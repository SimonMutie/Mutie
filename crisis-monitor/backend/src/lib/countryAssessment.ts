import type { Env } from "../bindings";
import { callStructured } from "./llm";
import { countryAt, countryName } from "./africaGeo";
import { isTerrorism } from "./terrorism";
import { hybridKind } from "./hybridWarfare";
import type { CountryStatus, CountryTrend } from "./countryStatus";

/**
 * Country assessments: for each country the Lens follows, the numbers (crunched from its own escalation incidents
 * and, for Africa, GDELT's conflict events) and an analyst-grade written assessment built on them: bottom line,
 * interpretation, historical context and patterns, drivers, outlook on the probability yardstick, indicators to
 * watch, and the evidence it rests on. The assessment also judges the country's status and trend, so the status
 * moves as the situation does; an analyst's own rating always wins (lib/countryStatus.ts).
 *
 * Only the Lens's own data is used: never a client's uploaded incidents, so one client's data cannot shape what
 * another sees.
 */

const DAY = 86_400_000;
const STATUS_RANK: Record<CountryStatus, number> = { none: 0, "risk-low": 1, "risk-high": 2, active: 3 };
const RANK_STATUS: CountryStatus[] = ["none", "risk-low", "risk-high", "active"];

/* ── The numbers ─────────────────────────────────────────────────────────────────────────────────────────────── */

export interface KeyIncident {
  id: string;
  date: string;
  level: string;
  place: string | null;
  deaths: number | null;
  headline: string;
  summary: string | null;
  terror: boolean;
  hybrid: string | null;
}

export interface CountryMetrics {
  code: string;
  name: string;
  asOf: string;
  /** Escalation incidents per week, the oldest of 13 weeks first (the last is the week to today). */
  weekly: number[];
  /** Weighted by level (watch 1, elevated 2, critical 3). */
  weeklyWeighted: number[];
  n30: number;
  nPrev30: number;
  w30: number;
  wPrev30: number;
  n90: number;
  critical30: number;
  elevated30: number;
  deaths30: number;
  deathsPrev30: number;
  deaths90: number;
  terror30: number;
  terror90: number;
  hybrid30: number;
  actors90: { name: string; n: number }[];
  places30: { name: string; n: number }[];
  lastIncident: string | null;
  /** GDELT conflict events (codes 18–20) located in the country: last 7 days and the 7 before. Africa only. */
  gdelt: { events7d: number; prev7d: number } | null;
  key: KeyIncident[];
}

