import countryList from "../data/countryNames.json";

/**
 * Active conflicts from UCDP's Georeferenced Event Dataset: a country is active when UCDP has recorded at least one
 * organised violence event there in the last 90 days. This is independent of the platform's own alerts, so a country
 * can be active without any escalation having been reported.
 */

export interface UcdpEvent {
  country: string;
  date_end?: string | null;
  date_start?: string | null;
  best?: number | null;
}

/** How intense a country's active conflict is over the 90-day window, from 1 (low) to 4 (severe). */
export type ActiveIntensity = 1 | 2 | 3 | 4;
export const ACTIVE_INTENSITY_LABEL: Record<ActiveIntensity, string> = { 1: "Low", 2: "Moderate", 3: "High", 4: "Severe" };

/** Killed (UCDP best estimate) over the window at which each level starts. Any recorded event is at least Low. */
export const ACTIVE_THRESHOLDS = { high: 500, elevated: 100, moderate: 20 } as const;

/** Intensity from the death toll: severe 500+, high 100+, moderate 20+, otherwise low. */
export function activeIntensityOf(fatalities: number): ActiveIntensity {
  if (fatalities >= ACTIVE_THRESHOLDS.high) return 4;
  if (fatalities >= ACTIVE_THRESHOLDS.elevated) return 3;
  if (fatalities >= ACTIVE_THRESHOLDS.moderate) return 2;
  return 1;
}

export interface ActiveCountry {
  code: string;
  name: string;
  events: number;
  fatalities: number;
  latest: string | null;
  intensity: ActiveIntensity;
  intensityLabel: string;
}

/** Lower-case, accent-free, letters and digits only. */
function key(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const BY_NAME = new Map<string, string>();
for (const [code, name] of countryList as [string, string][]) BY_NAME.set(key(name), code);

/** UCDP's names and old names that differ from the map's country names. */
const ALIASES: Record<string, string> = {
  "Burma": "MM", "Congo-Kinshasa": "CD", "DR Congo": "CD", "DR Congo (Zaire)": "CD", "Democratic Republic of the Congo": "CD", "Zaire": "CD",
  "Republic of Congo": "CG", "Congo-Brazzaville": "CG", "Ivory Coast": "CI", "Cote d'Ivoire": "CI", "Cape Verde": "CV",
  "Swaziland": "SZ", "Eswatini": "SZ", "Bosnia-Herzegovina": "BA", "North Macedonia": "MK", "Macedonia": "MK",
  "Turkey": "TR", "Syria": "SY", "Iran": "IR", "Russia": "RU", "Soviet Union": "RU", "United States": "US",
  "South Korea": "KR", "North Korea": "KP", "Vietnam": "VN", "North Vietnam": "VN", "Yemen": "YE", "North Yemen": "YE", "South Yemen": "YE",
  "Yugoslavia": "RS", "Serbia": "RS", "Cambodia": "KH", "Kampuchea": "KH", "Laos": "LA", "Timor-Leste": "TL", "East Timor": "TL",
  "Palestine": "PS", "Kosovo": "XK", "Somaliland": "SO", "Western Sahara": "EH", "Czech Republic": "CZ", "Taiwan": "TW",
};
for (const [name, code] of Object.entries(ALIASES)) BY_NAME.set(key(name), code);

/** The ISO code for a UCDP country name, trying the whole name, the part before a bracket and the bracketed part. */
export function codeForUcdpCountry(name: string): string | null {
  const candidates = [name, name.split("(")[0], ...(name.match(/\(([^)]+)\)/g) ?? []).map((m) => m.slice(1, -1))];
  for (const c of candidates) {
    const code = BY_NAME.get(key(c.trim()));
    if (code) return code;
  }
  return null;
}

const NAME_OF = new Map<string, string>(countryList as [string, string][]);

/** Countries with events in the window, most events first, and the UCDP names that could not be matched. */
export function activeCountries(events: UcdpEvent[]): { countries: ActiveCountry[]; unmatched: string[] } {
  const found = new Map<string, ActiveCountry>();
  const unmatched = new Set<string>();
  for (const e of events) {
    const code = codeForUcdpCountry(e.country);
    if (!code) {
      unmatched.add(e.country);
      continue;
    }
    const cur = found.get(code) ?? { code, name: NAME_OF.get(code) ?? e.country, events: 0, fatalities: 0, latest: null, intensity: 1 as ActiveIntensity, intensityLabel: ACTIVE_INTENSITY_LABEL[1] };
    cur.events += 1;
    cur.fatalities += e.best ?? 0;
    const when = e.date_end ?? e.date_start ?? null;
    if (when && (!cur.latest || when > cur.latest)) cur.latest = when;
    found.set(code, cur);
  }
  for (const c of found.values()) {
    c.intensity = activeIntensityOf(c.fatalities);
    c.intensityLabel = ACTIVE_INTENSITY_LABEL[c.intensity];
  }
  return {
    countries: [...found.values()].sort((a, b) => b.intensity - a.intensity || b.fatalities - a.fatalities || b.events - a.events || a.name.localeCompare(b.name)),
    unmatched: [...unmatched].sort(),
  };
}
