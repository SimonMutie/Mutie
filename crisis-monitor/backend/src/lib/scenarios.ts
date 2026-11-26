import type { Env } from "../bindings";

/**
 * Scenarios: questions about how a situation could develop, written by Afrilens analysts and placed on the map as
 * numbered markers. Each has the analyst's assessment, its likelihood on the probability yardstick, a time horizon,
 * the indicators to watch and the outlook.
 */

export const LIKELIHOODS = ["remote", "highly-unlikely", "unlikely", "realistic-possibility", "likely", "highly-likely", "almost-certain"] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

export interface Scenario {
  id: string;
  num: number;
  question: string;
  lat: number;
  lng: number;
  place: string | null;
  likelihood: Likelihood | null;
  horizon: string | null;
  assessment: string | null;
  indicators: string[];
  outlook: string | null;
  updatedAt: string;
}

const ready = new WeakSet<D1Database>();
export async function ensureScenarioTable(db: D1Database) {
  if (ready.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, num INTEGER NOT NULL, question TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, place TEXT, likelihood TEXT, horizon TEXT, assessment TEXT, indicators TEXT, outlook TEXT, updated_by TEXT, updated_at TEXT NOT NULL)`
    )
    .run();
  ready.add(db);
}

interface Row {
  id: string;
  num: number;
  question: string;
  lat: number;
  lng: number;
  place: string | null;
  likelihood: string | null;
  horizon: string | null;
  assessment: string | null;
  indicators: string | null;
  outlook: string | null;
  updated_at: string;
}
const toScenario = (r: Row): Scenario => ({
  id: r.id,
  num: r.num,
  question: r.question,
  lat: r.lat,
  lng: r.lng,
  place: r.place,
  likelihood: (LIKELIHOODS as readonly string[]).includes(r.likelihood ?? "") ? (r.likelihood as Likelihood) : null,
  horizon: r.horizon,
  assessment: r.assessment,
  indicators: (r.indicators ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
  outlook: r.outlook,
  updatedAt: r.updated_at,
});

export async function listScenarios(env: Env): Promise<Scenario[]> {
  await ensureScenarioTable(env.DB);
  return ((await env.DB.prepare(`SELECT * FROM scenarios ORDER BY num, updated_at`).all<Row>()).results ?? []).map(toScenario);
}

export interface ScenarioInput {
  question: string;
  lat: number;
  lng: number;
  place?: string | null;
  likelihood?: Likelihood | null;
  horizon?: string | null;
  assessment?: string | null;
  indicators?: string[];
  outlook?: string | null;
  num?: number;
}

/** Adds a scenario, numbered after the last one unless a number is given. */
export async function createScenario(env: Env, s: ScenarioInput, by: string, now: string): Promise<Scenario> {
  await ensureScenarioTable(env.DB);
  const id = crypto.randomUUID();
  const max = await env.DB.prepare(`SELECT COALESCE(MAX(num), 0) AS n FROM scenarios`).first<{ n: number }>();
  const num = s.num ?? (max?.n ?? 0) + 1;
  await env.DB.prepare(
    `INSERT INTO scenarios (id, num, question, lat, lng, place, likelihood, horizon, assessment, indicators, outlook, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, num, s.question, s.lat, s.lng, s.place ?? null, s.likelihood ?? null, s.horizon ?? null, s.assessment ?? null, (s.indicators ?? []).join("\n"), s.outlook ?? null, by, now)
    .run();
  return (await listScenarios(env)).find((x) => x.id === id)!;
}

export async function updateScenario(env: Env, id: string, s: ScenarioInput, by: string, now: string): Promise<boolean> {
  await ensureScenarioTable(env.DB);
  const r = await env.DB.prepare(
    `UPDATE scenarios SET question = ?, lat = ?, lng = ?, place = ?, likelihood = ?, horizon = ?, assessment = ?, indicators = ?, outlook = ?, num = COALESCE(?, num), updated_by = ?, updated_at = ? WHERE id = ?`
  )
    .bind(s.question, s.lat, s.lng, s.place ?? null, s.likelihood ?? null, s.horizon ?? null, s.assessment ?? null, (s.indicators ?? []).join("\n"), s.outlook ?? null, s.num ?? null, by, now, id)
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function deleteScenario(env: Env, id: string): Promise<boolean> {
  await ensureScenarioTable(env.DB);
  const r = await env.DB.prepare(`DELETE FROM scenarios WHERE id = ?`).bind(id).run();
  return (r.meta?.changes ?? 0) > 0;
}
