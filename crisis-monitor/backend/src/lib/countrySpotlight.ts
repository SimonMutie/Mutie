import type { Env } from "../bindings";
import { callStructured } from "./llm";
import { countryMetrics, getAssessments, type CountryMetrics } from "./countryAssessment";
import type { CountryStatus } from "./countryStatus";

/**
 * Country spotlights: the deep, self-updating country product under Regional Spotlight. Built from the Lens's own
 * evidence (escalation incidents, terrorism and hybrid-warfare flags, the country's status and assessment) and
 * written to US intelligence-community tradecraft:
 *
 *  - bottom line up front and key judgements, each with a likelihood on the ICD 203 seven-point scale, a confidence
 *    level and its basis; evidence kept apart from assumption and judgement; change since the last edition explained;
 *  - a Key Assumptions Check (what each judgement rests on and what would overturn it);
 *  - Alternative Futures Analysis: the two most critical uncertainties crossed into four scenarios, each with a
 *    likelihood, a narrative, its pathway, implications for investors, humanitarian and security managers, and
 *    signposts (indicators) for and against it;
 *  - a high-impact, low-probability wildcard with its triggers;
 *  - an indicator matrix (concern by area, CIA tradecraft primer) and the trigger dates ahead.
 *
 * Self-updating: each country is rewritten on a schedule (more often the hotter it is, and sooner when its status
 * changes or its signposts trip); between editions the Lens checks every signpost against new incidents, so the page
 * shows which futures are gaining ground. Every edition's scenario likelihoods are kept, so their drift can be seen.
 * Only the Lens's own data is used, never a client's uploaded incidents.
 */

const DAY = 86_400_000;

export const LIKELIHOOD_SCALE: { term: string; min: number; max: number }[] = [
  { term: "almost no chance", min: 1, max: 5 },
  { term: "very unlikely", min: 5, max: 20 },
  { term: "unlikely", min: 20, max: 45 },
  { term: "roughly even chance", min: 45, max: 55 },
  { term: "likely", min: 55, max: 80 },
  { term: "very likely", min: 80, max: 95 },
  { term: "almost certain", min: 95, max: 99 },
];
const TERMS = LIKELIHOOD_SCALE.map((l) => l.term);
export const termFor = (p: number) => LIKELIHOOD_SCALE.find((l) => p <= l.max)?.term ?? "almost certain";

export interface Signpost {
  text: string;
  /** Terms that must all appear in an incident's headline or summary for the signpost to count as seen. */
  terms: string[];
  /** "toward": seeing it makes the scenario more likely; "away": less likely. */
  direction: "toward" | "away";
}
export interface Scenario {
  id: "A" | "B" | "C" | "D";
  name: string;
  /** Where it sits on the two critical uncertainties. */
  u1: "low" | "high";
  u2: "low" | "high";
  /** Percent; the four add up to 100. */
  likelihood: number;
  narrative: string;
  pathway: string;
  implications: { investors: string; humanitarian: string; security: string };
  signposts: Signpost[];
}
export interface Spotlight {
  headline: string;
  bottomLine: string;
  keyJudgements: { judgement: string; likelihood: string; confidence: "low" | "moderate" | "high"; basis: string }[];
  situation: string;
  trajectory: string;
  history: string;
  drivers: { name: string; direction: "escalatory" | "stabilising" | "mixed"; note: string }[];
  predetermined: string[];
  uncertainties: { name: string; low: string; high: string }[];
  scenarios: Scenario[];
  wildcard: { name: string; description: string; triggers: string[]; indicators: string[] };
  assumptions: { assumption: string; invalidatedBy: string }[];
  indicatorMatrix: { area: string; level: "negligible" | "low" | "moderate" | "substantial" | "serious"; trend: "rising" | "steady" | "easing"; note: string }[];
  triggers: { when: string | null; event: string }[];
  changes: string | null;
  confidence: "low" | "moderate" | "high";
  confidenceBasis: string;
  sourcesNote: string;
}

/* ── The record of the country over time ─────────────────────────────────────────────────────────────────────── */

