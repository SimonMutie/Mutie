/**
 * Geometry for the Lens's GIS tools: distances, bearings, scale and grid intervals. Pure functions on WGS 84
 * longitude/latitude, so they can be checked in tests. Distances are great-circle on a sphere of the WGS 84 mean
 * radius (6,371.0088 km), within about 0.5% of the ellipsoid anywhere, which is the accuracy of an on-map measurement.
 */

export interface LL { lat: number; lng: number }

export const EARTH_RADIUS_KM = 6371.0088;
const rad = Math.PI / 180;

export function haversineKm(a: LL, b: LL): number {
  const dφ = (b.lat - a.lat) * rad;
  const dλ = (b.lng - a.lng) * rad;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing, degrees clockwise from true north. */
export function initialBearing(a: LL, b: LL): number {
  const φ1 = a.lat * rad, φ2 = b.lat * rad, Δλ = (b.lng - a.lng) * rad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/** The 16-point compass name of a bearing (N, NNE, NE ...). */
export function compassPoint(deg: number): string {
  const names = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return names[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

export interface Leg { from: LL; to: LL; km: number; bearing: number; backBearing: number; cumulativeKm: number }

/** Each leg of a path: its length, the bearing to fly along it, the bearing back, and the running total. */
export function legsOf(points: LL[], closed = false): Leg[] {
  const pts = closed && points.length >= 3 ? [...points, points[0]] : points;
  const out: Leg[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const from = pts[i - 1], to = pts[i];
    const km = haversineKm(from, to);
    total += km;
    out.push({ from, to, km, bearing: initialBearing(from, to), backBearing: initialBearing(to, from), cumulativeKm: total });
  }
  return out;
}

/** Point a given distance along a bearing (the direct geodesic problem on the sphere). */
export function destination(from: LL, bearingDeg: number, km: number): LL {
  const δ = km / EARTH_RADIUS_KM, θ = bearingDeg * rad, φ1 = from.lat * rad, λ1 = from.lng * rad;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 / rad, lng: ((λ2 / rad + 540) % 360) - 180 };
}

/** A circle of a given radius as a closed [lng, lat] ring, true on the ground (not a screen circle). */
export function circleRingLngLat(centre: LL, km: number, steps = 96): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(centre, (360 * i) / steps, km);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

/** Ray-casting test of a point against a polygon's outer ring ([lng, lat] pairs). */
export function insideRing(p: LL, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ground metres per screen pixel on a Web Mercator map at a latitude and zoom. Leaflet uses 256-pixel tiles;
 *  MapLibre uses 512, so its zoom is one level lower for the same scale. */
export function metresPerPixel(lat: number, zoom: number, tileSize = 256): number {
  return (2 * Math.PI * 6378137 * Math.cos(lat * rad)) / (tileSize * 2 ** zoom);
}

/** A round length for a scale bar no longer than `maxMetres`: 1, 2 or 5 times a power of ten. */
export function niceScale(maxMetres: number): { metres: number; label: string } {
  if (!(maxMetres > 0)) return { metres: 0, label: "" };
  const pow = 10 ** Math.floor(Math.log10(maxMetres));
  const first = maxMetres / pow;
  const step = first >= 5 ? 5 : first >= 2 ? 2 : 1;
  const metres = step * pow;
  return { metres, label: metres >= 1000 ? `${+(metres / 1000).toFixed(3)} km` : `${metres} m` };
}

/** Representative fraction (1:N) of a map frame: the ground it covers over its printed width. */
export function representativeFraction(groundMetres: number, printedMillimetres: number): number {
  if (!(printedMillimetres > 0)) return 0;
  const n = groundMetres / (printedMillimetres / 1000);
  // Rounded as map scales are quoted: two significant figures.
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

/** A grid interval in degrees for a span: aims for about `lines` lines across. */
export function gridStep(spanDeg: number, lines = 5): number {
  const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 45];
  const target = Math.abs(spanDeg) / lines;
  return steps.find((s) => s >= target) ?? 45;
}

/** Grid values from `min` to `max` at `step`, snapped to multiples of the step. */
export function gridValues(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + 1e-9 && out.length < 200; v += step) out.push(+v.toFixed(6));
  return out;
}

/** A grid label: 12°30′E, 3°N, 0.25°S, in whole minutes when the step allows. */
export function gridLabel(value: number, axis: "lat" | "lng"): string {
  const hemi = axis === "lat" ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs + 1e-9);
  const min = Math.round((abs - deg) * 60 * 100) / 100;
  if (min === 0) return `${deg}°${hemi}`;
  return Number.isInteger(min) ? `${deg}°${String(min).padStart(2, "0")}′${hemi}` : `${abs.toFixed(3)}°${hemi}`;
}

export function fmtKm(km: number): string {
  return km >= 100 ? `${km.toFixed(0)} km` : km >= 1 ? `${km.toFixed(2)} km` : `${(km * 1000).toFixed(0)} m`;
}

export function fmtBearing(deg: number): string {
  return `${deg.toFixed(1).padStart(5, "0")}° ${compassPoint(deg)}`;
}
