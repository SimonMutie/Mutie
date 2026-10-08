import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, batchRun, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { ensureStagingTable, stageIncidents } from "../incidentStaging";
import { incidentInsertStatement } from "./incidents";

export const incidentStagingRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
incidentStagingRouter.use("*", requireAuth, requireAdmin);
incidentStagingRouter.use("*", async (c, next) => {
  await ensureStagingTable(c.env);
  await next();
});

/** One line per day: how many rows are waiting, approved, rejected or already pushed. */
incidentStagingRouter.get("/batches", async (c) => {
  const rows = await all(
    c.env.DB,
    `SELECT batch_date,
            SUM(status = 'pending') AS pending, SUM(status = 'approved') AS approved,
            SUM(status = 'rejected') AS rejected, SUM(status = 'pushed') AS pushed, COUNT(*) AS total
       FROM incident_staging GROUP BY batch_date ORDER BY batch_date DESC LIMIT 120`
  );
  return c.json(rows);
});

incidentStagingRouter.get("/", async (c) => {
  const date = c.req.query("date");
  const status = c.req.query("status");
  const where: string[] = [];
  const params: unknown[] = [];
  if (date) { where.push("batch_date = ?"); params.push(date); }
  if (status) { where.push("status = ?"); params.push(status); }
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, batch_date, status, row_json, source_url, source_title, source_domain, confidence, geo_precision, quote, created_at, reviewed_at, pushed_at
       FROM incident_staging ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY batch_date DESC, created_at LIMIT 5000`,
    params
  );
  return c.json(rows.map((r) => ({ ...r, row: JSON.parse(String(r.row_json)), row_json: undefined })));
});

/** Collects now (instead of waiting for the daily run). `hours` looks back that far, default 24. */
incidentStagingRouter.post("/collect", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const hours = Math.min(Math.max(Number(body?.hours) || 24, 1), 24 * 14);
  const result = await stageIncidents(c.env, { sinceIso: new Date(Date.now() - hours * 3600_000).toISOString() });
  return c.json(result);
});

const patchSchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  row: z.record(z.unknown()).optional(),
});

incidentStagingRouter.patch("/:id", async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const cur = await first<{ row_json: string; status: string }>(c.env.DB, `SELECT row_json, status FROM incident_staging WHERE id = ?`, [c.req.param("id")]);
  if (!cur) return c.json({ error: "Not found" }, 404);
  if (cur.status === "pushed") return c.json({ error: "Already pushed to the database" }, 409);
  const merged = parsed.data.row ? { ...JSON.parse(cur.row_json), ...parsed.data.row } : JSON.parse(cur.row_json);
  const status = parsed.data.status ?? cur.status;
  await run(
    c.env.DB,
    `UPDATE incident_staging SET row_json = ?, status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`,
    [JSON.stringify(merged), status, nowIso(), c.get("userId"), c.req.param("id")]
  );
  return c.json({ ok: true });
});

const idsSchema = z.object({ ids: z.array(z.string()).min(1).max(5000), status: z.enum(["pending", "approved", "rejected"]) });
incidentStagingRouter.post("/set-status", async (c) => {
  const parsed = idsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const { ids, status } = parsed.data;
  await batchRun(
    c.env.DB,
    ids.map((id) => ({ sql: `UPDATE incident_staging SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status != 'pushed'`, params: [status, nowIso(), c.get("userId"), id] }))
  );
  return c.json({ ok: true });
});

/** Pushes every APPROVED row (optionally only those of one day) into the incidents table as one upload batch. */
incidentStagingRouter.post("/push", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const date: string | undefined = typeof body?.date === "string" ? body.date : undefined;
  const rows = await all<{ id: string; row_json: string }>(
    c.env.DB,
    `SELECT id, row_json FROM incident_staging WHERE status = 'approved' ${date ? "AND batch_date = ?" : ""} LIMIT 2000`,
    date ? [date] : []
  );
  if (rows.length === 0) return c.json({ pushed: 0 });
  const ownerId = c.get("userId");
  const batchId = newId();
  const now = nowIso();
  const label = `Daily review ${date ?? now.slice(0, 10)}`;
  const statements = rows.map((r) => {
    const row = JSON.parse(r.row_json);
    return incidentInsertStatement({ ...row, raw: { source: "daily-review", staging_id: r.id } }, ownerId, batchId, now);
  });
  await batchRun(c.env.DB, [
    ...statements,
    { sql: `INSERT INTO incident_uploads (id, owner_id, label, row_count, created_at) VALUES (?,?,?,?,?)`, params: [batchId, ownerId, label, rows.length, now] },
    ...rows.map((r) => ({ sql: `UPDATE incident_staging SET status = 'pushed', pushed_at = ? WHERE id = ?`, params: [now, r.id] })),
  ]);
  return c.json({ pushed: rows.length, batch_id: batchId });
});