export interface MonthPoint {
  month: string;
  incidents: number;
  critical: number;
  deaths: number;
}
const WHEN = `COALESCE(last_event_date, first_event_date, substr(updated_at, 1, 10))`;

/** Incidents, critical incidents and reported deaths per month since January 2025. */
export async function monthlySeries(env: Env, code: string): Promise<MonthPoint[]> {
  const rows =
    (
      await env.DB.prepare(
        `SELECT substr(${WHEN}, 1, 7) AS month, COUNT(*) AS incidents, SUM(CASE WHEN level = 'critical' THEN 1 ELSE 0 END) AS critical,
                SUM(COALESCE(json_extract(detail, '$.fatalitiesMax'), 0)) AS deaths
           FROM escalation_incidents WHERE country_code = ? AND status != 'dismissed' AND headline IS NOT NULL AND ${WHEN} >= '2025-01-01'
          GROUP BY month ORDER BY month`
      )
        .bind(code)
        .all<MonthPoint>()
        .catch(() => ({ results: [] as MonthPoint[] }))
    ).results ?? [];
  return rows.map((r) => ({ month: r.month, incidents: Number(r.incidents), critical: Number(r.critical), deaths: Number(r.deaths) }));
}

/* ── Writing an edition ──────────────────────────────────────────────────────────────────────────────────────── */

const str = { type: "string" } as const;
const conf = { type: "string", enum: ["low", "moderate", "high"] } as const;
const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "A sharp title for the edition, at most 14 words." },
    bottomLine: { type: "string", description: "Two or three sentences: the judgement that matters most." },
    keyJudgements: {
      type: "array",
      description: "Three to five key judgements.",
      items: { type: "object", properties: { judgement: str, likelihood: { type: "string", enum: TERMS }, confidence: conf, basis: { type: "string", description: "The evidence and reasoning, one or two sentences." } }, required: ["judgement", "likelihood", "confidence", "basis"] },
    },
    situation: { type: "string", description: "The situation now, 2–3 paragraphs separated by blank lines, quoting the numbers that matter." },
    trajectory: { type: "string", description: "How the conflict has moved since early 2025 and over the last 90 days: shape, phases, patterns. 1–2 paragraphs." },
    history: { type: "string", description: "Historical context and recurring patterns that explain the present. 1–2 paragraphs." },
    drivers: { type: "array", description: "Four to six drivers.", items: { type: "object", properties: { name: str, direction: { type: "string", enum: ["escalatory", "stabilising", "mixed"] }, note: str }, required: ["name", "direction", "note"] } },
    predetermined: { type: "array", items: str, description: "Two to four predetermined elements: things that will happen regardless (seasons, scheduled votes, mandates expiring)." },
    uncertainties: {
      type: "array",
      description: "Exactly two critical uncertainties: the most important and least predictable forces. Each runs from a low to a high end.",
      items: { type: "object", properties: { name: str, low: str, high: str }, required: ["name", "low", "high"] },
    },
    scenarios: {
      type: "array",
      description: "Exactly four scenarios, one per quadrant of the two uncertainties (A: u1 low/u2 low, B: u1 high/u2 low, C: u1 low/u2 high, D: u1 high/u2 high).",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: ["A", "B", "C", "D"] },
          name: { type: "string", description: "An evocative name, 2–5 words." },
          u1: { type: "string", enum: ["low", "high"] },
          u2: { type: "string", enum: ["low", "high"] },
          likelihood: { type: "integer", description: "Percent over the next 6–12 months; the four add up to 100." },
          narrative: { type: "string", description: "What this future looks like in 6–12 months, one paragraph." },
          pathway: { type: "string", description: "How it could plausibly come about from today, one paragraph." },
          implications: { type: "object", properties: { investors: str, humanitarian: str, security: str }, required: ["investors", "humanitarian", "security"] },
          signposts: {
            type: "array",
            description: "Three to five signposts: observable events that would show this future emerging (toward) or receding (away).",
            items: {
              type: "object",
              properties: {
                text: str,
                terms: { type: "array", items: str, description: "One to three lower-case words or short names that would ALL appear in a news headline reporting it (a place, an actor, an act), e.g. [\"el fasher\", \"rsf\"]." },
                direction: { type: "string", enum: ["toward", "away"] },
              },
              required: ["text", "terms", "direction"],
            },
          },
        },
        required: ["id", "name", "u1", "u2", "likelihood", "narrative", "pathway", "implications", "signposts"],
      },
    },
    wildcard: { type: "object", properties: { name: str, description: str, triggers: { type: "array", items: str }, indicators: { type: "array", items: str } }, required: ["name", "description", "triggers", "indicators"] },
    assumptions: { type: "array", description: "Three or four key assumptions.", items: { type: "object", properties: { assumption: str, invalidatedBy: str }, required: ["assumption", "invalidatedBy"] } },
    indicatorMatrix: {
      type: "array",
      description: "One row for each of: Security; Governance and legitimacy; Armed groups and opposition; Economy and livelihoods; Humanitarian; External actors.",
      items: { type: "object", properties: { area: str, level: { type: "string", enum: ["negligible", "low", "moderate", "substantial", "serious"] }, trend: { type: "string", enum: ["rising", "steady", "easing"] }, note: str }, required: ["area", "level", "trend", "note"] },
    },
    triggers: { type: "array", description: "Known dates or events ahead that could move the situation.", items: { type: "object", properties: { when: { type: ["string", "null"] }, event: str }, required: ["when", "event"] } },
    changes: { type: ["string", "null"], description: "What has changed since the previous edition and why the judgements moved or held; null for a first edition." },
    confidence: conf,
    confidenceBasis: str,
    sourcesNote: { type: "string", description: "The quality and limits of the evidence, one or two sentences." },
  },
  required: ["headline", "bottomLine", "keyJudgements", "situation", "trajectory", "history", "drivers", "predetermined", "uncertainties", "scenarios", "wildcard", "assumptions", "indicatorMatrix", "triggers", "changes", "confidence", "confidenceBasis", "sourcesNote"],
} as const;

