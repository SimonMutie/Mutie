import shp, { combine, parseDbf, parseShp } from "shpjs";
import { feature as topoFeature } from "topojson-client";
import type { ShapeSource } from "../api";

/**
 * Reads whatever geographic file a user drops on the map into GeoJSON:
 * shapefiles (zipped, or the loose .shp/.dbf/.prj files together), GeoJSON,
 * TopoJSON, KML and KMZ, GPX, CSV or Excel with coordinates, and WKT.
 * Everything comes out as WGS84 longitude/latitude.
 */

export interface Imported {
  fc: GeoJSON.FeatureCollection;
  source: ShapeSource;
  name: string;
  warnings: string[];
  /** Counts by geometry type, for the preview. */
  counts: Record<string, number>;
}

export const ACCEPT = ".zip,.shp,.dbf,.prj,.cpg,.geojson,.json,.topojson,.kml,.kmz,.gpx,.csv,.tsv,.txt,.wkt,.xlsx,.xls";
export const FORMATS = "Shapefile (.zip, or .shp with .dbf and .prj), GeoJSON, TopoJSON, KML, KMZ, GPX, CSV or Excel with latitude and longitude columns, WKT";

const ext = (n: string) => (/\.([a-z0-9]+)$/i.exec(n)?.[1] ?? "").toLowerCase();
const stem = (n: string) => n.replace(/\.[a-z0-9]+$/i, "");

// ── Normalising ─────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Drops altitude and checks the coordinates are longitude/latitude; returns null for geometry that is empty or out of range. */
function cleanCoords(c: unknown): unknown {
  if (Array.isArray(c) && c.length >= 2 && isNum(c[0]) && isNum(c[1])) return [c[0], c[1]];
  if (Array.isArray(c)) {
    const out = c.map(cleanCoords).filter((x) => x !== null);
    return out.length ? out : null;
  }
  return null;
}
function inRange(c: unknown): boolean {
  if (Array.isArray(c) && isNum(c[0]) && isNum(c[1])) return Math.abs(c[0] as number) <= 180.0001 && Math.abs(c[1] as number) <= 90.0001;
  return Array.isArray(c) ? c.every(inRange) : true;
}

function cleanGeometry(g: GeoJSON.Geometry | null | undefined): GeoJSON.Geometry[] {
  if (!g) return [];
  if (g.type === "GeometryCollection") return g.geometries.flatMap(cleanGeometry);
  const coords = cleanCoords((g as { coordinates: unknown }).coordinates);
  if (!coords) return [];
  return [{ ...g, coordinates: coords } as GeoJSON.Geometry];
}

export function normalise(input: GeoJSON.FeatureCollection | GeoJSON.Feature | GeoJSON.Geometry | GeoJSON.Feature[]): { fc: GeoJSON.FeatureCollection; warnings: string[] } {
  const warnings: string[] = [];
  const raw: GeoJSON.Feature[] = Array.isArray(input)
    ? input
    : input.type === "FeatureCollection"
      ? input.features
      : input.type === "Feature"
        ? [input]
        : [{ type: "Feature", properties: {}, geometry: input }];
  const features: GeoJSON.Feature[] = [];
  let dropped = 0;
  for (const f of raw) {
    const geoms = cleanGeometry(f?.geometry);
    if (!geoms.length) dropped++;
    for (const g of geoms) features.push({ type: "Feature", properties: f.properties ?? {}, geometry: g });
  }
  if (dropped) warnings.push(`${dropped} feature${dropped === 1 ? "" : "s"} had no usable geometry and were skipped.`);
  if (features.length && !features.every((f) => inRange((f.geometry as { coordinates: unknown }).coordinates)))
    throw new Error("These coordinates are not longitude/latitude (they look projected). For a shapefile, include the .prj file so it can be converted.");
  return { fc: { type: "FeatureCollection", features }, warnings };
}

const countTypes = (fc: GeoJSON.FeatureCollection) => fc.features.reduce<Record<string, number>>((m, f) => ({ ...m, [f.geometry.type]: (m[f.geometry.type] ?? 0) + 1 }), {});

// ── Formats ─────────────────────────────────────────────────────────────

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("That file is not valid XML.");
  return doc;
}

