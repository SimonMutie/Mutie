import { all, first, run, nowIso, isoMinutesAgo } from "./db";
import { newId } from "./ids";
import { toGdeltTimestamp } from "./connectors/gdeltBulk";
import { AFRICA_COUNTRIES } from "./routes/globalStatus";
import type { Env } from "./bindings";
import type { AlertLevel } from "./types";

/**
 * Country-level "is this country deteriorating right now" scoring, built on
 * top of the bulk-ingested GDELT conflict events (gdelt_bulk_events — see
 * connectors/gdeltBulk.ts). This is deliberately separate from the existing
 * per-saved-query escalation system in alerting.ts (which scores a client's
 * own boolean queries against the live-ingested `events` table): this one
 * is unscoped/"house" — a standing Africa-wide watch that doesn't depend on
 * any client having set up a query, matching what was asked for ("danger
 * icon in countries where there is increased mentions... like OSIRIS does").
 *
 * Method: for each African country, compare conflict-toned report volume
 * (CAMEO QuadClass >= 3, i.e. verbal-or-material conflict) in the last 24h
 * ("live") against the 24h immediately before that ("the past 2 days" the
 * request asked for — a rolling day-over-day comparison, not a fixed
 * calendar window). Escalation score is the same shape as the existing
 * per-query scorer in alerting.ts (growth vs baseline, nudged by negative
 * tone) for consistency, not a different, unexplained formula.
 *
 * Country matching is a plain substring match against each bulk event's
 * `place_name` (GDELT's own free-text location string, e.g. "Khartoum,
 * Khartoum, Sudan") — coarse (a country whose name is a substring of
 * another's, or appears in another country's admin-region name, could
 * double-count in rare cases) but real, and the same tradeoff already
 * accepted by activity-index's identical matching approach.
 */

const CURRENT_WINDOW_HOURS = 24;
const BASELINE_WINDOW_HOURS = 24; // the 24h immediately before the current window
const ELEVATED_THRESHOLD = 2.5;
const CRITICAL_THRESHOLD = 4.5;
const ALERT_DEDUPE_MINUTES = 60; // don't re-alert the same country+level more than once/hour

// Approximate geographic centroids (good enough for a map marker, not
// survey-grade) for every country in AFRICA_COUNTRIES — this app's own
// COUNTRY_CENTROIDS table (connectors/gdelt.ts) only covers ~35 countries
// globally, several outside Africa, so this is a purpose-built, complete
// set for the scope this feature actually needs.
export const AFRICA_CENTROIDS: Record<string, [number, number]> = {
  DZ: [28.0, 1.6], AO: [-11.2, 17.9], BJ: [9.3, 2.3], BW: [-22.3, 24.7], BF: [12.2, -1.6], BI: [-3.4, 29.9],
  CM: [7.4, 12.3], CV: [16.0, -24.0], CF: [6.6, 20.9], TD: [15.5, 18.7], KM: [-11.6, 43.3],
  CG: [-0.2, 15.8], CD: [-2.9, 23.6], CI: [7.5, -5.5], DJ: [11.6, 42.6], EG: [26.8, 30.8],
  GQ: [1.6, 10.5], ER: [15.2, 39.8], SZ: [-26.5, 31.5], ET: [9.1, 40.5], GA: [-0.6, 11.6], GM: [13.4, -15.3],
  GH: [7.9, -1.0], GN: [10.6, -10.9], GW: [12.0, -15.2], KE: [1.0, 38.0], LS: [-29.6, 28.2], LR: [6.4, -9.4],
  LY: [26.3, 17.2], MG: [-18.9, 46.9], MW: [-13.5, 34.3], ML: [17.0, -4.0], MR: [20.3, -10.3], MU: [-20.3, 57.6],
  MA: [31.8, -7.1], MZ: [-18.7, 35.5], NA: [-22.0, 17.1], NE: [17.6, 8.1], NG: [9.1, 8.7], RW: [-1.9, 29.9],
  ST: [0.2, 6.6], SN: [14.5, -14.5], SC: [-4.7, 55.5], SL: [8.5, -11.8], SO: [5.2, 46.2],
  ZA: [-30.6, 22.9], SS: [7.9, 30.0], SD: [15.5, 30.2], TZ: [-6.4, 34.9], TG: [8.6, 0.8], TN: [34.0, 9.5],
  UG: [1.4, 32.3], ZM: [-13.1, 27.8], ZW: [-19.0, 29.8],
};