const SYSTEM = `You are the senior analyst who writes Afrilens Consulting's country spotlight on The Lens: the deep, self-updating country product that investors, humanitarian leads and security managers read before they decide. It must meet the standards of the best national-intelligence and strategic-forecasting work.

TRADECRAFT
- Bottom line up front, then key judgements. Each judgement carries a likelihood on the ICD 203 scale (almost no chance, very unlikely, unlikely, roughly even chance, likely, very likely, almost certain), a confidence level (low, moderate, high) and its basis.
- Distinguish evidence (what the Lens's data shows), assumptions, and judgements. Describe the quality and limits of the sources.
- Alternative Futures Analysis: identify the TWO most critical and uncertain drivers, set a low and a high end for each, cross them into four scenarios, and write each as a plausible future with its pathway from today. Scenarios must be genuinely different, internally consistent and each plausible; their likelihoods (percent, next 6–12 months) add up to 100 and reflect the evidence, not symmetry.
- Signposts are observable, specific and checkable: named places, actors, acts. Give each one to three lower-case terms that would all appear in a headline reporting it. Include signposts that would show a scenario receding, not only emerging.
- Key Assumptions Check: the premises the main line rests on, each with what would overturn it.
- A high-impact, low-probability wildcard with plausible triggers and early indicators.
- Explain change: when a previous edition is supplied, say what moved since then and why, and keep continuity where the evidence has not changed.

EVIDENCE
- The CURRENT picture comes only from the numbers and incidents supplied; quote the numbers that matter and interpret them. Reported deaths are reported, not verified. The Lens reads wire, local-media and Telegram reporting: it undercounts thinly covered places and overcounts heavily reported wars; a fall can be quiet or silence, say which you think it is.
- HISTORY, structure and patterns come from established knowledge (earlier phases, seasonal rhythms, electoral cycles, how armed groups have behaved, regional and external actors). Do not assert specific recent events the evidence does not show; flag where background knowledge may be out of date.

STYLE
- British English, precise, interpretative, unhurried; no filler, no stock phrases ("remains fluid", "complex situation", "amid", "it remains to be seen"). Write for decision-makers: implications are concrete (routes, sites, staff, contracts, timing).`;

