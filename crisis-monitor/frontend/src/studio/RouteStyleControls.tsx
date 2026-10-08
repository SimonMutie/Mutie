import { HUD, DASHES, ROUTE_PALETTE, type RouteStyle } from "./hud";

/** Colour, thickness, dash and glow for a route. */
export function RouteStyleControls({ style, onChange }: { style: RouteStyle; onChange: (p: Partial<RouteStyle>) => void }) {
  const chip = (active: boolean): React.CSSProperties => ({
    cursor: "pointer", fontSize: 10.5, fontWeight: 600, padding: "3px 8px", borderRadius: 6, fontFamily: "inherit",
    border: `1px solid ${active ? HUD.gold : "rgba(212,175,55,.15)"}`, background: active ? "rgba(212,175,55,.18)" : "rgba(255,255,255,.03)", color: active ? HUD.goldLight : HUD.textSecondary,
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: HUD.textMuted, fontWeight: 600 }}>Route look</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {ROUTE_PALETTE.map((c) => (
          <button key={c} onClick={() => onChange({ color: c })} title={c} style={{ width: 17, height: 17, borderRadius: 5, background: c, cursor: "pointer", padding: 0, border: style.color.toLowerCase() === c ? `2px solid ${HUD.goldLight}` : "1px solid rgba(255,255,255,.25)" }} />
        ))}
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#4dff9e"} onChange={(e) => onChange({ color: e.target.value })} title="Any colour" style={{ width: 24, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: HUD.textSecondary }}>
          <span>Thickness</span>
          <span style={{ color: HUD.textMuted }}>{style.weight} px</span>
        </div>
        <input type="range" min={2} max={14} step={1} value={style.weight} onChange={(e) => onChange({ weight: Number(e.target.value) })} style={{ width: "100%", accentColor: HUD.gold }} />
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {DASHES.map((d) => (
          <button key={d.label} style={chip((style.dash ?? null) === d.value)} onClick={() => onChange({ dash: d.value })}>
            {d.label}
          </button>
        ))}
        <button style={chip(style.glow)} onClick={() => onChange({ glow: !style.glow })}>Glow</button>
      </div>
    </div>
  );
}