async function geoJsonish(text: string): Promise<{ fc: GeoJSON.FeatureCollection; source: ShapeSource }> {
  const j = JSON.parse(text) as { type?: string; objects?: Record<string, unknown>; features?: unknown };
  if (j.type === "Topology" && j.objects) {
    const feats = Object.values(j.objects).flatMap((o) => {
      const r = topoFeature(j as never, o as never) as unknown as GeoJSON.Feature | GeoJSON.FeatureCollection;
      return r.type === "FeatureCollection" ? r.features : [r];
    });
    return { fc: { type: "FeatureCollection", features: feats }, source: "topojson" };
  }
  if (Array.isArray(j) && j.every((x) => x && typeof x === "object" && (x as { type?: string }).type === "Feature")) return { fc: { type: "FeatureCollection", features: j as GeoJSON.Feature[] }, source: "geojson" };
  if (!j.type) throw new Error("That JSON is not GeoJSON: it has no \"type\".");
  return { fc: j as unknown as GeoJSON.FeatureCollection, source: "geojson" };
}

const toFc = (r: GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[]): GeoJSON.FeatureCollection => (Array.isArray(r) ? { type: "FeatureCollection", features: r.flatMap((x) => x.features) } : r);

async function fromZip(buf: ArrayBuffer): Promise<{ fc: GeoJSON.FeatureCollection; source: ShapeSource }> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !/__MACOSX/.test(n));
  const has = (e: string) => names.some((n) => ext(n) === e);
  if (has("shp")) return { fc: toFc(await shp(buf)), source: "shapefile" };
  const kmlName = names.find((n) => ext(n) === "kml");
  if (kmlName) return { fc: await kmlToFc(await zip.files[kmlName].async("string")), source: "kml" };
  const gj = names.find((n) => ["geojson", "json"].includes(ext(n)));
  if (gj) return geoJsonish(await zip.files[gj].async("string"));
  throw new Error("That zip has no .shp, .kml or .geojson file inside.");
}

async function kmlToFc(text: string): Promise<GeoJSON.FeatureCollection> {
  const { kml } = await import("@tmcw/togeojson");
  return kml(parseXml(text)) as GeoJSON.FeatureCollection;
}

/** Loose shapefile parts picked together: pairs .shp with its .dbf and .prj of the same name. */
async function fromLooseShapefile(files: File[]): Promise<GeoJSON.FeatureCollection> {
  const shpFile = files.find((f) => ext(f.name) === "shp");
  if (!shpFile) throw new Error("Pick the .shp together with its .dbf and .prj files, or one .zip.");
  const same = (e: string) => files.find((f) => ext(f.name) === e && stem(f.name).toLowerCase() === stem(shpFile.name).toLowerCase());
  const [dbf, prj, cpg] = [same("dbf"), same("prj"), same("cpg")];
  const geoms = parseShp(await shpFile.arrayBuffer(), prj ? await prj.text() : undefined);
  const props = dbf ? parseDbf(await dbf.arrayBuffer(), cpg ? (await cpg.text()).trim() : undefined) : undefined;
  return combine([geoms, props]);
}

// ── Delimited text and Excel ────────────────────────────────────────────

function splitCsv(text: string): string[][] {
  const delim = (text.split("\n", 1)[0].match(/\t/g)?.length ?? 0) > (text.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? "\t" : (text.split("\n", 1)[0].match(/;/g)?.length ?? 0) > (text.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const LAT = ["latitude", "lat", "y", "ycoord", "lat_dd", "point_y"];
const LNG = ["longitude", "lon", "lng", "long", "x", "xcoord", "lon_dd", "point_x"];

/** Rows with latitude and longitude columns (or a WKT column) become points and shapes. */
export function rowsToFc(rows: Record<string, unknown>[]): GeoJSON.FeatureCollection {
  if (!rows.length) throw new Error("The file has no rows.");
  const keys = Object.keys(rows[0]);
  const find = (names: string[]) => keys.find((k) => names.includes(k.trim().toLowerCase()));
  const wktKey = keys.find((k) => k.trim().toLowerCase() === "wkt" || k.trim().toLowerCase() === "geometry");
  const lat = find(LAT), lng = find(LNG);
  const features: GeoJSON.Feature[] = [];
  for (const r of rows) {
    let geometry: GeoJSON.Geometry | null = null;
    if (lat && lng && String(r[lat]).trim() !== "" && String(r[lng]).trim() !== "") {
      const y = Number(String(r[lat]).replace(",", ".")), x = Number(String(r[lng]).replace(",", "."));
      if (Number.isFinite(x) && Number.isFinite(y)) geometry = { type: "Point", coordinates: [x, y] };
    } else if (wktKey && typeof r[wktKey] === "string") geometry = parseWkt(r[wktKey] as string);
    if (geometry) {
      const properties = Object.fromEntries(Object.entries(r).filter(([k]) => k !== lat && k !== lng && k !== wktKey));
      features.push({ type: "Feature", properties, geometry });
    }
  }
  if (!features.length) throw new Error("No coordinates found. Add columns named latitude and longitude (or a WKT column).");
  return { type: "FeatureCollection", features };
}

async function fromExcel(buf: ArrayBuffer): Promise<GeoJSON.FeatureCollection> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const features = wb.SheetNames.flatMap((n) => {
    try {
      return rowsToFc(XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[n], { defval: "" })).features;
    } catch {
      return [];
    }
  });
  if (!features.length) throw new Error("No sheet has latitude and longitude columns.");
  return { type: "FeatureCollection", features };
}

// ── WKT ─────────────────────────────────────────────────────────────────

const pt = (s: string): number[] => s.trim().split(/\s+/).slice(0, 2).map(Number);
const ring = (s: string): number[][] => s.split(",").map(pt);
const parens = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (s[i] === ")") {
      depth--;
      if (depth === 0) out.push(s.slice(start, i));
    }
  }
  return out;
};

