import { MASS_CASUALTY_THRESHOLD } from "./escalationCodebook";

/**
 * Where the map should pulse. Two separate reasons, worked out from the incidents the pipeline already holds:
 *
 *  concentration  a square about 11 km across has had several incidents in the last 72 hours, and clearly more than
 *                 is normal for that square over the 27 days before.
 *  impact         one incident is serious on its own: mass casualties, a Critical rating, or a rare kind of event
 *                 (a town changing hands, a coup, fighting between states, a mass atrocity, a major terror attack).
 *
 * Every pulse says how well it is backed: "confirmed" when at least two different outlets report it and an article
 * has been read in full, otherwise a single-source claim, which the map draws dashed.
 */
export const RECENT_HOURS = 72;
export const BASELINE_DAYS = 27;
export const CELL_DEGREES = 0.1;
/** Fewest recent incidents in a square before it can pulse. */
export const MIN_CLUSTER = 3;
/** A square pulses when its recent count is at least this many times its normal 72-hour count. */
export const SURGE_FACTOR = 2;
export const HIGH_IMPACT_INDICATORS = ["mass_atrocity", "major_territorial_change", "coup_or_mutiny", "interstate_hostilities", "major_terror_attack"];

export interface PulseIncident {
  id: string;
  lat: number;
  lon: number;
  level: "watch" | "elevated" | "critical";
  locationLabel: string | null;
  countryName: string;
  headline: string;
  fatalitiesMax: number | null;
  preliminary: boolean;
  indicators: { id: string; label: string }[];
  sources: { domain: string }[];
  lastEventDate: string | null;
  updatedAt: string;
}

/** An earlier incident, for the baseline: where and when only. */
export interface PulseHistoryPoint {
  lat: number;
  lon: number;
  when: string;
}

export interface IncidentPulse {
  id: string;
  kind: "concentration" | "impact";
  lat: number;
  lon: number;
  /** 1 to 3: how large the ring is drawn. */
  size: 1 | 2 | 3;
  confirmed: boolean;
  label: string;
  /** One plain sentence saying why this place pulses. */
  reason: string;
  /** Incidents behind the pulse. */
  incidents: number;
  /** Different outlets behind it. */
  outlets: number;
  fatalities: number | null;
}

const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEGREES)}:${Math.floor(lon / CELL_DEGREES)}`;
const whenMs = (i: { lastEventDate: string | null; updatedAt: string }) => {
  const t = Date.parse(i.lastEventDate ? `${i.lastEventDate.slice(0, 10)}T12:00:00Z` : i.updatedAt);
  return Number.isFinite(t) ? t : Date.parse(i.updatedAt);
};
const outletsOf = (list: PulseIncident[]) => new Set(list.flatMap((i) => i.sources.map((s) => s.domain.toLowerCase()))).size;
const isConfirmed = (list: PulseIncident[]) => outletsOf(list) >= 2 && list.some((i) => !i.preliminary);

export function impactReasons(i: PulseIncident): string[] {
  const reasons: string[] = [];
  if ((i.fatalitiesMax ?? 0) >= MASS_CASUALTY_THRESHOLD) reasons.push(`${i.fatalitiesMax} deaths reported`);
  for (const ind of i.indicators) if (HIGH_IMPACT_INDICATORS.includes(ind.id)) reasons.push(ind.label.toLowerCase());
  if (reasons.length === 0 && i.level === "critical") reasons.push("rated Critical");
  return reasons;
}

export function incidentPulses(active: PulseIncident[], history: PulseHistoryPoint[], now: Date = new Date()): IncidentPulse[] {
  const nowMs = now.getTime();
  const recentFrom = nowMs - RECENT_HOURS * 3_600_000;
  const baselineFrom = recentFrom - BASELINE_DAYS * 86_400_000;
  const located = active.filter((i) => Number.isFinite(i.lat) && Number.isFinite(i.lon));
  const pulses: IncidentPulse[] = [];

  // Concentration.
  const prior = new Map<string, number>();
  for (const h of history) {
    const t = Date.parse(h.when.length <= 10 ? `${h.when}T12:00:00Z` : h.when);
    if (!Number.isFinite(t) || t < baselineFrom || t >= recentFrom) continue;
    const k = cellKey(h.lat, h.lon);
    prior.set(k, (prior.get(k) ?? 0) + 1);
  }
  const cells = new Map<string, PulseIncident[]>();
  for (const i of located) {
    if (whenMs(i) < recentFrom) continue;
    const k = cellKey(i.lat, i.lon);
    cells.set(k, [...(cells.get(k) ?? []), i]);
  }
  const clustered = new Set<string>();
  for (const [k, list] of cells) {
    const typical = ((prior.get(k) ?? 0) * RECENT_HOURS) / (BASELINE_DAYS * 24);
    if (list.length < MIN_CLUSTER || list.length < SURGE_FACTOR * typical) continue;
    list.forEach((i) => clustered.add(i.id));
    const place = list.find((i) => i.locationLabel)?.locationLabel ?? list[0].countryName;
    const deaths = list.reduce((s, i) => s + (i.fatalitiesMax ?? 0), 0);
    pulses.push({
      id: `cluster:${k}`,
      kind: "concentration",
      lat: list.reduce((s, i) => s + i.lat, 0) / list.length,
      lon: list.reduce((s, i) => s + i.lon, 0) / list.length,
      size: list.length >= 8 ? 3 : list.length >= 5 ? 2 : 1,
      confirmed: isConfirmed(list),
      label: place,
      reason: `${list.length} incidents here in the last ${RECENT_HOURS} hours; ${typical < 0.5 ? "normally fewer than one" : `normally about ${Math.round(typical)}`} in the same time.`,
      incidents: list.length,
      outlets: outletsOf(list),
      fatalities: deaths > 0 ? deaths : null,
    });
  }

  // High impact, one pulse per incident.
  for (const i of located) {
    const reasons = impactReasons(i);
    if (reasons.length === 0) continue;
    const deaths = i.fatalitiesMax ?? 0;
    pulses.push({
      id: `impact:${i.id}`,
      kind: "impact",
      lat: i.lat,
      lon: i.lon,
      size: deaths >= MASS_CASUALTY_THRESHOLD * 4 ? 3 : deaths >= MASS_CASUALTY_THRESHOLD || i.level === "critical" ? 2 : 1,
      confirmed: isConfirmed([i]),
      label: i.locationLabel ?? i.countryName,
      reason: `${i.headline} (${reasons.join("; ")}).`,
      incidents: 1,
      outlets: outletsOf([i]),
      fatalities: i.fatalitiesMax,
    });
  }
  return pulses.sort((a, b) => b.size - a.size || Number(b.confirmed) - Number(a.confirmed));
}
