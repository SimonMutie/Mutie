import { useEffect, useMemo, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LeafletTooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json?url";
import { api, type LiveLayerCollection, type LiveLayerFeature } from "../api";
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
            polygonsData={countryBorders ?? []}
            polygonCapColor={() => "rgba(10,16,28,0.55)"}
            polygonSideColor={() => "rgba(0,0,0,0.2)"}
            polygonStrokeColor={() => "rgba(210,225,255,0.55)"}
            polygonAltitude={0.001}
            polygonLabel={(f: object) => {
              const name = (f as GeoJSON.Feature).properties?.name as string | undefined;
              return name ? `<div style="font-family:monospace;font-size:12px">${escapeHtml(name)}</div>` : "";
            }}
            pointsData={points}
            pointLat={(d: object) => (d as GlobePoint).lat}
            pointLng={(d: object) => (d as GlobePoint).lng}
            pointColor={(d: object) => (d as GlobePoint).color}
            pointRadius={(d: object) => (d as GlobePoint).size}
            pointAltitude={0.002}
            pointResolution={16}
            pathsData={enabled.maritime ? SHIPPING_LANES : []}
            pathPoints={(d: object) => (d as { points: [number, number][] }).points}
            pathPointLat={(p: unknown) => (p as [number, number])[0]}
            pathPointLng={(p: unknown) => (p as [number, number])[1]}
            pathColor={() => "#3fd0ff"}
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
          <FlatMap mode={mapMode} points={points} />
        )}

        <LayerPanel defs={LAYER_DEFS} enabled={enabled} layers={layers} onToggle={(key) => setEnabled((prev) => ({ ...prev, [key]: !prev[key] }))} />
        <MapModeSwitcher mode={mapMode} onChange={setMapMode} />
        <StatusBar totalFeatures={points.length} clock={clock} />
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
function FlatMap({ mode, points }: { mode: Exclude<MapMode, "3d">; points: GlobePoint[] }) {
  const tile = mode === "sat" ? BASEMAPS.esriImagery : mode === "map" ? BASEMAPS.osm : BASEMAPS.dark;
  return (
    <MapContainer center={[15, 20]} zoom={2} minZoom={2} worldCopyJump style={{ height: "100%", width: "100%", background: "#000308" }}>
      <TileLayer url={tile.url} attribution={tile.attribution} />
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
