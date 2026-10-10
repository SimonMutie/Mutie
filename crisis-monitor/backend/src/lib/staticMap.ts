import { PROVINCES, provinceAt, type Province } from "./conflictZones";

/**
 * A small static map of where an escalation happened, drawn from the province borders the platform already has
 * (no map service, no network). The province the incident is in is filled red (critical) or orange (elevated), its
 * neighbours are drawn dark, and a pin marks the place the reporting named. When reporting named only a country, the
 * country's provinces are all tinted and there is no pin, because a pin would claim a precision that isn't there.
 *
 * The same scene is written as SVG (shown in the app) and as a PNG (attached to emails, where SVG is not shown).
 * The maps carry no text; the caption goes beside them.
 */
export type MapLevel = "elevated" | "critical";
export type MapPrecision = "place" | "approximate" | "region" | "country";

export const MAP_W = 640;
export const MAP_H = 360;

interface ScenePoly {
  rings: [number, number][][]; // pixel coordinates
  fill: string;
  stroke: string;
  strokeWidth: number;
}
export interface MapScene {
  polys: ScenePoly[];
  pin: { x: number; y: number; color: string } | null;
  /** What the map is centred on, for the caption. */
  provinceName: string | null;
  countryCode: string | null;
}

const SEA = "#0b1220";
const LAND = "#1d2536";
const LAND_EDGE = "#3a4560";
const COLORS: Record<MapLevel, { fill: string; edge: string; pin: string }> = {
  critical: { fill: "rgba(224,36,36,0.62)", edge: "#ff6a6a", pin: "#ff3d3d" },
  elevated: { fill: "rgba(224,110,42,0.58)", edge: "#ffa56a", pin: "#ff9500" },
};

export function buildMapScene(i: { lat: number; lon: number; level: MapLevel; precision: MapPrecision; countryCode?: string | null }): MapScene {
  const here = provinceAt(i.lat, i.lon);
  const countryCode = here?.country ?? i.countryCode ?? null;
  const countryWide = i.precision === "country";
  const focus: Province[] = countryWide ? PROVINCES.filter((p) => p.country === countryCode) : here ? [here] : [];

  // The area to show: the focus province(s) with room around them, never tighter than about 1.6 degrees.
  let minLon = i.lon - 1.5, maxLon = i.lon + 1.5, minLat = i.lat - 1.5, maxLat = i.lat + 1.5;
  if (focus.length) {
    minLon = Math.min(...focus.map((p) => p.bbox[0]));
    minLat = Math.min(...focus.map((p) => p.bbox[1]));
    maxLon = Math.max(...focus.map((p) => p.bbox[2]));
    maxLat = Math.max(...focus.map((p) => p.bbox[3]));
  }
  const midLat = (minLat + maxLat) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  let spanX = Math.max((maxLon - minLon) * k, 1.6 * k) * 1.45;
  let spanY = Math.max(maxLat - minLat, 1.6) * 1.45;
  if (spanX / spanY < MAP_W / MAP_H) spanX = spanY * (MAP_W / MAP_H);
  else spanY = spanX * (MAP_H / MAP_W);
  const cx = ((minLon + maxLon) / 2) * k;
  const cy = (minLat + maxLat) / 2;
  const scale = MAP_W / spanX;
  const px = (lon: number, lat: number): [number, number] => [(lon * k - (cx - spanX / 2)) * scale, (cy + spanY / 2 - lat) * scale];

  const view = { w0: cx - spanX / 2, w1: cx + spanX / 2, s: cy - spanY / 2, n: cy + spanY / 2 };
  const polys: ScenePoly[] = [];
  const c = COLORS[i.level];
  const focusSet = new Set(focus);
  for (const p of PROVINCES) {
    const [a, b, cc, d] = p.bbox;
    if (cc * k < view.w0 || a * k > view.w1 || d < view.s || b > view.n) continue;
    const isFocus = focusSet.has(p);
    polys.push({ rings: p.rings.map((r) => r.map(([lon, lat]) => px(lon, lat))), fill: isFocus ? c.fill : LAND, stroke: isFocus ? c.edge : LAND_EDGE, strokeWidth: isFocus ? 2 : 1 });
  }
  let pin: MapScene["pin"] = null;
  if (!countryWide) {
    const [x, y] = px(i.lon, i.lat);
    if (x > 0 && x < MAP_W && y > 0 && y < MAP_H) pin = { x, y, color: c.pin };
  }
  return { polys, pin, provinceName: here?.name ?? null, countryCode };
}

// ── SVG ──────────────────────────────────────────────────────────────────

const f1 = (n: number) => n.toFixed(1);

export function sceneToSvg(s: MapScene): string {
  const body = s.polys
    .map((p) => `<path d="${p.rings.map((r) => `M${r.map(([x, y]) => `${f1(x)},${f1(y)}`).join("L")}Z`).join("")}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linejoin="round" fill-rule="evenodd"/>`)
    .join("");
  const pin = s.pin ? `<circle cx="${f1(s.pin.x)}" cy="${f1(s.pin.y)}" r="11" fill="rgba(0,0,0,0.45)"/><circle cx="${f1(s.pin.x)}" cy="${f1(s.pin.y)}" r="8" fill="${s.pin.color}" stroke="#ffffff" stroke-width="2.5"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_W} ${MAP_H}" width="100%" role="img" aria-label="Map of where this happened"><rect width="${MAP_W}" height="${MAP_H}" fill="${SEA}"/>${body}${pin}</svg>`;
}