/** Parses one WKT geometry (POINT, LINESTRING, POLYGON and their MULTI versions). Returns null if it cannot be read. */
export function parseWkt(text: string): GeoJSON.Geometry | null {
  const m = /^\s*(?:SRID=\d+;)?\s*(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON)\s*(?:Z|M|ZM)?\s*(\(.*\))\s*$/is.exec(text);
  if (!m) return null;
  const body = m[2].slice(1, -1);
  try {
    switch (m[1].toUpperCase()) {
      case "POINT":
        return { type: "Point", coordinates: pt(body) };
      case "LINESTRING":
        return { type: "LineString", coordinates: ring(body) };
      case "POLYGON":
        return { type: "Polygon", coordinates: parens(body).map(ring) };
      case "MULTIPOINT":
        return { type: "MultiPoint", coordinates: body.replace(/[()]/g, "").split(",").map(pt) };
      case "MULTILINESTRING":
        return { type: "MultiLineString", coordinates: parens(body).map(ring) };
      default:
        return { type: "MultiPolygon", coordinates: parens(body).map((p) => parens(p).map(ring)) };
    }
  } catch {
    return null;
  }
}

function fromWkt(text: string): GeoJSON.FeatureCollection {
  const features = text
    .split(/\r?\n/)
    .map((l) => parseWkt(l))
    .filter((g): g is GeoJSON.Geometry => !!g)
    .map((geometry) => ({ type: "Feature" as const, properties: {}, geometry }));
  if (!features.length) throw new Error("No WKT geometry found.");
  return { type: "FeatureCollection", features };
}

// ── Entry point ─────────────────────────────────────────────────────────

/** Reads one file, or a set picked together (the parts of a shapefile). */
export async function importGeoFiles(files: File[]): Promise<Imported> {
  if (!files.length) throw new Error("No file chosen.");
  const main = files.find((f) => ["shp", "zip", "geojson", "json", "topojson", "kml", "kmz", "gpx", "csv", "tsv", "txt", "wkt", "xlsx", "xls"].includes(ext(f.name))) ?? files[0];
  const e = ext(main.name);
  let fc: GeoJSON.FeatureCollection;
  let source: ShapeSource;
  if (e === "shp") (fc = await fromLooseShapefile(files)), (source = "shapefile");
  else if (e === "zip" || e === "kmz") ({ fc, source } = await fromZip(await main.arrayBuffer()));
  else if (["geojson", "json", "topojson"].includes(e)) ({ fc, source } = await geoJsonish(await main.text()));
  else if (e === "kml") (fc = await kmlToFc(await main.text())), (source = "kml");
  else if (e === "gpx") {
    const { gpx } = await import("@tmcw/togeojson");
    (fc = gpx(parseXml(await main.text())) as GeoJSON.FeatureCollection), (source = "gpx");
  } else if (e === "csv" || e === "tsv" || e === "txt") {
    const text = await main.text();
    if (/^\s*(?:SRID=\d+;)?\s*(POINT|LINESTRING|POLYGON|MULTI)/i.test(text)) (fc = fromWkt(text)), (source = "wkt");
    else {
      const rows = splitCsv(text);
      const head = rows[0].map((h) => h.trim());
      fc = rowsToFc(rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))));
      source = "csv";
    }
  } else if (e === "wkt") (fc = fromWkt(await main.text())), (source = "wkt");
  else if (e === "xlsx" || e === "xls") (fc = await fromExcel(await main.arrayBuffer())), (source = "csv");
  else throw new Error(`Cannot read .${e || "this"} files. Supported: ${FORMATS}.`);

  const n = normalise(fc);
  if (!n.fc.features.length) throw new Error("No shapes or points were found in that file.");
  return { fc: n.fc, source, name: stem(main.name), warnings: n.warnings, counts: countTypes(n.fc) };
}
