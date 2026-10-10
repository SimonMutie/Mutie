import type { Context } from "hono";
import type { Env } from "../bindings";
import type { AuthedVariables } from "../middleware";
import { first, run } from "../db";

/**
 * Monthly allowances for the actions that cost money or upstream goodwill.
 *
 * Counted per client organisation (or per login for a standalone account), so
 * a client's team shares one allowance. The platform admin is never limited.
 * Defaults live here; a client's own limits, set by the admin, override them
 * through clients.quota_json.
 */
export type QuotaKind = "ai_summary" | "ai_notebook" | "due_diligence";

export const DEFAULT_MONTHLY_LIMITS: Record<QuotaKind, number> = {
  ai_summary: 60,
  ai_notebook: 30,
  due_diligence: 30,
};

/** Ceilings on what a client may keep on the platform at once. */
export type StockKind = "monitoring_queries" | "listening_queries" | "dataset_rows" | "incidents";

export const DEFAULT_STOCK_LIMITS: Record<StockKind, number> = {
  monitoring_queries: 25,
  listening_queries: 25,
  dataset_rows: 250_000,
  incidents: 150_000,
};

export const QUOTA_LABELS: Record<QuotaKind | StockKind, string> = {
  ai_summary: "AI day summaries per month",
  ai_notebook: "AI notebook drafts per month",
  due_diligence: "Due-diligence screenings per month",
  monitoring_queries: "Monitoring queries kept",
  listening_queries: "Social-listening searches kept",
  dataset_rows: "Dataset rows stored",
  incidents: "Incidents stored",
};

type Ctx = Context<{ Bindings: Env; Variables: AuthedVariables }>;

export interface QuotaScope {
  /** Counter key: the client id, or the login id for a standalone account. */
  key: string;
  clientId: string | null;
  limits: Partial<Record<QuotaKind | StockKind, number>>;
}

let tableReady: Promise<unknown> | null = null;
function ensureTable(env: Env) {
  if (!tableReady) {
    tableReady = env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS usage_counters (scope TEXT NOT NULL, kind TEXT NOT NULL, month TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (scope, kind, month))`
    )
      .run()
      .catch((err) => {
        tableReady = null;
        throw err;
      });
  }
  return tableReady;
}

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export async function scopeFor(env: Env, userId: string): Promise<QuotaScope> {
  let row: { client_id: string | null; quota_json: string | null } | null = null;
  try {
    row = await first<{ client_id: string | null; quota_json: string | null }>(
      env.DB,
      `SELECT u.client_id AS client_id, c.quota_json AS quota_json FROM users u LEFT JOIN clients c ON u.client_id = c.id WHERE u.id = ?`,
      [userId]
    );
  } catch {
    row = await first<{ client_id: string | null; quota_json: string | null }>(env.DB, `SELECT client_id, NULL AS quota_json FROM users WHERE id = ?`, [userId]);
  }
  let limits: QuotaScope["limits"] = {};
  try {
    if (row?.quota_json) limits = JSON.parse(row.quota_json) as QuotaScope["limits"];
  } catch {
    limits = {};
  }
  return { key: row?.client_id ?? userId, clientId: row?.client_id ?? null, limits };
}

export function limitFor(scope: QuotaScope, kind: QuotaKind | StockKind): number {
  const custom = scope.limits[kind];
  if (typeof custom === "number" && custom >= 0) return custom;
  return (DEFAULT_MONTHLY_LIMITS as Record<string, number>)[kind] ?? (DEFAULT_STOCK_LIMITS as Record<string, number>)[kind];
}

/** Uses one unit of a monthly allowance. Returns a 429 response when it is
 *  spent, or null when the action may go ahead. */
export async function consumeQuota(c: Ctx, kind: QuotaKind, now = new Date()): Promise<Response | null> {
  if (c.get("role") === "admin") return null;
  await ensureTable(c.env);
  const scope = await scopeFor(c.env, c.get("userId"));
  const limit = limitFor(scope, kind);
  const month = monthKey(now);
  await run(c.env.DB, `INSERT INTO usage_counters (scope, kind, month, n) VALUES (?,?,?,0) ON CONFLICT(scope, kind, month) DO NOTHING`, [scope.key, kind, month]);
  const res = await c.env.DB.prepare(`UPDATE usage_counters SET n = n + 1 WHERE scope = ? AND kind = ? AND month = ? AND n < ? RETURNING n`)
    .bind(scope.key, kind, month, limit)
    .all();
  if (res.results && res.results.length > 0) return null;
  return c.json(
    { error: `Your monthly allowance for this (${QUOTA_LABELS[kind].toLowerCase()}: ${limit}) has been used. It renews on the 1st; contact your Afrilens representative for more.` },
    429
  );
}

/** Refuses to add to something that is already at its ceiling. */
export async function checkStock(c: Ctx, kind: StockKind, current: number, adding = 1): Promise<Response | null> {
  if (c.get("role") === "admin") return null;
  const scope = await scopeFor(c.env, c.get("userId"));
  const limit = limitFor(scope, kind);
  if (current + adding <= limit) return null;
  return c.json({ error: `That would go over your limit (${QUOTA_LABELS[kind].toLowerCase()}: ${limit}). Remove some first or ask your Afrilens representative to raise it.` }, 429);
}

export async function usageFor(env: Env, clientId: string): Promise<{ kind: QuotaKind; label: string; used: number; limit: number }[]> {
  await ensureTable(env);
  const row = await first<{ quota_json: string | null }>(env.DB, `SELECT quota_json FROM clients WHERE id = ?`, [clientId]).catch(() => null);
  let limits: QuotaScope["limits"] = {};
  try {
    if (row?.quota_json) limits = JSON.parse(row.quota_json);
  } catch {
    limits = {};
  }
  const scope: QuotaScope = { key: clientId, clientId, limits };
  const month = monthKey();
  const out: { kind: QuotaKind; label: string; used: number; limit: number }[] = [];
  for (const kind of Object.keys(DEFAULT_MONTHLY_LIMITS) as QuotaKind[]) {
    const r = await first<{ n: number }>(env.DB, `SELECT n FROM usage_counters WHERE scope = ? AND kind = ? AND month = ?`, [clientId, kind, month]);
    out.push({ kind, label: QUOTA_LABELS[kind], used: r?.n ?? 0, limit: limitFor(scope, kind) });
  }
  return out;
}

/** Best-effort request limiter, per login, per isolate. It stops a runaway
 *  script or a shared password being used to drain the service; it is not a
 *  precise global counter. */
const windows = new Map<string, { start: number; n: number }>();
export const REQUESTS_PER_MINUTE = 300;

export function rateLimited(userId: string, role: string, now = Date.now()): boolean {
  if (role === "admin") return false;
  const w = windows.get(userId);
  if (!w || now - w.start >= 60_000) {
    if (windows.size > 5000) windows.clear();
    windows.set(userId, { start: now, n: 1 });
    return false;
  }
  w.n += 1;
  return w.n > REQUESTS_PER_MINUTE;
}
