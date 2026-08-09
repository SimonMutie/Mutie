import { Hono } from "hono";
import { all, first, isoMinutesAgo } from "../db";
import { canAccessQuery } from "../ownership";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const statsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

statsRouter.use("*", requireAuth);

/**
 * Picks a volume-chart bucket size (substr length on the ISO timestamp) so a
 * historical range doesn't return one row per minute over weeks of data —
 * per-minute for short ranges, per-hour for multi-day, per-day beyond that.
 */
function bucketLengthForRange(rangeMs: number): number {
  const HOUR = 60 * 60_000;
  if (rangeMs <= 3 * HOUR) return 16; // "YYYY-MM-DDTHH:MM"
  if (rangeMs <= 3 * 24 * HOUR) return 13; // "YYYY-MM-DDTHH"
  return 10; // "YYYY-MM-DD"
}

statsRouter.get("/summary", async (c) => {
  const db = c.env.DB;
  const queryId = c.req.query("query_id") ?? null;
  const isAdmin = c.get("role") === "admin";
  const twoHoursAgo = isoMinutesAgo(120);
  const sixtyMinAgo = isoMinutesAgo(60);

  // Optional historical range — defaults to the usual rolling windows when absent.
  const from = c.req.query("from") ?? null;
  const to = c.req.query("to") ?? null;
  const rangeStart = from ?? twoHoursAgo;
  const rangeEnd = to ?? new Date().toISOString();
  const bucketLen = from || to ? bucketLengthForRange(new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) : 16;

  if (!queryId && !isAdmin) {
    return c.json({ error: "query_id is required" }, 400);
  }
  if (queryId && !(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
    return c.json({ error: "Query not found" }, 404);
  }

  if (queryId) {
    const [bySource, sentiment, volumeSeries, openAlertCount] = await Promise.all([
      all<{ source_type: string; count: number }>(
        db,
        `SELECT e.source_type, COUNT(*) AS count
         FROM query_matches qm JOIN events e ON e.id = qm.event_id
         WHERE qm.query_id = ? AND qm.matched_at > ? AND qm.matched_at <= ?
         GROUP BY e.source_type`,
        [queryId, rangeStart, rangeEnd]
      ),
      first<{ negative: number; neutral: number; positive: number }>(
        db,
        `SELECT
           SUM(CASE WHEN e.sentiment < -0.2 THEN 1 ELSE 0 END) AS negative,
           SUM(CASE WHEN e.sentiment BETWEEN -0.2 AND 0.2 THEN 1 ELSE 0 END) AS neutral,
           SUM(CASE WHEN e.sentiment > 0.2 THEN 1 ELSE 0 END) AS positive
         FROM query_matches qm JOIN events e ON e.id = qm.event_id
         WHERE qm.query_id = ? AND qm.matched_at > ? AND qm.matched_at <= ?`,
        [queryId, rangeStart, rangeEnd]
      ),
      all<{ minute: string; count: number }>(
        db,
        `SELECT substr(e.published_at, 1, ${bucketLen}) AS minute, COUNT(*) AS count
         FROM query_matches qm JOIN events e ON e.id = qm.event_id
         WHERE qm.query_id = ? AND qm.matched_at > ? AND qm.matched_at <= ?
         GROUP BY minute ORDER BY minute ASC`,
        [queryId, from ? rangeStart : sixtyMinAgo, rangeEnd]
      ),
      first<{ count: number }>(db, `SELECT COUNT(*) AS count FROM alerts WHERE query_id = ? AND resolved_at IS NULL`, [
        queryId,
      ]),
    ]);

    return c.json({
      by_source: bySource,
      sentiment: sentiment ?? { negative: 0, neutral: 0, positive: 0 },
      volume_series: volumeSeries,
      open_alert_count: openAlertCount?.count ?? 0,
      top_queries: [],
    });
  }

  // Admin, unscoped: the original global view across every source/query.
  const [bySource, sentiment, volumeSeries, activeAlerts, topQueries] = await Promise.all([
    all<{ source_type: string; count: number }>(
      db,
      `SELECT source_type, COUNT(*) AS count FROM events WHERE published_at > ? GROUP BY source_type`,
      [twoHoursAgo]
    ),
    first<{ negative: number; neutral: number; positive: number }>(
      db,
      `SELECT
         SUM(CASE WHEN sentiment < -0.2 THEN 1 ELSE 0 END) AS negative,
         SUM(CASE WHEN sentiment BETWEEN -0.2 AND 0.2 THEN 1 ELSE 0 END) AS neutral,
         SUM(CASE WHEN sentiment > 0.2 THEN 1 ELSE 0 END) AS positive
       FROM events WHERE published_at > ?`,
      [twoHoursAgo]
    ),
    all<{ minute: string; count: number }>(
      db,
      `SELECT substr(published_at, 1, 16) AS minute, COUNT(*) AS count
       FROM events WHERE published_at > ? GROUP BY minute ORDER BY minute ASC`,
      [sixtyMinAgo]
    ),
    first<{ count: number }>(db, `SELECT COUNT(*) AS count FROM alerts WHERE resolved_at IS NULL`),
    all<{ id: string; name: string; category: string; matches: number }>(
      db,
      `SELECT q.id, q.name, q.category, COUNT(qm.id) AS matches
       FROM monitoring_queries q
       LEFT JOIN query_matches qm ON qm.query_id = q.id AND qm.matched_at > ?
       GROUP BY q.id ORDER BY matches DESC LIMIT 10`,
      [twoHoursAgo]
    ),
  ]);

  return c.json({
    by_source: bySource,
    sentiment: sentiment ?? { negative: 0, neutral: 0, positive: 0 },
    volume_series: volumeSeries,
    open_alert_count: activeAlerts?.count ?? 0,
    top_queries: topQueries,
  });
});

statsRouter.get("/escalation/:queryId", async (c) => {
  const queryId = c.req.param("queryId");
  if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
    return c.json({ error: "Query not found" }, 404);
  }

  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM escalation_snapshots WHERE query_id = ? ORDER BY window_end DESC LIMIT 50`,
    [queryId]
  );
  return c.json(rows.reverse());
});
