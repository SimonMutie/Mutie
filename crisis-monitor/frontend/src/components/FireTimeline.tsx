import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { CircleMarker, Popup, useMap, useMapEvents } from "react-leaflet";
import type { FireHistoryDay, LiveLayerCollection } from "../api";
import { HeatmapLayer } from "./HeatmapLayer";

/** Colour per satellite, shared by the timeline bars and the map's fire points. */
export const FIRE_SATELLITE_COLORS = {
  noaa20: "#ff7a1a",
  snpp: "#ffd23f",
  noaa21: "#ff3b30",
} as const;
export const FIRE_SATELLITE_LABELS = { noaa20: "NOAA-20", snpp: "Suomi NPP", noaa21: "NOAA-21" } as const;

/** Fewest collected days, before the day itself, needed before any day can be called unusual. */
const MIN_BASELINE_DAYS = 14;
/** A day must also reach this many detections across Africa, so quiet weeks are not flagged on tiny numbers. */
const MIN_UNUSUAL_TOTAL = 100;
/** A day is unusual when it has at least this many times the median of the other covered days. */
const UNUSUAL_FACTOR = 2;

/**
 * Days whose detection count is well above the usual level in our own stored history.
 * Returns the typical (median) count for each flagged day. This is not a seasonal baseline: a true one needs the
 * multi-year FIRMS archive, so until several months are stored this often flags nothing, by design.
 */
export function unusualFireDays(days: FireHistoryDay[], coveredFrom: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!coveredFrom) return out;
  const covered = days.filter((d) => d.date >= coveredFrom);
  if (covered.length <= MIN_BASELINE_DAYS) return out;
  for (const d of covered) {
    const others = covered.filter((o) => o.date !== d.date).map((o) => o.total).sort((a, b) => a - b);
    const median = others[Math.floor(others.length / 2)] ?? 0;
    if (d.total >= MIN_UNUSUAL_TOTAL && d.total >= UNUSUAL_FACTOR * Math.max(median, 1)) out.set(d.date, median);
  }
  return out;
}

/** Heat weight per detection: fire radiative power (MW) sets it, with a floor so small fires still show. */
export function fireHeatWeight(frp: number): number {
  return Math.min(1, 0.25 + frp / 40);
}

function StackedBar({ day, max, selected, uncovered, unusual }: { day: FireHistoryDay; max: number; selected: boolean; uncovered: boolean; unusual: boolean }) {
  const h = max > 0 ? (day.total / max) * 100 : 0;
  const sats = ["noaa20", "snpp", "noaa21"] as const;
  return (
    <div
      data-date={day.date}
      title={uncovered ? `${day.date}: not collected yet` : `${day.date}: ${day.total.toLocaleString()} detections${unusual ? " (unusual for the season)" : ""}`}
      style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", minWidth: 0, pointerEvents: "none", position: "relative" }}
    >
      {uncovered ? (
        <div style={{ width: "100%", height: 3, borderTop: "1px dashed rgba(255,255,255,0.25)" }} />
      ) : (
        <div
          style={{
            width: "100%",
            height: `${Math.max(h, day.total > 0 ? 3 : 0)}%`,
            display: "flex",
            flexDirection: "column-reverse",
            borderRadius: "2px 2px 0 0",
            overflow: "hidden",
            outline: selected ? "1px solid #ffffff" : "none",
            boxShadow: unusual ? "0 0 0 1px rgba(255,59,48,0.9)" : "none",
          }}
        >
          {sats.map((s) =>
            day[s] > 0 ? <div key={s} style={{ height: `${(day[s] / Math.max(day.total, 1)) * 100}%`, background: FIRE_SATELLITE_COLORS[s] }} /> : null
          )}
        </div>
      )}
    </div>
  );
}