function userMessage(m: CountryMetrics, months: MonthPoint[], ctx: { status: CountryStatus; trend: string | null; baseline: CountryStatus; note: string | null; assessment: string | null }, prev: StoredSpotlight | null): string {
  const lines = [
    `COUNTRY: ${m.name} (${m.code}); data as of ${m.asOf}.`,
    `STATUS ON THE LENS: ${ctx.status}${ctx.trend ? `, ${ctx.trend}` : ""} (editorial baseline ${ctx.baseline}${ctx.note ? `: ${ctx.note}` : ""}).`,
    ctx.assessment ? `LATEST COUNTRY ASSESSMENT (bottom line): ${ctx.assessment}` : "",
    "",
    "THE LAST 90 DAYS (Lens escalation incidents)",
    `- Last 30 days: ${m.n30} incidents (weighted ${m.w30}) against ${m.nPrev30} (weighted ${m.wPrev30}) in the 30 before; ${m.n90} over 90 days.`,
    `- Critical in 30 days: ${m.critical30}; elevated: ${m.elevated30}. Reported deaths: ${m.deaths30} (30 days), ${m.deathsPrev30} (30 before), ${m.deaths90} (90 days).`,
    `- Terrorist attacks: ${m.terror30} in 30 days, ${m.terror90} in 90. Hybrid-warfare incidents in 30 days: ${m.hybrid30}.`,
    `- Incidents per week, oldest first (13 weeks): ${m.weekly.join(", ")}.`,
    `- Actors most named (90 days): ${m.actors90.map((a) => `${a.name} (${a.n})`).join("; ") || "none"}.`,
    `- Hotspots (30 days): ${m.places30.map((p) => `${p.name} (${p.n})`).join("; ") || "none"}.`,
    m.gdelt ? `- GDELT conflict events in the country: ${m.gdelt.events7d} last 7 days, ${m.gdelt.prev7d} the 7 before.` : "",
    "",
    "MONTH BY MONTH SINCE JANUARY 2025 (month: incidents / critical / reported deaths)",
    months.length ? months.map((p) => `${p.month}: ${p.incidents} / ${p.critical} / ${p.deaths}`).join("; ") : "(no incidents recorded)",
    "",
    "KEY INCIDENTS (most significant first)",
    ...m.key.slice(0, 16).map((k, i) => `E${i + 1} | ${k.date} | ${k.level}${k.terror ? " | terrorism" : ""}${k.hybrid ? ` | hybrid: ${k.hybrid}` : ""}${k.deaths ? ` | up to ${k.deaths} dead` : ""}${k.place ? ` | ${k.place}` : ""}\n    ${k.headline}${k.summary ? `\n    ${k.summary.slice(0, 360)}` : ""}`),
  ];
  if (prev) {
    const p = prev.body;
    lines.push(
      "",
      `PREVIOUS EDITION (${prev.generatedAt.slice(0, 10)}): "${p.headline}"`,
      `Bottom line then: ${p.bottomLine}`,
      `Scenarios then: ${p.scenarios.map((s) => `${s.id} ${s.name} ${s.likelihood}%`).join("; ")}.`,
      `Signposts seen since: ${prev.tracking ? prev.tracking.map((t) => `${t.scenario}: ${t.seenToward} toward, ${t.seenAway} away`).join("; ") : "not checked"}.`
    );
  }
  return lines.filter((l) => l !== "").join("\n");
}

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/[ \t]+/g, " ").trim().slice(0, n) : "");
const arr = <T,>(v: unknown, n: number): T[] => (Array.isArray(v) ? (v as T[]).slice(0, n) : []);

