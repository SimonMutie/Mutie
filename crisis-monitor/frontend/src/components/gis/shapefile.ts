import JSZip from "jszip";

/**
 * An ESRI shapefile writer (the 1998 ESRI technical description) for export from the Lens: one .shp/.shx/.dbf/.prj/
 * .cpg set per geometry type (points, lines, polygons), zipped together, as desktop GIS (QGIS, ArcGIS) expects.
 * Coordinates are WGS 84 longitude/latitude (EPSG:4326). Attribute values are written as text in UTF-8, which the
 * .cpg file declares, so names in Amharic, Arabic or Tigrinya survive.
 */

type Pos = [number, number];
type Kind = "point" | "line" | "polygon";
const SHAPE_TYPE: Record<Kind, number> = { point: 1, line: 3, polygon: 5 };

export const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

interface Rec { parts: Pos[][]; props: Record<string, unknown> }

/** Signed area of a ring (positive when anticlockwise in lng/lat). */
function signedArea(ring: Pos[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}
/** Shapefiles want outer rings clockwise and holes anticlockwise (the reverse of GeoJSON). */
export function orient(ring: Pos[], clockwise: boolean): Pos[] {
  const closed = ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ? [...ring, ring[0]] : ring;
  const isClockwise = signedArea(closed) < 0;
  return isClockwise === clockwise ? closed : [...closed].reverse();
}

/** Splits features by geometry type into shapefile records. Geometry collections and empty geometries are skipped. */
export function recordsByKind(fc: GeoJSON.FeatureCollection): Record<Kind, Rec[]> {
  const out: Record<Kind, Rec[]> = { point: [], line: [], polygon: [] };
  for (const f of fc.features) {
    const g = f.geometry;
    const props = f.properties ?? {};
    if (!g) continue;
    if (g.type === "Point") out.point.push({ parts: [[g.coordinates as Pos]], props });
    else if (g.type === "MultiPoint") for (const c of g.coordinates) out.point.push({ parts: [[c as Pos]], props });
    else if (g.type === "LineString") out.line.push({ parts: [g.coordinates as Pos[]], props });
    else if (g.type === "MultiLineString") out.line.push({ parts: g.coordinates as Pos[][], props });
    else if (g.type === "Polygon") out.polygon.push({ parts: (g.coordinates as Pos[][]).map((r, i) => orient(r, i === 0)), props });
    else if (g.type === "MultiPolygon") out.polygon.push({ parts: (g.coordinates as Pos[][][]).flatMap((poly) => poly.map((r, i) => orient(r, i === 0))), props });
  }
  return out;
}

function bboxOf(parts: Pos[][]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts) for (const [x, y] of p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}

function header(view: DataView, kind: Kind, words: number, box: [number, number, number, number]) {
  view.setInt32(0, 9994, false);
  view.setInt32(24, words, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, SHAPE_TYPE[kind], true);
  box.forEach((v, i) => view.setFloat64(36 + i * 8, Number.isFinite(v) ? v : 0, true));
}

/** The .shp and .shx files for records of one kind. */
export function writeShpShx(kind: Kind, recs: Rec[]): { shp: ArrayBuffer; shx: ArrayBuffer } {
  const contentLen = (r: Rec) => (kind === "point" ? 20 : 44 + 4 * r.parts.length + 16 * r.parts.reduce((n, p) => n + p.length, 0));
  const shpBytes = 100 + recs.reduce((n, r) => n + 8 + contentLen(r), 0);
  const shp = new ArrayBuffer(shpBytes);
  const shx = new ArrayBuffer(100 + 8 * recs.length);
  const sv = new DataView(shp), xv = new DataView(shx);
  const box = bboxOf(recs.flatMap((r) => r.parts));
  header(sv, kind, shpBytes / 2, box);
  header(xv, kind, (100 + 8 * recs.length) / 2, box);
  let off = 100;
  recs.forEach((r, i) => {
    const len = contentLen(r);
    xv.setInt32(100 + i * 8, off / 2, false);
    xv.setInt32(104 + i * 8, len / 2, false);
    sv.setInt32(off, i + 1, false);
    sv.setInt32(off + 4, len / 2, false);
    let o = off + 8;
    sv.setInt32(o, SHAPE_TYPE[kind], true);
    if (kind === "point") {
      const [x, y] = r.parts[0][0];
      sv.setFloat64(o + 4, x, true);
      sv.setFloat64(o + 12, y, true);
    } else {
      bboxOf(r.parts).forEach((v, k) => sv.setFloat64(o + 4 + k * 8, v, true));
      const nPoints = r.parts.reduce((n, p) => n + p.length, 0);
      sv.setInt32(o + 36, r.parts.length, true);
      sv.setInt32(o + 40, nPoints, true);
      o += 44;
      let start = 0;
      for (const p of r.parts) { sv.setInt32(o, start, true); o += 4; start += p.length; }
      for (const p of r.parts) for (const [x, y] of p) { sv.setFloat64(o, x, true); sv.setFloat64(o + 8, y, true); o += 16; }
    }
    off += 8 + len;
  });
  return { shp, shx };
}

const enc = new TextEncoder();
/** Truncates UTF-8 text to a byte length without splitting a character. */
function fitBytes(text: string, max: number): Uint8Array {
  let b = enc.encode(text);
  if (b.length <= max) return b;
  let s = text;
  while (b.length > max) { s = s.slice(0, -1); b = enc.encode(s); }
  return b;
}

/** DBF field names: up to 10 ASCII characters, unique. */
export function fieldNames(keys: string[]): string[] {
  const used = new Set<string>();
  return keys.map((k) => {
    let base = k.normalize("NFKD").replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 10).toUpperCase() || "FIELD";
    let name = base, n = 1;
    while (used.has(name)) { const suffix = String(n++); name = base.slice(0, 10 - suffix.length) + suffix; }
    used.add(name);
    return name;
  });
}

