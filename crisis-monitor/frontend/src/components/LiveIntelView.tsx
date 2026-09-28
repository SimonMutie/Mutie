import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { MapContainer, TileLayer, CircleMarker, Polygon, Polyline, Tooltip as LeafletTooltip, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json?url";
import { api, type LiveLayerCollection, type LiveLayerFeature, type IssPosition, type NewsItem, type RouteProfile, type RouteResult } from "../api";
import { BASEMAPS } from "./mapConstants";

/**
 * "Live Intelligence" — a new, separate view rather than a restyle of the
 * existing (light) dashboards/choropleth. Modeled on OSIRIS's own dark HUD
 * aesthetic (osirisai.live): a grouped, toggleable layer panel on the left,
 * a rotating 3D globe (or a flat 2D/Map/Sat projection, switchable) with
 * crisp country-level boundary lines, and monospace status readouts.
 * Nothing here touches IncidentsMap/IncidentSearch or their data.
 *
 * The 3D globe deliberately does NOT use a photographic/satellite Earth
 * texture — that's a "Sat" look, and OSIRIS's own 3D view is a dark
 * data-vis map (flat black sphere, thin white national borders, a subtle
 * lat/lng graticule), not imagery. Country outlines come from the same
 * world-atlas topology already bundled for the choropleth/GlobeWidget
 * elsewhere in this app (world-atlas/countries-110m.json), rendered as
 * three-globe polygons with a transparent fill and a visible stroke only —
 * "Sat" as an actual satellite photo basemap is reserved for the flat 2D
 * mode switcher below, matching what OSIRIS's own 3D/2D/Map/Sat buttons do.
 *
 * Layer sourcing, and why each one either is or isn't here:
 *  - Earthquakes / Natural Events / Conflict Reports / Air Traffic: real
 *    public feeds (USGS, NASA EONET, GDELT, OpenSky), proxied and
 *    normalized by the backend's /api/live-layers gateway.
 *  - Botnet C2s: abuse.ch's Feodo Tracker — a real, free, keyless,
 *    continuously-updated list of confirmed active botnet
 *    command-and-control servers. Labeled specifically as "Botnet C2s"
 *    rather than a generic "Cyberattacks" layer because that's precisely
 *    what it is: confirmed C2 infrastructure by hosting country (which may
 *    itself be a proxy/bulletproof-hosting jurisdiction), not an
 *    "attack in progress" animation — those vendor map visuals are
 *    illustrative, not live telemetry, and this view only shows real data.
 *  - My Incidents / My Alerts: this account's own data, already scoped by
 *    the backend's normal auth (client/country restrictions apply exactly
 *    as they do everywhere else in the app) — reusing the existing
 *    /api/incidents and /api/alerts endpoints rather than a new route.
 *  - Maritime: checked directly against OSIRIS's own open-source code
 *    (github.com/enzg/osiris-live) rather than assumed to have live AIS —
 *    it turns out OSIRIS's "Maritime" layer is itself a static reference
 *    dataset (major ports, naval bases, shipping chokepoints with real
 *    published stats), refreshed once a day, zero external API calls.
 *  - Deliberately NOT included: live CCTV, and the "Recon Toolkit" /
 *    "Marauder" style device-scanning tools OSIRIS's own UI shows — those
 *    are active reconnaissance/surveillance capabilities, not data layers,
 *    and this app isn't going to carry them regardless of whether a
 *    backend exists to power them. Submarine cables: a real open dataset
 *    exists but wasn't confirmed reachable in time for this pass.
 *
 * Right-side toolbar — OSIRIS shows several of these as its own icon rail;
 * the ones built here are the legitimate, non-reconnaissance subset:
 *  - Drawing Tools: click points on the map to measure a line's distance or
 *    a shape's area, then export the shape as GeoJSON. Pure client-side
 *    geometry (haversine distance, a standard spherical-polygon-area
 *    approximation) — no external API.
 *  - Route: turn-by-turn driving/walking/cycling directions between two
 *    clicked points, via the backend's /route proxy in front of OSRM's free
 *    public demo router (see that route's own comment — it's a demo
 *    instance, not a production SLA).
 *  - Live From Space: the ISS's real current position (open-notify.org,
 *    proxied/cached by the backend) plotted as a live marker, plus NASA's
 *    own public livestream embed.
 *  - Live Alerts: real headlines from a handful of official, first-party
 *    broadcaster/wire RSS feeds (BBC, Al Jazeera, NYT, UN News), parsed
 *    server-side since none of them set CORS headers for a browser fetch.
 *  - NOT built here (same reconnaissance boundary as above): "Recon
 *    Toolkit" (port/MAC/IP scanning, self-track) and "Marauder" (Bluetooth
 *    device sweeps).
 */

interface GlobePoint {
  id: string;
  layerKey: string;
  lat: number;
  lng: number;
  color: string;
  size: number;
  title: string;
  subtitle: string;
  time: string | null;
  url: string | null;
}

type LayerGroup = "Natural Hazards" | "Threats & Intel" | "Aviation" | "Maritime" | "My Data";

interface LayerDef {
  key: string;
  label: string;
  group: LayerGroup;
  color: string;
  fetcher: () => Promise<GlobePoint[]>;
}

function fromGateway(color: string, label: string) {
  return (collection: LiveLayerCollection): GlobePoint[] =>
    collection.features.map((f: LiveLayerFeature) => ({
      id: f.properties.id,
      layerKey: label,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      color,
      // OSIRIS's own points render as tiny flat 2D circles (roughly 3-9px,
      // via MapLibre) — three-globe's pointsData markers are real 3D
      // discs, which read as chunky next to that at any size much above
      // this. Kept small and in a narrow range on purpose to match that
      // crisp, minimal feel rather than the bigger default scale.
      size: 0.1 + f.properties.intensity * 0.16,
      title: f.properties.title,
      subtitle: `${f.properties.intensityLabel}${f.properties.detail ? ` — ${f.properties.detail}` : ""}`,
      time: f.properties.time,
      url: f.properties.url,
    }));
}

const LAYER_DEFS: LayerDef[] = [
  { key: "earthquakes", label: "Earthquakes", group: "Natural Hazards", color: "#ff5d5d", fetcher: async () => fromGateway("#ff5d5d", "Earthquakes")(await api.getLiveEarthquakes()) },
  { key: "natural-events", label: "Active Fires & Storms", group: "Natural Hazards", color: "#ffb020", fetcher: async () => fromGateway("#ffb020", "Natural Events")(await api.getLiveNaturalEvents()) },
  { key: "conflict-events", label: "Conflict Reports", group: "Threats & Intel", color: "#7c9cff", fetcher: async () => fromGateway("#7c9cff", "Conflict Reports")(await api.getLiveConflictEvents()) },
  {
    key: "malware-infrastructure",
    label: "Botnet C2 Servers",
    group: "Threats & Intel",
    color: "#ff4fa3",
    fetcher: async () => fromGateway("#ff4fa3", "Botnet C2 Infrastructure")(await api.getLiveMalwareInfrastructure()),
  },
  { key: "air-traffic", label: "Air Traffic", group: "Aviation", color: "#2fe0c8", fetcher: async () => fromGateway("#2fe0c8", "Air Traffic")(await api.getLiveAirTraffic()) },
  {
    key: "maritime",
    label: "Ports, Bases & Chokepoints",
    group: "Maritime",
    color: "#3fd0ff",
    fetcher: async () => fromGateway("#3fd0ff", "Maritime")(await api.getLiveMaritime()),
  },
  {
    key: "my-incidents",
    label: "My Incidents",
    group: "My Data",
    color: "#ff9de2",
    fetcher: async () => {
      const rows = await api.getIncidents({ limit: 2000 });
      const out: GlobePoint[] = [];
      for (const r of rows) {
        if (r.latitude == null || r.longitude == null) continue;
        out.push({
          id: r.id,
          layerKey: "My Incidents",
          lat: r.latitude,
          lng: r.longitude,
          color: "#ff9de2",
          size: 0.16,
          title: r.city || r.district || r.country || "Incident",
          subtitle: [r.sector, r.tactic].filter(Boolean).join(" — "),
          time: r.occurred_at,
          url: null,
        });
      }
      return out;
    },
  },
  {
    key: "my-alerts",
    label: "My Alerts",
    group: "My Data",
    color: "#ffd23f",
    fetcher: async () => {
      const rows = await api.getAlerts({ status: "open" });
      const out: GlobePoint[] = [];
      for (const r of rows) {
        if (r.geo_lat == null || r.geo_lng == null) continue;
        out.push({
          id: r.id,
          layerKey: "My Alerts",
          lat: r.geo_lat,
          lng: r.geo_lng,
          color: "#ffd23f",
          size: 0.18,
          title: r.title,
          subtitle: r.geo_label ?? r.level,
          time: r.created_at,
          url: null,
        });
      }
      return out;
    },
  },
];

const GROUP_ORDER: LayerGroup[] = ["Natural Hazards", "Threats & Intel", "Aviation", "Maritime", "My Data"];

/** Major real global container-shipping trunk routes, drawn as arcs
 *  between the hub ports the backend's /maritime layer already lists.
 *  OSIRIS itself has no shipping-lane rendering at all (checked directly
 *  against its source — no lane/route code exists there, and its "ship"
 *  layer is wired to a backend field that's never actually populated), so
 *  this isn't matching something OSIRIS has; it's a legitimate addition of
 *  well-known real trade routes, tied to the same Maritime toggle. Only
 *  drawn in 3D mode — a flat equirectangular Polyline through these same
 *  raw coordinates would visibly wrap the wrong way around the antimeridian
 *  on several of these Pacific-crossing routes, which is worse than not
 *  showing them there at all. */
const SHIPPING_LANES: { points: [number, number][]; label: string }[] = [
  { points: [[31.23, 121.47], [33.74, -118.27]], label: "Transpacific — Shanghai–Los Angeles" },
  { points: [[35.10, 129.04], [33.74, -118.27]], label: "Transpacific — Busan–Los Angeles" },
  { points: [[31.23, 121.47], [1.26, 103.84], [25.01, 55.06]], label: "Asia–Middle East — Shanghai–Singapore–Jebel Ali" },
  { points: [[1.26, 103.84], [51.90, 4.50]], label: "Asia–Europe — Singapore–Rotterdam" },
  { points: [[51.90, 4.50], [32.08, -81.09]], label: "Transatlantic — Rotterdam–Savannah" },
  { points: [[31.23, 121.47], [1.26, 103.84]], label: "Intra-Asia trunk — Shanghai–Singapore" },
];

const POLL_MS = 60_000;

type LayerState = { data: GlobePoint[] | null; loading: boolean; error: string | null };
type MapMode = "3d" | "2d" | "map" | "sat";

/** Which right-side tool panel is open, if any — at most one at a time, both
 *  because that's simpler state to reason about and because Drawing Tools
 *  and Route both interpret a map/globe click as their own next action, so
 *  two active together would fight over the same click. */
type RightTool = "draw" | "route" | "space" | "news" | null;
type DrawMode = "distance" | "area" | null;

/** [lat, lng] tuples throughout the drawing/route tools — matches how a
 *  map click naturally arrives (Leaflet's own LatLng, and this view's own
 *  onGlobeClick handler below), converted to GeoJSON's [lng, lat] order
 *  only at the export/API boundary. */
type LatLng = [number, number];

const EARTH_RADIUS_KM = 6371.0088;

function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function pathDistanceKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
  return total;
}

