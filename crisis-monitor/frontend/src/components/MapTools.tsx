import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Circle, CircleMarker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LiveLayerCollection } from "../api";
import { bearingDeg, toDecimal } from "./coords";
import type { ImageryTemplate } from "./ImageryOverlays";
import { destination, instantAt, shadowReading, solarUtcOffset } from "./sun";
import { elevationProfile, haversineM, lineOfSight, type ProfilePoint } from "./terrain";

/* ── link to this view ───────────────────────────────────────── */

export interface ViewParams {
  date: string | null;
  layer: string | null;
  at: { lat: number; lng: number; zoom: number } | null;
}

/** Reads ?date=YYYY-MM-DD&layer=swir&at=lng,lat,zoom from the address bar. */
export function readViewParams(search: string = typeof window === "undefined" ? "" : window.location.search): ViewParams {
  const q = new URLSearchParams(search);
  const date = q.get("date");
  const at = (q.get("at") ?? "").split(",").map(Number);
  const okAt = at.length === 3 && at.every(Number.isFinite) && Math.abs(at[1]) <= 90 && Math.abs(at[0]) <= 180;
  return {
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    layer: q.get("layer"),
    at: okAt ? { lng: at[0], lat: at[1], zoom: Math.min(18, Math.max(2, at[2])) } : null,
  };
}

export function viewQuery(date: string | null, layer: string | null, at: { lat: number; lng: number; zoom: number }): string {
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (layer && layer !== "none") q.set("layer", layer);
  q.set("at", `${at.lng.toFixed(3)},${at.lat.toFixed(3)},${at.zoom.toFixed(2)}`);
  return q.toString();
}

/** Keeps the address bar in step with the map, so the link in it reopens the same place, day and imagery. */
export function ViewPermalink({ date, layer }: { date: string | null; layer: string | null }) {
  const map = useMap();
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const at = readViewParams().at;
    if (at) map.setView([at.lat, at.lng], at.zoom, { animate: false });
  }, [map]);
  const write = () => {
    const c = map.getCenter();
    const keep = new URLSearchParams(window.location.search);
    ["date", "layer", "at"].forEach((k) => keep.delete(k));
    const own = viewQuery(date, layer, { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    const rest = keep.toString();
    window.history.replaceState(null, "", `${window.location.pathname}?${own}${rest ? `&${rest}` : ""}${window.location.hash}`);
  };
  useMapEvents({ moveend: write });
  useEffect(() => {
    write();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, layer]);
  // Leaving the map takes its parameters out of the address bar.
  useEffect(
    () => () => {
      const keep = new URLSearchParams(window.location.search);
      ["date", "layer", "at"].forEach((k) => keep.delete(k));
      const rest = keep.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    },
    [],
  );
  return null;
}

/* ── before/after lens ───────────────────────────────────────── */

const LENS_PANE = "lens-compare";

/** A circle that follows the cursor and shows the same imagery on another day. */
export function BeforeAfterLens({ template, radiusKm }: { template: ImageryTemplate; radiusKm: number }) {
  const map = useMap();
  const [ready, setReady] = useState(false);
  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const pane = map.getPane(LENS_PANE) ?? map.createPane(LENS_PANE);
    pane.style.zIndex = "250";
    pane.style.pointerEvents = "none";
    pane.style.clipPath = "circle(0px at 0px 0px)";
    setReady(true);
    return () => {
      pane.style.clipPath = "circle(0px at 0px 0px)";
    };
  }, [map]);
  const clip = (lat: number, lng: number) => {
    const pane = map.getPane(LENS_PANE);
    if (!pane) return;
    const p = map.latLngToLayerPoint([lat, lng]);
    const metresPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
    pane.style.clipPath = `circle(${Math.max(12, (radiusKm * 1000) / metresPerPixel)}px at ${p.x}px ${p.y}px)`;
  };
  useMapEvents({
    mousemove: (e) => {
      setCentre({ lat: e.latlng.lat, lng: e.latlng.lng });
      clip(e.latlng.lat, e.latlng.lng);
    },
    click: (e) => {
      setCentre({ lat: e.latlng.lat, lng: e.latlng.lng });
      clip(e.latlng.lat, e.latlng.lng);
    },
    zoomend: () => centre && clip(centre.lat, centre.lng),
  });
  useEffect(() => {
    if (centre) clip(centre.lat, centre.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm]);
  if (!ready) return null;
  return (
    <>
      <TileLayer key={template.url} pane={LENS_PANE} url={template.url} maxNativeZoom={template.maxNativeZoom} attribution={template.attribution} />
      {centre && <Circle center={[centre.lat, centre.lng]} radius={radiusKm * 1000} interactive={false} pathOptions={{ color: "#ffffff", weight: 1.5, dashArray: "4 4", fill: false }} />}
    </>
  );
}