async function broadcast(env: Env, type: string, payload: unknown) {
  const id = env.LIVE_FEED.idFromName("global");
  await env.LIVE_FEED.get(id).fetch("http://live-feed/broadcast", {
    method: "POST",
    body: JSON.stringify({ type, payload, ownerIds: [] }), // house signal — admins only over the live socket; everyone can still poll the REST endpoints
  });
}

interface CountBucket {
  count: number;
  avg_tone: number | null;
}

/** Scores every African country and writes one snapshot row each per tick;
 *  raises a deduped alert when a country crosses ELEVATED/CRITICAL. Called
 *  from index.ts's scheduled() handler on the same 5-min cron as bulk
 *  ingestion (it's a handful of cheap D1 aggregate queries, no external
 *  calls, so running it every tick regardless of whether ingestion found a
 *  new export is fine). */
export async function scoreCountryEscalations(env: Env): Promise<void> {
  const now = new Date();
  const currentStart = toGdeltTimestamp(new Date(now.getTime() - CURRENT_WINDOW_HOURS * 3600_000));
  const baselineStart = toGdeltTimestamp(new Date(now.getTime() - (CURRENT_WINDOW_HOURS + BASELINE_WINDOW_HOURS) * 3600_000));
  const currentEnd = toGdeltTimestamp(now);

  for (const [code, name] of Object.entries(AFRICA_COUNTRIES)) {
    const likePattern = `%${name}%`;

    const current = await first<CountBucket>(
      env.DB,
      `SELECT COUNT(*) AS count, AVG(avg_tone) AS avg_tone FROM gdelt_bulk_events
       WHERE quad_class >= 3 AND date_added >= ? AND place_name LIKE ?`,
      [currentStart, likePattern]
    );
    const baseline = await first<CountBucket>(
      env.DB,
      `SELECT COUNT(*) AS count FROM gdelt_bulk_events
       WHERE quad_class >= 3 AND date_added >= ? AND date_added < ? AND place_name LIKE ?`,
      [baselineStart, currentStart, likePattern]
    );

    const currentCount = Number(current?.count ?? 0);
    const baselineCount = Number(baseline?.count ?? 0);
    const avgTone = current?.avg_tone ?? null;

    // Same shape as alerting.ts's per-query scorer: ratio-based growth,
    // nudged by negative tone (crises read as bad news, not just busy news).
    const growth = (currentCount - baselineCount) / Math.sqrt(baselineCount + 1);
    const tonePenalty = avgTone !== null && avgTone < 0 ? Math.abs(avgTone) : 0;
    const escalationScore = Math.max(0, growth) + tonePenalty * 0.5;

    let level: "none" | AlertLevel = "none";
    if (escalationScore >= CRITICAL_THRESHOLD) level = "critical";
    else if (escalationScore >= ELEVATED_THRESHOLD) level = "elevated";

    await run(
      env.DB,
      `INSERT INTO country_escalation_snapshots
        (id, country_code, country_name, window_start, window_end, current_count, baseline_count, avg_tone, escalation_score, level, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [newId(), code, name, currentStart, currentEnd, currentCount, baselineCount, avgTone, escalationScore, level, nowIso()]
    );

    if (level !== "none" && currentCount >= 3) {
      const recent = await first<{ id: string }>(
        env.DB,
        `SELECT id FROM alerts WHERE geo_label = ? AND level = ? AND query_id IS NULL AND created_at > ? LIMIT 1`,
        [name, level, isoMinutesAgo(ALERT_DEDUPE_MINUTES)]
      );
      if (!recent) {
        const centroid = AFRICA_CENTROIDS[code];
        const lat = centroid ? centroid[0] : null;
        const lng = centroid ? centroid[1] : null;
        const sample = await all<{ place_name: string }>(
          env.DB,
          `SELECT DISTINCT place_name FROM gdelt_bulk_events WHERE quad_class >= 3 AND date_added >= ? AND place_name LIKE ? LIMIT 3`,
          [currentStart, likePattern]
        );
        const sampleLocations = sample.map((r) => r.place_name).join("; ");
        const alertId = newId();
        const description =
          `Conflict-related reporting in ${name} has risen to ${currentCount} report${currentCount === 1 ? "" : "s"} in the last ${CURRENT_WINDOW_HOURS}h, ` +
          `versus a baseline of ${baselineCount} in the previous ${BASELINE_WINDOW_HOURS}h (escalation score ${escalationScore.toFixed(2)})` +
          `${avgTone !== null ? `, average tone ${avgTone.toFixed(1)} (${avgTone < -3 ? "sharply negative" : avgTone < 0 ? "negative" : "mixed"})` : ""}.` +
          `${sampleLocations ? ` Reported near: ${sampleLocations}.` : ""}`;

        const alertRows = await all<Record<string, unknown>>(
          env.DB,
          `INSERT INTO alerts (id, query_id, level, title, description, metric_snapshot, geo_label, geo_lat, geo_lng, created_at)
           VALUES (?,NULL,?,?,?,?,?,?,?,?) RETURNING *`,
          [
            alertId,
            level,
            `${level === "critical" ? "Critical" : "Elevated"} escalation: ${name}`,
            description,
            JSON.stringify({ currentCount, baselineCount, avgTone, escalationScore }),
            name,
            lat,
            lng,
            nowIso(),
          ]
        );
        if (alertRows[0]) {
          await broadcast(env, "alert", { ...alertRows[0], metric_snapshot: JSON.parse(String(alertRows[0].metric_snapshot ?? "{}")) });
        }
      }
    }
  }
}

export interface CountryEscalationSnapshot {
  countryCode: string;
  countryName: string;
  currentCount: number;
  baselineCount: number;
  avgTone: number | null;
  escalationScore: number;
  level: "none" | "elevated" | "critical";
  windowEnd: string;
}

interface SnapshotRow {
  country_code: string;
  country_name: string;
  current_count: number;
  baseline_count: number;
  avg_tone: number | null;
  escalation_score: number;
  level: "none" | "elevated" | "critical";
  window_end: string;
}

/** Latest snapshot per country — what the danger-icon map layer renders. */
export async function getLatestCountryEscalations(env: Env): Promise<CountryEscalationSnapshot[]> {
  const rows = await all<SnapshotRow>(
    env.DB,
    `SELECT s.* FROM country_escalation_snapshots s
     INNER JOIN (SELECT country_code, MAX(window_end) AS max_end FROM country_escalation_snapshots GROUP BY country_code) latest
       ON latest.country_code = s.country_code AND latest.max_end = s.window_end`
  );
  return rows.map((r) => ({
    countryCode: r.country_code,
    countryName: r.country_name,
    currentCount: r.current_count,
    baselineCount: r.baseline_count,
    avgTone: r.avg_tone,
    escalationScore: r.escalation_score,
    level: r.level,
    windowEnd: r.window_end,
  }));
}

export interface EscalationEvidenceItem {
  placeName: string;
  eventCode: string;
  avgTone: number | null;
  numMentions: number | null;
  sourceUrl: string;
  dateAdded: string;
}

/** The "see what's behind this" drill-down: the actual contributing bulk
 *  events for a country's current window, most-mentioned first. There's no
 *  literal boolean query behind this feature (unlike Social Listening) — it
 *  comes from the QuadClass-filtered bulk pipeline, not a keyword search —
 *  so this is the honest equivalent: the real underlying reports, not a
 *  fabricated "query string". */
export async function getCountryEscalationEvidence(env: Env, countryCode: string, limit = 10): Promise<EscalationEvidenceItem[]> {
  const name = AFRICA_COUNTRIES[countryCode.toUpperCase()];
  if (!name) return [];
  const currentStart = toGdeltTimestamp(new Date(Date.now() - CURRENT_WINDOW_HOURS * 3600_000));
  const rows = await all<{ place_name: string; event_code: string; avg_tone: number | null; num_mentions: number | null; source_url: string; date_added: string }>(
    env.DB,
    `SELECT place_name, event_code, avg_tone, num_mentions, source_url, date_added FROM gdelt_bulk_events
     WHERE quad_class >= 3 AND date_added >= ? AND place_name LIKE ?
     ORDER BY num_mentions DESC LIMIT ?`,
    [currentStart, `%${name}%`, limit]
  );
  return rows.map((r) => ({
    placeName: r.place_name,
    eventCode: r.event_code,
    avgTone: r.avg_tone,
    numMentions: r.num_mentions,
    sourceUrl: r.source_url,
    dateAdded: r.date_added,
  }));
}