export default function FireTimeline({
  days,
  coveredFrom,
  lastCollectedAt,
  selected,
  unusual,
  onSelect,
  playing,
  onPlayingChange,
  right,
  left = 12,
}: {
  days: FireHistoryDay[];
  coveredFrom: string | null | undefined;
  lastCollectedAt: string | null;
  selected: string | null;
  unusual: Map<string, number>;
  onSelect: (date: string) => void;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
  /** Space kept clear on the right, for the map's own zoom pad, and on the left for the conflict key button. */
  right: number;
  left?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...days.map((d) => d.total));
  const selectedIndex = Math.max(0, days.findIndex((d) => d.date === selected));
  const selectedDay = days[selectedIndex];

  // Play steps through the days once a second, and stops at the last day.
  useEffect(() => {
    if (!playing || days.length === 0) return;
    const id = setInterval(() => {
      const idx = days.findIndex((d) => d.date === selected);
      if (idx < 0 || idx >= days.length - 1) {
        onPlayingChange(false);
        return;
      }
      onSelect(days[idx + 1].date);
    }, 1000);
    return () => clearInterval(id);
  }, [playing, days, selected, onSelect, onPlayingChange]);

  const pickAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el || days.length === 0) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const idx = Math.min(days.length - 1, Math.floor(frac * days.length));
    onSelect(days[idx].date);
  };

  const dragging = useRef(false);
  const isUncovered = (date: string) => !coveredFrom || date < coveredFrom;
  const first = days[0]?.date;
  const last = days[days.length - 1]?.date;
  const handlePct = days.length ? ((selectedIndex + 0.5) / days.length) * 100 : 0;

  return (
    <div
      role="group"
      aria-label="Satellite fire timeline"
      style={{
        position: "absolute",
        left,
        right,
        bottom: 8,
        zIndex: 500,
        padding: "6px 10px 6px",
        borderRadius: 8,
        background: "rgba(8, 14, 24, 0.9)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "#e6edf7",
        fontSize: 11,
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <button
          onClick={() => onPlayingChange(!playing)}
          aria-label={playing ? "Pause timeline" : "Play timeline"}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 13, background: "rgba(255,122,26,0.3)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", cursor: "pointer", flex: "0 0 auto" }}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{selectedDay ? new Date(`${selectedDay.date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "No fire history yet"}</b>
          {selectedDay && (
            <span style={{ opacity: 0.75 }}>
              {" "}· {isUncovered(selectedDay.date) ? "not collected" : `${selectedDay.total.toLocaleString()} detections`}
              {unusual.has(selectedDay.date) && <span style={{ color: "#ff8a80", fontWeight: 700 }}> · unusual for the season</span>}
            </span>
          )}
        </div>
        <span style={{ opacity: 0.6, whiteSpace: "nowrap" }}>
          {lastCollectedAt ? `Collected ${new Date(lastCollectedAt).toISOString().slice(0, 16).replace("T", " ")} UTC` : "Collecting"}
        </span>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Fire day"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, days.length - 1)}
        aria-valuenow={selectedIndex}
        aria-valuetext={selectedDay?.date}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          pickAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) pickAt(e.clientX);
        }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && selectedIndex < days.length - 1) onSelect(days[selectedIndex + 1].date);
          if (e.key === "ArrowLeft" && selectedIndex > 0) onSelect(days[selectedIndex - 1].date);
        }}
        style={{ position: "relative", height: 34, display: "flex", alignItems: "stretch", gap: 2, cursor: "ew-resize", touchAction: "none", userSelect: "none", outline: "none" }}
      >
        {days.map((d) => (
          <StackedBar
            key={d.date}
            day={d}
            max={max}
            selected={d.date === selected}
            uncovered={isUncovered(d.date)}
            unusual={unusual.has(d.date)}
          />
        ))}
        {days.length > 0 && (
          <div
            aria-hidden="true"
            style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${handlePct}% - 1px)`, width: 2, background: "#ffffff", boxShadow: "0 0 6px rgba(255,255,255,0.8)", pointerEvents: "none" }}
          />
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3, opacity: 0.7, fontSize: 10 }}>
        <span>{first ?? ""}</span>
        <span style={{ display: "flex", gap: 10 }}>
          {(["noaa20", "snpp", "noaa21"] as const).map((s) => (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: FIRE_SATELLITE_COLORS[s] }} />
              {FIRE_SATELLITE_LABELS[s]}
            </span>
          ))}
        </span>
        <span>{last ?? ""}</span>
      </div>
    </div>
  );
}

/** Fires at or beyond this zoom are drawn as points. Further out they blend into heat. */
const POINT_ZOOM = 6;
/** Most points drawn at once, so a dense day stays responsive when zoomed in. */
const MAX_POINTS = 4000;
const FIRE_HEAT_STYLE = { radius: 16, blur: 14, max: 1, gradient: "redFade" as const, fade: 0.08 };

