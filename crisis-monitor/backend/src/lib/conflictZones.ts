import { countryAt } from "./africaGeo";

/**
 * Areas of active fighting, worked out from where recent conflict reporting clusters.
 *
 * The map is cut into half-degree cells (about 55 km). A cell counts as an active conflict area when, in the last
 * two days, it holds enough separate reports of fighting, or a verified escalation incident. Cells in a row are
 * joined into one rectangle so the layer stays small. This shows where reported fighting is concentrated; it is
 * NOT a front line or a control boundary, and says nothing about who holds the ground.
 */
export const ZONE_CELL_DEG = 0.5;
/** A cell needs this much weight to be drawn. */
export const ZONE_MIN_SCORE = 4;
/** What a verified escalation incident is worth, against 1 for a reported event. */
export const ZONE_INCIDENT_WEIGHT = 5;
/** Events at exactly the same coordinates (often a place name resolved to a town centre) count at most this many times. */
const MAX_PER_COORDINATE = 2;

export interface ZonePoint {
  lat: number;
  lon: number;
  /** Verified incident rather than a reported event. */
  verified?: boolean;
}

/** [south, west, north, east] */
export type ZoneBox = [number, number, number, number];

export function conflictZones(points: ZonePoint[]): { boxes: ZoneBox[]; cells: number } {
  const perCoord = new Map<string, number>();
  const score = new Map<string, number>();
  const cellOf = (v: number) => Math.floor(v / ZONE_CELL_DEG);
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    // Only land in Africa or the Middle East.
    if (!countryAt(p.lat, p.lon)) continue;
    let w = p.verified ? ZONE_INCIDENT_WEIGHT : 1;
    if (!p.verified) {
      const k = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
      const n = (perCoord.get(k) ?? 0) + 1;
      perCoord.set(k, n);
      if (n > MAX_PER_COORDINATE) w = 0;
    }
    if (w === 0) continue;
    const key = `${cellOf(p.lat)}:${cellOf(p.lon)}`;
    score.set(key, (score.get(key) ?? 0) + w);
  }
  const hot = [...score.entries()].filter(([, s]) => s >= ZONE_MIN_SCORE).map(([k]) => k.split(":").map(Number) as [number, number]);
  // Join cells that sit side by side in the same row.
  const rows = new Map<number, number[]>();
  for (const [r, c] of hot) rows.set(r, [...(rows.get(r) ?? []), c]);
  const boxes: ZoneBox[] = [];
  for (const [r, cols] of rows) {
    cols.sort((a, b) => a - b);
    let start = cols[0];
    let prev = cols[0];
    const flush = () => boxes.push([r * ZONE_CELL_DEG, start * ZONE_CELL_DEG, (r + 1) * ZONE_CELL_DEG, (prev + 1) * ZONE_CELL_DEG]);
    for (const c of cols.slice(1)) {
      if (c === prev + 1) prev = c;
      else {
        flush();
        start = c;
        prev = c;
      }
    }
    flush();
  }
  return { boxes, cells: hot.length };
}
