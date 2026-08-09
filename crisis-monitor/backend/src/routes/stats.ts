import { Hono } from "hono";
import { all, first, isoMinutesAgo } from "../db";
import { canAccessQuery } from "../ownership";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const statsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

statsRouter.use("*", requireAuth);

statsRouter.get("/summary", async (c) => {
  const db = c.env.DB;
  const queryId = c.req.query("query_id") ?? null;
  const isAdmin = c.get("role") === "admin";
  const twoHoursAgo = isoMinutesAgo(120);
  const sixtyMinAgo = isoMinutesAgo(60);

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
         WHERE qm.query_id = ? AND qm.matched_at > ?
         GROUP BY e.source_type`,
        [queryId, twoHoursAgo]
      ),
      first<{ negative: number; neutral: number; positive: number }>(
        db,
        `SELECT
           SUM(CASE WHEN e.sentiment < -0.2 THEN 1 ELSE 0 END) AS negative,
           SUM(CASE WHEN e.sentiment BETWEEN -0.2 AND 0.2 THEN 1 ELSE 0 END) AS neutral,
           SUM(CASE WHEN e.sentiment > 0.2 THEN 1 ELSE 0 END) AS positive
         FROM query_matches qm JOIN events e ON e.id = qm.event_id
         WHERE qm.query_id = ? AND qm.matched_at > ?`,
        [queryId, twoHoursAgo]
      ),
      all<{ minute: string; count: number }>(
        db,
        `SELECT substr(e.published_at, 1, 16) AS minute, COUNT(*) AS count
         FROM query_matches qm JOIN events e ON e.id = qm.event_id
         WHERE qm.query_id = ? AND qm.matched_at > ?
         GROUP BY minute ORDER BY minute ASC`,
        [queryId, sixtyMinAgo]
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
