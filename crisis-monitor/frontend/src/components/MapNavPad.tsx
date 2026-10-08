import type { CSSProperties } from "react";

/** Zoom (+/−) and pan (arrows) buttons, the same on every map. The caller supplies what each button does. */
export default function MapNavPad({
  onZoomIn,
  onZoomOut,
  onPan,
  style,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onPan: (dx: number, dy: number) => void;
  style?: CSSProperties;
}) {
  const btn: CSSProperties = { width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", color: "#9B978E", cursor: "pointer", fontSize: 16, fontFamily: "inherit", padding: 0 };
  return (
    <div
      style={{
        position: "absolute", right: 12, bottom: 30, zIndex: 1000, display: "flex", alignItems: "center", padding: "6px 8px", gap: 8,
        background: "rgba(8, 10, 20, 0.88)", backdropFilter: "blur(24px) saturate(1.3)", WebkitBackdropFilter: "blur(24px) saturate(1.3)",
        border: "1px solid rgba(212, 175, 55, 0.15)", borderRadius: 14, boxShadow: "0 4px 30px rgba(0,0,0,0.5)",
        ...style,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid rgba(212, 175, 55, 0.22)", paddingRight: 6 }}>
        <button style={btn} title="Zoom in" onClick={onZoomIn}>+</button>
        <button style={btn} title="Zoom out" onClick={onZoomOut}>−</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "28px 28px 28px", gridTemplateRows: "24px 24px 24px" }}>
        <span />
        <button style={btn} title="Pan up" onClick={() => onPan(0, -200)}>⌃</button>
        <span />
        <button style={btn} title="Pan left" onClick={() => onPan(-200, 0)}>‹</button>
        <span />
        <button style={btn} title="Pan right" onClick={() => onPan(200, 0)}>›</button>
        <span />
        <button style={btn} title="Pan down" onClick={() => onPan(0, 200)}>⌄</button>
        <span />
      </div>
    </div>
  );
}
