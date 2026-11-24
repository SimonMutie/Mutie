import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Fill patterns for areas on the map (watch zones and boundary-library areas): stripes, nets, grids, dots and
 * checks, in any colour. The same drawing serves both maps: an SVG <pattern> for the flat (Leaflet, SVG) map and a
 * pattern image for the 3D globe (MapLibre). Each pattern carries a faint tint of its colour under the marks, so a
 * patterned area still reads as one block.
 */

export type FillPattern = "solid" | "outline" | "diagonal" | "reverse" | "horizontal" | "vertical" | "net" | "grid" | "dots" | "checks";

export const FILL_PATTERNS: { id: FillPattern; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "outline", label: "Outline only" },
  { id: "diagonal", label: "Stripes ⁄" },
  { id: "reverse", label: "Stripes \\" },
  { id: "horizontal", label: "Stripes —" },
  { id: "vertical", label: "Stripes |" },
  { id: "net", label: "Net (crosshatch)" },
  { id: "grid", label: "Grid" },
  { id: "dots", label: "Dots" },
  { id: "checks", label: "Checks" },
];
const IDS = new Set<string>(FILL_PATTERNS.map((p) => p.id));
export const isFillPattern = (v: unknown): v is FillPattern => typeof v === "string" && IDS.has(v);

/** A pattern that draws marks (not plain solid or no fill). */
export const isMarked = (p: FillPattern | null | undefined): p is FillPattern => !!p && p !== "solid" && p !== "outline";

const TILE = 12;
const hex6 = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : /^#[0-9a-f]{3}$/i.test(c) ? `#${[...c.slice(1)].map((x) => x + x).join("")}`.toLowerCase() : "#ffffff");

/** The marks of a pattern as SVG elements on a TILE×TILE tile. */
function marks(p: FillPattern, color: string): string {
  const s = `stroke="${color}" stroke-opacity="0.9" stroke-width="1.6" stroke-linecap="square" fill="none"`;
  switch (p) {
    case "diagonal": return `<path d="M-3,3 L3,-3 M0,${TILE} L${TILE},0 M${TILE - 3},${TILE + 3} L${TILE + 3},${TILE - 3}" ${s}/>`;
    case "reverse": return `<path d="M-3,${TILE - 3} L3,${TILE + 3} M0,0 L${TILE},${TILE} M${TILE - 3},-3 L${TILE + 3},3" ${s}/>`;
    case "horizontal": return `<path d="M0,${TILE / 2} L${TILE},${TILE / 2}" ${s}/>`;
    case "vertical": return `<path d="M${TILE / 2},0 L${TILE / 2},${TILE}" ${s}/>`;
    case "net": return `<path d="M-3,3 L3,-3 M0,${TILE} L${TILE},0 M${TILE - 3},${TILE + 3} L${TILE + 3},${TILE - 3} M-3,${TILE - 3} L3,${TILE + 3} M0,0 L${TILE},${TILE} M${TILE - 3},-3 L${TILE + 3},3" ${s.replace('stroke-width="1.6"', 'stroke-width="1.2"')}/>`;
    case "grid": return `<path d="M0,0.6 L${TILE},0.6 M0.6,0 L0.6,${TILE}" ${s.replace('stroke-width="1.6"', 'stroke-width="1.2"')}/>`;
    case "dots": return `<circle cx="3" cy="3" r="1.6" fill="${color}" fill-opacity="0.95"/><circle cx="9" cy="9" r="1.6" fill="${color}" fill-opacity="0.95"/>`;
    case "checks": return `<rect x="0" y="0" width="${TILE / 2}" height="${TILE / 2}" fill="${color}" fill-opacity="0.45"/><rect x="${TILE / 2}" y="${TILE / 2}" width="${TILE / 2}" height="${TILE / 2}" fill="${color}" fill-opacity="0.45"/>`;
    default: return "";
  }
}

function tileSvgBody(p: FillPattern, color: string, tint: number): string {
  return `<rect width="${TILE}" height="${TILE}" fill="${color}" fill-opacity="${tint}"/>${marks(p, color)}`;
}

/* ── Flat map: SVG patterns, kept in one hidden <svg> in the page and referred to as url(#id) ─────────────────── */

let defs: SVGDefsElement | null = null;
const made = new Set<string>();

