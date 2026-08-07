import { Hono } from "hono";
import { all, nowIso } from "../db";
import { rowToAlert } from "../mappers";
import type { Env } from "../bindings";

export const alertsRouter = new Hono<{ Bindings: Env }>();

alertsRouter.get("/", async (c) => {
  const status = c.req.query("status") ?? "open";
  const limit = Math.min(Number(c.req.query("limit")) || 100, 500);

  let where = "";
  if (status === "open") where = "WHERE a.resolved_at IS NULL";
  else if (status === "resolved") where = "WHERE a.resolved_at IS NOT NULL";

  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.*, q.name AS query_name, q.category
     FROM alerts a LEFT JOIN monitoring_queries q ON q.id = a.query_id
     ${where} ORDER BY a.created_at DESC LIMIT ?`,
    [limit]
  );
  return c.json(rows.map(rowToAlert));
});

alertsRouter.patch("/:id/acknowledge", async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    "UPDATE alerts SET acknowledged_at = ? WHERE id = ? RETURNING *",
    [nowIso(), c.req.param("id")]
  );
  if (rows.length === 0) return c.json({ error: "Alert not found" }, 404);
  return c.json(rowToAlert(rows[0]));
});

alertsRouter.patch("/:id/resolve", async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, "UPDATE alerts SET resolved_at = ? WHERE id = ? RETURNING *", [
    nowIso(),
    c.req.param("id"),
  ]);
  if (rows.length === 0) return c.json({ error: "Alert not found" }, 404);
  return c.json(rowToAlert(rows[0]));
});
