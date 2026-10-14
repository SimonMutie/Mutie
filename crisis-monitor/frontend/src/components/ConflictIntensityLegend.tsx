import { INTENSITY_STYLE } from "./conflictIntensity";

/** Key for the conflict map: the four intensities, what each means, and the window. */
export default function ConflictIntensityLegend({ count }: { count: number }) {
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
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Countries by conflict intensity · {count} countr{count === 1 ? "y" : "ies"}</div>
      {([4, 3, 2, 1] as const).map((k) => (
        <div key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 4 }}>
          <span
            aria-hidden="true"
            style={{ flex: "0 0 auto", width: 16, height: 12, marginTop: 2, borderRadius: 2, background: INTENSITY_STYLE[k].fill, opacity: Math.min(1, INTENSITY_STYLE[k].opacity + 0.35), border: `1px solid ${INTENSITY_STYLE[k].line}` }}
          />
          <span>
            <b>{INTENSITY_STYLE[k].label}</b>: {INTENSITY_STYLE[k].text}
          </span>
        </div>
      ))}
      <div style={{ opacity: 0.7, marginTop: 4 }}>Countries, last 48 hours. Outlined areas are provinces. Grey: no escalation. Tooltips give the trend. Not a front line.</div>
    </div>
  );
}