// ── PNG ──────────────────────────────────────────────────────────────────

const SS = 2; // supersampling, for smooth edges

function parseColor(c: string): [number, number, number, number] {
  if (c.startsWith("#")) return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
  const m = /rgba?\(([^)]+)\)/.exec(c)!.at(1)!.split(",").map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
}

class Canvas {
  readonly w = MAP_W * SS;
  readonly h = MAP_H * SS;
  readonly px = new Uint8ClampedArray(this.w * this.h * 4);
  fillAll(color: string) {
    const [r, g, b] = parseColor(color);
    for (let i = 0; i < this.px.length; i += 4) { this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = 255; }
  }
  private blend(x: number, y: number, [r, g, b, a]: [number, number, number, number]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    this.px[o] = this.px[o] * (1 - a) + r * a;
    this.px[o + 1] = this.px[o + 1] * (1 - a) + g * a;
    this.px[o + 2] = this.px[o + 2] * (1 - a) + b * a;
  }
  /** Even-odd scanline fill of all rings together. */
  fill(rings: [number, number][][], color: string) {
    const col = parseColor(color);
    let minY = Infinity, maxY = -Infinity;
    for (const r of rings) for (const [, y] of r) { minY = Math.min(minY, y * SS); maxY = Math.max(maxY, y * SS); }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.h - 1, Math.ceil(maxY)); y++) {
      const yy = y + 0.5;
      const xs: number[] = [];
      for (const r of rings) {
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const y1 = r[i][1] * SS, y2 = r[j][1] * SS;
          if (y1 > yy !== y2 > yy) xs.push(r[i][0] * SS + ((yy - y1) / (y2 - y1)) * (r[j][0] * SS - r[i][0] * SS));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.max(0, Math.round(xs[i])); x < Math.min(this.w, Math.round(xs[i + 1])); x++) this.blend(x, y, col);
      }
    }
  }
  disc(cx: number, cy: number, radius: number, color: string) {
    const col = parseColor(color);
    const R = radius * SS;
    for (let y = Math.floor(cy * SS - R); y <= cy * SS + R; y++) for (let x = Math.floor(cx * SS - R); x <= cx * SS + R; x++) if ((x + 0.5 - cx * SS) ** 2 + (y + 0.5 - cy * SS) ** 2 <= R * R) this.blend(x, y, col);
  }
  line(x0: number, y0: number, x1: number, y1: number, width: number, color: string) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * SS));
    const half = Math.max(0.5, (width * SS) / 2);
    const col = parseColor(color);
    for (let s = 0; s <= steps; s++) {
      const cx = (x0 + ((x1 - x0) * s) / steps) * SS;
      const cy = (y0 + ((y1 - y0) * s) / steps) * SS;
      for (let y = Math.floor(cy - half); y <= cy + half; y++) for (let x = Math.floor(cx - half); x <= cx + half; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= half * half) this.blend(x, y, col);
    }
  }
  /** Averages SS x SS blocks down to the output size, as RGB rows each led by a PNG filter byte. */
  scanlines(): Uint8Array {
    const out = new Uint8Array(MAP_H * (1 + MAP_W * 3));
    let o = 0;
    for (let y = 0; y < MAP_H; y++) {
      out[o++] = 0;
      for (let x = 0; x < MAP_W; x++) {
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * this.w + (x * SS + dx)) * 4;
          r += this.px[i]; g += this.px[i + 1]; b += this.px[i + 2];
        }
        out[o++] = r / (SS * SS); out[o++] = g / (SS * SS); out[o++] = b / (SS * SS);
      }
    }
    return out;
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sceneToPng(s: MapScene): Promise<Uint8Array> {
  const cv = new Canvas();
  cv.fillAll(SEA);
  for (const p of s.polys) {
    cv.fill(p.rings, p.fill);
    for (const r of p.rings) for (let i = 1; i < r.length; i++) cv.line(r[i - 1][0], r[i - 1][1], r[i][0], r[i][1], p.strokeWidth, p.stroke);
  }
  if (s.pin) {
    cv.disc(s.pin.x, s.pin.y, 11, "rgba(0,0,0,0.45)");
    cv.disc(s.pin.x, s.pin.y, 8, "#ffffff");
    cv.disc(s.pin.x, s.pin.y, 5.5, s.pin.color);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, MAP_W);
  dv.setUint32(4, MAP_H);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const idat = await deflate(cv.scanlines());
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What the map shows, in words, for the caption beside it. */
export function mapCaption(i: { locationLabel: string | null; countryName: string; precision: MapPrecision }, scene: MapScene): string {
  const where = [scene.provinceName && scene.provinceName !== i.locationLabel ? scene.provinceName : null, i.countryName].filter(Boolean).join(", ");
  if (i.precision === "country") return `Reporting named only ${i.countryName}, so the whole country is tinted and no pin is shown.`;
  const exact = i.precision === "place" ? "The pin marks the place named in the reporting." : "The pin is approximate: reporting named a wider area or the place was estimated.";
  return `${where} — shaded province is where this was reported. ${exact}`;
}