/** The fill to give an SVG path for a pattern: url(#…) (the pattern is added to the page on first use). */
export function svgPatternFill(p: FillPattern, color: string, tint = 0.1): string {
  const c = hex6(color);
  const id = `lens-pat-${p}-${c.slice(1)}-${Math.round(tint * 100)}`;
  if (!made.has(id) && typeof document !== "undefined") {
    if (!defs) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.setAttribute("aria-hidden", "true");
      svg.style.position = "absolute";
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      svg.appendChild(defs);
      document.body.appendChild(svg);
    }
    const pat = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
    pat.setAttribute("id", id);
    pat.setAttribute("patternUnits", "userSpaceOnUse");
    pat.setAttribute("width", String(TILE));
    pat.setAttribute("height", String(TILE));
    pat.innerHTML = tileSvgBody(p, c, tint);
    defs.appendChild(pat);
    made.add(id);
  }
  return `url(#${id})`;
}

/** Leaflet path options for an area's fill: a pattern, plain colour, or no fill. */
export function leafletFill(p: FillPattern | null | undefined, color: string, fillOpacity: number): { fillColor: string; fillOpacity: number } {
  if (p === "outline") return { fillColor: color, fillOpacity: 0 };
  if (isMarked(p)) return { fillColor: svgPatternFill(p, color, Math.min(0.3, fillOpacity * 0.6)), fillOpacity: 1 };
  return { fillColor: color, fillOpacity };
}

/** A small preview of a pattern for buttons (inline SVG). */
export function patternPreviewSvg(p: FillPattern, color: string, size = 18): string {
  const c = hex6(color);
  const body = p === "solid" ? `<rect width="${TILE}" height="${TILE}" fill="${c}" fill-opacity="0.55"/>` : p === "outline" ? "" : tileSvgBody(p, c, 0.12);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${TILE} ${TILE}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:hidden">${body}<rect x="0.5" y="0.5" width="${TILE - 1}" height="${TILE - 1}" fill="none" stroke="${c}" stroke-width="1"/></svg>`;
}

/* ── 3D globe: pattern images, made when the map first asks for one ──────────────────────────────────────────── */

/** The image name for a pattern in MapLibre, or undefined when the area is solid or unfilled. */
export function glPatternImage(p: FillPattern | null | undefined, color: string, tint = 0.1): string | undefined {
  if (!isMarked(p)) return undefined;
  return `lens-pat-${p}-${hex6(color).slice(1)}-${Math.round(Math.min(0.3, tint) * 100)}`;
}

function drawTile(p: FillPattern, color: string, tint: number, ratio: number): ImageData | null {
  const size = TILE * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.globalAlpha = tint;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "square";
  const line = (pts: number[][], w = 1.6) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i + 1][0], pts[i + 1][1]); }
    ctx.stroke();
  };
  const fwd = [[-3, 3], [3, -3], [0, TILE], [TILE, 0], [TILE - 3, TILE + 3], [TILE + 3, TILE - 3]];
  const back = [[-3, TILE - 3], [3, TILE + 3], [0, 0], [TILE, TILE], [TILE - 3, -3], [TILE + 3, 3]];
  switch (p) {
    case "diagonal": line(fwd); break;
    case "reverse": line(back); break;
    case "horizontal": line([[0, TILE / 2], [TILE, TILE / 2]]); break;
    case "vertical": line([[TILE / 2, 0], [TILE / 2, TILE]]); break;
    case "net": line([...fwd, ...back], 1.2); break;
    case "grid": line([[0, 0.6], [TILE, 0.6], [0.6, 0], [0.6, TILE]], 1.2); break;
    case "dots":
      ctx.globalAlpha = 0.95;
      for (const [x, y] of [[3, 3], [9, 9]]) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
      break;
    case "checks":
      ctx.globalAlpha = 0.45;
      ctx.fillRect(0, 0, TILE / 2, TILE / 2);
      ctx.fillRect(TILE / 2, TILE / 2, TILE / 2, TILE / 2);
      break;
  }
  return ctx.getImageData(0, 0, size, size);
}

/** Adds to the globe every pattern image the features name (property "pat"), before they are drawn. MapLibre 6
 *  does not wait for images added from its "styleimagemissing" event, so they must be in place first. */
export function ensureGlPatterns(map: MapLibreMap, fc: { features: { properties?: Record<string, unknown> | null }[] }) {
  for (const f of fc.features) {
    const id = f.properties?.pat;
    if (typeof id !== "string" || map.hasImage(id)) continue;
    const m = /^lens-pat-([a-z]+)-([0-9a-f]{6})-(\d+)$/.exec(id);
    if (!m || !isFillPattern(m[1])) continue;
    const img = drawTile(m[1], `#${m[2]}`, Number(m[3]) / 100, 2);
    if (img) map.addImage(id, img, { pixelRatio: 2 });
  }
}
