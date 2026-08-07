import { all, first, run, nowIso, isoMinutesAgo } from "./db";
import { newId } from "./ids";
import { rowToMonitoringQuery } from "./mappers";
import type { Env } from "./bindings";
import type { AlertLevel } from "./types";

const WINDOW_MINUTES = 5; // how often we score, and the size of the "current" window

async function broadcast(env: Env, type: string, payload: unknown) {
  const id = env.LIVE_FEED.idFromName("global");
  await env.LIVE_FEED.get(id).fetch("http://live-feed/broadcast", {
    method: "POST",
    body: JSON.stringify({ type, payload }),
  });
}

/**
 * For each active query: compare match volume in the last WINDOW_MINUTES against
 * a longer rolling baseline. escalation_score is roughly a z-score of current
 * volume vs baseline mean/stddev, nudged by how negative the sentiment is
 * (crises read as bad news, not just busy news). Called every 30s from
 * AlertingActor's alarm.
 */
export async function scoreEscalations(env: Env) {
  const queryRows = await all<Record<string, unknown>>(env.DB, "SELECT * FROM monitoring_queries WHERE is_active = 1");

  for (const row of queryRows) {
    const q = rowToMonitoringQuery(row);
    const currentWindowStart = isoMinutesAgo(WINDOW_MINUTES);
    const baselineWindowStart = isoMinutesAgo(q.baseline_window_minutes);

    const current = await first<{ volume: number; avg_sentiment: number | null }>(
      env.DB,
      `SELECT COUNT(*) AS volume, AVG(e.sentiment) AS avg_sentiment
       FROM query_matches qm JOIN events e ON e.id = qm.event_id
       WHERE qm.query_id = ? AND qm.matched_at > ?`,
      [q.id, currentWindowStart]
    );

    const geoAvg = await first<{ geo_lat: number | null; geo_lng: number | null }>(
      env.DB,
      `SELECT AVG(e.geo_lat) AS geo_lat, AVG(e.geo_lng) AS geo_lng
       FROM query_matches qm JOIN events e ON e.id = qm.event_id
       WHERE qm.query_id = ? AND qm.matched_at > ?`,
      [q.id, currentWindowStart]
    );

    const geoMode = await first<{ geo_label: string | null }>(
      env.DB,
      `SELECT e.geo_label AS geo_label
       FROM query_matches qm JOIN events e ON e.id = qm.event_id
       WHERE qm.query_id = ? AND qm.matched_at > ? AND e.geo_label IS NOT NULL
       GROUP BY e.geo_label ORDER BY COUNT(*) DESC LIMIT 1`,
      [q.id, currentWindowStart]
    );

    const baseline = await first<{ volume: number }>(
      env.DB,
      `SELECT COUNT(*) AS volume FROM query_matches qm
       WHERE qm.query_id = ? AND qm.matched_at BETWEEN ? AND ?`,
      [q.id, baselineWindowStart, currentWindowStart]
    );

    const currentVolume = Number(current?.volume ?? 0);
    const avgSentiment = current?.avg_sentiment ?? null;
    const buckets = Math.max(1, q.baseline_window_minutes / WINDOW_MINUTES);
    const baselineMeanPerWindow = Number(baseline?.volume ?? 0) / buckets;

    // Simple robust escalation score: ratio-based growth + sentiment penalty.
    const growth = (currentVolume - baselineMeanPerWindow) / Math.sqrt(baselineMeanPerWindow + 1);
    const sentimentPenalty = avgSentiment !== null && avgSentiment < 0 ? Math.abs(avgSentiment) : 0;
    const escalationScore = Math.max(0, growth) + sentimentPenalty * 1.5;

    await run(
      env.DB,
      `INSERT INTO escalation_snapshots
        (id, query_id, window_start, window_end, volume, baseline_volume, avg_sentiment, escalation_score, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [newId(), q.id, currentWindowStart, nowIso(), currentVolume, baselineMeanPerWindow, avgSentiment, escalationScore, nowIso()]
    );

    await broadcast(env, "escalation", {
      query_id: q.id,
      query_name: q.name,
      volume: currentVolume,
      baseline_volume: baselineMeanPerWindow,
      avg_sentiment: avgSentiment,
      escalation_score: escalationScore,
      window_end: nowIso(),
    });

    let level: AlertLevel | null = null;
    if (escalationScore >= q.critical_threshold) level = "critical";
    else if (escalationScore >= q.elevated_threshold) level = "elevated";

    if (level && currentVolume >= 3) {
      // avoid spamming: only raise a new alert if none of the same level for this query in the last 10 min
      const recent = await first<{ id: string }>(
        env.DB,
        `SELECT id FROM alerts WHERE query_id = ? AND level = ? AND created_at > ? LIMIT 1`,
        [q.id, level, isoMinutesAgo(10)]
      );

      if (!recent) {
        const geoLabel = geoMode?.geo_label ?? null;
        const geoLat = geoAvg?.geo_lat ?? null;
        const geoLng = geoAvg?.geo_lng ?? null;
        const alertId = newId();

        const alertRows = await all<Record<string, unknown>>(
          env.DB,
          `INSERT INTO alerts (id, query_id, level, title, description, metric_snapshot, geo_label, geo_lat, geo_lng, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
          [
            alertId,
            q.id,
            level,
            `${level === "critical" ? "Critical" : "Elevated"} escalation: ${q.name}`,
            `Match volume (${currentVolume}) in the last ${WINDOW_MINUTES} min is well above the rolling baseline (${baselineMeanPerWindow.toFixed(
              1
            )}), escalation score ${escalationScore.toFixed(2)}${geoLabel ? `, concentrated near ${geoLabel}` : ""}.`,
            JSON.stringify({ currentVolume, baselineMeanPerWindow, avgSentiment, escalationScore }),
            geoLabel,
            geoLat,
            geoLng,
            nowIso(),
          ]
        );

        if (alertRows[0]) {
          await broadcast(env, "alert", {
            ...alertRows[0],
            metric_snapshot: JSON.parse(String(alertRows[0].metric_snapshot ?? "{}")),
          });
        }
      }
    }
  }
}