const WEIGHT: Record<string, number> = { watch: 1, elevated: 2, critical: 3 };
const WHEN = `COALESCE(last_event_date, first_event_date, substr(updated_at, 1, 10))`;
const parse = <T,>(s: string | null, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

export async function countryMetrics(env: Env, code: string, now = new Date()): Promise<CountryMetrics> {
  const t = now.getTime();
  const day = (n: number) => new Date(t - n * DAY).toISOString().slice(0, 10);
  const rows =
    (
      await env.DB.prepare(
        `SELECT id, location_label AS place, level, headline, summary, detail, ${WHEN} AS date
           FROM escalation_incidents
          WHERE country_code = ? AND status != 'dismissed' AND headline IS NOT NULL AND ${WHEN} >= ?
          ORDER BY ${WHEN} DESC LIMIT 3000`
      )
        .bind(code, day(91))
        .all<{ id: string; place: string | null; level: string; headline: string; summary: string | null; detail: string | null; date: string }>()
        .catch(() => ({ results: [] }))
    ).results ?? [];
  const weekly = Array(13).fill(0) as number[];
  const weeklyWeighted = Array(13).fill(0) as number[];
  const m = {
    n30: 0, nPrev30: 0, w30: 0, wPrev30: 0, n90: 0, critical30: 0, elevated30: 0, deaths30: 0, deathsPrev30: 0, deaths90: 0, terror30: 0, terror90: 0, hybrid30: 0,
  };
  const actors = new Map<string, number>();
  const places = new Map<string, number>();
  const enriched: (KeyIncident & { w: number; age: number })[] = [];
  for (const r of rows) {
    const age = Math.floor((t - Date.parse(`${r.date}T12:00:00Z`)) / DAY);
    if (age > 90 || age < -1) continue;
    const d = parse<{ actors?: string[]; fatalitiesMax?: number | null; indicators?: { id: string }[] }>(r.detail, {});
    const w = WEIGHT[r.level] ?? 1;
    const deaths = typeof d.fatalitiesMax === "number" ? d.fatalitiesMax : 0;
    const terror = isTerrorism((d.indicators ?? []).map((i) => i.id), d.actors ?? []).terrorism;
    const hybrid = hybridKind(`${r.headline}. ${r.summary ?? ""}`);
    const wk = 12 - Math.min(12, Math.floor(Math.max(0, age) / 7));
    weekly[wk]++;
    weeklyWeighted[wk] += w;
    m.n90++;
    m.deaths90 += deaths;
    if (terror) m.terror90++;
    for (const a of d.actors ?? []) actors.set(a, (actors.get(a) ?? 0) + 1);
    if (age < 30) {
      m.n30++;
      m.w30 += w;
      m.deaths30 += deaths;
      if (r.level === "critical") m.critical30++;
      if (r.level === "elevated") m.elevated30++;
      if (terror) m.terror30++;
      if (hybrid) m.hybrid30++;
      if (r.place) places.set(r.place, (places.get(r.place) ?? 0) + 1);
    } else if (age < 60) {
      m.nPrev30++;
      m.wPrev30 += w;
      m.deathsPrev30 += deaths;
    }
    enriched.push({ id: r.id, date: r.date, level: r.level, place: r.place, deaths: deaths || null, headline: r.headline, summary: r.summary, terror, hybrid, w, age });
  }
  const top = (mp: Map<string, number>, n: number) => [...mp].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, k]) => ({ name, n: k }));
  // The incidents that carry the most weight: recent, severe, deadly.
  const key = enriched
    .sort((a, b) => b.w * 3 + Math.min(10, Math.log2(1 + (b.deaths ?? 0)) * 2) - b.age / 10 - (a.w * 3 + Math.min(10, Math.log2(1 + (a.deaths ?? 0)) * 2) - a.age / 10))
    .slice(0, 18)
    .map(({ w: _w, age: _a, ...k }) => k);
  return {
    code,
    name: countryName(code),
    asOf: now.toISOString().slice(0, 10),
    weekly,
    weeklyWeighted,
    ...m,
    actors90: top(actors, 8),
    places30: top(places, 8),
    lastIncident: rows[0]?.date ?? null,
    gdelt: await gdeltCounts(env, code, now),
    key,
  };
}

/** GDELT conflict events (fight, assault, mass violence) located in an African country: last 7 days and the 7 before. */
async function gdeltCounts(env: Env, code: string, now: Date): Promise<{ events7d: number; prev7d: number } | null> {
  const ts = (n: number) => new Date(now.getTime() - n * DAY).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  try {
    const cells =
      (
        await env.DB.prepare(
          `SELECT ROUND(lat * 2) / 2 AS la, ROUND(lon * 2) / 2 AS lo, SUM(CASE WHEN date_added >= ? THEN 1 ELSE 0 END) AS a, SUM(CASE WHEN date_added < ? THEN 1 ELSE 0 END) AS b
             FROM gdelt_bulk_events
            WHERE date_added >= ? AND (event_code LIKE '18%' OR event_code LIKE '19%' OR event_code LIKE '20%')
              AND lat BETWEEN -36 AND 38 AND lon BETWEEN -19 AND 53
            GROUP BY la, lo`
        )
          .bind(ts(7), ts(7), ts(14))
          .all<{ la: number; lo: number; a: number; b: number }>()
      ).results ?? [];
    let a = 0, b = 0, any = false;
    for (const c of cells) {
      if (countryAt(c.la, c.lo) !== code) continue;
      any = true;
      a += c.a;
      b += c.b;
    }
    return any || cells.length ? { events7d: a, prev7d: b } : null;
  } catch {
    return null;
  }
}

