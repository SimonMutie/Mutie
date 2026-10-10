import { getSessionUser } from "./session";

/** Sources whose terms ask for a credit wherever their data is shown or copied. */
export const DATA_CREDITS =
  "Map © OpenStreetMap contributors · Boundaries: Natural Earth, geoBoundaries (CC BY 4.0) · Indicators: World Bank · Events: GDELT";

/** One line stamped on every image the app produces. Doubles as the owner's
 *  mark and as a reminder that the picture is not a public document. */
export function exportStampLine(): string {
  const user = getSessionUser();
  const who = user ? ` · prepared for ${user.display_name || user.username}` : "";
  return `Afrilens Consulting · The Lens${who} · ${new Date().toISOString().slice(0, 10)} · Confidential — not for onward distribution`;
}

/** Viewer logins can look but not take anything away. The server refuses
 *  their writes; this keeps the download buttons from pretending to work. */
export function exportAllowed(): boolean {
  const user = getSessionUser();
  if (user?.read_only) {
    window.alert("This is a viewer login — downloads are switched off. Ask your Afrilens contact if you need a copy.");
    return false;
  }
  return true;
}

/** Returns a copy of `source` with a footer strip carrying the stamp and data credits. */
export function stampCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const scale = Math.max(1, Math.min(3, source.width / 900));
  const pad = Math.round(8 * scale);
  const font = Math.round(11 * scale);
  const strip = font * 2 + pad * 3;
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height + strip;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(source, 0, 0);
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, source.height, out.width, strip);
  ctx.fillStyle = "#c7d0db";
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(clip(ctx, exportStampLine(), out.width - pad * 2), pad, source.height + pad);
  ctx.fillStyle = "#8795a6";
  ctx.font = `${font}px system-ui, sans-serif`;
  ctx.fillText(clip(ctx, DATA_CREDITS, out.width - pad * 2), pad, source.height + pad * 2 + font);
  return out;
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 4 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}
