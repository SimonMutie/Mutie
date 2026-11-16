/**
 * Internet connectivity by country from IODA (Internet Outage Detection and Analysis, Georgia Tech).
 *
 * For each country the latest level of each signal is compared with a quiet baseline week. A country at 100% is
 * as connected as it was in the baseline; below 90% is degraded and below 60% is a serious loss.
 *
 * IODA's public API needs no key. Its response shape is read defensively (see collectSeries), and every call's
 * status is returned as diagnostics, so a change on IODA's side shows up as a readable message, not a blank map.
 */
export const IODA_BASE = "https://api.ioda.inetintel.cc.gatech.edu/v2";

export const IODA_COUNTRIES: { code: string; name: string; numeric: string }[] = [
  { code: "ET", name: "Ethiopia", numeric: "231" },
  { code: "ER", name: "Eritrea", numeric: "232" },
  { code: "SD", name: "Sudan", numeric: "729" },
  { code: "SS", name: "South Sudan", numeric: "728" },
  { code: "SO", name: "Somalia", numeric: "706" },
  { code: "DJ", name: "Djibouti", numeric: "262" },
  { code: "KE", name: "Kenya", numeric: "404" },
];

/** The quiet week every reading is compared with: 15 to 21 September 2026, before the fighting. */
export const BASELINE_FROM = Date.UTC(2026, 8, 15) / 1000;
export const BASELINE_UNTIL = Date.UTC(2026, 8, 22) / 1000;
/** How much of the recent past makes up "now". */
export const CURRENT_WINDOW_SECONDS = 6 * 3600;
export const DEGRADED_BELOW = 0.9;
export const SEVERE_BELOW = 0.6;

export interface Series {
  datasource: string;
  values: number[];
}

/** Finds every { datasource, values } object in a response, however deeply IODA nests it. */
export function collectSeries(node: unknown, out: Series[] = [], depth = 0): Series[] {
  if (depth > 6 || node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectSeries(item, out, depth + 1);
    return out;
  }
  const o = node as Record<string, unknown>;
  if (typeof o.datasource === "string" && Array.isArray(o.values)) {
    out.push({ datasource: o.datasource, values: o.values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) });
    return out;
  }
  for (const v of Object.values(o)) collectSeries(v, out, depth + 1);
  return out;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type ConnectivityLevel = "normal" | "degraded" | "severe" | "unmeasured";

export interface SignalReading {
  datasource: string;
  baseline: number | null;
  current: number | null;
  /** current ÷ baseline. Null when either side is missing or the baseline is too small to compare with. */
  ratio: number | null;
}

/** Signals with a baseline this small are too thin to say anything about (a handful of networks). */
const MIN_BASELINE = 5;

export function readSignals(baseline: Series[], current: Series[]): SignalReading[] {
  const names = [...new Set([...baseline, ...current].map((s) => s.datasource))];
  return names.map((datasource) => {
    const b = median(baseline.filter((s) => s.datasource === datasource).flatMap((s) => s.values));
    const c = median(current.filter((s) => s.datasource === datasource).flatMap((s) => s.values));
    const ratio = b !== null && c !== null && b >= MIN_BASELINE ? c / b : null;
    return { datasource, baseline: b, current: c, ratio };
  });
}

/** The country's level is set by its weakest measurable signal. */
export function levelFrom(signals: SignalReading[]): { level: ConnectivityLevel; ratio: number | null } {
  const ratios = signals.map((s) => s.ratio).filter((r): r is number => r !== null);
  if (ratios.length === 0) return { level: "unmeasured", ratio: null };
  const ratio = Math.min(...ratios);
  return { level: ratio < SEVERE_BELOW ? "severe" : ratio < DEGRADED_BELOW ? "degraded" : "normal", ratio };
}

export interface CountryConnectivity {
  code: string;
  name: string;
  numeric: string;
  level: ConnectivityLevel;
  ratio: number | null;
  signals: SignalReading[];
  error: string | null;
}

export interface ConnectivityResult {
  countries: CountryConnectivity[];
  baseline: { from: string; until: string };
  current: { from: string; until: string };
  diagnostics: { url: string; status: number | string; series: number; topLevelKeys: string[] }[];
  fetchedAt: string;
}

type Fetcher = (url: string) => Promise<Response>;

async function fetchSeries(fetcher: Fetcher, code: string, from: number, until: number, diagnostics: ConnectivityResult["diagnostics"]): Promise<Series[]> {
  const url = `${IODA_BASE}/signals/raw/country/${code}?from=${from}&until=${until}`;
  try {
    const res = await fetcher(url);
    if (!res.ok) {
      diagnostics.push({ url, status: res.status, series: 0, topLevelKeys: [] });
      throw new Error(`IODA returned ${res.status}`);
    }
    const body = (await res.json()) as unknown;
    const series = collectSeries(body);
    diagnostics.push({ url, status: res.status, series: series.length, topLevelKeys: body && typeof body === "object" ? Object.keys(body as object).slice(0, 8) : [] });
    return series;
  } catch (err) {
    if (!diagnostics.some((d) => d.url === url)) diagnostics.push({ url, status: err instanceof Error ? err.message : String(err), series: 0, topLevelKeys: [] });
    throw err;
  }
}

export async function readConnectivity(now: Date = new Date(), fetcher: Fetcher = (url) => fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) })): Promise<ConnectivityResult> {
  const until = Math.floor(now.getTime() / 1000);
  const from = until - CURRENT_WINDOW_SECONDS;
  const diagnostics: ConnectivityResult["diagnostics"] = [];
  const countries = await Promise.all(
    IODA_COUNTRIES.map(async (c): Promise<CountryConnectivity> => {
      try {
        const [baseline, current] = await Promise.all([
          fetchSeries(fetcher, c.code, BASELINE_FROM, BASELINE_UNTIL, diagnostics),
          fetchSeries(fetcher, c.code, from, until, diagnostics),
        ]);
        const signals = readSignals(baseline, current);
        return { ...c, ...levelFrom(signals), signals, error: signals.length === 0 ? "IODA returned no signals in a shape this reader recognises" : null };
      } catch (err) {
        return { ...c, level: "unmeasured", ratio: null, signals: [], error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
  const isoS = (s: number) => new Date(s * 1000).toISOString();
  return { countries, baseline: { from: isoS(BASELINE_FROM), until: isoS(BASELINE_UNTIL) }, current: { from: isoS(from), until: isoS(until) }, diagnostics, fetchedAt: now.toISOString() };
}
