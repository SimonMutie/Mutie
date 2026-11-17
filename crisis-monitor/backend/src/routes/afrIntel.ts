import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso, run as dbRun } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { advance, askRun, assist, type AfrIntelRun } from "../lib/afrIntel";

/**
 * AfrIntel: the prediction engine and the talk-to-the-map assistant (lib/afrIntel.ts). A forecast run is stored as one JSON
 * document and advanced one model call at a time by POST /runs/:id/step, which the page calls until the run is done.
 */
export const afrIntelRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
afrIntelRouter.use("*", requireAuth);

let ready = false;
async function ensureTable(env: Env) {
  if (ready) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS afrintel_runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, question TEXT NOT NULL, stage TEXT NOT NULL, data TEXT NOT NULL, busy_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  ).run();
  // Runs saved before the engine was renamed (Nov 2026) are moved across once, then the old table is dropped.
  const old = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'oi_runs'`).first();
  if (old) {
    await env.DB.prepare(`INSERT OR IGNORE INTO afrintel_runs SELECT id, owner, question, stage, data, busy_until, created_at, updated_at FROM oi_runs`).run();
    await env.DB.prepare(`DROP TABLE oi_runs`).run();
  }
  ready = true;
}

async function load(env: Env, id: string, owner: string): Promise<AfrIntelRun | null> {
  const row = await first<{ data: string; owner: string }>(env.DB, `SELECT data, owner FROM afrintel_runs WHERE id = ?`, [id]);
  if (!row || row.owner !== owner) return null;
  return JSON.parse(row.data) as AfrIntelRun;
}

async function save(env: Env, r: AfrIntelRun, busyUntil: string | null = null) {
  await dbRun(env.DB, `UPDATE afrintel_runs SET stage = ?, data = ?, busy_until = ?, updated_at = ? WHERE id = ?`, [r.stage, JSON.stringify(r), busyUntil, r.updatedAt, r.id]);
}

const createSchema = z.object({
  question: z.string().trim().min(8).max(500),
  material: z.string().max(100_000).optional().default(""),
  worlds: z.number().int().min(1).max(5).optional().default(3),
  periods: z.number().int().min(2).max(6).optional().default(3),
});

afrIntelRouter.post("/runs", async (c) => {
  await ensureTable(c.env);
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "A question of 8 to 500 characters is needed." }, 400);
  const now = nowIso();
  const r: AfrIntelRun = {
    id: newId(), owner: c.get("userId"), question: parsed.data.question, material: parsed.data.material, worldCount: parsed.data.worlds, periodCount: parsed.data.periods,
    stage: "context", createdAt: now, updatedAt: now, context: [], frame: null, actors: [], links: [], periods: [], worlds: [], injects: [], report: null, pooled: null, error: null, model: null, chat: [],
  };
  await dbRun(c.env.DB, `INSERT INTO afrintel_runs (id, owner, question, stage, data, busy_until, created_at, updated_at) VALUES (?,?,?,?,?,NULL,?,?)`, [r.id, r.owner, r.question, r.stage, JSON.stringify(r), now, now]);
  return c.json(r);
});

afrIntelRouter.get("/runs", async (c) => {
  await ensureTable(c.env);
  const rows = await all<{ id: string; question: string; stage: string; created_at: string; updated_at: string }>(c.env.DB, `SELECT id, question, stage, created_at, updated_at FROM afrintel_runs WHERE owner = ? ORDER BY created_at DESC LIMIT 50`, [c.get("userId")]);
  return c.json({ runs: rows });
});

afrIntelRouter.get("/runs/:id", async (c) => {
  await ensureTable(c.env);
  const r = await load(c.env, c.req.param("id"), c.get("userId"));
  return r ? c.json(r) : c.json({ error: "not found" }, 404);
});

afrIntelRouter.delete("/runs/:id", async (c) => {
  await ensureTable(c.env);
  await dbRun(c.env.DB, `DELETE FROM afrintel_runs WHERE id = ? AND owner = ?`, [c.req.param("id"), c.get("userId")]);
  return c.json({ ok: true });
});

/** Advances a run by one step. A step already in progress (another tab) is not run twice. */
afrIntelRouter.post("/runs/:id/step", async (c) => {
  await ensureTable(c.env);
  const id = c.req.param("id");
  const r = await load(c.env, id, c.get("userId"));
  if (!r) return c.json({ error: "not found" }, 404);
  if (r.stage === "done" || r.stage === "failed") return c.json(r);
  const now = new Date();
  const claimed = await c.env.DB.prepare(`UPDATE afrintel_runs SET busy_until = ? WHERE id = ? AND (busy_until IS NULL OR busy_until < ?)`).bind(new Date(now.getTime() + 120_000).toISOString(), id, now.toISOString()).run();
  if (!claimed.meta?.changes) return c.json({ ...r, busy: true });
  try {
    const next = await advance(c.env, { ...r, error: null }, now);
    await save(c.env, next);
    return c.json(next);
  } catch (err) {
    const failed = { ...r, error: err instanceof Error ? err.message : String(err), updatedAt: nowIso() };
    await save(c.env, failed);
    return c.json(failed);
  }
});

/** An event the analyst injects: it happens in every world from the next period not yet played. */
afrIntelRouter.post("/runs/:id/inject", async (c) => {
  await ensureTable(c.env);
  const r = await load(c.env, c.req.param("id"), c.get("userId"));
  if (!r) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text ?? "").trim().slice(0, 400);
  if (!text) return c.json({ error: "Say what happens." }, 400);
  if (r.stage === "done" || r.stage === "report") return c.json({ error: "The simulation has finished; start a new run to test this event." }, 400);
  const played = r.worlds.length ? Math.min(...r.worlds.map((w) => w.periods.length)) : 0;
  r.injects.push({ text, fromPeriod: played, at: nowIso() });
  r.updatedAt = nowIso();
  await save(c.env, r);
  return c.json(r);
});

/** A question to the report agent ("report") or to one actor (its id), after the run. */
afrIntelRouter.post("/runs/:id/ask", async (c) => {
  await ensureTable(c.env);
  const r = await load(c.env, c.req.param("id"), c.get("userId"));
  if (!r) return c.json({ error: "not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { target?: string; message?: string };
  const message = String(body.message ?? "").trim().slice(0, 1000);
  if (!message) return c.json({ error: "Ask something." }, 400);
  const target = String(body.target ?? "report");
  const answer = await askRun(c.env, r, target, message);
  const at = nowIso();
  r.chat.push({ role: "user", target, text: message, at }, { role: "afrintel", target, text: answer, at });
  r.updatedAt = at;
  await save(c.env, r);
  return c.json(r);
});

const assistSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  layers: z.array(z.object({ key: z.string(), label: z.string(), group: z.string() })).max(200),
  view: z.object({ lat: z.number(), lng: z.number(), zoom: z.number() }).nullable().optional(),
});

afrIntelRouter.post("/assist", async (c) => {
  const parsed = assistSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Say what you want the map to do." }, 400);
  return c.json(await assist(c.env, parsed.data.message, parsed.data.layers, parsed.data.view ?? null));
});
