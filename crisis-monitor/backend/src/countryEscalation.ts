import { all, first, run, nowIso, isoMinutesAgo } from "./db";
import { newId } from "./ids";
import { toGdeltTimestamp, BROAD_CONFLICT_SQL } from "./connectors/gdeltBulk";
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
 * Redefined per Simon's direction (previously this scored ALL conflict-toned
 * report volume equally — a country with lots of routine "criticize/protest"
 * coverage could outscore one with a real military escalation). "Escalation"
 * now specifically means a rise in MILITARY-POSTURE reporting: drone
 * strikes, airstrikes, military clashes/armed confrontations, mobilization,
 * reinforcement, heavy weapons use, blockades, ceasefire violations —
 * MILITARY_POSTURE_EVENT_CODES below is that list translated into GDELT's
 * own CAMEO event-code taxonomy (the structured field this data actually
 * has — there's no raw article text in the bulk feed to literally keyword-
 * match "drone strike" against, see gdeltBulk.ts's own doc comment), fetched
 * and verified directly against the CAMEO codebook rather than guessed from
 * memory. Overall conflict-toned volume (the old signal) is kept as a
 * smaller secondary input, not the primary driver anymore.
 *
 * Also now a dual-window "fast + slow" signal rather than one fixed 24h
 * comparison: a FAST_WINDOW_HOURS (6h vs prior 6h) catches a same-day spike
 * before a full day has passed, a SLOW_WINDOW_HOURS (24h vs prior 24h)
 * catches a sustained deterioration a short window could miss in a country
 * with low report volume. Each window gets its own score; the higher of the
 * two wins, and which window triggered it is recorded (`triggeredWindow`)
 * so the alert/popup text can say "breaking" vs "sustained" honestly rather
 * than implying one fixed cadence always applies.
 *
 * Country matching is a plain substring match against each bulk event's
 * `place_name` (GDELT's own free-text location string, e.g. "Khartoum,
 * Khartoum, Sudan") — coarse (a country whose name is a substring of
 * another's, or appears in another country's admin-region name, could
 * double-count in rare cases) but real, and the same tradeoff already
 * accepted by activity-index's identical matching approach.
 */

// CAMEO event codes verified against the official CAMEO codebook
// (parusanalytics.com/eventdata/cameo.dir/CAMEO.09b6.pdf), category 15
// "EXHIBIT FORCE POSTURE" and category 19/20 "FIGHT" / "USE UNCONVENTIONAL
// MASS VIOLENCE" — the closest real, structured equivalent GDELT's bulk
// data has to the plain-language terms Simon asked for:
//   150 Demonstrate military or police power, not specified below
//   151 Increase police alert status
//   152 Increase military alert status          -> "increased military movement"
//   153 Mobilize or increase police power
//   154 Mobilize or increase armed forces        -> "military mobilisation" / "reinforcement"
//   190 Use conventional military force          -> "military clashes" / "armed confrontations"
//   191 Impose blockade, restrict movement
//   192 Occupy territory
//   193 Fight with small arms and light weapons  -> "armed confrontations"
//   194 Fight with artillery and tanks           -> "heavy weapons"
//   195 Employ aerial weapons, not specified      -> "airstrikes"
//   1951 Employ precision-guided aerial munitions -> "airstrikes"
//   1952 Employ remotely piloted aerial munitions -> "drone strikes"
//   196 Violate ceasefire
//   200-204(1/2) Use unconventional mass violence / mass killings / WMD — the most
//     severe tier; included since these are unambiguous security deterioration
const MILITARY_POSTURE_EVENT_CODES = [
  "150", "151", "152", "153", "154",
  "190", "191", "192", "193", "194", "195", "1951", "1952", "196",
  "200", "201", "202", "203", "204", "2041", "2042",
] as const;
const MILITARY_POSTURE_SQL = `event_code IN (${MILITARY_POSTURE_EVENT_CODES.map(() => "?").join(",")})`;

const FAST_WINDOW_HOURS = 6; // catches a same-day spike
const SLOW_WINDOW_HOURS = 24; // catches sustained deterioration a short window could miss
// Posture-report growth is the primary signal now; overall conflict-toned
// volume growth is kept as smaller secondary context (a country can still
// be "busy" without military posture actually changing); negative tone
// keeps its prior weight, unchanged from the original scorer.
const POSTURE_GROWTH_WEIGHT = 1.6;
const VOLUME_GROWTH_WEIGHT = 0.4;
const TONE_WEIGHT = 0.5;
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

const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"; // fast + cheap — this fires at most a few times/hour, per country, never a chat-scale workload
const ANTHROPIC_TIMEOUT_MS = 8000;

/** Turns one country's escalation numbers into a short analyst-style brief
 *  via the Anthropic API, in place of the plain templated sentence. Returns
 *  null (never throws) whenever this can't produce a real answer — no key
 *  configured, a timeout, a non-200 response, or an unexpected response
 *  shape — so the caller always has the templated description to fall back
 *  on and an alert never fails to fire just because this enhancement did.
 *  Deliberately fed only the numbers already computed above (no invented
 *  context, no speculation beyond the data) — this is meant to read the
 *  same numbers a human analyst would see, phrased better, not to add
 *  claims nothing here actually knows. */
async function generateAnalyticalSummary(
  env: Env,
  params: {
    countryName: string;
    windowHours: number;
    triggeredWindow: "fast" | "slow";
    postureCurrentCount: number;
    postureBaselineCount: number;
    currentCount: number;
    baselineCount: number;
    avgTone: number | null;
    escalationScore: number;
    level: "elevated" | "critical";
    sampleLocations: string[];
  }
): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;

  const prompt =
    `You are drafting one short paragraph (2-3 sentences, no markdown, no headings, no bullet points) for a security-monitoring alert ` +
    `on an African conflict-monitoring dashboard. Use only the facts given below — do not add locations, causes, actors, or context not stated here. ` +
    `Write it the way a conflict analyst would phrase a terse situation note, not a headline and not a hedge-filled disclaimer.\n\n` +
    `Country: ${params.countryName}\n` +
    `Alert level: ${params.level}\n` +
    `Signal: ${params.triggeredWindow === "fast" ? "breaking/rapid" : "sustained"} rise over a ${params.windowHours}h window\n` +
    `Military-posture reports (mobilization, clashes, airstrikes, drone strikes, heavy weapons, blockades, ceasefire violations) in that window: ${params.postureCurrentCount}\n` +
    `Military-posture baseline (prior ${params.windowHours}h): ${params.postureBaselineCount}\n` +
    `Overall conflict-toned reports in that window: ${params.currentCount} (baseline ${params.baselineCount.toFixed(0)})\n` +
    `Escalation score: ${params.escalationScore.toFixed(2)}\n` +
    `Average report tone (GDELT scale, negative = more negative coverage): ${params.avgTone !== null ? params.avgTone.toFixed(1) : "not available"}\n` +
    `Sample reported locations: ${params.sampleLocations.length > 0 ? params.sampleLocations.join("; ") : "none captured"}\n`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 220,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error(`[country-escalation] Anthropic summary request failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    const text = data.content?.find((b) => b.type === "text")?.text?.trim();
    return text || null;
  } catch (err) {
    console.error("[country-escalation] Anthropic summary request errored", err);
    return null;
  }
}

async function broadcast(env: Env, type: string, payload: unknown) {
  const id = env.LIVE_FEED.idFromName("global");
  await env.LIVE_FEED.get(id).fetch("http://live-feed/broadcast", {
    method: "POST",
    body: JSON.stringify({ type, payload, ownerIds: [] }), // house signal — admins only over the live socket; everyone can still poll the REST endpoints
  });
}

/** Self-provisioned the same way connectors/gdeltGkg.ts's and
 *  lib/gdeltAdaptiveBudget.ts's tables are — this app's D1 schema has no
 *  migration files checked into the repo (changes are normally applied by
 *  hand via `wrangler d1 execute`, which this sandbox can't run), so this
 *  table creates itself on first use instead. This was the actual cause of
 *  the "no such table: country_escalation_snapshots" error on the danger-
 *  marker layer: the table was never created anywhere, by hand or in code,
 *  when this feature was first built. Cheap no-op (CREATE TABLE/INDEX IF
 *  NOT EXISTS) on every call once it exists. */
async function ensureTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS country_escalation_snapshots (
      id TEXT PRIMARY KEY,
      country_code TEXT NOT NULL,
      country_name TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      current_count INTEGER NOT NULL,
      baseline_count INTEGER NOT NULL,
      avg_tone REAL,
      escalation_score REAL NOT NULL,
      level TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_country_escalation_country_window ON country_escalation_snapshots (country_code, window_end)`
  ).run();

  // Added when escalation was redefined around military-posture events —
  // D1/SQLite has no "ADD COLUMN IF NOT EXISTS", so each ALTER is tried and
  // its "duplicate column name" error (already applied, by an earlier tick
  // or another isolate) is swallowed; any other error still surfaces.
  for (const stmt of [
    `ALTER TABLE country_escalation_snapshots ADD COLUMN posture_current_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE country_escalation_snapshots ADD COLUMN posture_baseline_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE country_escalation_snapshots ADD COLUMN triggered_window TEXT NOT NULL DEFAULT 'slow'`,
    `ALTER TABLE country_escalation_snapshots ADD COLUMN window_hours INTEGER NOT NULL DEFAULT ${SLOW_WINDOW_HOURS}`,
  ]) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("duplicate column name")) throw err;
    }
  }
}

