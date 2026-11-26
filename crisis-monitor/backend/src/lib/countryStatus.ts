import type { Env } from "../bindings";
import { isTerrorism } from "./terrorism";

/**
 * Country conflict status: the Afrilens editorial rating of each country in Africa and the Middle East, with a
 * trend for countries in active conflict taken from the Lens's own escalation incidents.
 *
 *  - status: "active" (armed conflict under way), "risk-high" / "risk-low" (at risk of armed conflict breaking out
 *    or reigniting), or "none". The defaults below are the Lens's starting rating; an admin can change any country,
 *    and the change is kept in country_status_overrides.
 *  - trend (active countries): "worsening", "steady" or "improving", from the incidents of the last 30 days against
 *    the 30 before (weighted by level: watch 1, elevated 2, critical 3). An admin can set it by hand instead.
 */

export type CountryStatus = "active" | "risk-high" | "risk-low" | "none";
export type CountryTrend = "worsening" | "steady" | "improving";
export const COUNTRY_STATUSES: CountryStatus[] = ["active", "risk-high", "risk-low", "none"];
export const COUNTRY_TRENDS: CountryTrend[] = ["worsening", "steady", "improving"];

/** The starting rating, by ISO 3166 alpha-2 code. Countries not listed are "none". */
export const DEFAULT_COUNTRY_STATUS: Record<string, { status: CountryStatus; note?: string }> = {
  // Africa: active armed conflict
  SD: { status: "active", note: "SAF–RSF war; fighting in Darfur, Kordofan and the centre." },
  SS: { status: "active", note: "SSPDF–SPLA-IO fighting and communal violence across several states." },
  CD: { status: "active", note: "M23/AFC in the Kivus; ADF and CODECO in Ituri and North Kivu." },
  SO: { status: "active", note: "Al-Shabaab insurgency; ISIS-Somalia in Puntland; clan conflict." },
  ET: { status: "active", note: "Fano insurgency in Amhara; OLA in Oromia; Tigray tensions." },
  ML: { status: "active", note: "JNIM and IS Sahel insurgency; fuel blockade and attacks on supply routes." },
  BF: { status: "active", note: "JNIM and IS Sahel insurgency across most regions." },
  NE: { status: "active", note: "IS Sahel in Tillabéri and Tahoua; JNIM; ISWAP in Diffa." },
  NG: { status: "active", note: "ISWAP and JAS in the north-east; bandit violence in the north-west; Middle Belt violence." },
  CM: { status: "active", note: "Anglophone separatist conflict; Boko Haram and ISWAP in the Far North." },
  CF: { status: "active", note: "Armed groups against government and allied forces; Sudan border spillover." },
  MZ: { status: "active", note: "IS Mozambique insurgency in Cabo Delgado and Niassa." },
  BJ: { status: "active", note: "JNIM attacks in the north, near Burkina Faso and Niger." },
  // Africa: at risk
  TD: { status: "risk-high", note: "Lake Chad jihadist attacks; Sudan war spillover in the east; political tension." },
  LY: { status: "risk-high", note: "Rival governments and armed groups; clashes in Tripoli." },
  ER: { status: "risk-high", note: "Tension with Ethiopia over Red Sea access and Tigray." },
  TG: { status: "risk-high", note: "JNIM attacks in the Savanes region." },
  BI: { status: "risk-high", note: "Troops in eastern DRC against M23; spillover risk." },
  RW: { status: "risk-high", note: "Backing for M23 in eastern DRC; risk of direct confrontation." },
  KE: { status: "risk-low", note: "Al-Shabaab attacks in the north-east and Lamu." },
  UG: { status: "risk-low", note: "ADF; operations in eastern DRC." },
  CI: { status: "risk-low", note: "Sahel spillover in the north." },
  GH: { status: "risk-low", note: "Bawku conflict; Sahel spillover risk in the north." },
  EG: { status: "risk-low", note: "Residual insurgency in North Sinai; Gaza and Sudan border pressure." },
  TZ: { status: "risk-low", note: "Political unrest; Cabo Delgado spillover in Mtwara." },
  MG: { status: "risk-low", note: "Unrest after the 2025 change of government." },
  GW: { status: "risk-low", note: "Repeated coups and political instability." },
  GN: { status: "risk-low", note: "Military rule and political tension." },
  MR: { status: "risk-low", note: "Sahel spillover along the Mali border." },
  DJ: { status: "risk-low", note: "Red Sea security pressure." },
  CG: { status: "risk-low" },
  EH: { status: "risk-low", note: "Low-intensity Morocco–Polisario hostilities." },
  // Middle East
  PS: { status: "active", note: "Gaza war and its aftermath; West Bank violence." },
  IL: { status: "active", note: "Gaza, Lebanon, Syria and Yemen fronts." },
  YE: { status: "active", note: "Houthi–government front lines; Houthi attacks at sea and on Israel." },
  SY: { status: "active", note: "Fighting on the coast, in Sweida and in the north-east; Israeli strikes." },
  LB: { status: "active", note: "Israeli strikes on Hezbollah despite the ceasefire." },
  IQ: { status: "risk-high", note: "IS remnants; militia attacks; regional escalation risk." },
  IR: { status: "risk-high", note: "Risk of renewed conflict with Israel and the United States." },
  SA: { status: "risk-low", note: "Houthi missile and drone risk." },
  JO: { status: "risk-low" },
  TR: { status: "risk-low", note: "PKK disarmament process; operations in Syria and Iraq." },
};

