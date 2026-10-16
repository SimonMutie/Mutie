import { ACTIVE_INTENSITY_STYLE, INTENSITY_STYLE } from "./conflictIntensity";

/** Key for the active-conflict layer and the escalation rings. */
export default function ConflictIntensityLegend({ activeCount, activeConfigured }: { activeCount: number; activeConfigured: boolean | null }) {
  const swatch = (fill: string, opacity: number, line: string) => (
    <span
      aria-hidden="true"
      style={{ flex: "0 0 auto", width: 16, height: 12, marginTop: 2, borderRadius: 2, background: fill, opacity: Math.min(1, opacity + 0.35), border: `1px solid ${line}` }}
    />
  );
  return (
    <div
      role="group"
      aria-label="Conflict intensity key"
      style={{
        position: "absolute",
        left: 12,
        bottom: 36,
        zIndex: 500,
        maxWidth: 260,
        padding: "9px 11px",
        borderRadius: 8,
        background: "rgba(8, 14, 24, 0.82)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "#e6edf7",
        fontSize: 11.5,
        lineHeight: 1.4,
        pointerEvents: "none",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        Active conflict (UCDP, 90 days) · {activeConfigured === false ? "not configured" : `${activeCount} countr${activeCount === 1 ? "y" : "ies"}`}
      </div>
      {([4, 3, 2, 1] as const).map((k) => (
        <div key={`a${k}`} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 4 }}>
          {swatch(ACTIVE_INTENSITY_STYLE[k].fill, ACTIVE_INTENSITY_STYLE[k].opacity, ACTIVE_INTENSITY_STYLE[k].line)}
          <span>
            <b>{ACTIVE_INTENSITY_STYLE[k].label}</b>: {ACTIVE_INTENSITY_STYLE[k].text}
          </span>
        </div>
      ))}
      {activeConfigured === false && <div style={{ opacity: 0.7, marginBottom: 4 }}>Unavailable: UCDP is not configured on the server.</div>}
      <div style={{ opacity: 0.7, marginTop: 4 }}>Rings: escalations getting worse. Tooltips give the detail.</div>
    </div>
  );
}
