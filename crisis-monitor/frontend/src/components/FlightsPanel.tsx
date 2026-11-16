import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, type AircraftTrack, type LiveLayerFeature } from "../api";

/**
 * The Flights tool: find an aircraft by callsign, registration, type or address, then trace where it has been
 * (stored every fifteen minutes for three days) and follow it as new positions arrive every five minutes.
 */
const text = "#e6edf7";
const muted = "#93a1b8";
const chip = (on: boolean): CSSProperties => ({ padding: "4px 9px", fontSize: 11, fontFamily: "inherit", cursor: "pointer", color: text, background: on ? "rgba(124,156,255,0.22)" : "transparent", border: "1px solid rgba(124,156,255,0.25)", borderRadius: 6 });
const CLASS_COLOUR: Record<string, string> = { commercial: "#2fe0c8", private: "#00E676", military: "#FF3D3D" };

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

export default function FlightsPanel({
  selected,
  onSelect,
  hours,
  onHours,
  follow,
  onFollow,
  track,
  trackError,
}: {
  selected: SelectedAircraft | null;
  onSelect: (a: SelectedAircraft | null) => void;
  hours: number;
  onHours: (h: number) => void;
  follow: boolean;
  onFollow: (on: boolean) => void;
  track: AircraftTrack | null;
  trackError: string | null;
}) {
  const [query, setQuery] = useState("");
  const [aircraft, setAircraft] = useState<LiveLayerFeature[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyMilitary, setOnlyMilitary] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getLiveAirTraffic()
        .then((r) => !cancelled && (setAircraft(r.features), setError(null)))
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Aircraft unavailable"));
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (aircraft ?? [])
      .filter((f) => !onlyMilitary || f.properties.aviationClass === "military")
      .filter((f) => !q || `${f.properties.title} ${f.properties.detail ?? ""} ${f.properties.id}`.toLowerCase().includes(q))
      .slice(0, 60);
  }, [aircraft, query, onlyMilitary]);

  const pts = track?.points ?? [];
  const flown = pts.slice(1).reduce((s, p, i) => s + km(pts[i], p), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, color: text, fontSize: 12 }}>
      {selected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.label}</div>
            <button style={chip(false)} onClick={() => onSelect(null)}>Back to list</button>
          </div>
          {track?.current && (
            <div style={{ color: muted, fontSize: 11, lineHeight: 1.5 }}>
              {[track.current[3], track.current[2]].filter(Boolean).join(" · ") || "Type not known"} · {track.current[0]}
              {track.current[4] ? " · military" : ""}
              <br />
              Now at {pos({ lat: track.current[5], lon: track.current[6] })}
              {track.current[7] != null ? `, ${track.current[7].toLocaleString("en-GB")} ft` : ""}
              {track.current[8] != null ? `, ${track.current[8]} kt` : ""}
              {track.snapshotAt ? ` (as of ${when(track.snapshotAt)})` : ""}
            </div>
          )}
          {track && !track.current && <div style={{ color: "#ffd23f", fontSize: 11 }}>Not in the latest picture: it has landed, left the area covered, or stopped broadcasting.</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: muted, fontSize: 11 }}>Track:</span>
            {[6, 24, 72].map((h) => (
              <button key={h} style={chip(hours === h)} aria-pressed={hours === h} onClick={() => onHours(h)}>{h === 72 ? "3 days" : `${h} h`}</button>
            ))}
            <button style={chip(follow)} aria-pressed={follow} onClick={() => onFollow(!follow)} title="Keep the flat map centred on the aircraft as new positions arrive">{follow ? "Following" : "Follow"}</button>
          </div>
          {trackError && <div style={{ color: "#ff8f8f", fontSize: 11 }}>Could not load the track: {trackError}</div>}
          {!track && !trackError && <div style={{ color: muted, fontSize: 11 }}>Loading track…</div>}
          {track && pts.length >= 2 && (
            <div style={{ fontSize: 11, lineHeight: 1.55 }}>
              <div><span style={{ color: muted }}>From</span> {pos(pts[0])} <span style={{ color: muted }}>at {when(pts[0].t)}</span></div>
              <div><span style={{ color: muted }}>To</span> {pos(pts[pts.length - 1])} <span style={{ color: muted }}>at {when(pts[pts.length - 1].t)}</span></div>
              <div style={{ color: muted }}>{pts.length} positions · about {Math.round(flown).toLocaleString("en-GB")} km flown in this window</div>
            </div>
          )}
          {track && pts.length < 2 && <div style={{ color: muted, fontSize: 11, lineHeight: 1.5 }}>No earlier positions stored yet in this window. Positions are kept every fifteen minutes, so a track builds up as the aircraft flies.</div>}
          <div style={{ color: muted, fontSize: 10.5, lineHeight: 1.45 }}>
            The track is drawn on the map in yellow, from the first stored position to the latest. Positions are stored every fifteen minutes and the latest picture is refreshed every five, so the line joins the dots rather than showing every turn.
          </div>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Callsign, registration, type or address"
            aria-label="Find an aircraft"
            style={{ fontFamily: "inherit", fontSize: 12, padding: "6px 8px", background: "#0b1422", color: text, border: "1px solid rgba(124,156,255,0.25)", borderRadius: 6 }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button style={chip(onlyMilitary)} aria-pressed={onlyMilitary} onClick={() => setOnlyMilitary((v) => !v)}>Military only</button>
            {aircraft && <span style={{ color: muted, fontSize: 11 }}>{aircraft.length.toLocaleString("en-GB")} aircraft in the latest picture</span>}
          </div>
          {error && <div style={{ color: "#ff8f8f", fontSize: 11 }}>{error}</div>}
          {!aircraft && !error && <div style={{ color: muted, fontSize: 11 }}>Loading aircraft…</div>}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {matches.map((f) => (
              <button
                key={f.properties.id}
                onClick={() => onSelect({ hex: f.properties.id, label: f.properties.title })}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", background: "none", border: 0, borderBottom: "1px solid rgba(124,156,255,0.12)", color: text, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textAlign: "left" }}
              >
                <span>
                  <span style={{ color: CLASS_COLOUR[String(f.properties.aviationClass)] ?? text, fontWeight: 600 }}>{f.properties.title}</span>
                  <span style={{ color: muted, fontSize: 11 }}> {f.properties.detail}</span>
                </span>
                <span style={{ color: muted, fontSize: 11, whiteSpace: "nowrap" }}>{f.properties.intensityLabel.split(" · ")[0]}</span>
              </button>
            ))}
          </div>
          <div style={{ color: muted, fontSize: 10.5, lineHeight: 1.45 }}>You can also click an aircraft on the flat map to trace it. Aircraft: adsb.lol (ODbL).</div>
        </>
      )}
    </div>
  );
}