export interface CountryStatusRow {
  code: string;
  status: CountryStatus;
  /** Set for active countries: the admin's trend if set, otherwise the one from the data. */
  trend: CountryTrend | null;
  /** The trend from the data, whatever the admin set. */
  trendAuto: CountryTrend | null;
  /** Weighted incidents in the last 30 days, and the 30 before. */
  recent: number;
  prior: number;
  /** Incidents in the last 30 days, and how many of them were terrorist attacks. */
  incidents30: number;
  terror30: number;
  note: string | null;
  /** True when an admin has changed this country from the default. */
  edited: boolean;
}

interface OverrideRow {
  code: string;
  status: string | null;
  trend: string | null;
  note: string | null;
}

const ready = new WeakSet<D1Database>();
export async function ensureCountryStatusTable(db: D1Database) {
  if (ready.has(db)) return;
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS country_status_overrides (code TEXT PRIMARY KEY, status TEXT, trend TEXT, note TEXT, updated_by TEXT, updated_at TEXT NOT NULL)`)
    .run();
  ready.add(db);
}

/** Worsening when the last 30 days are clearly heavier than the 30 before, improving when clearly lighter. */
export function trendFrom(recent: number, prior: number): CountryTrend {
  if (recent + prior < 3) return "steady";
  const ratio = (recent + 1) / (prior + 1);
  if (ratio >= 1.3 && recent - prior >= 2) return "worsening";
  if (ratio <= 0.77 && prior - recent >= 2) return "improving";
  return "steady";
}

const WEIGHT = `CASE level WHEN 'critical' THEN 3 WHEN 'elevated' THEN 2 ELSE 1 END`;
const WHEN = `COALESCE(last_event_date, first_event_date, substr(updated_at, 1, 10))`;

/** Every country with a rating other than "none", an admin's change, or incidents in the last 60 days. */
export async function getCountryStatus(env: Env, now = new Date()): Promise<CountryStatusRow[]> {
  await ensureCountryStatusTable(env.DB);
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  const [d30, d60] = [day(30), day(60)];
  const counts = await env.DB.prepare(
    `SELECT country_code AS code,
            SUM(CASE WHEN ${WHEN} > ? THEN ${WEIGHT} ELSE 0 END) AS recent,
            SUM(CASE WHEN ${WHEN} <= ? THEN ${WEIGHT} ELSE 0 END) AS prior,
            SUM(CASE WHEN ${WHEN} > ? THEN 1 ELSE 0 END) AS n30
       FROM escalation_incidents
      WHERE status != 'dismissed' AND headline IS NOT NULL AND ${WHEN} > ?
      GROUP BY country_code`
  )
    .bind(d30, d30, d30, d60)
    .all<{ code: string; recent: number; prior: number; n30: number }>()
    .then((r) => r.results ?? [])
    .catch(() => [] as { code: string; recent: number; prior: number; n30: number }[]);
  const terror = await terrorCounts(env, d30);
  const overrides = await env.DB.prepare(`SELECT code, status, trend, note FROM country_status_overrides`)
    .all<OverrideRow>()
    .then((r) => r.results ?? []);
  const byCount = new Map(counts.map((c) => [c.code.toUpperCase(), c]));
  const byOverride = new Map(overrides.map((o) => [o.code.toUpperCase(), o]));
  const codes = new Set([...Object.keys(DEFAULT_COUNTRY_STATUS), ...byCount.keys(), ...byOverride.keys()]);
  const rows: CountryStatusRow[] = [];
  for (const code of codes) {
    const d = DEFAULT_COUNTRY_STATUS[code];
    const o = byOverride.get(code);
    const c = byCount.get(code);
    const status = (o?.status && COUNTRY_STATUSES.includes(o.status as CountryStatus) ? o.status : d?.status ?? "none") as CountryStatus;
    const recent = Number(c?.recent ?? 0), prior = Number(c?.prior ?? 0);
    const trendAuto = status === "active" ? trendFrom(recent, prior) : null;
    const manual = o?.trend && COUNTRY_TRENDS.includes(o.trend as CountryTrend) ? (o.trend as CountryTrend) : null;
    rows.push({
      code,
      status,
      trend: status === "active" ? (manual ?? trendAuto) : null,
      trendAuto,
      recent,
      prior,
      incidents30: Number(c?.n30 ?? 0),
      terror30: terror.get(code) ?? 0,
      note: o?.note ?? d?.note ?? null,
      edited: !!o,
    });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

/** Terrorist attacks per country since `since`, by the same test as the incident markers (lib/terrorism.ts). */
async function terrorCounts(env: Env, since: string): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT country_code AS code, json_extract(detail, '$.actors') AS actors,
            (SELECT json_group_array(json_extract(value, '$.id')) FROM json_each(detail, '$.indicators')) AS ind
       FROM escalation_incidents WHERE status != 'dismissed' AND headline IS NOT NULL AND ${WHEN} > ?`
  )
    .bind(since)
    .all<{ code: string; actors: string | null; ind: string | null }>()
    .then((r) => r.results ?? [])
    .catch(() => [] as { code: string; actors: string | null; ind: string | null }[]);
  const m = new Map<string, number>();
  for (const r of rows) {
    if (isTerrorism(parseList(r.ind), parseList(r.actors)).terrorism) m.set(r.code.toUpperCase(), (m.get(r.code.toUpperCase()) ?? 0) + 1);
  }
  return m;
}

