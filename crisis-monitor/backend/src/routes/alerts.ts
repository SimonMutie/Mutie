import { Hono } from "hono";
import { all, nowIso } from "../db";
import { rowToAlert } from "../mappers";
import { canAccessQuery, canAccessAlert } from "../ownership";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const alertsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

alertsRouter.use("*", requireAuth);

alertsRouter.get("/", async (c) => {
  const status = c.req.query("status") ?? "open";
  const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
  const queryId = c.req.query("query_id") ?? null;
  const isAdmin = c.get("role") === "admin";

  if (!queryId && !isAdmin) {
    return c.json({ error: "query_id is required" }, 400);
  }
  if (queryId && !(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
    return c.json({ error: "Query not found" }, 404);
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status === "open") conditions.push("a.resolved_at IS NULL");
  else if (status === "resolved") conditions.push("a.resolved_at IS NOT NULL");

  if (queryId) {
    conditions.push("a.query_id = ?");
    params.push(queryId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.*, q.name AS query_name, q.category
     FROM alerts a LEFT JOIN monitoring_queries q ON q.id = a.query_id
     ${where} ORDER BY a.created_at DESC LIMIT ?`,
    params
  );
  return c.json(rows.map(rowToAlert));
});

alertsRouter.patch("/:id/acknowledge", async (c) => {
  const id = c.req.param("id");
  if (!(await canAccessAlert(c.env, c.get("userId"), c.get("role"), id))) {
    return c.json({ error: "Alert not found" }, 404);
  }
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    "UPDATE alerts SET acknowledged_at = ? WHERE id = ? RETURNING *",
    [nowIso(), id]
  );
  if (rows.length === 0) return c.json({ error: "Alert not found" }, 404);
  return c.json(rowToAlert(rows[0]));
});

alertsRouter.patch("/:id/resolve", async (c) => {
  const id = c.req.param("id");
  if (!(await canAccessAlert(c.env, c.get("userId"), c.get("role"), id))) {
    return c.json({ error: "Alert not found" }, 404);
  }
  const rows = await all<Record<string, unknown>>(c.env.DB, "UPDATE alerts SET resolved_at = ? WHERE id = ? RETURNING *", [
    nowIso(),
    id,
  ]);
  if (rows.length === 0) return c.json({ error: "Alert not found" }, 404);
  return c.json(rowToAlert(rows[0]));
});