/* ── The data rule: status from the numbers alone ────────────────────────────────────────────────────────────── */

/**
 * What the numbers alone say, against the editorial baseline. Escalation shows at once: sustained, deadly or
 * critical violence makes a country "active", and lesser but repeated violence "at risk (high)". The numbers
 * alone never lower a status: a quiet stretch in the Lens's data can mean thin coverage as easily as peace, so
 * calm is left to the written assessment (which weighs coverage) or to an analyst.
 */
export function dataStatus(m: { w30: number; deaths30: number; critical30: number; n90: number }, baseline: CountryStatus): CountryStatus {
  const signal = m.w30 >= 15 || m.deaths30 >= 25 || m.critical30 >= 2 ? 3 : m.w30 >= 5 || m.critical30 >= 1 || m.n90 >= 8 ? 2 : m.n90 >= 2 ? 1 : 0;
  return signal > STATUS_RANK[baseline] ? RANK_STATUS[signal] : baseline;
}

/* ── The written assessment ──────────────────────────────────────────────────────────────────────────────────── */

export const LIKELIHOOD_TERMS = ["remote chance", "highly unlikely", "unlikely", "realistic possibility", "likely", "highly likely", "almost certain"] as const;

export interface CountryAssessment {
  status: CountryStatus;
  trend: CountryTrend | null;
  confidence: "low" | "moderate" | "high";
  bottomLine: string;
  assessment: string;
  context: string;
  drivers: string[];
  outlook: string;
  outlookLikelihood: (typeof LIKELIHOOD_TERMS)[number] | null;
  indicators: string[];
  evidence: string[];
  coverageNote: string | null;
}

const SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["active", "risk-high", "risk-low", "none"] },
    trend: { type: ["string", "null"], enum: ["worsening", "steady", "improving", null] },
    confidence: { type: "string", enum: ["low", "moderate", "high"] },
    bottomLine: { type: "string", description: "One or two sentences, at most 45 words: the judgement, stated plainly." },
    assessment: { type: "string", description: "Two or three paragraphs (180–300 words) separated by blank lines." },
    context: { type: "string", description: "One paragraph (90–150 words): history and recurring patterns." },
    drivers: { type: "array", items: { type: "string" }, description: "Three to five drivers, each one sentence." },
    outlook: { type: "string", description: "One paragraph (80–150 words) on the next 30 to 90 days." },
    outlookLikelihood: { type: ["string", "null"], enum: [...LIKELIHOOD_TERMS, null] },
    indicators: { type: "array", items: { type: "string" }, description: "Three to six observable indicators, each one line." },
    evidence: { type: "array", items: { type: "string" }, description: "The ids (E1, E2…) of the incidents the judgement leans on most, at most six." },
    coverageNote: { type: ["string", "null"], description: "One sentence when the Lens's data is thin or lopsided for this country; otherwise null." },
  },
  required: ["status", "trend", "confidence", "bottomLine", "assessment", "context", "drivers", "outlook", "outlookLikelihood", "indicators", "evidence", "coverageNote"],
} as const;

