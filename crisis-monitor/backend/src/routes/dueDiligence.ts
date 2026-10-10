import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { requireAuth, type AuthedVariables } from "../middleware";
import { consumeQuota } from "../lib/quota";
import { runDueDiligence, type DdResult } from "../lib/dd/run";
import { LIST_SOURCES, listStatuses, refreshList, type ListId } from "../lib/dd/sanctionsLists";
import type { Env } from "../bindings";

/**
 * Due-diligence screening of organisations and public figures. Cases are
 * private to the person who ran them. Scope is deliberately narrow: names of
 * companies and public officials, sanctions, public office, ownership
 * records and adverse media. No address, phone or private-individual dossiers.
 */
export const dueDiligenceRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
dueDiligenceRouter.use("*", requireAuth);

const DEFAULT_RUNS_PER_DAY = 40;
let ready = false;
export function resetDdTableCheck() {
  ready = false;
}
async function ensureTable(env: Env) {
  if (ready) return;
  await run(
    env.DB,
    `CREATE TABLE IF NOT EXISTS due_diligence_cases (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, subject_type TEXT NOT NULL, country TEXT,
      aliases TEXT, identifiers TEXT, reference TEXT, outcome TEXT NOT NULL, result TEXT NOT NULL, summary TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  );
  await run(env.DB, "CREATE INDEX IF NOT EXISTS idx_dd_owner ON due_diligence_cases (owner_id, created_at)");
  ready = true;
}

let reportReady = false;
async function ensureReportTable(env: Env) {
  if (reportReady) return;
  await run(env.DB, "CREATE TABLE IF NOT EXISTS due_diligence_reports (case_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)");
  reportReady = true;
}

const runSchema = z.object({
  name: z.string().trim().min(2).max(200),
  subject_type: z.enum(["person", "entity"]),
  country: z.string().trim().max(80).optional(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(4).optional(),
  identifiers: z.string().trim().max(500).optional(),
  reference: z.string().trim().max(120).optional(),
});

const newId = () => `dd_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

dueDiligenceRouter.get("/sources/status", async (c) => {
  return c.json({ sanctions: await listStatuses(c.env), companies_house: !!c.env.COMPANIES_HOUSE_API_KEY });
});

/** Downloads one sanctions list now (one per request, so each stays within limits). The daily background run does this too. */
dueDiligenceRouter.post("/sources/refresh", async (c) => {
  const id = String((await c.req.json().catch(() => ({})) as { list?: string }).list ?? "");
  const src = LIST_SOURCES.find((s) => s.id === id);
  if (!src) return c.json({ error: "Unknown list" }, 400);
  try {
    const r = await refreshList(c.env, src.id as ListId);
    return c.json({ ok: true, entries: r.entries });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

dueDiligenceRouter.get("/", async (c) => {
  await ensureTable(c.env);
  const rows = await all<{ id: string; name: string; subject_type: string; country: string | null; reference: string | null; outcome: string; summary: string | null; created_at: string }>(
    c.env.DB,
    "SELECT id, name, subject_type, country, reference, outcome, summary, created_at FROM due_diligence_cases WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100",
    [c.get("userId")]
  );
  return c.json({ cases: rows });
});

dueDiligenceRouter.post("/", async (c) => {
  await ensureTable(c.env);
  const parsed = runSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Enter a name of at least two characters." }, 400);
  const d = parsed.data;

  const cap = Math.max(0, Number(c.env.DUE_DILIGENCE_RUNS_PER_DAY ?? DEFAULT_RUNS_PER_DAY) || 0);
  const today = await first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM due_diligence_cases WHERE created_at >= ?", [`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`]);
  if (Number(today?.n ?? 0) >= cap) return c.json({ error: `Today's ${cap} screenings have been used. More can be run after 03:00 Nairobi time.` }, 429);

  const over = await consumeQuota(c, "due_diligence");
  if (over) return over;

  let result;
  try {
    result = await runDueDiligence(c.env, {
      name: d.name,
      kind: d.subject_type,
      country: d.country || null,
      aliases: d.aliases ?? [],
      identifiers: d.identifiers || null,
    });
  } catch (err) {
    console.error("[dd] screening failed:", err);
    return c.json({ error: `The screening failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
  const id = newId();
  const now = nowIso();
  await run(c.env.DB, "INSERT INTO due_diligence_cases (id, owner_id, name, subject_type, country, aliases, identifiers, reference, outcome, result, summary, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [
    id, c.get("userId"), d.name, d.subject_type, d.country || null, JSON.stringify(d.aliases ?? []), d.identifiers || null, d.reference || null, result.outcome, JSON.stringify(result), result.summary.text, now, now,
  ]);
  return c.json({ id, name: d.name, subject_type: d.subject_type, reference: d.reference ?? null, created_at: now, result }, 201);
});

dueDiligenceRouter.get("/:id", async (c) => {
  await ensureTable(c.env);
  const row = await first<{ id: string; name: string; subject_type: string; reference: string | null; created_at: string; result: string }>(c.env.DB, "SELECT * FROM due_diligence_cases WHERE id = ? AND owner_id = ?", [c.req.param("id"), c.get("userId")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ id: row.id, name: row.name, subject_type: row.subject_type, reference: row.reference, created_at: row.created_at, result: JSON.parse(row.result) as DdResult });
});

/** The editable commercial due-diligence report built on a screening. Stored as one JSON document; the screen owns its structure. */
const MAX_REPORT_BYTES = 1_500_000;
dueDiligenceRouter.get("/:id/report", async (c) => {
  await ensureTable(c.env);
  await ensureReportTable(c.env);
  const own = await first<{ id: string }>(c.env.DB, "SELECT id FROM due_diligence_cases WHERE id = ? AND owner_id = ?", [c.req.param("id"), c.get("userId")]);
  if (!own) return c.json({ error: "Not found" }, 404);
  const row = await first<{ data: string; updated_at: string }>(c.env.DB, "SELECT data, updated_at FROM due_diligence_reports WHERE case_id = ?", [own.id]);
  return c.json(row ? { report: JSON.parse(row.data), updated_at: row.updated_at } : { report: null, updated_at: null });
});

dueDiligenceRouter.put("/:id/report", async (c) => {
  await ensureTable(c.env);
  await ensureReportTable(c.env);
  const own = await first<{ id: string }>(c.env.DB, "SELECT id FROM due_diligence_cases WHERE id = ? AND owner_id = ?", [c.req.param("id"), c.get("userId")]);
  if (!own) return c.json({ error: "Not found" }, 404);
  const text = await c.req.text();
  if (text.length > MAX_REPORT_BYTES) return c.json({ error: "The report is too large to save." }, 413);
  let body: { report?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: "Invalid report" }, 400);
  }
  if (!body.report || typeof body.report !== "object" || !Array.isArray((body.report as { sections?: unknown }).sections)) return c.json({ error: "Invalid report" }, 400);
  const now = nowIso();
  await run(c.env.DB, "INSERT INTO due_diligence_reports (case_id, owner_id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(case_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at", [own.id, c.get("userId"), JSON.stringify(body.report), now]);
  return c.json({ ok: true, updated_at: now });
});

dueDiligenceRouter.delete("/:id", async (c) => {
  await ensureTable(c.env);
  await ensureReportTable(c.env);
  await run(c.env.DB, "DELETE FROM due_diligence_reports WHERE case_id = ? AND owner_id = ?", [c.req.param("id"), c.get("userId")]);
  await run(c.env.DB, "DELETE FROM due_diligence_cases WHERE id = ? AND owner_id = ?", [c.req.param("id"), c.get("userId")]);
  return c.body(null, 204);
});
