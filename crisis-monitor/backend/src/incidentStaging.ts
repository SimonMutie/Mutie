import { all, first, run, nowIso } from "./db";
import { newId } from "./ids";
import type { Env } from "./bindings";

/**
 * The daily review queue. The escalation pipeline (escalationIncidents.ts) already reads online reporting,
 * codes it and locates it; this turns what it found into rows laid out like the analyst's incident
 * spreadsheet and parks them in `incident_staging` as "pending". Nothing reaches the incidents table until a
 * person has checked it (routes/incidentStaging.ts), so unreviewed machine output never mixes into the data.
 *
 * Only fields the reporting actually supports are filled (date, place, coordinates, actor, tactic, details,
 * a fatality count in the details). Everything else in the spreadsheet — casualty breakdowns, kidnapping
 * columns, sector, operation — is left blank for the analyst, not guessed.
 */

export interface StagedRow {
  date: string | null;
  time: string | null;
  country: string | null;
  province: string | null;
  county: string | null;
  district: string | null;
  city: string | null;
  suburb: string | null;
  precise_location: string | null;
  latitude: number | null;
  longitude: number | null;
  sector: string | null;
  actor: string | null;
  operation: string | null;
  tactic: string | null;
  severity: string | null;
  details: string | null;
  target: string | null;
  interest_group: string | null;
  actual_main_victim: string | null;
  intended_primary_target: string | null;
  civilian_death_child: number | null;
  civilian_death_female: number | null;
  civilian_death_male: number | null;
  civilian_death_unknown: number | null;
  civilian_injury_female: number | null;
  civilian_injury_male: number | null;
  civilian_injury_unknown: number | null;
  kidnappings_ngo: number | null;
}

let ready = false;
export async function ensureStagingTable(env: Env): Promise<void> {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS incident_staging (
      id TEXT PRIMARY KEY,
      batch_date TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      row_json TEXT NOT NULL,
      source_url TEXT,
      source_title TEXT,
      source_domain TEXT,
      confidence TEXT,
      geo_precision TEXT,
      quote TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT,
      pushed_at TEXT
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_incident_staging_batch ON incident_staging (batch_date, status)`),
  ]);
  ready = true;
}

interface ReportRow {
  id: string;
  article_id: string;
  country_name: string;
  place: string | null;
  admin1: string | null;
  lat: number;
  lon: number;
  geo_precision: string;
  event_date: string;
  actors: string;
  indicators: string;
  fatalities: number | null;
  what_happened: string;
  confidence: string;
  excerpt: string | null;
  created_at: string;
  url: string | null;
  title: string | null;
  domain: string | null;
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function reportToStagedRow(r: ReportRow): StagedRow {
  const actors = parseJson<string[]>(r.actors, []).filter(Boolean);
  const indicators = parseJson<{ label?: string }[]>(r.indicators, []);
  const tactic = Array.from(new Set(indicators.map((i) => i.label).filter(Boolean) as string[])).join("; ") || null;
  const details = [r.what_happened.trim(), r.fatalities != null ? `Reported fatalities: ${r.fatalities}.` : ""].filter(Boolean).join(" ");
  return {
    date: r.event_date || null,
    time: null,
    country: r.country_name || null,
    province: r.admin1,
    county: null,
    district: null,
    city: r.place,
    suburb: null,
    precise_location: r.geo_precision === "place" || r.geo_precision === "approximate" ? r.place : null,
    latitude: Number.isFinite(r.lat) ? Math.round(r.lat * 1e5) / 1e5 : null,
    longitude: Number.isFinite(r.lon) ? Math.round(r.lon * 1e5) / 1e5 : null,
    sector: null,
    actor: actors.join("; ") || null,
    operation: null,
    tactic,
    severity: null,
    details,
    target: null,
    interest_group: null,
    actual_main_victim: null,
    intended_primary_target: null,
    civilian_death_child: null,
    civilian_death_female: null,
    civilian_death_male: null,
    civilian_death_unknown: null,
    civilian_injury_female: null,
    civilian_injury_male: null,
    civilian_injury_unknown: null,
    kidnappings_ngo: null,
  };
}

/** Stages every located, coded report created in [sinceIso, now) that is not staged yet.
 *  `batchDate` (UTC day) is the label the review queue and the daily Excel file group by. */
export async function stageIncidents(env: Env, opts: { sinceIso?: string; batchDate?: string } = {}): Promise<{ staged: number; batchDate: string }> {
  await ensureStagingTable(env);
  const batchDate = opts.batchDate ?? new Date().toISOString().slice(0, 10);
  const since = opts.sinceIso ?? new Date(Date.now() - 24 * 3600_000).toISOString();
  let reports: ReportRow[] = [];
  try {
    reports = await all<ReportRow>(
      env.DB,
      `SELECT r.id, r.article_id, r.country_name, r.place, r.admin1, r.lat, r.lon, r.geo_precision, r.event_date, r.actors, r.indicators,
              r.fatalities, r.what_happened, r.confidence, r.excerpt, r.created_at, a.url, a.title, a.domain
         FROM escalation_reports r LEFT JOIN escalation_articles a ON a.id = r.article_id
        WHERE r.created_at >= ? ORDER BY r.created_at`,
      [since]
    );
  } catch {
    return { staged: 0, batchDate }; // the escalation tables do not exist yet
  }
  let staged = 0;
  const now = nowIso();
  for (const r of reports) {
    const key = `${r.article_id}|${(r.place ?? "").toLowerCase()}|${r.event_date}`;
    const exists = await first(env.DB, `SELECT 1 AS x FROM incident_staging WHERE dedupe_key = ?`, [key]);
    if (exists) continue;
    const row = reportToStagedRow(r);
    await run(
      env.DB,
      `INSERT OR IGNORE INTO incident_staging (id, batch_date, dedupe_key, status, row_json, source_url, source_title, source_domain, confidence, geo_precision, quote, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newId(), batchDate, key, "pending", JSON.stringify(row), r.url, r.title, r.domain, r.confidence, r.geo_precision, r.excerpt, now]
    );
    staged++;
  }
  return { staged, batchDate };
}

/** Once per UTC day (the first cron tick after 03:00), collects the previous 24 hours into that day's batch. */
export async function stageDailyIfDue(env: Env, scheduledTime: number): Promise<void> {
  const d = new Date(scheduledTime);
  if (d.getUTCHours() !== 3 || d.getUTCMinutes() >= 5) return;
  await stageIncidents(env, { batchDate: d.toISOString().slice(0, 10) });
}
