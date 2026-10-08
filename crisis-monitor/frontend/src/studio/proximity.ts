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