const SYSTEM = `You are a senior conflict analyst at Afrilens Consulting, Nairobi, writing the country assessment that sits behind a country's status on The Lens, a crisis-monitoring platform for Africa and the Middle East. Your readers are security managers, humanitarian leads and investors who act on what you write.

Write as the best analysts write: judgement first, then the reasoning. Precise, interpretative, unhurried British English. No filler, no stock phrases ("remains fluid", "it remains to be seen", "complex situation", "amid"), no lists of everything that happened. Every claim earns its place.

EVIDENCE AND JUDGEMENT
- The CURRENT situation comes only from the numbers and incidents supplied. Quote the numbers that matter (e.g. "34 incidents in the last 30 days against 19 in the 30 before; 210 reported deaths") and interpret them: what the change means, not merely that it happened. Treat reported deaths as reported, not verified.
- HISTORY and PATTERNS come from established knowledge: earlier phases of the conflict, seasonal rhythms (rainy seasons, harvests, transhumance), electoral cycles, how armed groups have behaved before, and what comparable moments led to. Use it to interpret the present, but do not assert specific recent events that the evidence does not show; if your background knowledge may be out of date, say what would need checking.
- Distinguish what the data shows, what you infer, and what you expect. Use the probability yardstick for forward judgements: remote chance, highly unlikely, unlikely, realistic possibility, likely, highly likely, almost certain.
- The Lens's incident data comes from its own reading of wire, local-media and Telegram reporting. It undercounts places with little reporting and overcounts heavily reported wars. A fall in incidents can be quiet or silence; say which you think it is and why. Note it in coverageNote when this matters.

STATUS AND TREND
- active: organised armed violence is under way now (sustained clashes, insurgency, war), whatever its scale.
- risk-high: no sustained armed conflict now, but a serious chance of it breaking out or reigniting within months (mobilisation, spillover, a collapsing settlement, repeated deadly incidents).
- risk-low: identifiable risk factors and sporadic violence, but conflict is not expected soon.
- none: no meaningful armed-conflict risk.
- trend (active countries only, otherwise null): worsening, steady or improving over the last 30 days against the 30 before and the 13-week shape, judged on severity and reach as well as counts.
- You are given the editorial baseline and what the numbers alone suggest. Depart from them when the evidence and your interpretation justify it, and say why in the assessment.

OUTPUT
- bottomLine: the judgement in one or two sentences.
- assessment: what is happening, where, by whom, how it compares with recent weeks, and what it means.
- context: the history and patterns that make sense of the present.
- drivers: the forces moving the situation now.
- outlook: the most likely course over the next 30 to 90 days, the main alternative, and what would tip it; outlookLikelihood is the yardstick term for the most likely course.
- indicators: specific, observable signs to watch (named places, actors, dates, thresholds), not generic ones.
- evidence: the ids of the incidents your judgement leans on.`;

function userMessage(m: CountryMetrics, baseline: { status: CountryStatus; note: string | null }, ruled: CountryStatus): string {
  const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? "no change" : "up from none") : `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`);
  const lines = [
    `COUNTRY: ${m.name} (${m.code}); data as of ${m.asOf}.`,
    `EDITORIAL BASELINE: ${baseline.status}${baseline.note ? `: ${baseline.note}` : ""}`,
    `WHAT THE NUMBERS ALONE SUGGEST: ${ruled}`,
    "",
    "THE NUMBERS (Lens escalation incidents)",
    `- Last 30 days: ${m.n30} incidents (weighted ${m.w30}), against ${m.nPrev30} (weighted ${m.wPrev30}) in the 30 before: ${pct(m.w30, m.wPrev30)} weighted.`,
    `- Last 90 days: ${m.n90} incidents. Critical in the last 30 days: ${m.critical30}; elevated: ${m.elevated30}.`,
    `- Reported deaths: ${m.deaths30} in the last 30 days, ${m.deathsPrev30} in the 30 before, ${m.deaths90} over 90 days.`,
    `- Terrorist attacks: ${m.terror30} in 30 days, ${m.terror90} in 90. Hybrid-warfare incidents in 30 days: ${m.hybrid30}.`,
    `- Incidents per week, oldest first (13 weeks): ${m.weekly.join(", ")}.`,
    `- Weighted per week: ${m.weeklyWeighted.join(", ")}.`,
    `- Most named actors (90 days): ${m.actors90.map((a) => `${a.name} (${a.n})`).join("; ") || "none named"}.`,
    `- Main places (30 days): ${m.places30.map((p) => `${p.name} (${p.n})`).join("; ") || "none located"}.`,
    m.gdelt ? `- GDELT conflict events located in the country: ${m.gdelt.events7d} in the last 7 days, ${m.gdelt.prev7d} in the 7 before.` : "- GDELT conflict events: not available for this country.",
    `- Most recent incident: ${m.lastIncident ?? "none in 90 days"}.`,
    "",
    "KEY INCIDENTS (most significant first)",
    ...m.key.map(
      (k, i) =>
        `E${i + 1} | ${k.date} | ${k.level}${k.terror ? " | terrorist attack" : ""}${k.hybrid ? ` | hybrid: ${k.hybrid}` : ""}${k.deaths ? ` | up to ${k.deaths} reported dead` : ""}${k.place ? ` | ${k.place}` : ""}\n    ${k.headline}${k.summary ? `\n    ${k.summary.slice(0, 420)}` : ""}`
    ),
  ];
  if (!m.key.length) lines.push("(No incidents recorded in the last 90 days.)");
  return lines.join("\n");
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[ \t]+/g, " ").trim().slice(0, max) : "");

