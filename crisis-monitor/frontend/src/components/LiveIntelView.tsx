import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { api, type LiveLayerCollection, type LiveLayerFeature } from "../api";

/**
 * "Live Intelligence" — a new, separate view rather than a restyle of the
 * existing (light) dashboards/choropleth. Modeled on OSIRIS's own dark HUD
 * aesthetic (osirisai.live): a rotating 3D globe, a real day/night
 * terminator, monospace status readouts, and a toggleable layer rail
 * instead of a fixed legend. Nothing here touches IncidentsMap/
 * IncidentSearch or their data.
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
 *  - Deliberately NOT included, despite being on OSIRIS's own toggle list:
 *    live CCTV (aggregating public/private cameras without consent is a
 *    surveillance capability this app isn't going to carry, independent of
 *    whether a feed for it exists). Maritime/AIS ship tracking has no
 *    free+keyless+global source either — every option found needs a
 *    registered API key (e.g. aisstream.io), so it's held for a follow-up
 *    once a key is available rather than built silently broken. Submarine
 *    cables: a real open dataset exists but wasn't confirmed reachable in
 *    time for this pass — a reasonable fast-follow.
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

interface LayerDef {
  key: string;
  label: string;
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
      size: 0.35 + f.properties.intensity * 0.9,
      title: f.properties.title,
      subtitle: `${f.properties.intensityLabel}${f.properties.detail ? ` — ${f.properties.detail}` : ""}`,
      time: f.properties.time,
      url: f.properties.url,
    }));
}

const LAYER_DEFS: LayerDef[] = [
  { key: "earthquakes", label: "Earthquakes", color: "#ff5d5d", fetcher: async () => fromGateway("#ff5d5d", "Earthquakes")(await api.getLiveEarthquakes()) },
  { key: "natural-events", label: "Natural Events", color: "#ffb020", fetcher: async () => fromGateway("#ffb020", "Natural Events")(await api.getLiveNaturalEvents()) },
  { key: "conflict-events", label: "Conflict Reports", color: "#7c9cff", fetcher: async () => fromGateway("#7c9cff", "Conflict Reports")(await api.getLiveConflictEvents()) },
  { key: "air-traffic", label: "Air Traffic", color: "#2fe0c8", fetcher: async () => fromGateway("#2fe0c8", "Air Traffic")(await api.getLiveAirTraffic()) },
  {
    key: "malware-infrastructure",
    label: "Botnet C2s",
    color: "#ff4fa3",
    fetcher: async () => fromGateway("#ff4fa3", "Botnet C2 Infrastructure")(await api.getLiveMalwareInfrastructure()),
  },
  {
    key: "my-incidents",
    label: "My Incidents",
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
          size: 0.4,
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
          size: 0.45,
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

const POLL_MS = 60_000;

type LayerState = { data: GlobePoint[] | null; loading: boolean; error: string | null };

/** Standard low-precision solar position formula (accurate to well within
 *  a degree — the same approach used by widely-deployed day/night
 *  terminator visualizations), used to point the globe's shader at the
 *  real current subsolar point rather than a fixed or fake light source. */
function subsolarDirection(date: Date): THREE.Vector3 {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const RA = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
  const decl = Math.asin(Math.sin(e) * Math.sin(L)) / rad;
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  const lng = (((RA - gmst) % 360) + 540) % 360 - 180;
  const lat = decl;

  // Same lat/lng -> unit-sphere convention three-globe itself uses.
  const phi = (90 - lat) * rad;
  const theta = (lng + 180) * rad;
  return new THREE.Vector3(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).normalize();
}

/** A day/night globe material: the same day and night Earth textures used
 *  elsewhere in this app's globe widget, blended per-fragment by how much
 *  each point on the sphere currently faces the sun. Because the blend
 *  uses the mesh's own model matrix, it stays correct as the globe
 *  auto-rotates — no per-frame camera bookkeeping needed, only a periodic
 *  update to the sun direction itself as real time passes. */
