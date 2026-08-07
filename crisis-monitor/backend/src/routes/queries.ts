import { Hono } from "hono";
import { z } from "zod";
import { all, nowIso } from "../db";
import { newId } from "../ids";
import { validateBooleanQuery } from "../booleanQuery";
import { rowToMonitoringQuery } from "../mappers";
import type { Env } from "../bindings";

export const queriesRouter = new Hono<{ Bindings: Env }>();

const createSchema = z.object({
  name: z.string().min(1),
  boolean_query: z.string().min(1),
  category: z.string().default("general"),
  baseline_window_minutes: z.number().int().positive().default(60),
  elevated_threshold: z.number().positive().default(2.5),
  critical_threshold: z.number().positive().default(4.0),
});

queriesRouter.get("/", async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM monitoring_queries ORDER BY created_at DESC");
  return c.json(rows.map(rowToMonitoringQuery));
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
      (id, name, boolean_query, category, baseline_window_minutes, elevated_threshold, critical_threshold, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`,
    [
      id,
      parsed.data.name,
      parsed.data.boolean_query,
      parsed.data.category,
      parsed.data.baseline_window_minutes,
      parsed.data.elevated_threshold,
      parsed.data.critical_threshold,
      now,
      now,
    ]
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
  await c.env.DB.prepare("DELETE FROM monitoring_queries WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});