export async function writeAssessment(env: Env, m: CountryMetrics, baseline: { status: CountryStatus; note: string | null }, ruled: CountryStatus): Promise<{ body: CountryAssessment; provider: string; model: string } | null> {
  const r = await callStructured<CountryAssessment>(env, {
    role: "analyst",
    feature: "country assessments",
    system: SYSTEM,
    user: userMessage(m, baseline, ruled),
    schema: SCHEMA as unknown as Record<string, unknown>,
    toolName: "record_country_assessment",
    toolDescription: "Record the country assessment.",
    maxTokens: 2200,
  });
  if (!r) return null;
  const d = r.data;
  const statuses: CountryStatus[] = ["active", "risk-high", "risk-low", "none"];
  const status = statuses.includes(d.status) ? d.status : ruled;
  const body: CountryAssessment = {
    status,
    trend: status === "active" && ["worsening", "steady", "improving"].includes(d.trend ?? "") ? d.trend : null,
    confidence: ["low", "moderate", "high"].includes(d.confidence) ? d.confidence : "moderate",
    bottomLine: clean(d.bottomLine, 400),
    assessment: clean(d.assessment, 3000),
    context: clean(d.context, 1600),
    drivers: (Array.isArray(d.drivers) ? d.drivers : []).map((x) => clean(x, 300)).filter(Boolean).slice(0, 6),
    outlook: clean(d.outlook, 1600),
    outlookLikelihood: (LIKELIHOOD_TERMS as readonly string[]).includes(d.outlookLikelihood ?? "") ? d.outlookLikelihood : null,
    indicators: (Array.isArray(d.indicators) ? d.indicators : []).map((x) => clean(x, 240)).filter(Boolean).slice(0, 7),
    evidence: (Array.isArray(d.evidence) ? d.evidence : [])
      .map((e) => m.key[Number(String(e).replace(/\D/g, "")) - 1]?.id)
      .filter((x): x is string => !!x)
      .slice(0, 6),
    coverageNote: d.coverageNote ? clean(d.coverageNote, 300) : null,
  };
  if (body.bottomLine.length < 20 || body.assessment.length < 120) return null;
  return { body, provider: r.provider, model: r.model };
}

/* ── Storage and schedule ────────────────────────────────────────────────────────────────────────────────────── */

