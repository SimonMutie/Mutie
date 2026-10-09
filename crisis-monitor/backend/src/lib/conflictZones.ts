import provincesJson from "../data/provinces.json";
import { countryName } from "./africaGeo";

/**
 * Provinces with active armed clashes, worked out from where recent fighting reports fall.
 *
 * Each report of fighting from the last two days (and each verified escalation incident) is placed in the province,
 * state or region it falls inside. A province is shaded when a verified incident is inside it, or when enough
 * separate reports of fighting are. The whole province is drawn, as in "Tigray" or "North Kivu": the shading says
 * where fighting is being reported, not where a front line runs or who controls the ground.
 *
 * Borders: Natural Earth (public domain), and geoBoundaries (CC BY 4.0) for the DR Congo's current provinces.
 */
type Ring = [number, number][]; // [lon, lat]
interface Province {
  country: string;
  name: string;
  rings: Ring[];
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
}

const PROVINCES: Province[] = (provincesJson as unknown as [string, string, Ring[]][]).map(([country, name, rings]) => {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const r of rings) for (const [lon, lat] of r) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { country, name, rings, bbox: [minLon, minLat, maxLon, maxLat] };
});

/** A province needs this much weight to be shaded. */
export const ZONE_MIN_SCORE = 6;
/** What a verified escalation incident is worth, against 1 for a reported event: one is enough on its own. */
export const ZONE_INCIDENT_WEIGHT = 6;
/** Events at exactly the same coordinates (usually a place name resolved to a town centre) count at most this many times. */
const MAX_PER_COORDINATE = 2;

export interface ZonePoint {
  lat: number;
  lon: number;
  /** Reports at this point, when several have been counted into one (default 1). */
  weight?: number;
  /** A verified incident rather than a reported event. */
  verified?: boolean;
}

export interface ConflictProvince {
  id: string;
  /** Always "active": only provinces with armed clashes or a verified escalation in the last 48 hours are returned. */
  tier: "active";
  country: string;
  countryName: string;
  name: string;
  /** Reports counted in it. */
  score: number;
  /** [lat, lon] rings, ready to draw. */
  rings: [number, number][][];
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The smallest province containing the point, if any. */
export function provinceAt(lat: number, lon: number): Province | null {
  let best: Province | null = null;
  let bestArea = Infinity;
  for (const p of PROVINCES) {
    const [a, b, c, d] = p.bbox;
    if (lon < a || lon > c || lat < b || lat > d) continue;
    if (!p.rings.some((r) => inRing(lon, lat, r))) continue;
    const area = (c - a) * (d - b);
    if (area < bestArea) {
      best = p;
      bestArea = area;
    }
  }
  return best;
}

export function conflictProvinces(points: ZonePoint[]): ConflictProvince[] {
  const perCoord = new Map<string, number>();
  const score = new Map<Province, number>();
  for (const pt of points) {
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
    let w = pt.verified ? ZONE_INCIDENT_WEIGHT : Math.min(pt.weight ?? 1, MAX_PER_COORDINATE);
    if (!pt.verified) {
      const k = `${pt.lat.toFixed(2)},${pt.lon.toFixed(2)}`;
      const used = perCoord.get(k) ?? 0;
      if (used >= MAX_PER_COORDINATE) continue;
      w = Math.min(w, MAX_PER_COORDINATE - used);
      perCoord.set(k, used + w);
    }
    const prov = provinceAt(pt.lat, pt.lon);
    if (!prov) continue;
    score.set(prov, (score.get(prov) ?? 0) + w);
  }
  const active = new Map<string, ConflictProvince>();
  for (const [p, sc] of score) {
    if (sc < ZONE_MIN_SCORE) continue;
    active.set(`${p.country}:${p.name}`, draw(p, "active", sc));
  }
  return [...active.values()].sort((a, b) => b.score - a.score);
}

function draw(p: Province, tier: "active", score: number): ConflictProvince {
  return {
    id: `${p.country}:${p.name}`,
    tier,
    country: p.country,
    countryName: countryName(p.country),
    name: p.name,
    score,
    rings: p.rings.map((r) => r.map(([lon, lat]) => [lat, lon] as [number, number])),
  };
}
