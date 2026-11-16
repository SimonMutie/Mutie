import type { Env } from "../bindings";
import { COMMS_RESTRICTED_AREAS } from "./escalationCodebook";
import { readConnectivity } from "./ioda";

/**
 * Which places are under internet restrictions, for the longer escalation window (escalationCodebook.ts,
 * RESTRICTED_WINDOW_HOURS): the standing regional list, plus any whole country IODA currently measures as degraded
 * or severely degraded. IODA is read at most once an hour and remembered in D1, so a five-minute pipeline tick
 * costs one row read; if IODA cannot be reached, the last good reading is kept for up to a day.
 */
const KEY = "comms_restricted_countries";
const REFRESH_MS = 3600_000;
const KEEP_MS = 24 * 3600_000;

export interface RestrictionReport {
  countryCode: string;
  admin1?: string | null;
  place?: string | null;
  geoLabel?: string | null;
}

/** The countries IODA measures as degraded now, refreshed hourly. */
export async function restrictedCountries(env: Env, now: Date = new Date(), read = readConnectivity): Promise<Set<string>> {
  // The escalation pipeline's own state table (created by escalationIncidents.ts before this is called).
  const row = await env.DB.prepare("SELECT value FROM escalation_pipeline_state WHERE key = ?").bind(KEY).first<{ value: string }>();
  const saved = row ? (JSON.parse(row.value) as { at: number; countries: string[] }) : null;
  if (saved && now.getTime() - saved.at < REFRESH_MS) return new Set(saved.countries);
  try {
    const result = await read(now);
    const countries = result.countries.filter((c) => c.level === "degraded" || c.level === "severe").map((c) => c.code);
    // A reading where every country failed tells nothing; keep the last one instead.
    if (result.countries.every((c) => c.level === "unmeasured")) throw new Error("IODA measured nothing");
    await env.DB.prepare("INSERT INTO escalation_pipeline_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(KEY, JSON.stringify({ at: now.getTime(), countries })).run();
    return new Set(countries);
  } catch {
    return saved && now.getTime() - saved.at < KEEP_MS ? new Set(saved.countries) : new Set();
  }
}

/** The restricted region a report falls in, the whole country (when IODA has it degraded), or null. */
export function restrictionFor(report: RestrictionReport, degradedCountries: Set<string>): string | null {
  if (degradedCountries.has(report.countryCode)) return "national internet disruption measured by IODA";
  const text = [report.admin1, report.place, report.geoLabel].filter(Boolean).join(" | ").toLowerCase();
  if (!text) return null;
  const area = COMMS_RESTRICTED_AREAS.find((a) => a.country === report.countryCode && a.terms.some((t) => text.includes(t)));
  return area ? `internet restrictions in ${area.region}` : null;
}
