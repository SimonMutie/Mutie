import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import type { IncidentItem } from "../api";

interface Props {
  incidents: IncidentItem[];
}

const BASEMAPS = {
  osm: {
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  esriStreet: {
    label: "Esri Streets",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
  esriImagery: {
    label: "Esri Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
} as const;

type BasemapKey = keyof typeof BASEMAPS;

function severityColor(severity: string | null | undefined): string {
  const s = (severity ?? "").toLowerCase();
  if (/(critical|extreme|severe|high)/.test(s)) return "#d1352b";
  if (/(elevated|moderate|medium|med\b)/.test(s)) return "#b3690b";
  if (/(low|minor|minimal)/.test(s)) return "#17924f";
  return "#2f66f0";
}

function totalCasualties(i: IncidentItem): number {
  return (
    (i.civilian_death_child ?? 0) +
    (i.civilian_death_female ?? 0) +
    (i.civilian_death_male ?? 0) +
    (i.civilian_death_unknown ?? 0) +
    (i.civilian_injury_female ?? 0) +
    (i.civilian_injury_male ?? 0) +
    (i.civilian_injury_unknown ?? 0)
  );
}

// --- distance helpers: flat-km approximation via a local reference latitude,
// accurate enough for the city/regional scale a "near this route" filter needs ---
const KM_PER_DEG_LAT = 111.32;
function kmPerDegLng(lat: number) {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}
function toXY(lat: number, lng: number, refLat: number) {
  return { x: lng * kmPerDegLng(refLat), y: lat * KM_PER_DEG_LAT };
}
function pointToSegmentDistKm(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Distance in km from a point to the nearest segment of a route polyline.
 *  Downsamples very dense route geometries so this stays cheap even with
 *  hundreds/thousands of incidents against a long route. */
function distanceToRouteKm(lat: number, lng: number, routeLatLngs: [number, number][]): number {
  if (routeLatLngs.length === 0) return Infinity;
  const refLat = routeLatLngs[Math.floor(routeLatLngs.length / 2)][0];
  const p = toXY(lat, lng, refLat);

  const MAX_SEGMENTS = 400;
  const step = Math.max(1, Math.floor(routeLatLngs.length / MAX_SEGMENTS));
  let min = Infinity;
  for (let i = 0; i + step < routeLatLngs.length; i += step) {
    const a = toXY(routeLatLngs[i][0], routeLatLngs[i][1], refLat);
    const b = toXY(routeLatLngs[i + step][0], routeLatLngs[i + step][1], refLat);
    const d = pointToSegmentDistKm(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

type RoutePick = "idle" | "picking-a" | "picking-b";

interface RouteState {
  a: [number, number] | null;
  b: [number, number] | null;
  geometry: [number, number][] | null;
  distanceKm: number | null;
  durationMin: number | null;
  loading: boolean;
  error: string | null;
}

function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

async function fetchRoute(a: [number, number], b: [number, number]): Promise<{ geometry: [number, number][]; distanceKm: number; durationMin: number }> {
  // OSRM's public demo server — free, no API key, but explicitly not meant for
  // heavy/production traffic. Fine for occasional route lookups here; a
  // production deployment would want a self-hosted OSRM instance or a paid
  // routing API (Mapbox/ORS/Google) instead.
  const url = `https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Routing service returned ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.[0]) throw new Error("No route found between those two points");
  const route = data.routes[0];
  const geometry: [number, number][] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
  return { geometry, distanceKm: route.distance / 1000, durationMin: route.duration / 60 };
}

export default function IncidentsRouteMap({ incidents }: Props) {
  const [basemap, setBasemap] = useState<BasemapKey>("osm");
  const [routePick, setRoutePick] = useState<RoutePick>("idle");
  const [route, setRoute] = useState<RouteState>({ a: null, b: null, geometry: null, distanceKm: null, durationMin: null, loading: false, error: null });
  const [bufferKm, setBufferKm] = useState(5);
  const requestSeq = useRef(0);

  const geoIncidents = useMemo(() => incidents.filter((i) => i.latitude != null && i.longitude != null), [incidents]);

  const initialCenter = useMemo((): LatLngExpression => {
    if (geoIncidents.length === 0) return [1, 20];
    const avgLat = geoIncidents.reduce((s, i) => s + i.latitude!, 0) / geoIncidents.length;
    const avgLng = geoIncidents.reduce((s, i) => s + i.longitude!, 0) / geoIncidents.length;
    return [avgLat, avgLng];
  }, [geoIncidents]);

  useEffect(() => {
    if (!route.a || !route.b) return;
    const seq = ++requestSeq.current;
    setRoute((r) => ({ ...r, loading: true, error: null }));
    fetchRoute(route.a, route.b)
      .then(({ geometry, distanceKm, durationMin }) => {
        if (seq !== requestSeq.current) return;
        setRoute((r) => ({ ...r, geometry, distanceKm, durationMin, loading: false }));
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setRoute((r) => ({ ...r, loading: false, error: err instanceof Error ? err.message : "Couldn't fetch a route" }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.a, route.b]);

  const nearRouteIds = useMemo(() => {
    if (!route.geometry) return null;
    const ids = new Set<string>();
    for (const i of geoIncidents) {
      if (distanceToRouteKm(i.latitude!, i.longitude!, route.geometry) <= bufferKm) ids.add(i.id);
    }
    return ids;
  }, [route.geometry, bufferKm, geoIncidents]);

  function handleMapClick(lat: number, lng: number) {
    if (routePick === "picking-a") {
      setRoute({ a: [lat, lng], b: null, geometry: null, distanceKm: null, durationMin: null, loading: false, error: null });
      setRoutePick("picking-b");
    } else if (routePick === "picking-b") {
      setRoute((r) => ({ ...r, b: [lat, lng] }));
      setRoutePick("idle");
    }
  }

  function clearRoute() {
    setRoute({ a: null, b: null, geometry: null, distanceKm: null, durationMin: null, loading: false, error: null });
    setRoutePick("idle");
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* controls */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 10,
          boxShadow: "0 4px 16px rgba(19,23,34,0.12)",
          maxWidth: 260,
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
            <button key={k} onClick={() => setBasemap(k)} style={chipStyle(basemap === k)}>
              {BASEMAPS[k].label}
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: "var(--border-soft)" }} />

        {routePick === "idle" && !route.a && (
          <button onClick={() => setRoutePick("picking-a")} style={primaryChipStyle}>
            Plan a route
          </button>
        )}
        {routePick === "picking-a" && <div style={hintStyle}>Click the map to set the start point (A)</div>}
        {routePick === "picking-b" && <div style={hintStyle}>Click the map to set the end point (B)</div>}

        {route.loading && <div style={hintStyle}>Fetching route…</div>}
        {route.error && <div style={{ ...hintStyle, color: "var(--critical)" }}>{route.error}</div>}
        {route.distanceKm != null && route.durationMin != null && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {route.distanceKm.toFixed(1)} km · ~{Math.round(route.durationMin)} min drive
          </div>
        )}

        {route.geometry && (
          <>
            <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Show incidents within {bufferKm} km of route
              <input
                type="range"
                min={1}
                max={50}
                value={bufferKm}
                onChange={(e) => setBufferKm(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </label>
            {nearRouteIds && <div style={{ fontSize: 12, fontWeight: 600 }}>{nearRouteIds.size} incidents near this route</div>}
          </>
        )}

        {(route.a || routePick !== "idle") && (
          <button onClick={clearRoute} style={secondaryChipStyle}>
            Clear route
          </button>
        )}
      </div>

      <MapContainer center={initialCenter} zoom={geoIncidents.length ? 6 : 2} style={{ width: "100%", height: "100%" }} scrollWheelZoom>
        <TileLayer url={BASEMAPS[basemap].url} attribution={BASEMAPS[basemap].attribution} maxZoom={19} />
        <ClickCapture onClick={handleMapClick} />

        {geoIncidents.map((i) => {
          const highlighted = !nearRouteIds || nearRouteIds.has(i.id);
          return (
            <CircleMarker
              key={i.id}
              center={[i.latitude!, i.longitude!]}
              radius={highlighted ? 6 : 4}
              pathOptions={{
                color: severityColor(i.severity),
                fillColor: severityColor(i.severity),
                fillOpacity: highlighted ? 0.85 : 0.25,
                opacity: highlighted ? 1 : 0.3,
                weight: 1,
              }}
            >
              <Popup>
                <div style={{ fontSize: 13, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>
                    {[i.city, i.province].filter(Boolean).join(", ") || i.precise_location || "Unknown location"}
                  </div>
                  <div style={{ color: "#666", marginBottom: 4 }}>{i.occurred_date || ""}</div>
                  <div style={{ marginBottom: 4 }}>{[i.sector, i.tactic, i.actor].filter(Boolean).join(" · ")}</div>
                  {totalCasualties(i) > 0 && <div style={{ color: "#d1352b" }}>{totalCasualties(i)} civilian casualties</div>}
                  {i.details && <div style={{ marginTop: 4, color: "#444" }}>{i.details.slice(0, 200)}</div>}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {route.a && (
          <CircleMarker center={route.a} radius={8} pathOptions={{ color: "#0d9488", fillColor: "#0d9488", fillOpacity: 1, weight: 2 }}>
            <Popup>Start (A)</Popup>
          </CircleMarker>
        )}
        {route.b && (
          <CircleMarker center={route.b} radius={8} pathOptions={{ color: "#2f66f0", fillColor: "#2f66f0", fillOpacity: 1, weight: 2 }}>
            <Popup>End (B)</Popup>
          </CircleMarker>
        )}
        {route.geometry && <Polyline positions={route.geometry} pathOptions={{ color: "#0d9488", weight: 4, opacity: 0.75 }} />}
      </MapContainer>
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 5,
    border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
    background: active ? "var(--signal-dim)" : "transparent",
    color: "var(--text-primary)",
    cursor: "pointer",
    flex: 1,
  };
}

const primaryChipStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--signal)",
  background: "var(--signal-dim)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontWeight: 600,
};

const secondaryChipStyle: React.CSSProperties = {
  fontSize: 11.5,
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-muted)",
};