interface WindowBucket {
  totalCount: number;
  postureCount: number;
  avgTone: number | null;
}

async function queryWindowBucket(env: Env, likePattern: string, start: string, end: string | null): Promise<WindowBucket> {
  const row = await first<{ total_count: number; posture_count: number; avg_tone: number | null }>(
    env.DB,
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN ${MILITARY_POSTURE_SQL} THEN 1 ELSE 0 END) AS posture_count,
            AVG(avg_tone) AS avg_tone
     FROM gdelt_bulk_events
     WHERE ${BROAD_CONFLICT_SQL} AND date_added >= ? ${end ? "AND date_added < ?" : ""} AND place_name LIKE ?`,
    end ? [...MILITARY_POSTURE_EVENT_CODES, start, end, likePattern] : [...MILITARY_POSTURE_EVENT_CODES, start, likePattern]
  );
  return {
    totalCount: Number(row?.total_count ?? 0),
    postureCount: Number(row?.posture_count ?? 0),
    avgTone: row?.avg_tone ?? null,
  };
}

interface WindowScore {
  score: number;
  current: WindowBucket;
  baseline: WindowBucket;
}

/** growth is driven primarily by military-posture report growth (the
 *  redefined signal), with overall conflict-toned volume growth kept as
 *  smaller secondary context and negative tone nudging it further — same
 *  sqrt-dampened ratio shape as the original scorer (and alerting.ts's
 *  per-query scorer) so a near-zero baseline doesn't produce wild swings. */
function scoreWindow(current: WindowBucket, baseline: WindowBucket): WindowScore {
  const postureGrowth = Math.max(0, (current.postureCount - baseline.postureCount) / Math.sqrt(baseline.postureCount + 1));
  const volumeGrowth = Math.max(0, (current.totalCount - baseline.totalCount) / Math.sqrt(baseline.totalCount + 1));
  const tonePenalty = current.avgTone !== null && current.avgTone < 0 ? Math.abs(current.avgTone) : 0;
  const score = postureGrowth * POSTURE_GROWTH_WEIGHT + volumeGrowth * VOLUME_GROWTH_WEIGHT + tonePenalty * TONE_WEIGHT;
  return { score, current, baseline };
}

/** Scores every African country and writes one snapshot row each per tick;
 *  raises a deduped alert when a country crosses ELEVATED/CRITICAL. Called
 *  from index.ts's scheduled() handler on the same 5-min cron as bulk
 *  ingestion (it's a handful of cheap D1 aggregate queries, no external
 *  calls, so running it every tick regardless of whether ingestion found a
 *  new export is fine).
 *
 *  Runs both the fast (6h) and slow (24h) window per country and keeps
 *  whichever scores higher — see the module doc comment for why. */
export async function scoreCountryEscalations(env: Env): Promise<void> {
  await ensureTable(env);
  const now = new Date();

  for (const [code, name] of Object.entries(AFRICA_COUNTRIES)) {
    const likePattern = `%${name}%`;

    const fastCurrentStart = toGdeltTimestamp(new Date(now.getTime() - FAST_WINDOW_HOURS * 3600_000));
    const fastBaselineStart = toGdeltTimestamp(new Date(now.getTime() - FAST_WINDOW_HOURS * 2 * 3600_000));
    const slowCurrentStart = toGdeltTimestamp(new Date(now.getTime() - SLOW_WINDOW_HOURS * 3600_000));
    const slowBaselineStart = toGdeltTimestamp(new Date(now.getTime() - SLOW_WINDOW_HOURS * 2 * 3600_000));
    const nowTs = toGdeltTimestamp(now);

    const [fastCurrent, fastBaseline, slowCurrent, slowBaseline] = await Promise.all([
      queryWindowBucket(env, likePattern, fastCurrentStart, null),
      queryWindowBucket(env, likePattern, fastBaselineStart, fastCurrentStart),
      queryWindowBucket(env, likePattern, slowCurrentStart, null),
      queryWindowBucket(env, likePattern, slowBaselineStart, slowCurrentStart),
    ]);

    const fast = scoreWindow(fastCurrent, fastBaseline);
    const slow = scoreWindow(slowCurrent, slowBaseline);
    const triggeredWindow: "fast" | "slow" = fast.score >= slow.score ? "fast" : "slow";
    const winning = triggeredWindow === "fast" ? fast : slow;
    const windowHours = triggeredWindow === "fast" ? FAST_WINDOW_HOURS : SLOW_WINDOW_HOURS;
    const windowStart = triggeredWindow === "fast" ? fastCurrentStart : slowCurrentStart;
    const escalationScore = winning.score;

    let level: "none" | AlertLevel = "none";
    if (escalationScore >= CRITICAL_THRESHOLD) level = "critical";
    else if (escalationScore >= ELEVATED_THRESHOLD) level = "elevated";

    await run(
      env.DB,
      `INSERT INTO country_escalation_snapshots
        (id, country_code, country_name, window_start, window_end, current_count, baseline_count, avg_tone, escalation_score, level, created_at,
         posture_current_count, posture_baseline_count, triggered_window, window_hours)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        newId(), code, name, windowStart, nowTs,
        winning.current.totalCount, winning.baseline.totalCount, winning.current.avgTone, escalationScore, level, nowIso(),
        winning.current.postureCount, winning.baseline.postureCount, triggeredWindow, windowHours,
      ]
    );

    // Gate is on the posture count specifically (the real signal now), not
    // overall volume — lowered from the old >=3 since posture-coded events
    // are a narrower, higher-signal set than "any conflict-toned report".
    if (level !== "none" && winning.current.postureCount >= 2) {
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
          `SELECT DISTINCT place_name FROM gdelt_bulk_events WHERE ${MILITARY_POSTURE_SQL} AND date_added >= ? AND place_name LIKE ? LIMIT 3`,
          [...MILITARY_POSTURE_EVENT_CODES, windowStart, likePattern]
        );
        const sampleLocationList = sample.map((r) => r.place_name);
        const sampleLocations = sampleLocationList.join("; ");
        const alertId = newId();
        const windowLabel = triggeredWindow === "fast" ? "a rapid rise" : "a sustained rise";
        const templatedDescription =
          `${name} shows ${windowLabel} in military-posture reporting (mobilization, clashes, airstrikes, heavy weapons, blockades) — ` +
          `${winning.current.postureCount} report${winning.current.postureCount === 1 ? "" : "s"} in the last ${windowHours}h ` +
          `versus a baseline of ${winning.baseline.postureCount} in the previous ${windowHours}h (overall conflict-toned volume ${winning.current.totalCount} vs ${winning.baseline.totalCount}, escalation score ${escalationScore.toFixed(2)})` +
          `${winning.current.avgTone !== null ? `, average tone ${winning.current.avgTone.toFixed(1)} (${winning.current.avgTone < -3 ? "sharply negative" : winning.current.avgTone < 0 ? "negative" : "mixed"})` : ""}.` +
          `${sampleLocations ? ` Reported near: ${sampleLocations}.` : ""}`;

        // AI-written brief when ANTHROPIC_API_KEY is configured, falling
        // back to the plain templated sentence above otherwise or on any
        // failure — see generateAnalyticalSummary's own doc comment.
        const aiSummary = await generateAnalyticalSummary(env, {
          countryName: name,
          windowHours,
          triggeredWindow,
          postureCurrentCount: winning.current.postureCount,
          postureBaselineCount: winning.baseline.postureCount,
          currentCount: winning.current.totalCount,
          baselineCount: winning.baseline.totalCount,
          avgTone: winning.current.avgTone,
          escalationScore,
          level,
          sampleLocations: sampleLocationList,
        });
        const description = aiSummary ?? templatedDescription;

        const alertRows = await all<Record<string, unknown>>(
          env.DB,
          `INSERT INTO alerts (id, query_id, level, title, description, metric_snapshot, geo_label, geo_lat, geo_lng, created_at)
           VALUES (?,NULL,?,?,?,?,?,?,?,?) RETURNING *`,
          [
            alertId,
            level,
            `${level === "critical" ? "Critical" : "Elevated"} escalation: ${name}`,
            description,
            JSON.stringify({
              currentCount: winning.current.totalCount,
              baselineCount: winning.baseline.totalCount,
              postureCurrentCount: winning.current.postureCount,
              postureBaselineCount: winning.baseline.postureCount,
              avgTone: winning.current.avgTone,
              escalationScore,
              triggeredWindow,
              windowHours,
              aiGenerated: aiSummary !== null,
            }),
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
  postureCurrentCount: number;
  postureBaselineCount: number;
  triggeredWindow: "fast" | "slow";
  windowHours: number;
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
  posture_current_count: number;
  posture_baseline_count: number;
  triggered_window: "fast" | "slow";
  window_hours: number;
  avg_tone: number | null;
  escalation_score: number;
  level: "none" | "elevated" | "critical";
  window_end: string;
}

/** Latest snapshot per country — what the danger-icon map layer renders. */
export async function getLatestCountryEscalations(env: Env): Promise<CountryEscalationSnapshot[]> {
  // The map layer can be opened before the first cron tick has ever called
  // scoreCountryEscalations (e.g. right after this feature first deploys),
  // so this read path needs the same self-provisioning, not just the writer.
  await ensureTable(env);
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
    postureCurrentCount: r.posture_current_count,
    postureBaselineCount: r.posture_baseline_count,
    triggeredWindow: r.triggered_window,
    windowHours: r.window_hours,
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
  // The broader of the two scoring windows (SLOW_WINDOW_HOURS) — a drill-
  // down should show everything that could be behind either a fast or slow
  // trigger, not just the narrower 6h window.
  const currentStart = toGdeltTimestamp(new Date(Date.now() - SLOW_WINDOW_HOURS * 3600_000));
  const rows = await all<{ place_name: string; event_code: string; avg_tone: number | null; num_mentions: number | null; source_url: string; date_added: string }>(
    env.DB,
    `SELECT place_name, event_code, avg_tone, num_mentions, source_url, date_added FROM gdelt_bulk_events
     WHERE ${BROAD_CONFLICT_SQL} AND date_added >= ? AND place_name LIKE ?
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
