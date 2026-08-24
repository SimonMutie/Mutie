import { Hono } from "hono";
import { z } from "zod";
import { all, nowIso } from "../db";
import { newId } from "../ids";
import { validateBooleanQuery, parseBooleanQuery, evaluate } from "../booleanQuery";
import { rowToMonitoringQuery } from "../mappers";
import { canAccessQuery } from "../ownership";
import { backfillQueryMatches } from "../ingest";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const queriesRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

queriesRouter.use("*", requireAuth);

const createSchema = z.object({
  name: z.string().min(1),
  boolean_query: z.string().min(1),
  category: z.string().default("general"),
  baseline_window_minutes: z.number().int().positive().default(60),
  elevated_threshold: z.number().positive().default(2.5),
  critical_threshold: z.number().positive().default(4.0),
});

/** Admins see every query (including unowned "house" ones); clients see only their own. Includes a 2h match count for the query list UI. */
queriesRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const twoHoursAgo = new Date(Date.now() - 120 * 60_000).toISOString();

  const baseSql = `
    SELECT q.*, COUNT(qm.id) AS match_count
    FROM monitoring_queries q
    LEFT JOIN query_matches qm ON qm.query_id = q.id AND qm.matched_at > ?
    ${isAdmin ? "" : "WHERE q.owner_id = ?"}
    GROUP BY q.id
    ORDER BY q.created_at DESC
  `;
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    baseSql,
    isAdmin ? [twoHoursAgo] : [twoHoursAgo, c.get("userId")]
  );
  return c.json(rows.map((row) => ({ ...rowToMonitoringQuery(row), match_count: Number(row.match_count ?? 0) })));
});

queriesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const validationError = validateBooleanQuery(parsed.data.boolean_query);
  if (validationError) {
    return c.json({ error: `Invalid boolean query: ${validationError}` }, 400);
  }

  const id = newId();
  const now = nowIso();
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `INSERT INTO monitoring_queries
      (id, name, boolean_query, category, baseline_window_minutes, elevated_threshold, critical_threshold, owner_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [
      id,
      parsed.data.name,
      parsed.data.boolean_query,
      parsed.data.category,
      parsed.data.baseline_window_minutes,
      parsed.data.elevated_threshold,
      parsed.data.critical_threshold,
      c.get("userId"),
      now,
      now,
    ]
  );

  // Backfill in the background so query creation itself stays fast — the
  // client's next poll of the query list / dashboard picks up the matches.
  c.executionCtx.waitUntil(
    backfillQueryMatches(c.env, id, parsed.data.boolean_query).catch((err) =>
      console.error(`[backfill] failed for query ${id}:`, err)
    )
  );

  return c.json(rowToMonitoringQuery(rows[0]), 201);
});

queriesRouter.post("/validate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const booleanQuery = (body as Record<string, unknown>)?.boolean_query;
  if (typeof booleanQuery !== "string") {
    return c.json({ error: "boolean_query must be a string" }, 400);
  }
  const error = validateBooleanQuery(booleanQuery);
  return c.json({ valid: error === null, error });
});

const PREVIEW_LOOKBACK_HOURS = 72;
const PREVIEW_SCAN_LIMIT = 3000; // how many recent events to scan
const PREVIEW_RESULT_LIMIT = 20; // how many matches to actually return

/** Read-only: runs a boolean query against recent events without creating a
 *  monitoring query or writing anything, so the editor's live-preview panel
 *  can show sample matches as the person types — same evaluate() logic used
 *  for real ingestion/backfill, just not persisted. */
queriesRouter.post("/preview", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const booleanQuery = (body as Record<string, unknown>)?.boolean_query;
  if (typeof booleanQuery !== "string" || booleanQuery.trim().length === 0) {
    return c.json({ error: "boolean_query must be a non-empty string" }, 400);
  }

  let parsed;
  try {
    parsed = parseBooleanQuery(booleanQuery);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Invalid boolean query" }, 400);
  }

  const cutoff = new Date(Date.now() - PREVIEW_LOOKBACK_HOURS * 60 * 60_000).toISOString();
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, source_type, title, content, url, author, published_at, geo_label
     FROM events WHERE published_at > ? ORDER BY published_at DESC LIMIT ?`,
    [cutoff, PREVIEW_SCAN_LIMIT]
  );

  const matches: Record<string, unknown>[] = [];
  let scanned = 0;
  for (const row of rows) {
    scanned++;
    const fields = {
      content: String(row.content ?? ""),
      title: (row.title as string | null) ?? null,
      url: (row.url as string | null) ?? null,
      domain: (row.author as string | null) ?? null,
    };
    if (evaluate(parsed, fields)) {
      matches.push({
        id: row.id,
        source_type: row.source_type,
        title: row.title,
        content: row.content,
        url: row.url,
        published_at: row.published_at,
        geo_label: row.geo_label,
      });
      if (matches.length >= PREVIEW_RESULT_LIMIT) break;
    }
  }

  return c.json({
    matches,
    scanned,
    lookback_hours: PREVIEW_LOOKBACK_HOURS,
    truncated: matches.length >= PREVIEW_RESULT_LIMIT,
  });
});

const PATCHABLE_FIELDS = [
  "name",
  "boolean_query",
  "category",
  "is_active",
  "baseline_window_minutes",
  "elevated_threshold",
  "critical_threshold",
] as const;

queriesRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), id))) {
    return c.json({ error: "Query not found" }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of PATCHABLE_FIELDS) {
    if (field in body) {
      if (field === "boolean_query") {
        const err = validateBooleanQuery(String(body.boolean_query));
        if (err) return c.json({ error: `Invalid boolean query: ${err}` }, 400);
      }
      updates.push(`${field} = ?`);
      values.push(field === "is_active" ? (body[field] ? 1 : 0) : body[field]);
    }
  }
  if (updates.length === 0) return c.json({ error: "No valid fields to update" }, 400);

  updates.push("updated_at = ?");
  values.push(nowIso());
  values.push(id);

  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `UPDATE monitoring_queries SET ${updates.join(", ")} WHERE id = ? RETURNING *`,
    values
  );
  if (rows.length === 0) return c.json({ error: "Query not found" }, 404);
  return c.json(rowToMonitoringQuery(rows[0]));
});

queriesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), id))) {
    return c.json({ error: "Query not found" }, 404);
  }
  await c.env.DB.prepare("DELETE FROM monitoring_queries WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
