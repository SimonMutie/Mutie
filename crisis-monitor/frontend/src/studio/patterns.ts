/**
 * Fill patterns for map shapes: stripes, criss-cross, grids and so on, drawn
 * as SVG patterns so they stay crisp at any zoom and print cleanly.
 */

export type PatternKey = "solid" | "none" | "stripes-h" | "stripes-v" | "stripes-d1" | "stripes-d2" | "grid" | "cross" | "dots" | "diamonds";

export const PATTERNS: { key: PatternKey; label: string }[] = [
  { key: "solid", label: "Solid" },
  { key: "stripes-d1", label: "Diagonal /" },
  { key: "stripes-d2", label: "Diagonal \\" },
  { key: "stripes-h", label: "Horizontal" },
  { key: "stripes-v", label: "Vertical" },
  { key: "cross", label: "Criss-cross" },
  { key: "grid", label: "Grid" },
  { key: "dots", label: "Dots" },
  { key: "diamonds", label: "Diamonds" },
  { key: "none", label: "Outline" },
];

export interface PatternSpec {
  key: PatternKey;
  /** Colour of the pattern lines or dots. */
  color: string;
  /** Tile size in pixels: the spacing between lines. */
  size: number;
  /** Line thickness in pixels. */
  weight: number;
  /** Background colour and opacity behind the pattern. */
  bg: string;
  bgOpacity: number;
}

const f = (n: number) => Number(n.toFixed(2));

/** The drawing inside one tile. Diagonal lines are drawn three times so the tile joins up without seams. */
function marks(k: PatternKey, s: number, w: number, c: string): string {
  const line = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${c}" stroke-width="${w}" stroke-linecap="square"/>`;
  const d1 = () => line(0, s, s, 0) + line(-s / 2, s / 2, s / 2, -s / 2) + line(s / 2, s * 1.5, s * 1.5, s / 2);
  const d2 = () => line(0, 0, s, s) + line(-s / 2, s / 2, s / 2, s * 1.5) + line(s / 2, -s / 2, s * 1.5, s / 2);
  switch (k) {
    case "stripes-h":
      return line(0, s / 2, s, s / 2);
    case "stripes-v":
      return line(s / 2, 0, s / 2, s);
    case "stripes-d1":
      return d1();
    case "stripes-d2":
      return d2();
    case "grid":
      return line(0, s / 2, s, s / 2) + line(s / 2, 0, s / 2, s);
    case "cross":
      return d1() + d2();
    case "dots":
      return `<circle cx="${s / 2}" cy="${s / 2}" r="${f(Math.max(1, w))}" fill="${c}"/>`;
    case "diamonds": {
      const r = Math.max(2, w * 1.8);
      return `<polygon points="${s / 2},${f(s / 2 - r)} ${f(s / 2 + r)},${s / 2} ${s / 2},${f(s / 2 + r)} ${f(s / 2 - r)},${s / 2}" fill="${c}"/>`;
    }
    default:
      return "";
  }
}

/** A stable id for a pattern, so identical patterns share one definition. */
export function patternId(p: PatternSpec): string {
  const h = [p.key, p.color, p.size, p.weight, p.bg, p.bgOpacity].join("|");
  let n = 0;
  for (let i = 0; i < h.length; i++) n = (n * 31 + h.charCodeAt(i)) >>> 0;
  return `lens-pat-${p.key}-${n.toString(36)}`;
}

/** The SVG `<pattern>` element for a spec. */
export function patternSvg(p: PatternSpec, id = patternId(p)): string {
  const s = Math.max(3, p.size);
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}"><rect width="${s}" height="${s}" fill="${p.bg}" fill-opacity="${p.bgOpacity}"/>${marks(p.key, s, p.weight, p.color)}</pattern>`;
}

export const hasPattern = (k: string | undefined): k is Exclude<PatternKey, "solid" | "none"> => !!k && k !== "solid" && k !== "none" && PATTERNS.some((x) => x.key === k);

/** A swatch for the style picker. */
export function previewSvg(p: PatternSpec, w = 44, h = 32): string {
  const id = `pv${patternId(p)}`;
  const fill = p.key === "none" ? "none" : hasPattern(p.key) ? `url(#${id})` : p.bg;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${hasPattern(p.key) ? patternSvg({ ...p, size: Math.min(p.size, 12) }, id) : ""}</defs><rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="5" fill="${fill}" fill-opacity="${p.key === "solid" ? p.bgOpacity : 1}" stroke="${p.color}" stroke-width="1.6"/></svg>`;
}