/** The .dbf attribute table: every property as a text field, up to 254 bytes. */
export function writeDbf(recs: Rec[]): ArrayBuffer {
  const keys = [...new Set(recs.flatMap((r) => Object.keys(r.props)))].slice(0, 120);
  const cols = keys.length ? keys : ["id"];
  const names = fieldNames(cols);
  const values = recs.map((r, i) => cols.map((k) => {
    const v = keys.length ? r.props[k] : i + 1;
    return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  }));
  const widths = cols.map((_, c) => Math.max(1, Math.min(254, Math.max(0, ...values.map((row) => enc.encode(row[c]).length)))));
  const headerLen = 32 + 32 * cols.length + 1;
  const recordLen = 1 + widths.reduce((a, b) => a + b, 0);
  const buf = new ArrayBuffer(headerLen + recordLen * recs.length + 1);
  const v = new DataView(buf), u = new Uint8Array(buf);
  const now = new Date();
  v.setUint8(0, 0x03);
  v.setUint8(1, now.getUTCFullYear() - 1900);
  v.setUint8(2, now.getUTCMonth() + 1);
  v.setUint8(3, now.getUTCDate());
  v.setUint32(4, recs.length, true);
  v.setUint16(8, headerLen, true);
  v.setUint16(10, recordLen, true);
  v.setUint8(29, 0x00);
  names.forEach((name, c) => {
    const at = 32 + c * 32;
    u.set(enc.encode(name), at);
    v.setUint8(at + 11, "C".charCodeAt(0));
    v.setUint8(at + 16, widths[c]);
  });
  v.setUint8(headerLen - 1, 0x0d);
  let o = headerLen;
  for (const row of values) {
    u[o++] = 0x20;
    row.forEach((text, c) => {
      u.fill(0x20, o, o + widths[c]);
      u.set(fitBytes(text, widths[c]), o);
      o += widths[c];
    });
  }
  u[o] = 0x1a;
  return buf;
}

/** A zip of shapefiles for a feature collection: <name>_points, <name>_lines, <name>_polygons, as present. */
export async function shapefileZip(fc: GeoJSON.FeatureCollection, name: string): Promise<Blob> {
  const zip = new JSZip();
  const byKind = recordsByKind(fc);
  const base = name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "lens";
  let any = false;
  for (const kind of ["point", "line", "polygon"] as Kind[]) {
    const recs = byKind[kind];
    if (!recs.length) continue;
    any = true;
    const stem = `${base}_${kind}s`;
    const { shp, shx } = writeShpShx(kind, recs);
    zip.file(`${stem}.shp`, shp);
    zip.file(`${stem}.shx`, shx);
    zip.file(`${stem}.dbf`, writeDbf(recs));
    zip.file(`${stem}.prj`, WGS84_PRJ);
    zip.file(`${stem}.cpg`, "UTF-8");
  }
  if (!any) throw new Error("Nothing to export: no points, lines or areas.");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