/** Checks and tidies the model's edition: four scenarios with likelihoods that add up to 100, clean signposts. */
export function normaliseSpotlight(d: Spotlight): Spotlight | null {
  const scenarios = arr<Scenario>(d.scenarios, 4).map((s, i) => ({
    id: (["A", "B", "C", "D"] as const)[i],
    name: clip(s.name, 60) || `Scenario ${i + 1}`,
    u1: s.u1 === "high" ? ("high" as const) : ("low" as const),
    u2: s.u2 === "high" ? ("high" as const) : ("low" as const),
    likelihood: Math.max(0, Math.round(Number(s.likelihood) || 0)),
    narrative: clip(s.narrative, 1400),
    pathway: clip(s.pathway, 1400),
    implications: { investors: clip(s.implications?.investors, 500), humanitarian: clip(s.implications?.humanitarian, 500), security: clip(s.implications?.security, 500) },
    signposts: arr<Signpost>(s.signposts, 6)
      .map((g) => ({ text: clip(g.text, 240), terms: arr<string>(g.terms, 3).map((t) => clip(t, 40).toLowerCase()).filter((t) => t.length >= 3), direction: g.direction === "away" ? ("away" as const) : ("toward" as const) }))
      .filter((g) => g.text),
  }));
  if (scenarios.length !== 4 || clip(d.bottomLine, 10).length < 10) return null;
  const total = scenarios.reduce((a, s) => a + s.likelihood, 0);
  if (total <= 0) scenarios.forEach((s) => (s.likelihood = 25));
  else {
    scenarios.forEach((s) => (s.likelihood = Math.round((s.likelihood / total) * 100)));
    const drift = 100 - scenarios.reduce((a, s) => a + s.likelihood, 0);
    scenarios.reduce((a, b) => (b.likelihood > a.likelihood ? b : a)).likelihood += drift;
  }
  const levels = ["negligible", "low", "moderate", "substantial", "serious"];
  return {
    headline: clip(d.headline, 140),
    bottomLine: clip(d.bottomLine, 700),
    keyJudgements: arr<Spotlight["keyJudgements"][number]>(d.keyJudgements, 6).map((k) => ({
      judgement: clip(k.judgement, 400),
      likelihood: TERMS.includes(k.likelihood) ? k.likelihood : "roughly even chance",
      confidence: (["low", "moderate", "high"] as const).includes(k.confidence) ? k.confidence : "moderate",
      basis: clip(k.basis, 500),
    })),
    situation: clip(d.situation, 3500),
    trajectory: clip(d.trajectory, 2500),
    history: clip(d.history, 2500),
    drivers: arr<Spotlight["drivers"][number]>(d.drivers, 7).map((x) => ({ name: clip(x.name, 80), direction: (["escalatory", "stabilising", "mixed"] as const).includes(x.direction) ? x.direction : "mixed", note: clip(x.note, 360) })),
    predetermined: arr<string>(d.predetermined, 5).map((x) => clip(x, 260)).filter(Boolean),
    uncertainties: arr<Spotlight["uncertainties"][number]>(d.uncertainties, 2).map((u) => ({ name: clip(u.name, 100), low: clip(u.low, 120), high: clip(u.high, 120) })),
    scenarios,
    wildcard: { name: clip(d.wildcard?.name, 100), description: clip(d.wildcard?.description, 900), triggers: arr<string>(d.wildcard?.triggers, 5).map((x) => clip(x, 200)), indicators: arr<string>(d.wildcard?.indicators, 5).map((x) => clip(x, 200)) },
    assumptions: arr<Spotlight["assumptions"][number]>(d.assumptions, 5).map((a) => ({ assumption: clip(a.assumption, 300), invalidatedBy: clip(a.invalidatedBy, 300) })),
    indicatorMatrix: arr<Spotlight["indicatorMatrix"][number]>(d.indicatorMatrix, 7).map((r) => ({ area: clip(r.area, 60), level: levels.includes(r.level) ? r.level : "moderate", trend: (["rising", "steady", "easing"] as const).includes(r.trend) ? r.trend : "steady", note: clip(r.note, 300) })),
    triggers: arr<Spotlight["triggers"][number]>(d.triggers, 8).map((t) => ({ when: t.when ? clip(t.when, 40) : null, event: clip(t.event, 240) })),
    changes: d.changes ? clip(d.changes, 1500) : null,
    confidence: (["low", "moderate", "high"] as const).includes(d.confidence) ? d.confidence : "moderate",
    confidenceBasis: clip(d.confidenceBasis, 500),
    sourcesNote: clip(d.sourcesNote, 500),
  };
}

