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
  level: "watch" | "elevated" | "critical";
  /** Where the incident is, as named. */
  label?: string | null;
}

/** How intense the escalation in a province is, from 1 (low) to 4 (severe). */
export type Intensity = 1 | 2 | 3 | 4;
export const INTENSITY_LABEL: Record<Intensity, string> = { 1: "Low", 2: "Moderate", 3: "High", 4: "Severe" };

/** Weight of each level in a province's score: a critical incident counts as much as six watch-level ones. */
const LEVEL_WEIGHT = { watch: 1, elevated: 3, critical: 6 } as const;

export interface ConflictProvince {
  id: string;
  /** Always "active": only provinces with at least one escalation in the window are returned. */
  tier: "active";
  country: string;
  countryName: string;
  name: string;
  /** Escalations inside it, all levels. */
  incidents: number;
  /** Escalations inside it by level. */
  counts: { watch: number; elevated: number; critical: number };
  /** The highest level among them. */
  level: "watch" | "elevated" | "critical";
  /** Weighted sum of the levels (watch 1, elevated 3, critical 6). */
  score: number;
  intensity: Intensity;
  intensityLabel: string;
  /** [lat, lon] rings, ready to draw. */
  rings: [number, number][][];
}

/**
 * Intensity from the weighted score and the worst level:
 *  Severe   two or more critical incidents, or a score of 12 or more
 *  High     one critical incident, or a score of 6 or more
 *  Moderate a score of 3 or more (one elevated incident, or three watch-level ones)
 *  Low      only watch-level incidents, one or two of them
 */
export function intensityOf(counts: { watch: number; elevated: number; critical: number }): { score: number; intensity: Intensity } {
  const score = counts.watch * LEVEL_WEIGHT.watch + counts.elevated * LEVEL_WEIGHT.elevated + counts.critical * LEVEL_WEIGHT.critical;
  let intensity: Intensity = 1;
  if (counts.critical >= 2 || score >= 12) intensity = 4;
  else if (counts.critical >= 1 || score >= 6) intensity = 3;
  else if (score >= 3) intensity = 2;
  return { score, intensity };
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

/** One escalation, placed by its country (ISO-3166 alpha-2) rather than by coordinates. */
export interface EscalationCountryPoint {
  code: string;
  name: string;
  level: "watch" | "elevated" | "critical";
}

/** A country with at least one flagged escalation in the window, coded by intensity like a conflict tracker. */
export interface ConflictCountry {
  code: string;
  name: string;
  incidents: number;
  counts: { watch: number; elevated: number; critical: number };
  level: "watch" | "elevated" | "critical";
  score: number;
  intensity: Intensity;
  intensityLabel: string;
}

/**
 * Countries coded by the intensity of their escalations in the window. Every incident carries its country, so a
 * country is coded even when its incidents cannot be placed inside a province, which is why this does not use
 * coordinates. Countries with no escalation are simply absent; the map draws them as neutral.
 */
export function conflictCountries(points: EscalationCountryPoint[]): ConflictCountry[] {
  const found = new Map<string, { name: string; counts: { watch: number; elevated: number; critical: number } }>();
  for (const pt of points) {
    const code = pt.code?.trim().toUpperCase();
    if (!code || code.length !== 2) continue;
    const cur = found.get(code) ?? { name: pt.name, counts: { watch: 0, elevated: 0, critical: 0 } };
    cur.counts[pt.level] += 1;
    found.set(code, cur);
  }
  const rank: Record<ConflictCountry["level"], number> = { critical: 2, elevated: 1, watch: 0 };
  return [...found.entries()]
    .map(([code, { name, counts }]) => {
      const { score, intensity } = intensityOf(counts);
      const level: ConflictCountry["level"] = counts.critical > 0 ? "critical" : counts.elevated > 0 ? "elevated" : "watch";
      return {
        code,
        name: name || countryName(code),
        incidents: counts.watch + counts.elevated + counts.critical,
        counts,
        level,
        score,
        intensity,
        intensityLabel: INTENSITY_LABEL[intensity],
      };
    })
    .sort((a, b) => b.intensity - a.intensity || b.score - a.score || rank[b.level] - rank[a.level] || a.name.localeCompare(b.name));
}

export function conflictProvinces(points: EscalationPoint[]): ConflictProvince[] {
  const found = new Map<Province, { watch: number; elevated: number; critical: number }>();
  for (const pt of points) {
    if (!Number.isFinite(pt.lat) || !Number.isFinite(pt.lon)) continue;
    const prov = provinceAt(pt.lat, pt.lon);
    if (!prov) continue;
    const cur = found.get(prov) ?? { watch: 0, elevated: 0, critical: 0 };
    cur[pt.level] += 1;
    found.set(prov, cur);
  }
  const rank: Record<ConflictProvince["level"], number> = { critical: 2, elevated: 1, watch: 0 };
  return [...found.entries()]
    .map(([p, counts]) => {
      const { score, intensity } = intensityOf(counts);
      const level: ConflictProvince["level"] = counts.critical > 0 ? "critical" : counts.elevated > 0 ? "elevated" : "watch";
      return {
        id: `${p.country}:${p.name}`,
        tier: "active" as const,
        country: p.country,
        countryName: countryName(p.country),
        name: p.name,
        incidents: counts.watch + counts.elevated + counts.critical,
        counts,
        level,
        score,
        intensity,
        intensityLabel: INTENSITY_LABEL[intensity],
        rings: p.rings.map((r) => r.map(([lon, lat]) => [lat, lon] as [number, number])),
      };
    })
    .sort((a, b) => b.intensity - a.intensity || b.score - a.score || rank[b.level] - rank[a.level]);
}