interface FireFeature {
  geometry: { coordinates: [number, number] };
  properties: { id: string; time: string | null; intensityLabel: string; detail: string; intensity: number };
}

/** The framed card shown when a fire point is clicked. */
function FireDetectionCard({ feature, dayTotal, typicalDay }: { feature: FireFeature; dayTotal: number; typicalDay: number | null }) {
  const [lng, lat] = feature.geometry.coordinates;
  const parts = feature.properties.detail.split(". ").filter(Boolean);
  const when = feature.properties.time ? new Date(feature.properties.time).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "time unknown";
  const row = (label: string, value: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0", borderBottom: "1px dotted rgba(255,255,255,0.1)" }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
  return (
    <div style={{ fontFamily: "monospace", fontSize: 12, width: 240, color: "#e6edf7" }}>
      <div style={{ border: "1px solid rgba(255,122,26,0.9)", borderRadius: 4, padding: 9, background: "#0b1220", boxShadow: "inset 0 0 0 3px #0b1220, inset 0 0 0 4px rgba(255,122,26,0.35)" }}>
        <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: "#ff7a1a" }}>Satellite fire detection</div>
        <div style={{ fontWeight: 700, marginTop: 4, fontSize: 13 }}>{when}</div>
        <div style={{ marginTop: 6 }}>
          {row("Radiative power", feature.properties.intensityLabel)}
          {row("Position", `${lat.toFixed(3)}, ${lng.toFixed(3)}`)}
          {parts.slice(0, 3).map((p, i) => row(i === 0 ? "Satellite" : i === 1 ? "Confidence" : "Detail", p))}
        </div>
        {typicalDay !== null && (
          <div style={{ marginTop: 8, padding: "5px 7px", borderRadius: 3, background: "rgba(255,59,48,0.22)", color: "#ffb4ac" }}>
            <div style={{ fontWeight: 700 }}>Unusual for the season</div>
            <div style={{ fontSize: 10.5, marginTop: 2, opacity: 0.9 }}>
              {dayTotal.toLocaleString()} detections across Africa this day, against a typical {typicalDay.toLocaleString()} in our stored history.
            </div>
          </div>
        )}
        <div style={{ opacity: 0.5, fontSize: 10, marginTop: 7 }}>Each point is about a 375 m pixel. Source: NASA FIRMS.</div>
      </div>
    </div>
  );
}

/**
 * The selected day's fire detections on a flat map: heat blobs when zoomed out, one framed, clickable point each when
 * zoomed in. Points outside the current view are skipped.
 */
export function FireMapLayer({ collection, unusual }: { collection: { features: FireFeature[] }; unusual: Map<string, number> }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  // Bumped on every move, so the visible points are picked again from the new bounds.
  const [, setView] = useState(0);
  useMapEvents({
    zoomend: () => { setZoom(map.getZoom()); setView((v) => v + 1); },
    moveend: () => setView((v) => v + 1),
  });
  const features = collection.features;
  const dayTotal = features.length;
  const heat = useMemo(
    () => features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0], fireHeatWeight(f.properties.intensity * 50)] as [number, number, number]),
    [features]
  );
  if (zoom < POINT_ZOOM) return <HeatmapLayer points={heat} style={FIRE_HEAT_STYLE} />;

  const bounds = map.getBounds().pad(0.1);
  const visible = features.filter((f) => bounds.contains([f.geometry.coordinates[1], f.geometry.coordinates[0]])).slice(0, MAX_POINTS);
  return (
    <>
      {visible.map((f) => {
        const day = f.properties.time?.slice(0, 10) ?? "";
        const typical = unusual.get(day) ?? null;
        const satColor = f.properties.detail.startsWith("NOAA-20") ? FIRE_SATELLITE_COLORS.noaa20 : f.properties.detail.startsWith("Suomi") ? FIRE_SATELLITE_COLORS.snpp : FIRE_SATELLITE_COLORS.noaa21;
        return (
          <CircleMarker
            key={f.properties.id}
            center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
            radius={3 + Math.min(f.properties.intensity, 1) * 4}
            pathOptions={{ color: "#ffffff", weight: 0.6, fillColor: satColor, fillOpacity: 0.9 }}
          >
            <Popup maxWidth={260}>
              <FireDetectionCard feature={f} dayTotal={dayTotal} typicalDay={typical} />
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
