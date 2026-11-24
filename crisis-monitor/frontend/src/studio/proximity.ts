/**
 * "Which incidents are within N km of this route, line, area or point?"
 * Distances are worked out on a flat patch around each incident, which is
 * accurate to well under a percent for the few-hundred-km searches used here.
 */

type Pos = [number, number]; // lng, lat

export interface Parts {
  points: Pos[];
  lines: Pos[][];
  /** Each polygon is a list of rings (outer first, then holes). */
  polygons: Pos[][][];
}

type AnyGeo = GeoJSON.Geometry | GeoJSON.Feature | GeoJSON.FeatureCollection | null | undefined;

export function partsOf(g: AnyGeo, into: Parts = { points: [], lines: [], polygons: [] }): Parts {
  if (!g) return into;
  switch (g.type) {
    case "FeatureCollection":
      g.features.forEach((f) => partsOf(f, into));
      break;
    case "Feature":
      partsOf(g.geometry, into);
      break;
    case "GeometryCollection":
      g.geometries.forEach((x) => partsOf(x, into));
      break;
    case "Point":
      into.points.push(g.coordinates as Pos);
      break;
    case "MultiPoint":
      into.points.push(...(g.coordinates as Pos[]));
      break;
    case "LineString":
      into.lines.push(g.coordinates as Pos[]);
      break;
    case "MultiLineString":
      into.lines.push(...(g.coordinates as Pos[][]));
      break;
    case "Polygon":
      into.polygons.push(g.coordinates as Pos[][]);
      break;
    case "MultiPolygon":
      into.polygons.push(...(g.coordinates as Pos[][][]));
      break;
  }
  return into;
}

const KM_PER_DEG = 111.32;

function segDistKm(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inRing(x: number, y: number, ring: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance in km from a point to the parts; 0 when it lies inside an area. */
export function distanceKm(lng: number, lat: number, parts: Parts): number {
  const k = Math.cos((lat * Math.PI) / 180);
  const X = (l: number) => (l - lng) * k * KM_PER_DEG;
  const Y = (l: number) => (l - lat) * KM_PER_DEG;
  let best = Infinity;
  for (const p of parts.points) best = Math.min(best, Math.hypot(X(p[0]), Y(p[1])));
  const walk = (ring: Pos[]) => {
    for (let i = 0; i < ring.length - 1; i++) best = Math.min(best, segDistKm(0, 0, X(ring[i][0]), Y(ring[i][1]), X(ring[i + 1][0]), Y(ring[i + 1][1])));
  };
  for (const l of parts.lines) {
    if (l.length === 1) best = Math.min(best, Math.hypot(X(l[0][0]), Y(l[0][1])));
    walk(l);
  }
  for (const poly of parts.polygons) {
    if (inRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lng, lat, h))) return 0;
    for (const ring of poly) walk(ring);
  }
  return best;
}

function bounds(parts: Parts): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const see = (p: Pos) => ((w = Math.min(w, p[0])), (e = Math.max(e, p[0])), (s = Math.min(s, p[1])), (n = Math.max(n, p[1])));
  parts.points.forEach(see);
  parts.lines.forEach((l) => l.forEach(see));
  parts.polygons.forEach((p) => p[0].forEach(see));
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export interface Near<T> {
  row: T;
  km: number;
}

/** Rows (anything with latitude and longitude) within `radiusKm` of the geometry, nearest first. */
export function incidentsNear<T extends { latitude?: number | null; longitude?: number | null }>(rows: T[], geometry: AnyGeo, radiusKm: number): Near<T>[] {
  const parts = partsOf(geometry);
  const b = bounds(parts);
  if (!b) return [];
  const padLat = radiusKm / KM_PER_DEG;
  const out: Near<T>[] = [];
  for (const row of rows) {
    const lat = row.latitude, lng = row.longitude;
    if (lat == null || lng == null) continue;
    if (lat < b[1] - padLat || lat > b[3] + padLat) continue;
    const padLng = padLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    if (lng < b[0] - padLng || lng > b[2] + padLng) continue;
    const km = distanceKm(lng, lat, parts);
    if (km <= radiusKm) out.push({ row, km });
  }
  return out.sort((a, c) => a.km - c.km);
}

/** The box to ask the server for: the geometry's extent widened by the radius on every side. */
export function searchBox(geometry: AnyGeo, radiusKm: number): { min_lat: number; max_lat: number; min_lng: number; max_lng: number } | null {
  const b = bounds(partsOf(geometry));
  if (!b) return null;
  const padLat = radiusKm / KM_PER_DEG + 0.01;
  const widest = Math.max(Math.abs(b[1] - padLat), Math.abs(b[3] + padLat));
  const padLng = padLat / Math.max(0.05, Math.cos((Math.min(89, widest) * Math.PI) / 180));
  return { min_lat: Math.max(-90, b[1] - padLat), max_lat: Math.min(90, b[3] + padLat), min_lng: Math.max(-180, b[0] - padLng), max_lng: Math.min(180, b[2] + padLng) };
}

function haversineKm(a: Pos, b: Pos): number {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length in km of the geometry's lines (0 when it has none). */
export function lineLengthKm(geometry: AnyGeo): number {
  let total = 0;
  for (const l of partsOf(geometry).lines) for (let i = 0; i < l.length - 1; i++) total += haversineKm(l[i], l[i + 1]);
  return total;
}

/**
 * Where a point falls along the geometry's lines, as a distance from the start (the "chainage"), taken at the
 * closest point of the nearest line; lines after the first count on from the end of the one before. Null when the
 * geometry has no lines.
 */
export function chainageKm(lng: number, lat: number, geometry: AnyGeo): number | null {
  const lines = partsOf(geometry).lines;
  if (!lines.length) return null;
  const k = Math.cos((lat * Math.PI) / 180);
  const X = (l: number) => (l - lng) * k * KM_PER_DEG;
  const Y = (l: number) => (l - lat) * KM_PER_DEG;
  let best = Infinity, at = 0, offset = 0;
  for (const l of lines) {
    let run = 0;
    for (let i = 0; i < l.length - 1; i++) {
      const ax = X(l[i][0]), ay = Y(l[i][1]), bx = X(l[i + 1][0]), by = Y(l[i + 1][1]);
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      const seg = haversineKm(l[i], l[i + 1]);
      if (d < best) { best = d; at = offset + run + t * seg; }
      run += seg;
    }
    offset += run;
  }
  return at;
}