export async function writeSpotlight(env: Env, m: CountryMetrics, months: MonthPoint[], ctx: Parameters<typeof userMessage>[2], prev: StoredSpotlight | null) {
  const r = await callStructured<Spotlight>(env, {
    role: "analyst",
    feature: "country spotlights",
    system: SYSTEM,
    user: userMessage(m, months, ctx, prev),
    schema: SCHEMA as unknown as Record<string, unknown>,
    toolName: "record_country_spotlight",
    toolDescription: "Record the country spotlight edition.",
    maxTokens: 8000,
  });
  if (!r) return null;
  const body = normaliseSpotlight(r.data);
  return body ? { body, provider: r.provider, model: r.model } : null;
}

/* ── Signposts: checked against new incidents between editions ───────────────────────────────────────────────── */

export interface SignpostHit {
  scenario: Scenario["id"];
  index: number;
  seen: { id: string; date: string; headline: string }[];
}
export interface ScenarioTracking {
  scenario: Scenario["id"];
  seenToward: number;
  seenAway: number;
  totalToward: number;
  totalAway: number;
}

const matches = (text: string, terms: string[]) => terms.length > 0 && terms.every((t) => new RegExp(`(^|[^\\p{L}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu").test(text));

/** Which signposts the Lens's incidents in the country have shown since the edition was written. */
export async function trackSignposts(env: Env, code: string, s: Spotlight, since: string): Promise<{ hits: SignpostHit[]; tracking: ScenarioTracking[] }> {
  const rows =
    (
      await env.DB.prepare(
        `SELECT id, ${WHEN} AS date, headline, summary FROM escalation_incidents WHERE country_code = ? AND status != 'dismissed' AND headline IS NOT NULL AND ${WHEN} >= ? ORDER BY ${WHEN} DESC LIMIT 2000`
      )
        .bind(code, since.slice(0, 10))
        .all<{ id: string; date: string; headline: string; summary: string | null }>()
        .catch(() => ({ results: [] as { id: string; date: string; headline: string; summary: string | null }[] }))
    ).results ?? [];
  const hits: SignpostHit[] = [];
  const tracking: ScenarioTracking[] = [];
  for (const sc of s.scenarios) {
    const t: ScenarioTracking = { scenario: sc.id, seenToward: 0, seenAway: 0, totalToward: 0, totalAway: 0 };
    sc.signposts.forEach((g, index) => {
      if (g.direction === "toward") t.totalToward++;
      else t.totalAway++;
      const seen = rows.filter((r) => matches(`${r.headline}. ${r.summary ?? ""}`, g.terms)).slice(0, 4).map((r) => ({ id: r.id, date: r.date, headline: r.headline }));
      if (!seen.length) return;
      hits.push({ scenario: sc.id, index, seen });
      if (g.direction === "toward") t.seenToward++;
      else t.seenAway++;
    });
    tracking.push(t);
  }
  return { hits, tracking };
}

/* ── Storage, history and schedule ───────────────────────────────────────────────────────────────────────────── */

export interface StoredSpotlight {
  code: string;
  generatedAt: string;
  status: CountryStatus;
  provider: string | null;
  model: string | null;
  body: Spotlight;
  tracking: ScenarioTracking[] | null;
}

const ready = new WeakSet<D1Database>();
export async function ensureSpotlightTables(db: D1Database) {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS country_spotlights (code TEXT PRIMARY KEY, generated_at TEXT NOT NULL, status TEXT NOT NULL, provider TEXT, model TEXT, body TEXT NOT NULL, tracking TEXT)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS country_spotlight_history (code TEXT NOT NULL, generated_at TEXT NOT NULL, status TEXT NOT NULL, headline TEXT, likelihoods TEXT NOT NULL, PRIMARY KEY (code, generated_at))`).run();
  ready.add(db);
}

