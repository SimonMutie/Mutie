import { Hono } from "hono";
import { all, isoMinutesAgo } from "../db";
import { rowToEvent } from "../mappers";
import { canAccessQuery } from "../ownership";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const eventsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

eventsRouter.use("*", requireAuth);

eventsRouter.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
  const sourceType = c.req.query("source_type") ?? null;
  const queryId = c.req.query("query_id") ?? null;
  const isAdmin = c.get("role") === "admin";

  // Non-admins only ever see events matched to a query they own — never the raw, unscoped firehose.
  if (!queryId && !isAdmin) {
    return c.json({ error: "query_id is required" }, 400);
  }

  if (queryId) {
    if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
      return c.json({ error: "Query not found" }, 404);
    }
    const rows = await all<Record<string, unknown>>(
      c.env.DB,
      `SELECT e.* FROM events e
       JOIN query_matches qm ON qm.event_id = e.id
       WHERE qm.query_id = ?
       ORDER BY e.published_at DESC LIMIT ?`,
      [queryId, limit]
    );
    return c.json(rows.map(rowToEvent));
  }

  if (sourceType) {
    const rows = await all<Record<string, unknown>>(
      c.env.DB,
      "SELECT * FROM events WHERE source_type = ? ORDER BY published_at DESC LIMIT ?",
      [sourceType, limit]
    );
    return c.json(rows.map(rowToEvent));
  }

  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM events ORDER BY published_at DESC LIMIT ?", [limit]);
  return c.json(rows.map(rowToEvent));
});

eventsRouter.get("/geo", async (c) => {
  const minutes = Math.min(Number(c.req.query("minutes")) || 120, 1440);
  const queryId = c.req.query("query_id") ?? null;
  const isAdmin = c.get("role") === "admin";
  const cutoff = isoMinutesAgo(minutes);

  if (!queryId && !isAdmin) {
    return c.json({ error: "query_id is required" }, 400);
  }

  if (queryId) {
    if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
      return c.json({ error: "Query not found" }, 404);
    }
    const rows = await all<Record<string, unknown>>(
      c.env.DB,
      `SELECT e.id, e.source_type, e.content, e.geo_lat, e.geo_lng, e.geo_label, e.sentiment, e.published_at
       FROM events e JOIN query_matches qm ON qm.event_id = e.id
       WHERE qm.query_id = ? AND e.geo_lat IS NOT NULL AND e.published_at > ?
       ORDER BY e.published_at DESC LIMIT 500`,
      [queryId, cutoff]
    );
    return c.json(rows.map(rowToEvent));
  }

  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, source_type, content, geo_lat, geo_lng, geo_label, sentiment, published_at
     FROM events
     WHERE geo_lat IS NOT NULL AND published_at > ?
     ORDER BY published_at DESC LIMIT 500`,
    [cutoff]
  );
  return c.json(rows.map(rowToEvent));
});
