import type { CSSProperties } from "react";
import type { AircraftTrack } from "../api";

/**
 * The card that opens when an aircraft is clicked on either map: where it has been (stored every fifteen minutes for
 * three days) and, with Follow, the map kept on it as new positions arrive every five minutes.
 */
const text = "#e6edf7";
const muted = "#93a1b8";
const chip = (on: boolean): CSSProperties => ({ padding: "4px 9px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", color: text, background: on ? "rgba(124,156,255,0.22)" : "transparent", border: "1px solid rgba(124,156,255,0.25)", borderRadius: 6 });

export interface SelectedAircraft {
  hex: string;
  label: string;
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pos = (p: { lat: number; lon: number }) => `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`;

export default function FlightCard({
  selected,
  onClose,
  hours,
  onHours,
  follow,
  onFollow,
  track,
  trackError,
  bottom = 16,
}: {
  selected: SelectedAircraft;
  onClose: () => void;
  hours: number;
  onHours: (h: number) => void;
  follow: boolean;
  onFollow: (on: boolean) => void;
  track: AircraftTrack | null;
  trackError: string | null;
  /** Distance from the bottom of the map, so the card clears the fire timeline when it is showing. */
  bottom?: number;
}) {
  const pts = track?.points ?? [];
  const flown = pts.slice(1).reduce((s, p, i) => s + km(pts[i], p), 0);
  return (
    <div
      role="dialog"
      aria-label={`Flight ${selected.label}`}
      style={{ position: "absolute", left: "50%", bottom, transform: "translateX(-50%)", zIndex: 900, width: "min(420px, calc(100% - 32px))", background: "rgba(8,14,24,0.94)", border: "1px solid rgba(255,210,63,0.45)", borderRadius: 10, padding: "12px 14px", color: text, fontSize: 12, display: "flex", flexDirection: "column", gap: 8, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>✈ {selected.label}</div>
        <button style={chip(false)} onClick={onClose} aria-label="Close">Close</button>
      </div>
      {track?.current && (
        <div style={{ color: muted, fontSize: 11, lineHeight: 1.5 }}>
          {[track.current[3], track.current[2]].filter(Boolean).join(" · ") || "Type not known"} · {track.current[0]}
          {track.current[4] ? " · military" : ""}
          <br />
          Live: {pos({ lat: track.current[5], lon: track.current[6] })}
          {track.current[7] != null ? `, ${track.current[7].toLocaleString("en-GB")} ft` : ""}
          {track.current[8] != null ? `, ${track.current[8]} kt` : ""}
          {track.current[9] != null ? `, heading ${track.current[9]}°` : ""}
          {track.snapshotAt ? ` (as of ${when(track.snapshotAt)})` : ""}
        </div>
      )}
      {track && !track.current && <div style={{ color: "#ffd23f", fontSize: 11 }}>Not in the latest picture: it has landed, left the area covered, or stopped broadcasting.</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: muted, fontSize: 11 }}>Path:</span>
        {[6, 24, 72].map((h) => (
          <button key={h} style={chip(hours === h)} aria-pressed={hours === h} onClick={() => onHours(h)}>{h === 72 ? "3 days" : `${h} h`}</button>
        ))}
        <button style={chip(follow)} aria-pressed={follow} onClick={() => onFollow(!follow)} title="Keep the map on the aircraft as new positions arrive">{follow ? "● Following live" : "Follow live"}</button>
      </div>
      {trackError && <div style={{ color: "#ff8f8f", fontSize: 11 }}>Could not load the path: {trackError}</div>}
      {!track && !trackError && <div style={{ color: muted, fontSize: 11 }}>Loading path…</div>}
      {track && pts.length >= 2 && (
        <div style={{ fontSize: 11, lineHeight: 1.55 }}>
          <div><span style={{ color: muted }}>From</span> {pos(pts[0])} <span style={{ color: muted }}>at {when(pts[0].t)}</span></div>
          <div><span style={{ color: muted }}>To</span> {pos(pts[pts.length - 1])} <span style={{ color: muted }}>at {when(pts[pts.length - 1].t)}</span></div>
          <div style={{ color: muted }}>{pts.length} positions · about {Math.round(flown).toLocaleString("en-GB")} km flown in this window</div>
        </div>
      )}
      {track && pts.length < 2 && <div style={{ color: muted, fontSize: 11, lineHeight: 1.5 }}>No earlier positions stored in this window yet. A position is kept every fifteen minutes, so the path builds up as it flies.</div>}
    </div>
  );
}