type Row = { code: string; generated_at: string; status: string; provider: string | null; model: string | null; body: string; tracking: string | null };
const toStored = (r: Row): StoredSpotlight => ({
  code: r.code,
  generatedAt: r.generated_at,
  status: r.status as CountryStatus,
  provider: r.provider,
  model: r.model,
  body: JSON.parse(r.body) as Spotlight,
  tracking: r.tracking ? (JSON.parse(r.tracking) as ScenarioTracking[]) : null,
});

export async function getSpotlight(env: Env, code: string): Promise<StoredSpotlight | null> {
  await ensureSpotlightTables(env.DB);
  const r = await env.DB.prepare(`SELECT * FROM country_spotlights WHERE code = ?`).bind(code).first<Row>();
  return r ? toStored(r) : null;
}
export async function listSpotlights(env: Env): Promise<Map<string, StoredSpotlight>> {
  await ensureSpotlightTables(env.DB);
  return new Map(((await env.DB.prepare(`SELECT * FROM country_spotlights`).all<Row>()).results ?? []).map((r) => [r.code, toStored(r)]));
}
export async function spotlightHistory(env: Env, code: string) {
  await ensureSpotlightTables(env.DB);
  const rows = (await env.DB.prepare(`SELECT generated_at, status, headline, likelihoods FROM country_spotlight_history WHERE code = ? ORDER BY generated_at`).bind(code).all<{ generated_at: string; status: string; headline: string | null; likelihoods: string }>()).results ?? [];
  return rows.map((r) => ({ generatedAt: r.generated_at, status: r.status, headline: r.headline, likelihoods: JSON.parse(r.likelihoods) as { id: string; name: string; likelihood: number }[] }));
}

export async function saveSpotlight(env: Env, code: string, status: CountryStatus, a: { body: Spotlight; provider: string; model: string }, now: Date) {
  await ensureSpotlightTables(env.DB);
  const at = now.toISOString();
  await env.DB.prepare(
    `INSERT INTO country_spotlights (code, generated_at, status, provider, model, body, tracking) VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(code) DO UPDATE SET generated_at = excluded.generated_at, status = excluded.status, provider = excluded.provider, model = excluded.model, body = excluded.body, tracking = NULL`
  )
    .bind(code, at, status, a.provider, a.model, JSON.stringify(a.body))
    .run();
  await env.DB.prepare(`INSERT OR REPLACE INTO country_spotlight_history (code, generated_at, status, headline, likelihoods) VALUES (?, ?, ?, ?, ?)`)
    .bind(code, at, status, a.body.headline, JSON.stringify(a.body.scenarios.map((s) => ({ id: s.id, name: s.name, likelihood: s.likelihood }))))
    .run();
}

/** Writes and saves a country's edition now, from the numbers as they stand. */
export async function produceSpotlight(env: Env, code: string, ctx: { status: CountryStatus; trend: string | null; baseline: CountryStatus; note: string | null }, now = new Date()): Promise<boolean> {
  const [m, months, prev, assessed] = await Promise.all([countryMetrics(env, code, now), monthlySeries(env, code), getSpotlight(env, code), getAssessments(env).catch(() => new Map())]);
  if (prev) prev.tracking = (await trackSignposts(env, code, prev.body, prev.generatedAt)).tracking;
  const a = await writeSpotlight(env, m, months, { ...ctx, assessment: assessed.get(code)?.body.bottomLine ?? null }, prev);
  if (!a) return false;
  await saveSpotlight(env, code, ctx.status, a, now);
  return true;
}

/** How long an edition stands, by status. */
const REFRESH_HOURS: Record<CountryStatus, number> = { active: 72, "risk-high": 120, "risk-low": 240, none: 504 };
/** Rewrites per day, at most, so the analyst budget keeps room for incident and country assessments. */
export const SPOTLIGHTS_PER_DAY = 14;
/** First editions (countries with no spotlight yet) per day, and per five-minute tick: counted apart, so every
 *  country the Lens follows gets its first spotlight within a few hours rather than days. */