const ready = new WeakSet<D1Database>();
export async function ensureAssessmentTable(db: D1Database) {
  if (ready.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS country_assessments (code TEXT PRIMARY KEY, generated_at TEXT NOT NULL, provider TEXT, model TEXT, status TEXT NOT NULL, trend TEXT, metrics TEXT NOT NULL, body TEXT NOT NULL)`
    )
    .run();
  ready.add(db);
}

export interface StoredAssessment {
  code: string;
  generatedAt: string;
  provider: string | null;
  model: string | null;
  status: CountryStatus;
  trend: CountryTrend | null;
  metrics: CountryMetrics;
  body: CountryAssessment;
}

export async function getAssessments(env: Env): Promise<Map<string, StoredAssessment>> {
  await ensureAssessmentTable(env.DB);
  const rows = (await env.DB.prepare(`SELECT * FROM country_assessments`).all<{ code: string; generated_at: string; provider: string | null; model: string | null; status: string; trend: string | null; metrics: string; body: string }>()).results ?? [];
  return new Map(
    rows.map((r) => [
      r.code,
      { code: r.code, generatedAt: r.generated_at, provider: r.provider, model: r.model, status: r.status as CountryStatus, trend: (r.trend as CountryTrend | null) ?? null, metrics: parse(r.metrics, {} as CountryMetrics), body: parse(r.body, {} as CountryAssessment) },
    ])
  );
}

export async function saveAssessment(env: Env, code: string, m: CountryMetrics, a: { body: CountryAssessment; provider: string; model: string }, now: Date) {
  await ensureAssessmentTable(env.DB);
  await env.DB.prepare(
    `INSERT INTO country_assessments (code, generated_at, provider, model, status, trend, metrics, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET generated_at = excluded.generated_at, provider = excluded.provider, model = excluded.model, status = excluded.status, trend = excluded.trend, metrics = excluded.metrics, body = excluded.body`
  )
    .bind(code, now.toISOString(), a.provider, a.model, a.body.status, a.body.trend, JSON.stringify(m), JSON.stringify(a.body))
    .run();
}

/** How long an assessment stands before it is rewritten, by status; and sooner when the numbers move. */
const REFRESH_HOURS: Record<CountryStatus, number> = { active: 24, "risk-high": 36, "risk-low": 72, none: 168 };
const MOVED_MIN_HOURS = 6;
/** Country assessments written per day, at most, so incident assessments keep their share of the analyst budget. */
export const ASSESSMENTS_PER_DAY = 45;

/** Whether a country's assessment is due: never written, past its lifetime, or the numbers have moved materially. */
export function assessmentDue(prev: StoredAssessment | undefined, now: { w30: number; critical30: number; deaths30: number }, status: CountryStatus, at: number): boolean {
  if (!prev) return true;
  const age = (at - Date.parse(prev.generatedAt)) / 3_600_000;
  if (age >= REFRESH_HOURS[status]) return true;
  if (age < MOVED_MIN_HOURS) return false;
  const was = prev.metrics;
  const swing = Math.abs(now.w30 - (was.w30 ?? 0));
  return now.critical30 > (was.critical30 ?? 0) || (swing >= 6 && swing >= 0.5 * Math.max(1, was.w30 ?? 0)) || now.deaths30 >= (was.deaths30 ?? 0) + 25;
}

/**
 * One step of the schedule (every cron tick): writes the most overdue country's assessment, if any is due and the
 * day's quota is not spent. Countries never assessed come first, then active ones, then the longest unrefreshed.
 */
export async function runCountryAssessments(env: Env, candidates: { code: string; status: CountryStatus; baseline: CountryStatus; note: string | null; w30: number; critical30: number; deaths30: number; n90: number }[], now = new Date(), perRun = 1): Promise<string[]> {
  await ensureAssessmentTable(env.DB);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lens_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
  const dayKey = `country_assessments:${now.toISOString().slice(0, 10)}`;
  const done = Number((await env.DB.prepare(`SELECT value FROM lens_state WHERE key = ?`).bind(dayKey).first<{ value: string }>())?.value ?? 0);
  if (done >= ASSESSMENTS_PER_DAY) return [];
  const prev = await getAssessments(env);
  const at = now.getTime();
  const due = candidates
    .filter((c) => c.status !== "none" || c.n90 > 0)
    .filter((c) => assessmentDue(prev.get(c.code), c, c.status, at))
    .sort((a, b) => Number(!!prev.get(a.code)) - Number(!!prev.get(b.code)) || STATUS_RANK[b.status] - STATUS_RANK[a.status] || Date.parse(prev.get(a.code)?.generatedAt ?? "0") - Date.parse(prev.get(b.code)?.generatedAt ?? "0"))
    .slice(0, Math.min(perRun, ASSESSMENTS_PER_DAY - done));
  const written: string[] = [];
  for (const c of due) {
    const m = await countryMetrics(env, c.code, now);
    const ruled = dataStatus(m, c.baseline);
    const a = await writeAssessment(env, m, { status: c.baseline, note: c.note }, ruled);
    await env.DB.prepare(`INSERT INTO lens_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`).bind(dayKey, "1").run();
    if (!a) continue;
    await saveAssessment(env, c.code, m, a, now);
    written.push(c.code);
  }
  return written;
}