function useDayNightMaterial() {
  const [material, setMaterial] = useState<THREE.ShaderMaterial | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    Promise.all([
      loader.loadAsync("//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"),
      loader.loadAsync("//unpkg.com/three-globe/example/img/earth-night.jpg"),
    ]).then(([dayTexture, nightTexture]) => {
      if (cancelled) return;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          dayTexture: { value: dayTexture },
          nightTexture: { value: nightTexture },
          sunDirection: { value: subsolarDirection(new Date()) },
        },
        vertexShader: `
          varying vec3 vWorldNormal;
          varying vec2 vUv;
          void main() {
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D dayTexture;
          uniform sampler2D nightTexture;
          uniform vec3 sunDirection;
          varying vec3 vWorldNormal;
          varying vec2 vUv;
          void main() {
            float intensity = dot(normalize(vWorldNormal), normalize(sunDirection));
            vec4 dayColor = texture2D(dayTexture, vUv);
            vec4 nightColor = texture2D(nightTexture, vUv) * vec4(0.55, 0.6, 0.8, 1.0);
            float blend = smoothstep(-0.15, 0.15, intensity);
            gl_FragColor = mix(nightColor, dayColor, blend);
          }
        `,
      });
      materialRef.current = mat;
      setMaterial(mat);
    }).catch((err) => {
      // Falls back to the plain night-texture globeImageUrl below (material
      // stays null) rather than leaving an unhandled rejection — a texture
      // CDN hiccup should degrade the view, not crash it.
      console.warn("Live Intel: day/night textures failed to load, falling back to static night globe", err);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real time passing, not the render loop — the sun moves on the order of
  // minutes, so there's nothing to gain from updating this every frame.
  useEffect(() => {
    const interval = setInterval(() => {
      if (materialRef.current) materialRef.current.uniforms.sunDirection.value = subsolarDirection(new Date());
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  return material;
}

export default function LiveIntelView() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    earthquakes: true,
    "natural-events": true,
    "conflict-events": true,
    "air-traffic": false,
    "malware-infrastructure": false,
    "my-incidents": false,
    "my-alerts": false,
  });
  const [layers, setLayers] = useState<Record<string, LayerState>>(() =>
    Object.fromEntries(LAYER_DEFS.map((d) => [d.key, { data: null, loading: true, error: null }]))
  );
  const [clock, setClock] = useState(() => new Date());
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dayNightMaterial = useDayNightMaterial();

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
    const controls = globeRef.current?.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;
    }
  }, [size]);

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
      <HudToolbar
        defs={LAYER_DEFS}
        enabled={enabled}
        layers={layers}
        onToggle={(key) => setEnabled((prev) => ({ ...prev, [key]: !prev[key] }))}
      />

      <div ref={containerRef} style={{ position: "relative", flex: 1 }}>
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="#000308"
          globeMaterial={dayNightMaterial ?? undefined}
          globeImageUrl={dayNightMaterial ? undefined : "//unpkg.com/three-globe/example/img/earth-night.jpg"}
          showAtmosphere
          atmosphereColor="#5d8cff"
          atmosphereAltitude={0.18}
          pointsData={points}
          pointLat={(d: object) => (d as GlobePoint).lat}
          pointLng={(d: object) => (d as GlobePoint).lng}
          pointColor={(d: object) => (d as GlobePoint).color}
          pointRadius={(d: object) => (d as GlobePoint).size}
          pointAltitude={0.01}
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

        <StatusBar totalFeatures={points.length} clock={clock} />
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function HudToolbar({
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
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderBottom: "1px solid rgba(124,156,255,0.18)",
        background: "linear-gradient(180deg, #05070d, #000308)",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "#7c9cff",
          fontWeight: 700,
          marginRight: 4,
        }}
      >
        Live Intelligence
      </span>

      {defs.map((def) => {
        const state = layers[def.key];
        const isOn = enabled[def.key];
        const count = state?.data?.length;
        return (
          <button
            key={def.key}
            onClick={() => onToggle(def.key)}
            title={state?.error ?? undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              padding: "5px 10px",
              borderRadius: 999,
              border: `1px solid ${isOn ? def.color : "rgba(215,228,242,0.25)"}`,
              background: isOn ? `${def.color}22` : "transparent",
              color: isOn ? "#eef3ff" : "#7f8ea3",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: state?.error ? "#ff5d5d" : def.color,
                opacity: isOn ? 1 : 0.35,
              }}
            />
            {def.label}
            <span style={{ opacity: 0.65 }}>{state?.loading ? "…" : state?.error ? "ERR" : (count ?? 0)}</span>
          </button>
        );
      })}
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
        display: "flex",
        gap: 16,
        fontSize: 11,
        color: "#7f8ea3",
        background: "rgba(0,3,8,0.72)",
        border: "1px solid rgba(124,156,255,0.18)",
        borderRadius: 6,
        padding: "6px 12px",
        backdropFilter: "blur(4px)",
        zIndex: 500,
      }}
    >
      <span>
        TRACKS <span style={{ color: "#eef3ff" }}>{totalFeatures}</span>
      </span>
      <span>{clock.toISOString().replace("T", " ").slice(0, 19)} UTC</span>
    </div>
  );
}