export const FIRST_EDITIONS_PER_DAY = 50;
const FIRST_EDITIONS_PER_TICK = 2;

export function spotlightDue(prev: StoredSpotlight | undefined, status: CountryStatus, tracking: ScenarioTracking[] | null, at: number): boolean {
  if (!prev) return true;
  const age = (at - Date.parse(prev.generatedAt)) / 3_600_000;
  if (age >= REFRESH_HOURS[status]) return true;
  if (age >= 12 && prev.status !== status) return true;
  const tripped = (tracking ?? []).reduce((n, t) => n + t.seenToward + t.seenAway, 0);
  return age >= 24 && tripped >= 3;
}

/** One step of the schedule: refreshes signpost tracking for every edition and writes the most overdue one. */
export async function runCountrySpotlights(env: Env, candidates: { code: string; status: CountryStatus; trend: string | null; baseline: CountryStatus; note: string | null; n90: number }[], now = new Date()): Promise<string[]> {
  await ensureSpotlightTables(env.DB);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS lens_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();
  const existing = await listSpotlights(env);
  // Keep every edition's signpost tracking current (cheap: no AI).
  for (const s of existing.values()) {
    const { tracking } = await trackSignposts(env, s.code, s.body, s.generatedAt);
    s.tracking = tracking;
    await env.DB.prepare(`UPDATE country_spotlights SET tracking = ? WHERE code = ?`).bind(JSON.stringify(tracking), s.code).run();
  }
  const day = now.toISOString().slice(0, 10);
  const count = async (key: string) => Number((await env.DB.prepare(`SELECT value FROM lens_state WHERE key = ?`).bind(key).first<{ value: string }>())?.value ?? 0);
  const bump = (key: string) => env.DB.prepare(`INSERT INTO lens_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`).bind(key, "1").run();
  const firstKey = `country_spotlights_first:${day}`;
  const refreshKey = `country_spotlights:${day}`;
  const rank: Record<CountryStatus, number> = { active: 3, "risk-high": 2, "risk-low": 1, none: 0 };
  const due = candidates
    .filter((c) => c.status !== "none" || c.n90 > 0)
    .filter((c) => spotlightDue(existing.get(c.code), c.status, existing.get(c.code)?.tracking ?? null, now.getTime()))
    .sort((a, b) => Number(existing.has(a.code)) - Number(existing.has(b.code)) || rank[b.status] - rank[a.status] || b.n90 - a.n90);
  const firsts = due.filter((c) => !existing.has(c.code)).slice(0, Math.max(0, Math.min(FIRST_EDITIONS_PER_TICK, FIRST_EDITIONS_PER_DAY - (await count(firstKey)))));
  const refresh = firsts.length ? [] : due.filter((c) => existing.has(c.code)).slice(0, (await count(refreshKey)) < SPOTLIGHTS_PER_DAY ? 1 : 0);
  const written: string[] = [];
  for (const c of [...firsts, ...refresh]) {
    await bump(existing.has(c.code) ? refreshKey : firstKey);
    if (await produceSpotlight(env, c.code, c, now)) written.push(c.code);
  }
  return written;
}

/** Everything a spotlight page shows: the edition, live signpost tracking, the edition history and the record. */
export async function spotlightPage(env: Env, code: string) {
  const [spot, history, months, metrics] = await Promise.all([getSpotlight(env, code), spotlightHistory(env, code), monthlySeries(env, code), countryMetrics(env, code)]);
  const live = spot ? await trackSignposts(env, code, spot.body, spot.generatedAt) : null;
  return { spotlight: spot, signposts: live, history, months, metrics, scale: LIKELIHOOD_SCALE, refreshHours: REFRESH_HOURS, sinceDays: spot ? Math.round((Date.now() - Date.parse(spot.generatedAt)) / DAY) : null };
}