export function parseList(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** One incident in the history: enough to place, size, colour and date it on the map. */
export interface IncidentHistoryPoint {
  id: string;
  cc: string;
  country: string;
  place: string | null;
  lat: number;
  lon: number;
  date: string;
  level: "watch" | "elevated" | "critical";
  terror: boolean;
  deaths: number | null;
  headline: string;
}

/** Every located escalation incident since `since` (not only the ones still active), newest first. */
export async function getIncidentHistory(env: Env, since: string, limit = 30000): Promise<IncidentHistoryPoint[]> {
  const rows = await env.DB.prepare(
    `SELECT id, country_code AS cc, country_name AS country, location_label AS place, lat, lon, ${WHEN} AS date, level, headline,
            json_extract(detail, '$.actors') AS actors, json_extract(detail, '$.fatalitiesMax') AS deaths,
            (SELECT json_group_array(json_extract(value, '$.id')) FROM json_each(detail, '$.indicators')) AS ind
       FROM escalation_incidents
      WHERE status != 'dismissed' AND headline IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL AND ${WHEN} >= ?
      ORDER BY ${WHEN} DESC LIMIT ?`
  )
    .bind(since, limit)
    .all<{ id: string; cc: string; country: string; place: string | null; lat: number; lon: number; date: string; level: IncidentHistoryPoint["level"]; headline: string; actors: string | null; deaths: number | null; ind: string | null }>()
    .then((r) => r.results ?? [])
    .catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    cc: r.cc,
    country: r.country,
    place: r.place,
    lat: r.lat,
    lon: r.lon,
    date: r.date,
    level: r.level,
    terror: isTerrorism(parseList(r.ind), parseList(r.actors)).terrorism,
    deaths: r.deaths == null ? null : Number(r.deaths),
    headline: r.headline,
  }));
}
