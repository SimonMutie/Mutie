import { useMemo, useState, type CSSProperties } from "react";
import { Flame, MapPinned, Search, Waypoints, X } from "lucide-react";
import type { IncidentItem } from "../api";
import { classifyIncident } from "../components/actorTheme";
import { fmtLength } from "./geo";
import { HUD, inputStyle } from "./hud";
import { incidentsNear } from "./proximity";

/** What the map is currently narrowed to, so the panel can show and clear it. */
export interface NearbyState {
  label: string;
  km: number;
  count: number;
}

const btn = (active = false): CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "6px 9px", borderRadius: 7,
  border: `1px solid ${active ? HUD.gold : HUD.border}`, background: active ? "rgba(212,175,55,.18)" : "rgba(255,255,255,.03)", color: active ? HUD.goldLight : HUD.textSecondary, fontFamily: "inherit",
});

/**
 * Finds the uploaded incidents within a distance of a route, line, area or point.
 * The result narrows what the map shows; it can be left as bullet markers or turned into a heatmap.
 */
export function NearbySearch({
  title = "Incidents nearby",
  geometry,
  label,
  incidents,
  state,
  viewMode,
  onResults,
  onViewMode,
  onCorridor,
}: {
  title?: string;
  geometry: GeoJSON.Feature | GeoJSON.FeatureCollection | null;
  label: string;
  incidents: IncidentItem[];
  state: NearbyState | null;
  viewMode: "markers" | "heatmap";
  onResults: (rows: IncidentItem[] | null, s: NearbyState | null) => void;
  onViewMode: (m: "markers" | "heatmap") => void;
  /** Draws the search band as a layer, when the host can. */
  onCorridor?: (km: number) => void;
}) {
  const [km, setKm] = useState(10);
  const [found, setFound] = useState<{ row: IncidentItem; km: number }[] | null>(null);
  const mine = state?.label === label;

  const byActor = useMemo(() => {
    const m = new Map<string, { color: string; n: number }>();
    for (const f of found ?? []) {
      const c = classifyIncident(f.row);
      const e = m.get(c.label) ?? { color: c.color, n: 0 };
      e.n++;
      m.set(c.label, e);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [found]);

  function run() {
    if (!geometry) return;
    const r = incidentsNear(incidents, geometry, km);
    setFound(r);
    onResults(r.map((x) => x.row), { label, km, count: r.length });
  }
  function clear() {
    setFound(null);
    onResults(null, null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 10, border: `1px solid ${HUD.borderStrong}`, background: "rgba(212,175,55,.05)" }}>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.gold, fontWeight: 700 }}>{title}</div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: HUD.textSecondary }}>
          <span>Within</span>
          <span style={{ color: HUD.text }}>{fmtLength(km * 1000)}</span>
        </div>
        <input type="range" min={1} max={300} step={1} value={km} onChange={(e) => setKm(Number(e.target.value))} style={{ width: "100%", accentColor: HUD.gold }} />
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
          {[1, 5, 10, 25, 50, 100].map((v) => (
            <button key={v} style={{ ...btn(km === v), padding: "2px 7px", fontSize: 10 }} onClick={() => setKm(v)}>{v} km</button>
          ))}
          <input type="number" min={0.1} step={1} value={km} onChange={(e) => setKm(Math.max(0.1, Number(e.target.value) || 1))} style={{ ...inputStyle, width: 58, padding: "2px 6px" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={{ ...btn(true), flex: 1 }} onClick={run} disabled={!geometry}>
          <Search size={13} /> Search
        </button>
        {onCorridor && (
          <button style={btn()} onClick={() => onCorridor(km)} title="Draw the search band as a layer">
            <Waypoints size={13} /> Band
          </button>
        )}
      </div>
      {!incidents.length && <div style={{ fontSize: 10.5, color: HUD.textMuted }}>No incidents loaded yet. Upload some in the Incidents panel.</div>}
      {mine && state && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ fontSize: 12, color: HUD.text, fontWeight: 600 }}>
            {state.count} incident{state.count === 1 ? "" : "s"} within {fmtLength(state.km * 1000)}
          </div>
          {byActor.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", fontSize: 10.5, color: HUD.textSecondary }}>
              {byActor.map(([name, v]) => (
                <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: v.color, border: "1.5px solid #fff" }} />
                  {name} {v.n}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button style={{ ...btn(viewMode === "markers"), flex: 1 }} onClick={() => onViewMode("markers")}><MapPinned size={13} /> Markers</button>
            <button style={{ ...btn(viewMode === "heatmap"), flex: 1 }} onClick={() => onViewMode("heatmap")} disabled={!state.count}><Flame size={13} /> Heatmap</button>
            <button style={btn()} onClick={clear} title="Show every incident again"><X size={13} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
