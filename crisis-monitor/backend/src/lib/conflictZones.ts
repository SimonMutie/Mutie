import provincesJson from "../data/provinces.json";
import { countryName } from "./africaGeo";

/**
 * Provinces with a flagged escalation.
 *
 * A province is shaded only when at least one escalation incident the platform has verified and flagged (elevated
 * or critical, in the last 48 hours) is located inside it. Raw news-event counts are not used: they put shading in
 * places with no escalation. The whole province is drawn, as in "Tigray" or "North Kivu"; the shading says where
 * escalations are, not where a front line runs or who controls the ground.
 *
 * Borders: Natural Earth (public domain), and geoBoundaries (CC BY 4.0) for the DR Congo's current provinces.
 */
type Ring = [number, number][]; // [lon, lat]
export interface Province {
  country: string;
  name: string;
  rings: Ring[];
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
}

export const PROVINCES: Province[] = (provincesJson as unknown as [string, string, Ring[]][]).map(([country, name, rings]) => {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const r of rings) for (const [lon, lat] of r) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { country, name, rings, bbox: [minLon, minLat, maxLon, maxLat] };
});

export interface EscalationPoint {
  lat: number;
  lon: number;
  level: "elevated" | "critical";
  /** Where the incident is, as named. */
  label?: string | null;
}

export interface ConflictProvince {
  id: string;
  /** Always "active": only provinces holding a flagged escalation are returned. */
  tier: "active";
  country: string;
  countryName: string;
  name: string;
  /** Flagged escalations inside it. */
  incidents: number;
  /** The highest level among them. */
  level: "elevated" | "critical";
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

export function conflictProvinces(points: EscalationPoint[]): ConflictProvince[] {
  const found = new Map<Province, { n: number; level: "elevated" | "critical" }>();
  for (const pt of points) {
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
    const prov = provinceAt(pt.lat, pt.lon);
    if (!prov) continue;
    const cur = found.get(prov) ?? { n: 0, level: "elevated" as const };
    found.set(prov, { n: cur.n + 1, level: cur.level === "critical" || pt.level === "critical" ? "critical" : "elevated" });
  }
  return [...found.entries()]
    .map(([p, v]) => ({
      id: `${p.country}:${p.name}`,
      tier: "active" as const,
      country: p.country,
      countryName: countryName(p.country),
      name: p.name,
      incidents: v.n,
      level: v.level,
      rings: p.rings.map((r) => r.map(([lon, lat]) => [lat, lon] as [number, number])),
    }))
    .sort((a, b) => (a.level === b.level ? b.incidents - a.incidents : a.level === "critical" ? -1 : 1));
}
