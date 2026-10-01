import type { CSSProperties, ReactNode } from "react";
import { HEATMAP_GRADIENTS, type HeatmapStyle } from "./HeatmapLayer";

/** One shared set of heatmap controls for every incident map (Mapping,
 *  Incident Search, Live Intel) — previously three hand-copied blocks that
 *  had to be kept in sync by hand. Each host passes its own label/select
 *  styling so it still matches that view's look (light panel vs. HUD). */
export function HeatmapControls({
  style,
  onChange,
  labelStyle,
  selectStyle,
}: {
  style: HeatmapStyle;
  onChange: (updater: (prev: HeatmapStyle) => HeatmapStyle) => void;
  labelStyle?: CSSProperties;
  selectStyle?: CSSProperties;
}) {
  const set = <K extends keyof HeatmapStyle>(key: K, value: HeatmapStyle[K]) => onChange((s) => ({ ...s, [key]: value }));
  const lbl: CSSProperties = { fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.75, marginBottom: 3, ...labelStyle };
  const chip = (active: boolean): CSSProperties => ({
    flex: 1,
    fontSize: 11,
    padding: "4px 6px",
    borderRadius: 5,
    cursor: "pointer",
    border: `1px solid ${active ? "#dc2626" : "rgba(128,128,128,0.4)"}`,
    background: active ? "rgba(220,38,38,0.15)" : "transparent",
    color: "inherit",
  });
  // Slider shows "intensity" (right = redder sooner); stored as leaflet.heat's
  // `max`, which works the other way round (lower max = redder sooner).
  const intensity = Math.round((10 / style.max) * 10) / 10;
  const stops = HEATMAP_GRADIENTS[style.gradient]?.stops ?? {};
  const gradientCss = `linear-gradient(to right, transparent 0%, ${Object.entries(stops)
    .map(([k, c]) => `${c} ${Math.round(Number(k) * 100)}%`)
    .join(", ")})`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={lbl}>Heat based on</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => set("weighting", "casualties")} style={chip(style.weighting === "casualties")}>
            Fatalities &amp; injuries
          </button>
          <button onClick={() => set("weighting", "count")} style={chip(style.weighting === "count")}>
            Incident count
          </button>
        </div>
      </div>

      {style.weighting === "casualties" && (
        <>
          <Slider label={`Fatality weight ×${style.deathWeight}`} lbl={lbl} min={1} max={10} step={1} value={style.deathWeight} onChange={(v) => set("deathWeight", v)} />
          <Slider label={`Injury weight ×${style.injuryWeight}`} lbl={lbl} min={0} max={5} step={0.5} value={style.injuryWeight} onChange={(v) => set("injuryWeight", v)} />
          <Slider
            label={`Incidents with no casualties: ${style.baseline === 0 ? "hidden" : `${Math.round(style.baseline * 100)}%`}`}
            lbl={lbl}
            min={0}
            max={1}
            step={0.05}
            value={style.baseline}
            onChange={(v) => set("baseline", v)}
          />
        </>
      )}

      <Slider label={`Intensity ${intensity} (higher = redder sooner)`} lbl={lbl} min={1} max={40} step={0.5} value={intensity} onChange={(v) => set("max", 10 / v)} />
      <Slider label={`Fade-out ${Math.round(((0.6 - style.fade) / 0.6) * 100)}% (higher = edges fade to clear)`} lbl={lbl} min={0} max={0.6} step={0.05} value={0.6 - style.fade} onChange={(v) => set("fade", Math.round((0.6 - v) * 100) / 100)} />
      <Slider label="Spread (radius)" lbl={lbl} min={8} max={60} step={1} value={style.radius} onChange={(v) => set("radius", v)} />
      <Slider label="Softness (blur)" lbl={lbl} min={2} max={40} step={1} value={style.blur} onChange={(v) => set("blur", v)} />

      <div>
        <div style={lbl}>Color theme</div>
        <select value={style.gradient} onChange={(e) => set("gradient", e.target.value as HeatmapStyle["gradient"])} style={{ width: "100%", ...selectStyle }}>
          {Object.entries(HEATMAP_GRADIENTS).map(([key, g]) => (
            <option key={key} value={key}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      <Legend gradientCss={gradientCss} lbl={lbl}>
        {style.weighting === "casualties" ? ["Few casualties", "Most fatalities & injuries"] : ["Sparse", "Dense"]}
      </Legend>
    </div>
  );
}

function Slider({
  label,
  lbl,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  lbl: CSSProperties;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={lbl}>{label}</div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%" }} />
    </div>
  );
}

function Legend({ gradientCss, lbl, children }: { gradientCss: string; lbl: CSSProperties; children: ReactNode[] }) {
  return (
    <div>
      <div style={{ height: 8, borderRadius: 4, background: gradientCss, border: "1px solid rgba(128,128,128,0.3)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", ...lbl, textTransform: "none", letterSpacing: 0, marginTop: 2 }}>
        <span>{children[0]}</span>
        <span>{children[1]}</span>
      </div>
    </div>
  );
}
