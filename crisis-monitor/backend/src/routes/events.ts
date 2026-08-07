import { Hono } from "hono";
import { all, isoMinutesAgo } from "../db";
import { rowToEvent } from "../mappers";
import type { Env } from "../bindings";

export const eventsRouter = new Hono<{ Bindings: Env }>();

eventsRouter.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
  const sourceType = c.req.query("source_type") ?? null;
  const queryId = c.req.query("query_id") ?? null;

  if (queryId) {
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
  const cutoff = isoMinutesAgo(minutes);
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