/* ── shared panel styles ─────────────────────────────────────── */

const section: CSSProperties = { marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.1)" };
const smallBtn = (active = false): CSSProperties => ({
  padding: "3px 8px",
  fontSize: 11,
  fontFamily: "inherit",
  cursor: "pointer",
  color: "#e6edf7",
  background: active ? "rgba(255,122,26,0.35)" : "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 5,
});
const input: CSSProperties = { padding: "3px 5px", fontSize: 11, fontFamily: "inherit", color: "#e6edf7", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 5, colorScheme: "dark" };
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 100_000 ? 0 : 2)} km` : `${Math.round(m)} m`);

/* ── sun and shadows ─────────────────────────────────────────── */

/**
 * Click a point, set the day and clock time, and read which way a shadow points and how long it is for each metre of
 * height. Used to check when a photo or a satellite image was taken, or how tall something is.
 */
export function SunShadowTool({ defaultDay }: { defaultDay: string }) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [day, setDay] = useState(defaultDay);
  const [time, setTime] = useState("09:00");
  const [height, setHeight] = useState(10);
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ click: (e) => open && setPoint({ lat: e.latlng.lat, lng: e.latlng.lng }), zoomend: () => setZoom(map.getZoom()) });
  const offset = point ? solarUtcOffset(point.lng) : 3;
  const reading = useMemo(() => (point ? shadowReading(instantAt(day, time, offset), point.lat, point.lng) : null), [point, day, time, offset]);
  // The drawn line shows the direction only, at a fixed length on screen; the panel gives the true length.
  const arrowMetres = point ? (80 * 156543.03392 * Math.cos((point.lat * Math.PI) / 180)) / 2 ** zoom : 0;
  const tip = point && reading?.shadowBearing != null ? destination(point.lat, point.lng, reading.shadowBearing, arrowMetres) : null;
  return (
    <div style={section}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} style={smallBtn(open)}>Sun and shadows</button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <input type="date" aria-label="Day" value={day} onChange={(e) => setDay(e.target.value || defaultDay)} style={input} />
            <input type="time" aria-label="Local time" value={time} onChange={(e) => setTime(e.target.value || "09:00")} style={input} />
          </div>
          {!point && <div style={{ opacity: 0.7 }}>Click the map where the shadow falls.</div>}
          {point && reading && (
            <div style={{ fontFamily: "monospace", fontSize: 10.5, lineHeight: 1.55 }}>
              <div>{toDecimal(point.lat, point.lng)} · UTC{offset >= 0 ? "+" : ""}{offset}</div>
              <div>Sun: {reading.azimuth.toFixed(1)}° from north, {reading.elevation.toFixed(1)}° up</div>
              {reading.shadowBearing != null && reading.shadowPerHeight != null ? (
                <>
                  <div>Shadow points: {reading.shadowBearing.toFixed(1)}°</div>
                  <div>Shadow ÷ height: {reading.shadowPerHeight.toFixed(2)}</div>
                  <label style={{ display: "flex", gap: 5, alignItems: "center", fontFamily: "inherit" }}>
                    Height (m)
                    <input type="number" min={1} max={1000} value={height} onChange={(e) => setHeight(Math.max(1, Number(e.target.value) || 1))} style={{ ...input, width: 56 }} />
                    <span>→ {(height * reading.shadowPerHeight).toFixed(1)} m shadow</span>
                  </label>
                </>
              ) : (
                <div>The sun is down or on the horizon: no usable shadow.</div>
              )}
            </div>
          )}
          {point && <button onClick={() => setPoint(null)} style={{ ...smallBtn(), alignSelf: "flex-start" }}>Clear point</button>}
        </div>
      )}
      {open && point && <CircleMarker center={[point.lat, point.lng]} radius={4} interactive={false} pathOptions={{ color: "#fff", weight: 1.5, fillColor: "#ffd23f", fillOpacity: 1 }} />}
      {open && point && tip && <Polyline positions={[[point.lat, point.lng], [tip.lat, tip.lng]]} interactive={false} pathOptions={{ color: "#ffd23f", weight: 3, opacity: 0.95 }} />}
    </div>
  );
}

/* ── ruler: bearing, height profile and line of sight ─────────── */

const W = 262;
const H = 70;

/** For a measured line: length, bearing, the ground profile under it, and whether one end can see the other. */
export function TerrainProfile({ path }: { path: { lat: number; lng: number }[] }) {
  const [profile, setProfile] = useState<ProfilePoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const key = path.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setFailed(false);
    if (path.length < 2) return;
    const id = setTimeout(() => {
      elevationProfile(path)
        .then((p) => {
          if (cancelled) return;
          if (p.length === 0 || p.every((x) => x.height === null)) setFailed(true);
          else setProfile(p);
        })
        .catch(() => !cancelled && setFailed(true));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (path.length < 2) return null;
  const total = path.slice(1).reduce((s, p, i) => s + haversineM(path[i], p), 0);
  const bearing = bearingDeg(path[0], path[1]);
  const heights = (profile ?? []).map((p) => p.height).filter((h): h is number => h !== null);
  const lo = heights.length ? Math.min(...heights) : 0;
  const hi = heights.length ? Math.max(...heights) : 1;
  const span = Math.max(1, hi - lo);
  const line = (profile ?? [])
    .filter((p) => p.height !== null)
    .map((p) => `${((p.dist / total) * W).toFixed(1)},${(H - 4 - (((p.height as number) - lo) / span) * (H - 8)).toFixed(1)}`)
    .join(" ");
  const sight = profile && path.length === 2 ? lineOfSight(profile, 2) : null;
  const first = profile?.[0]?.height ?? null;
  const last = profile?.[profile.length - 1]?.height ?? null;
  return (
    <div style={section}>
      <div style={{ fontWeight: 600 }}>Measured line</div>
      <div style={{ fontFamily: "monospace", fontSize: 10.5, lineHeight: 1.55 }}>
        <div>{km(total)} · bearing {bearing.toFixed(1)}°{path.length > 2 ? " (first leg)" : ""}</div>
        {profile && first !== null && last !== null && (
          <div>Height {Math.round(first)} m → {Math.round(last)} m · low {Math.round(lo)} m, high {Math.round(hi)} m</div>
        )}
      </div>
      {!profile && !failed && <div style={{ opacity: 0.7 }}>Reading ground heights…</div>}
      {failed && <div style={{ opacity: 0.7 }}>Ground heights are unavailable right now.</div>}
      {profile && line && (
        <svg width={W} height={H} role="img" aria-label={`Ground profile from ${Math.round(lo)} to ${Math.round(hi)} metres`} style={{ display: "block", marginTop: 4, background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
          <polygon points={`0,${H} ${line} ${W},${H}`} fill="rgba(255,210,63,0.22)" />
          <polyline points={line} fill="none" stroke="#ffd23f" strokeWidth={1.5} />
          {sight && first !== null && last !== null && (
            <line x1={0} y1={H - 4 - ((first + 2 - lo) / span) * (H - 8)} x2={W} y2={H - 4 - ((last - lo) / span) * (H - 8)} stroke={sight.visible ? "#4dff9e" : "#ff6b6b"} strokeWidth={1} strokeDasharray="4 3" />
          )}
        </svg>
      )}
      {path.length === 2 && profile && (
        <div style={{ marginTop: 4, lineHeight: 1.45 }}>
          {sight === null
            ? "Line of sight could not be worked out for this line."
            : sight.visible
              ? "Line of sight: the far end is visible from 2 m above the ground at the start."
              : `Line of sight: blocked ${km(sight.blockedAt ?? 0)} from the start, by ground about ${Math.round(sight.blockedBy ?? 0)} m above the sight line.`}
          <span style={{ opacity: 0.65 }}> Bare ground at about 30 m detail; trees and buildings are not counted.</span>
        </div>
      )}
      {path.length > 2 && <div style={{ marginTop: 4, opacity: 0.7 }}>Line of sight is worked out for a two-point line.</div>}
    </div>
  );
}

/* ── open data: download what the fire layer is showing ───────── */

function save(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The fire detections on the map as CSV rows (one per detection or cell). */
export function fireCsv(collection: LiveLayerCollection): string {
  const keys = [...new Set(collection.features.flatMap((f) => Object.keys(f.properties ?? {})))];
  const head = ["latitude", "longitude", ...keys];
  const rows = collection.features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0], ...keys.map((k) => (f.properties as Record<string, unknown>)[k])].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\n");
}

export function FireDownload({ collection, label }: { collection: LiveLayerCollection | null; label: string }) {
  if (!collection || collection.features.length === 0) return null;
  const stem = `lens-fires-${label}`;
  return (
    <div style={section}>
      <div style={{ fontWeight: 600 }}>Fire detections shown ({collection.features.length.toLocaleString("en-GB")})</div>
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <button style={smallBtn()} onClick={() => save(`${stem}.csv`, "text/csv", fireCsv(collection))}>Download CSV</button>
        <button style={smallBtn()} onClick={() => save(`${stem}.geojson`, "application/geo+json", JSON.stringify({ type: "FeatureCollection", features: collection.features }))}>Download GeoJSON</button>
      </div>
      <div style={{ opacity: 0.65, marginTop: 3 }}>Source: NASA FIRMS (VIIRS), as collected by the Lens.</div>
    </div>
  );
}
