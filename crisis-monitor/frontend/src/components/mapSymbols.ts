/**
 * Marker drawings shared by Live OSINT's two map engines (Map3D for the 3D globe, FlatMap for the flat map), so a
 * marker looks the same whichever view is on screen.
 */

export type EscalationLevel = "watch" | "elevated" | "critical";

export const WARNING_COLOR: Record<EscalationLevel, string> = { critical: "#ff3d3d", elevated: "#ff9d4f", watch: "#c9a227" };
/** On-screen height of the escalation triangle, in CSS pixels. */
export const WARNING_SIZE: Record<EscalationLevel, number> = { critical: 19, elevated: 15, watch: 12 };

/** The escalation triangle with its exclamation mark, drawn as shapes on a 64-pixel canvas (crisp at any size). */
export function drawWarningIcon(fillColor: string): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.06);
  ctx.lineTo(size * 0.96, size * 0.92);
  ctx.lineTo(size * 0.04, size * 0.92);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#0b0b0b";
  // The "!": a little larger and bolder than before, with a rounded stem, so it reads at a glance.
  const stem = size * 0.12;
  ctx.beginPath();
  ctx.roundRect(size / 2 - stem / 2, size * 0.29, stem, size * 0.35, stem / 2.5);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.775, stem * 0.68, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

const urls = new Map<string, string>();
/** The escalation triangle as an image address (for the flat map's markers). */
export function warningIconUrl(level: EscalationLevel): string {
  let u = urls.get(level);
  if (!u) {
    u = drawWarningIcon(WARNING_COLOR[level]).toDataURL("image/png");
    urls.set(level, u);
  }
  return u;
}

/** A plain data point: its radius in pixels and its look (the same on the globe and the flat map). */
export const dotRadius = (size: number) => 3 + size * 14;
export const DOT = { fillOpacity: 0.9, stroke: "rgba(0,0,0,0.4)", strokeWidth: 1 };