/** Standard spherical-polygon-area approximation (the same one behind most
 *  GIS "measure area" tools, sometimes credited to Chamberlain & Duquette /
 *  JPL) — accurate enough for a rough on-map measurement, not surveyed
 *  cadastral precision. Treats the point list as an implicitly closed ring
 *  (last point connects back to the first). */
function sphericalPolygonAreaKm2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[(i + 1) % points.length];
    total += (lng2 - lng1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

function formatKm(km: number): string {
  return km >= 1 ? `${km.toFixed(km >= 100 ? 0 : 1)} km` : `${Math.round(km * 1000)} m`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

/** Downloads a drawn shape as a standalone .geojson file — client-side only
 *  (Blob + a synthetic anchor click), no server round-trip needed since the
 *  shape only ever existed in this browser session anyway. */
function downloadDrawingAsGeoJson(points: LatLng[], mode: DrawMode) {
  if (!mode || points.length < 2) return;
  const coordinates = points.map(([lat, lng]) => [lng, lat]);
  const isArea = mode === "area" && points.length >= 3;
  const geometry = isArea ? { type: "Polygon" as const, coordinates: [[...coordinates, coordinates[0]]] } : { type: "LineString" as const, coordinates };
  const properties = isArea
    ? { measurement: "area", areaKm2: Number(sphericalPolygonAreaKm2(points).toFixed(3)) }
    : { measurement: "distance", distanceKm: Number(pathDistanceKm(points).toFixed(3)) };
  const fc = { type: "FeatureCollection", features: [{ type: "Feature", geometry, properties }] };
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `live-intel-${mode}-${Date.now()}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Country border polygons for the 3D globe — same world-atlas topology and
 *  topojson-client conversion GlobeWidget already uses for its choropleth,
 *  loaded independently here since this view is code-split from that one
 *  and shouldn't need to import a whole other component to reuse a JSON
 *  file. Fetched once; never changes at runtime. */
function useCountryBorders(): GeoJSON.Feature[] | null {
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(worldTopology)
      .then((r) => r.json())
      .then((topo: Topology) => {
        if (cancelled) return;
        const collection = feature(topo, topo.objects.countries as GeometryCollection) as unknown as GeoJSON.FeatureCollection;
        setFeatures(collection.features);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return features;
}

export default function LiveIntelView() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    earthquakes: true,
    "natural-events": true,
    "conflict-events": true,
    "air-traffic": false,
    "malware-infrastructure": false,
    maritime: false,
    "my-incidents": false,
    "my-alerts": false,
  });
  const [mapMode, setMapMode] = useState<MapMode>("3d");
  const [layers, setLayers] = useState<Record<string, LayerState>>(() =>
    Object.fromEntries(LAYER_DEFS.map((d) => [d.key, { data: null, loading: true, error: null }]))
  );
  const [clock, setClock] = useState(() => new Date());
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const countryBorders = useCountryBorders();

  // --- Right-side tools: at most one open at a time (see RightTool). ---
  const [activeTool, setActiveTool] = useState<RightTool>(null);

  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([]);

  const [routeMode, setRouteMode] = useState<RouteProfile>("driving");
  const [routeOrigin, setRouteOrigin] = useState<LatLng | null>(null);
  const [routeDestination, setRouteDestination] = useState<LatLng | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [issPos, setIssPos] = useState<IssPosition | null>(null);
  const [issError, setIssError] = useState<string | null>(null);

  const [newsItems, setNewsItems] = useState<NewsItem[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  // A click on the map/globe means something different depending on which
  // right-side tool is open: adds the next drawing vertex, or sets
  // whichever of origin/destination isn't picked yet (a third click starts
  // a fresh pair rather than silently doing nothing).
  function handleMapClick(lat: number, lng: number) {
    if (activeTool === "draw" && drawMode) {
      setDrawPoints((prev) => [...prev, [lat, lng]]);
    } else if (activeTool === "route") {
      if (!routeOrigin) setRouteOrigin([lat, lng]);
      else if (!routeDestination) setRouteDestination([lat, lng]);
      else {
        setRouteOrigin([lat, lng]);
        setRouteDestination(null);
        setRouteResult(null);
        setRouteError(null);
      }
    }
  }

  useEffect(() => {
    if (!routeOrigin || !routeDestination) return;
    let cancelled = false;
    setRouteLoading(true);
    setRouteError(null);
    api
      .getLiveRoute(routeOrigin, routeDestination, routeMode)
      .then((result) => {
        if (cancelled) return;
        setRouteResult(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setRouteResult(null);
        setRouteError(err instanceof Error ? err.message : "Route unavailable");
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [routeOrigin, routeDestination, routeMode]);

  useEffect(() => {
    if (activeTool !== "space") return;
    let cancelled = false;
    async function poll() {
      try {
        const pos = await api.getLiveIss();
        if (!cancelled) {
          setIssPos(pos);
          setIssError(null);
        }
      } catch (err) {
        if (!cancelled) setIssError(err instanceof Error ? err.message : "ISS feed unavailable");
      }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTool]);

  useEffect(() => {
    if (activeTool !== "news") return;
    let cancelled = false;
    async function poll() {
      setNewsLoading(true);
      try {
        const feed = await api.getLiveNews();
        if (!cancelled) {
          setNewsItems(feed.items);
          setNewsError(null);
        }
      } catch (err) {
        if (!cancelled) setNewsError(err instanceof Error ? err.message : "News feed unavailable");
      } finally {
        if (!cancelled) setNewsLoading(false);
      }
    }
    poll();
    const interval = setInterval(poll, 300_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTool]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mapMode !== "3d") return;
    const controls = globeRef.current?.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;
    }
  }, [size, mapMode]);

  useEffect(() => {
    let cancelled = false;
    async function loadLayer(def: LayerDef) {
      setLayers((prev) => ({ ...prev, [def.key]: { ...prev[def.key], loading: true } }));
      try {
        const data = await def.fetcher();
        if (cancelled) return;
        setLayers((prev) => ({ ...prev, [def.key]: { data, loading: false, error: null } }));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Feed unavailable";
        setLayers((prev) => ({ ...prev, [def.key]: { ...prev[def.key], loading: false, error: message } }));
      }
    }
    LAYER_DEFS.forEach(loadLayer);
    const interval = setInterval(() => LAYER_DEFS.forEach(loadLayer), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const points = useMemo(() => {
    const all: GlobePoint[] = [];
    for (const def of LAYER_DEFS) {
      if (!enabled[def.key]) continue;
      const data = layers[def.key]?.data;
      if (data) all.push(...data);
    }
    return all;
  }, [layers, enabled]);

  // Tool overlays rendered as ordinary GlobePoints — the marker rendering
  // (both the 3D pointsData layer and the flat CircleMarker map) is already
  // generic over color/size/title/subtitle, so a drawing vertex or a route
  // endpoint just piggybacks on that same code path rather than needing its
  // own renderer per map mode.
  const toolPoints = useMemo(() => {
    const extra: GlobePoint[] = [];
    if (activeTool === "space" && issPos) {
      extra.push({
        id: "iss",
        layerKey: "ISS",
        lat: issPos.lat,
        lng: issPos.lng,
        color: "#ffffff",
        size: 0.22,
        title: "International Space Station",
        subtitle: `~${issPos.speedKmh.toLocaleString()} km/h orbital ground speed`,
        time: issPos.timestamp,
        url: null,
      });
    }
    if (activeTool === "route") {
      if (routeOrigin) {
        extra.push({ id: "route-origin", layerKey: "Route", lat: routeOrigin[0], lng: routeOrigin[1], color: "#4dff9e", size: 0.2, title: "Origin", subtitle: "", time: null, url: null });
      }
      if (routeDestination) {
        extra.push({ id: "route-destination", layerKey: "Route", lat: routeDestination[0], lng: routeDestination[1], color: "#ff5d5d", size: 0.2, title: "Destination", subtitle: "", time: null, url: null });
      }
    }
    if (activeTool === "draw") {
      drawPoints.forEach(([lat, lng], i) => {
        extra.push({ id: `draw-${i}`, layerKey: "Drawing", lat, lng, color: "#ffd23f", size: 0.14, title: `Point ${i + 1}`, subtitle: "", time: null, url: null });
      });
    }
    return extra;
  }, [activeTool, issPos, routeOrigin, routeDestination, drawPoints]);

  const mapPoints = useMemo(() => [...points, ...toolPoints], [points, toolPoints]);

  // Draw/route lines, merged alongside the shipping lanes for the 3D globe's
  // single pathsData layer — a color field on each entry (shipping lanes
  // have none, so they fall back to their usual blue) is what tells
  // pathColor apart, rather than needing three separate path layers.
  const globePaths = useMemo(() => {
    const lanes = enabled.maritime ? SHIPPING_LANES : [];
    const drawPath =
      drawMode === "distance" && drawPoints.length >= 2 ? [{ points: drawPoints, label: "Measured distance", color: "#ffd23f" }] : [];
    const routePath =
      routeResult && routeResult.coordinates.length >= 2
        ? [{ points: routeResult.coordinates.map(([lng, lat]) => [lat, lng] as LatLng), label: "Route", color: "#4dff9e" }]
        : [];
    return [...lanes, ...drawPath, ...routePath];
  }, [enabled.maritime, drawMode, drawPoints, routeResult]);

  // Same idea for the 3D globe's polygon layer — country borders plus, when
  // area-measuring, the in-progress shape itself (flagged so
  // polygonCapColor/polygonStrokeColor can render it distinctly from an
  // ordinary country border).
  const globePolygons = useMemo(() => {
    if (drawMode !== "area" || drawPoints.length < 3) return countryBorders ?? [];
    const ring = [...drawPoints.map(([lat, lng]) => [lng, lat]), [drawPoints[0][1], drawPoints[0][0]]];
    const drawFeature: GeoJSON.Feature = { type: "Feature", properties: { __draw: true }, geometry: { type: "Polygon", coordinates: [ring] } };
    return [...(countryBorders ?? []), drawFeature];
  }, [countryBorders, drawMode, drawPoints]);

  const routeLineForFlatMap = useMemo<LatLng[] | undefined>(
    () => (routeResult ? routeResult.coordinates.map(([lng, lat]) => [lat, lng] as LatLng) : undefined),
    [routeResult]
  );

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "#000308",
        color: "#d7e4f2",
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
      }}
    >
      <div ref={containerRef} style={{ position: "relative", flex: 1 }}>
        {mapMode === "3d" ? (
          <Globe
            ref={globeRef}
            width={size.width}
            height={size.height}
            backgroundColor="#000308"
            globeImageUrl={null}
            showGlobe
            showGraticules
            showAtmosphere
            atmosphereColor="#5d8cff"
            atmosphereAltitude={0.18}
            polygonsData={globePolygons}
            polygonCapColor={(f: object) => ((f as GeoJSON.Feature).properties?.__draw ? "rgba(255,210,63,0.3)" : "rgba(10,16,28,0.55)")}
            polygonSideColor={() => "rgba(0,0,0,0.2)"}
            polygonStrokeColor={(f: object) => ((f as GeoJSON.Feature).properties?.__draw ? "#ffd23f" : "rgba(210,225,255,0.55)")}
            polygonAltitude={0.001}
            polygonLabel={(f: object) => {
              const name = (f as GeoJSON.Feature).properties?.name as string | undefined;
              return name ? `<div style="font-family:monospace;font-size:12px">${escapeHtml(name)}</div>` : "";
            }}
            onGlobeClick={(coords) => handleMapClick(coords.lat, coords.lng)}
            onPolygonClick={(_p, _e, coords) => handleMapClick(coords.lat, coords.lng)}
            pointsData={mapPoints}
            pointLat={(d: object) => (d as GlobePoint).lat}
            pointLng={(d: object) => (d as GlobePoint).lng}
            pointColor={(d: object) => (d as GlobePoint).color}
            pointRadius={(d: object) => (d as GlobePoint).size}
            pointAltitude={0.002}
            pointResolution={16}
            pathsData={globePaths}
            pathPoints={(d: object) => (d as { points: LatLng[] }).points}
            pathPointLat={(p: unknown) => (p as LatLng)[0]}
            pathPointLng={(p: unknown) => (p as LatLng)[1]}
            pathColor={(d: object) => (d as { color?: string }).color ?? "#3fd0ff"}
            pathLabel={(d: object) => (d as { label: string }).label}
            pathStroke={0.4}
            pathDashLength={0.4}
            pathDashGap={0.2}
            pathDashAnimateTime={6000}
            pathTransitionDuration={0}
            pointLabel={(d: object) => {
              const p = d as GlobePoint;
              return `<div style="font-family:monospace;font-size:12px;max-width:220px">
                <b>${escapeHtml(p.title)}</b><br/>
                <span style="opacity:0.75">${escapeHtml(p.layerKey)}</span><br/>
                ${escapeHtml(p.subtitle)}
                ${p.time ? `<br/>${new Date(p.time).toLocaleString()}` : ""}
              </div>`;
            }}
          />
        ) : (
          <FlatMap
            mode={mapMode}
            points={mapPoints}
            onMapClick={activeTool === "draw" || activeTool === "route" ? handleMapClick : undefined}
            drawMode={activeTool === "draw" ? drawMode : null}
            drawPoints={drawPoints}
            routeLine={activeTool === "route" ? routeLineForFlatMap : undefined}
          />
        )}

        <LayerPanel defs={LAYER_DEFS} enabled={enabled} layers={layers} onToggle={(key) => setEnabled((prev) => ({ ...prev, [key]: !prev[key] }))} />
        <MapModeSwitcher mode={mapMode} onChange={setMapMode} />
        <StatusBar totalFeatures={points.length} clock={clock} />

        <RightToolRail
          active={activeTool}
          onSelect={(tool) =>
            setActiveTool((prev) => {
              const next = prev === tool ? null : tool;
              // Leaving a tool clears its in-progress state, rather than
              // leaving a half-drawn shape or a stale route sitting on the
              // map invisibly (its panel gone, but its data/click-handling
              // still live) the next time some other tool is opened.
              if (next !== "draw") {
                setDrawMode(null);
                setDrawPoints([]);
              }
              if (next !== "route") {
                setRouteOrigin(null);
                setRouteDestination(null);
                setRouteResult(null);
                setRouteError(null);
              }
              return next;
            })
          }
        />

        {activeTool === "draw" && (
          <DrawingToolPanel
            mode={drawMode}
            points={drawPoints}
            onSetMode={(m) => {
              setDrawMode(m);
              setDrawPoints([]);
            }}
            onClear={() => setDrawPoints([])}
            onExport={() => downloadDrawingAsGeoJson(drawPoints, drawMode)}
          />
        )}
        {activeTool === "route" && (
          <RoutePlannerPanel
            mode={routeMode}
            onModeChange={setRouteMode}
            origin={routeOrigin}
            destination={routeDestination}
            result={routeResult}
            loading={routeLoading}
            error={routeError}
            onClear={() => {
              setRouteOrigin(null);
              setRouteDestination(null);
              setRouteResult(null);
              setRouteError(null);
            }}
          />
        )}
        {activeTool === "space" && <LiveSpacePanel pos={issPos} error={issError} />}
        {activeTool === "news" && <NewsFeedPanel items={newsItems} loading={newsLoading} error={newsError} />}
      </div>
    </div>
  );
}

/** The flat-projection modes (2D / Map / Sat) reuse the same Leaflet stack
 *  already powering IncidentsMap/IncidentSearch elsewhere in this app,
 *  rather than trying to make three-globe fake a flat view — it's a real
 *  2D map, not a globe photographed from directly above. "2D" and "Map"
 *  both use street-style tiles (2D dark, Map light) — Sat uses satellite
 *  imagery, matching what the three style buttons mean on OSIRIS itself. */
function FlatMap({
  mode,
  points,
  onMapClick,
  drawMode,
  drawPoints,
  routeLine,
}: {
  mode: Exclude<MapMode, "3d">;
  points: GlobePoint[];
  /** Set only while Drawing Tools or Route is the active right-side tool —
   *  its presence is literally what makes a map click do something. */
  onMapClick?: (lat: number, lng: number) => void;
  drawMode?: DrawMode;
  drawPoints?: LatLng[];
  routeLine?: LatLng[];
}) {
  const tile = mode === "sat" ? BASEMAPS.esriImagery : mode === "map" ? BASEMAPS.osm : BASEMAPS.dark;
  return (
    <MapContainer center={[15, 20]} zoom={2} minZoom={2} worldCopyJump style={{ height: "100%", width: "100%", background: "#000308" }}>
      <TileLayer url={tile.url} attribution={tile.attribution} />
      {onMapClick && <MapClickCapture onClick={onMapClick} />}
      {drawMode === "distance" && drawPoints && drawPoints.length >= 2 && (
        <Polyline positions={drawPoints} pathOptions={{ color: "#ffd23f", weight: 2 }} />
      )}
      {drawMode === "area" && drawPoints && drawPoints.length >= 3 && (
        <Polygon positions={drawPoints} pathOptions={{ color: "#ffd23f", fillColor: "#ffd23f", fillOpacity: 0.25, weight: 2 }} />
      )}
      {routeLine && routeLine.length >= 2 && <Polyline positions={routeLine} pathOptions={{ color: "#4dff9e", weight: 3 }} />}
      {points.map((p) => (
        <CircleMarker key={`${p.layerKey}:${p.id}`} center={[p.lat, p.lng]} radius={3 + p.size * 18} pathOptions={{ color: p.color, fillColor: p.color, fillOpacity: 0.6, weight: 1 }}>
          <LeafletTooltip direction="top">
            <div style={{ fontFamily: "monospace", fontSize: 12 }}>
              <b>{p.title}</b>
              <br />
              <span style={{ opacity: 0.7 }}>{p.layerKey}</span>
              <br />
              {p.subtitle}
            </div>
          </LeafletTooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

/** Bridges Leaflet's own click event to this view's tool click-handling —
 *  a null-rendering child rather than a prop on MapContainer itself since
 *  react-leaflet only exposes map events through hooks used from inside
 *  the map's own React context. */
function MapClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Grouped, collapsible left-side toggle panel — OSIRIS's own layout, one
 *  card per category with a switch + live count per row, rather than the
 *  earlier flat row of chips. Kept as plain CSS toggles (not a heavier
 *  component) since this can hold a couple dozen rows and needs to stay
 *  fast to click through. */
function LayerPanel({
  defs,
  enabled,
  layers,
  onToggle,
}: {
  defs: LayerDef[];
  enabled: Record<string, boolean>;
  layers: Record<string, LayerState>;
  onToggle: (key: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const byGroup = useMemo(() => {
    const map = new Map<LayerGroup, LayerDef[]>();
    for (const def of defs) {
      if (!map.has(def.group)) map.set(def.group, []);
      map.get(def.group)!.push(def);
    }
    return map;
  }, [defs]);

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 500,
        width: 240,
        maxHeight: "calc(100% - 90px)",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7c9cff", fontWeight: 700, padding: "2px 4px 4px" }}>
        Live Intelligence
      </div>

      {GROUP_ORDER.map((group) => {
        const rows = byGroup.get(group);
        if (!rows || rows.length === 0) return null;
        const isCollapsed = collapsed[group];
        return (
          <div key={group} style={{ background: "rgba(6,10,18,0.82)", border: "1px solid rgba(124,156,255,0.18)", borderRadius: 8, backdropFilter: "blur(4px)", overflow: "hidden" }}>
            <button
              onClick={() => setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }))}
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "7px 10px",
                background: "transparent",
                border: "none",
                borderBottom: isCollapsed ? "none" : "1px solid rgba(124,156,255,0.12)",
                color: "#9fb3d9",
                fontSize: 10.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {group}
              <span style={{ opacity: 0.5 }}>{isCollapsed ? "▸" : "▾"}</span>
            </button>
            {!isCollapsed &&
              rows.map((def) => {
                const state = layers[def.key];
                const isOn = enabled[def.key];
                const count = state?.data?.length ?? 0;
                return (
                  <button
                    key={def.key}
                    onClick={() => onToggle(def.key)}
                    title={state?.error ?? undefined}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px",
                      background: "transparent",
                      border: "none",
                      borderTop: "1px solid rgba(124,156,255,0.06)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textAlign: "left",
                    }}
                  >
                    <ToggleSwitch on={isOn} color={def.color} />
                    <span style={{ flex: 1, fontSize: 12, color: isOn ? "#eef3ff" : "#7f8ea3" }}>{def.label}</span>
                    <span style={{ fontSize: 11, color: state?.error ? "#ff5d5d" : "#7f8ea3" }}>
                      {state?.loading ? "…" : state?.error ? "ERR" : count}
                    </span>
                  </button>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

function ToggleSwitch({ on, color }: { on: boolean; color: string }) {
  return (
    <span
      style={{
        position: "relative",
        width: 26,
        height: 14,
        borderRadius: 999,
        background: on ? `${color}44` : "rgba(255,255,255,0.12)",
        border: `1px solid ${on ? color : "rgba(255,255,255,0.2)"}`,
        flexShrink: 0,
        transition: "background 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 1,
          left: on ? 12 : 1,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: on ? color : "#8a97ab",
          transition: "left 0.15s",
        }}
      />
    </span>
  );
}

function MapModeSwitcher({ mode, onChange }: { mode: MapMode; onChange: (m: MapMode) => void }) {
  const options: { key: MapMode; label: string }[] = [
    { key: "3d", label: "3D" },
    { key: "2d", label: "2D" },
    { key: "map", label: "Map" },
    { key: "sat", label: "Sat" },
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 44,
        zIndex: 500,
        display: "flex",
        gap: 2,
        background: "rgba(6,10,18,0.82)",
        border: "1px solid rgba(124,156,255,0.18)",
        borderRadius: 8,
        padding: 3,
        backdropFilter: "blur(4px)",
      }}
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          style={{
            fontSize: 11,
            padding: "5px 10px",
            borderRadius: 6,
            border: "none",
            background: mode === opt.key ? "#7c9cff33" : "transparent",
            color: mode === opt.key ? "#eef3ff" : "#7f8ea3",
            fontWeight: mode === opt.key ? 700 : 400,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StatusBar({ totalFeatures, clock }: { totalFeatures: number; clock: Date }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        zIndex: 500,
        display: "flex",
        gap: 16,
        fontSize: 11,
        color: "#7f8ea3",
        background: "rgba(0,3,8,0.72)",
        border: "1px solid rgba(124,156,255,0.18)",
        borderRadius: 6,
        padding: "6px 12px",
        backdropFilter: "blur(4px)",
      }}
    >
      <span>
        TRACKS <span style={{ color: "#eef3ff" }}>{totalFeatures}</span>
      </span>
      <span>{clock.toISOString().replace("T", " ").slice(0, 19)} UTC</span>
    </div>
  );
}

/** Right-side icon rail — the OSIRIS-style vertical strip of tool buttons,
 *  mirroring the left LayerPanel's visual language (same dark glass card,
 *  same border color) but icon-only + a short label, since this rail holds
 *  tools rather than a scrollable list of toggles. */
function RightToolRail({ active, onSelect }: { active: RightTool; onSelect: (tool: Exclude<RightTool, null>) => void }) {
  const tools: { key: Exclude<RightTool, null>; icon: string; label: string }[] = [
    { key: "draw", icon: "✏", label: "Draw" },
    { key: "route", icon: "➜", label: "Route" },
    { key: "space", icon: "◎", label: "Space" },
    { key: "news", icon: "☰", label: "Alerts" },
  ];
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 500,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        background: "rgba(6,10,18,0.82)",
        border: "1px solid rgba(124,156,255,0.18)",
        borderRadius: 8,
        padding: 4,
        backdropFilter: "blur(4px)",
      }}
    >
      {tools.map((t) => (
        <button
          key={t.key}
          onClick={() => onSelect(t.key)}
          title={t.label}
          style={{
            width: 52,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            padding: "7px 4px",
            background: active === t.key ? "#7c9cff33" : "transparent",
            border: "none",
            borderRadius: 6,
            color: active === t.key ? "#eef3ff" : "#7f8ea3",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 15, lineHeight: 1 }}>{t.icon}</span>
          <span style={{ fontSize: 9.5, letterSpacing: "0.04em", textTransform: "uppercase" }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Shared shell every right-side tool panel renders inside — same
 *  positioning (just left of the icon rail) and card chrome as the rail
 *  itself, so opening any tool feels like one consistent system rather
 *  than four separately-designed popovers. */
function ToolPanelShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 76,
        zIndex: 500,
        width: 260,
        maxHeight: "calc(100% - 24px)",
        overflowY: "auto",
        background: "rgba(6,10,18,0.9)",
        border: "1px solid rgba(124,156,255,0.18)",
        borderRadius: 8,
        backdropFilter: "blur(4px)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#7c9cff", fontWeight: 700 }}>{title}</div>
      {children}
    </div>
  );
}

function ToolButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        fontSize: 11,
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${active ? "#7c9cff" : "rgba(124,156,255,0.25)"}`,
        background: active ? "#7c9cff33" : "transparent",
        color: active ? "#eef3ff" : "#9fb3d9",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function DrawingToolPanel({
  mode,
  points,
  onSetMode,
  onClear,
  onExport,
}: {
  mode: DrawMode;
  points: LatLng[];
  onSetMode: (m: DrawMode) => void;
  onClear: () => void;
  onExport: () => void;
}) {
  const distanceKm = mode === "distance" ? pathDistanceKm(points) : 0;
  const areaKm2 = mode === "area" ? sphericalPolygonAreaKm2(points) : 0;
  const canExport = (mode === "distance" && points.length >= 2) || (mode === "area" && points.length >= 3);
  return (
    <ToolPanelShell title="Drawing Tools">
      <div style={{ display: "flex", gap: 6 }}>
        <ToolButton active={mode === "distance"} onClick={() => onSetMode(mode === "distance" ? null : "distance")}>
          Distance
        </ToolButton>
        <ToolButton active={mode === "area"} onClick={() => onSetMode(mode === "area" ? null : "area")}>
          Area
        </ToolButton>
      </div>
      {mode ? (
        <div style={{ fontSize: 11, color: "#9fb3d9", lineHeight: 1.6 }}>
          Click the map to add points{mode === "area" ? " (closes automatically)" : ""}.
          <br />
          {points.length} point{points.length === 1 ? "" : "s"} placed.
          {mode === "distance" && points.length >= 2 && (
            <>
              <br />
              Distance: <b style={{ color: "#eef3ff" }}>{formatKm(distanceKm)}</b>
            </>
          )}
          {mode === "area" && points.length >= 3 && (
            <>
              <br />
              Area: <b style={{ color: "#eef3ff" }}>{areaKm2 >= 1 ? `${areaKm2.toFixed(1)} km²` : `${(areaKm2 * 1e6).toFixed(0)} m²`}</b>
            </>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "#7f8ea3" }}>Pick Distance or Area to start placing points.</div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <ToolButton onClick={onClear}>Clear</ToolButton>
        <ToolButton onClick={onExport}>{canExport ? "Export GeoJSON" : "Export"}</ToolButton>
      </div>
    </ToolPanelShell>
  );
}

function RoutePlannerPanel({
  mode,
  onModeChange,
  origin,
  destination,
  result,
  loading,
  error,
  onClear,
}: {
  mode: RouteProfile;
  onModeChange: (m: RouteProfile) => void;
  origin: LatLng | null;
  destination: LatLng | null;
  result: RouteResult | null;
  loading: boolean;
  error: string | null;
  onClear: () => void;
}) {
  const profiles: { key: RouteProfile; label: string }[] = [
    { key: "driving", label: "Drive" },
    { key: "walking", label: "Walk" },
    { key: "cycling", label: "Bike" },
  ];
  return (
    <ToolPanelShell title="Route">
      <div style={{ display: "flex", gap: 4 }}>
        {profiles.map((p) => (
          <ToolButton key={p.key} active={mode === p.key} onClick={() => onModeChange(p.key)}>
            {p.label}
          </ToolButton>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#9fb3d9", lineHeight: 1.6 }}>
        {!origin && "Click the map to set an origin."}
        {origin && !destination && "Now click a destination."}
        {origin && destination && !loading && !error && !result && "Routing…"}
      </div>
      {loading && <div style={{ fontSize: 11, color: "#7f8ea3" }}>Routing…</div>}
      {error && <div style={{ fontSize: 11, color: "#ff5d5d" }}>{error}</div>}
      {result && (
        <div style={{ fontSize: 11, color: "#9fb3d9", lineHeight: 1.6 }}>
          Distance: <b style={{ color: "#eef3ff" }}>{formatKm(result.distanceMeters / 1000)}</b>
          <br />
          Duration: <b style={{ color: "#eef3ff" }}>{formatDuration(result.durationSeconds)}</b>
        </div>
      )}
      <div style={{ fontSize: 10, color: "#7f8ea3", lineHeight: 1.5 }}>
        Routed via OSRM's free public demo server — fine for occasional use, not a guaranteed production service.
      </div>
      <ToolButton onClick={onClear}>Clear</ToolButton>
    </ToolPanelShell>
  );
}

function LiveSpacePanel({ pos, error }: { pos: IssPosition | null; error: string | null }) {
  return (
    <ToolPanelShell title="Live From Space">
      {error && <div style={{ fontSize: 11, color: "#ff5d5d" }}>{error}</div>}
      {pos ? (
        <div style={{ fontSize: 11, color: "#9fb3d9", lineHeight: 1.6 }}>
          ISS position: <b style={{ color: "#eef3ff" }}>{pos.lat.toFixed(2)}, {pos.lng.toFixed(2)}</b>
          <br />
          Ground speed: <b style={{ color: "#eef3ff" }}>~{pos.speedKmh.toLocaleString()} km/h</b>
          <br />
          As of {new Date(pos.timestamp).toLocaleTimeString()}
        </div>
      ) : (
        !error && <div style={{ fontSize: 11, color: "#7f8ea3" }}>Locating ISS…</div>
      )}
      <div style={{ borderRadius: 6, overflow: "hidden", aspectRatio: "16 / 9", background: "#000" }}>
        <iframe
          title="NASA live"
          src="https://www.youtube.com/embed/live_stream?channel=UCLA_DiR1FfKNvjuUpBHmylQ&autoplay=0&mute=1"
          style={{ width: "100%", height: "100%", border: "none" }}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div style={{ fontSize: 10, color: "#7f8ea3" }}>NASA's public live channel — plays whatever NASA currently has live (ISS views, launches, briefings).</div>
    </ToolPanelShell>
  );
}

function NewsFeedPanel({ items, loading, error }: { items: NewsItem[] | null; loading: boolean; error: string | null }) {
  return (
    <ToolPanelShell title="Live Alerts">
      {loading && !items && <div style={{ fontSize: 11, color: "#7f8ea3" }}>Loading headlines…</div>}
      {error && <div style={{ fontSize: 11, color: "#ff5d5d" }}>{error}</div>}
      {items && items.length === 0 && !error && <div style={{ fontSize: 11, color: "#7f8ea3" }}>No headlines available right now.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items?.map((item) => (
          <a
            key={item.id}
            href={item.link}
            target="_blank"
            rel="noreferrer"
            style={{ display: "block", textDecoration: "none", padding: "6px 0", borderBottom: "1px solid rgba(124,156,255,0.1)" }}
          >
            <div style={{ fontSize: 12, color: "#eef3ff", lineHeight: 1.35 }}>{item.title}</div>
            <div style={{ fontSize: 10, color: "#7f8ea3", marginTop: 2 }}>
              {item.source}
              {item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleString()}` : ""}
            </div>
          </a>
        ))}
      </div>
    </ToolPanelShell>
  );
}
