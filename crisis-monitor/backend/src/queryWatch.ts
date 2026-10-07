import { all, first, run, nowIso } from "./db";
import { newId } from "./ids";
import { rowToMonitoringQuery } from "./mappers";
import type { Env } from "./bindings";
import type { MonitoringQuery } from "./types";

/**
 * The watch kept on each monitoring query: how much it has collected in the
 * last 24 hours against what is usual for it, and a "coverage surge" alert
 * when the first runs well above the second.
 *
 * This replaces the old scorer (alerting.ts), which compared the last five
 * minutes with the last hour every 30 seconds. News on one subject arrives
 * an item or two at a time, so that rule almost never fired, and it wrote a
 * row per query on every run into a table nothing displayed. This one:
 *
 *   - runs every WATCH_EVERY_MINUTES from the scheduled handler;
 *   - compares a full day with the query's own usual day (the median of the
 *     last BASIS_DAYS days), so the bar means the same thing for a query
 *     that collects 5 items a day and one that collects 500;
 *   - keeps one small row per query (query_watch), overwritten in place;
 *   - opens at most one alert per surge, keeps its figures current, and
 *     closes it by itself when coverage falls back.
 *
 * A surge is a count of reporting. It is stored at level "info" and worded
 * as such: it is never an "escalation", which on this platform is a claim
 * about events and is made only by the incident pipeline against written
 * criteria (escalationIncidents.ts).
 */

export const WATCH_EVERY_MINUTES = 15;
/** How many past days "usual" is worked out from. */
export const BASIS_DAYS = 28;
/** A query younger than this has no "usual" yet, and raises nothing. */
export const MIN_BASIS_DAYS = 7;
/** A surge is never called on fewer items than this, however quiet the query usually is. */
export const MIN_SURGE_ITEMS = 6;
/** Rows of the retired scorer's table removed per run (see trimOldSnapshots). */
const SNAPSHOT_TRIM_PER_RUN = 150;

const DAY_MS = 86_400_000;

export interface WatchStatus {
  /** Items matched in the last 24 hours. */
  last24h: number;
  /** The median number of items a day over the basis period. */
  usual: number;
  /** Days the usual figure rests on (at most BASIS_DAYS). */
  basisDays: number;
  /** The most items on any one of those days. */
  busiest: number;
  /** Items in 24 hours at which a surge is called. */
  threshold: number;
  /** The multiple of usual that sets the threshold (the query's own setting). */
  multiple: number;
  /** "learning" until there are MIN_BASIS_DAYS of history. */
  state: "learning" | "quiet" | "normal" | "above" | "surge";
  /** When the newest item was matched. */
  lastItemAt: string | null;
  computedAt: string;
}

interface WatchRow {
  query_id: string;
  last24h: number;
  usual: number;
  basis_days: number;
  busiest: number;
  baseline_at: string | null;
  surge_open: number;
  alert_id: string | null;
  last_item_at: string | null;
  computed_at: string;
}

let tablesReady = false;
export async function ensureWatchTables(env: Env): Promise<void> {
  if (tablesReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS query_watch (
      query_id TEXT PRIMARY KEY,
      last24h INTEGER NOT NULL DEFAULT 0,
      usual REAL NOT NULL DEFAULT 0,
      basis_days INTEGER NOT NULL DEFAULT 0,
      busiest INTEGER NOT NULL DEFAULT 0,
      baseline_at TEXT,
      surge_open INTEGER NOT NULL DEFAULT 0,
      alert_id TEXT,
      last_item_at TEXT,
      computed_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS query_watch_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS query_notes (
      id TEXT PRIMARY KEY,
      query_id TEXT NOT NULL,
      day TEXT NOT NULL,
      body TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_query_notes_query ON query_notes (query_id, day)`,
    // A query's open and closed alerts are asked for every time its dashboard refreshes. Without this the
    // database walks the whole alerts table each time; with it, it reads only that query's rows.
    `CREATE INDEX IF NOT EXISTS idx_alerts_query ON alerts (query_id, resolved_at, created_at)`,
  ];
  for (const sql of stmts) await env.DB.prepare(sql).run();
  tablesReady = true;
}
/** Test hook. */
export function resetWatchTableCheck(): void {
  tablesReady = false;
}

async function getState(env: Env, key: string): Promise<string | null> {
  return (await first<{ value: string }>(env.DB, "SELECT value FROM query_watch_state WHERE key = ?", [key]))?.value ?? null;
}
async function setState(env: Env, key: string, value: string): Promise<void> {
  await run(env.DB, "INSERT INTO query_watch_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value]);
}

async function broadcast(env: Env, type: string, payload: unknown, ownerIds: string[]) {
  const id = env.LIVE_FEED.idFromName("global");
  await env.LIVE_FEED.get(id).fetch("http://live-feed/broadcast", { method: "POST", body: JSON.stringify({ type, payload, ownerIds }) });
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The number of items in 24 hours at which a query is in surge. A usual day
 *  of less than one item is treated as one, so that a quiet query needs
 *  MIN_SURGE_ITEMS real items and not "three times nothing". */
export function surgeThreshold(usual: number, multiple: number): number {
  return Math.max(MIN_SURGE_ITEMS, Math.ceil(multiple * Math.max(usual, 1)));
}

/** Pure: what a query's figures amount to. Covered by test/queryWatch.test.ts. */
export function judge(input: { last24h: number; usual: number; basisDays: number; multiple: number; majorMultiple: number }): {
  state: WatchStatus["state"];
  threshold: number;
  major: boolean;
  /** Below this, an open surge is over. Lower than the threshold, so a count hovering at the bar does not open and close an alert every run. */
  exit: number;
} {
  const threshold = surgeThreshold(input.usual, input.multiple);
  const exit = Math.ceil(threshold * 0.7);
  if (input.basisDays < MIN_BASIS_DAYS) return { state: "learning", threshold, major: false, exit };
  const majorAt = input.majorMultiple > input.multiple ? surgeThreshold(input.usual, input.majorMultiple) : Infinity;
  if (input.last24h >= threshold) return { state: "surge", threshold, major: input.last24h >= majorAt, exit };
  if (input.last24h === 0) return { state: "quiet", threshold, major: false, exit };
  // "Above usual" needs a real margin: more than half as much again, and at least three more items.
  if (input.last24h >= input.usual * 1.5 && input.last24h - input.usual >= 3) return { state: "above", threshold, major: false, exit };
  return { state: "normal", threshold, major: false, exit };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** "about 9 a day" / "fewer than one a day". */
export const usualWords = (usual: number) => (usual < 1 ? "fewer than one a day" : `about ${fmt(usual)} a day`);

/** The usual day: the median of the complete UTC days in the basis period. */
async function baseline(env: Env, q: MonitoringQuery, now: Date): Promise<{ usual: number; basisDays: number; busiest: number }> {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // A query has history from the day it was created (its first three days are filled in when it is saved).
  const created = Date.parse(q.created_at);
  const ageDays = Number.isFinite(created) ? Math.floor((today - created) / DAY_MS) : BASIS_DAYS;
  const basisDays = Math.max(0, Math.min(BASIS_DAYS, ageDays));
  if (basisDays === 0) return { usual: 0, basisDays: 0, busiest: 0 };
  const from = new Date(today - basisDays * DAY_MS).toISOString();
  const rows = await all<{ day: string; n: number }>(
    env.DB,
    `SELECT substr(matched_at, 1, 10) AS day, COUNT(*) AS n FROM query_matches WHERE query_id = ? AND matched_at >= ? AND matched_at < ? GROUP BY day`,
    [q.id, from, new Date(today).toISOString()]
  );
  const byDay = new Map(rows.map((r) => [r.day, Number(r.n)]));
  const counts: number[] = [];
  for (let d = 1; d <= basisDays; d++) counts.push(byDay.get(new Date(today - d * DAY_MS).toISOString().slice(0, 10)) ?? 0);
  return { usual: median(counts), basisDays, busiest: Math.max(0, ...counts) };
}

function toStatus(row: WatchRow, q: Pick<MonitoringQuery, "elevated_threshold" | "critical_threshold">): WatchStatus {
  const j = judge({ last24h: row.last24h, usual: row.usual, basisDays: row.basis_days, multiple: q.elevated_threshold, majorMultiple: q.critical_threshold });
  return {
    last24h: row.last24h,
    usual: row.usual,
    basisDays: row.basis_days,
    busiest: row.busiest,
    threshold: j.threshold,
    multiple: q.elevated_threshold,
    state: j.state,
    lastItemAt: row.last_item_at,
    computedAt: row.computed_at,
  };
}

interface SurgeSnapshot {
  kind: "surge";
  major: boolean;
  last24h: number;
  usual: number;
  threshold: number;
  multiple: number;
  basisDays: number;
  criteriaMet: string[];
  headlines: { title: string; url: string | null; source: string | null; published_at: string }[];
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function surgeText(q: MonitoringQuery, s: Omit<SurgeSnapshot, "kind" | "criteriaMet" | "headlines">): { title: string; description: string; criteriaMet: string[] } {
  const times = s.usual >= 1 ? `${fmt(Math.round((s.last24h / s.usual) * 10) / 10)} times the usual` : "well above the usual";
  return {
    title: `${s.major ? "Major coverage surge" : "Coverage surge"}: ${q.name}`,
    description: `${s.last24h} items in the last 24 hours, ${times} (${usualWords(s.usual)} over the last ${s.basisDays} days). This counts reporting; it is not a judgement that the situation itself has escalated.`,
    criteriaMet: [
      `${s.last24h} items collected in the last 24 hours`,
      `A usual day for this query is ${usualWords(s.usual)}, the median of the last ${s.basisDays} days`,
      `The bar for a surge is ${s.threshold} items in 24 hours (${fmt(s.multiple)} times the usual, and never fewer than ${MIN_SURGE_ITEMS})`,
    ],
  };
}

/** Brings one query's watch up to date; opens, updates or closes its surge alert. */
export async function watchQuery(env: Env, q: MonitoringQuery, prior: WatchRow | null, now = new Date()): Promise<WatchStatus> {
  const stale = !prior?.baseline_at || now.getTime() - Date.parse(prior.baseline_at) >= DAY_MS || prior.baseline_at.slice(0, 10) !== now.toISOString().slice(0, 10);
  const base = stale ? await baseline(env, q, now) : { usual: prior!.usual, basisDays: prior!.basis_days, busiest: prior!.busiest };
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const [count, newest] = await Promise.all([
    first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM query_matches WHERE query_id = ? AND matched_at > ?", [q.id, since]),
    first<{ at: string | null }>(env.DB, "SELECT MAX(matched_at) AS at FROM query_matches WHERE query_id = ?", [q.id]),
  ]);
  const last24h = Number(count?.n ?? 0);
  const j = judge({ last24h, usual: base.usual, basisDays: base.basisDays, multiple: q.elevated_threshold, majorMultiple: q.critical_threshold });

  let surgeOpen = prior?.surge_open ? 1 : 0;
  let alertId = prior?.alert_id ?? null;
  const figures = { major: j.major, last24h, usual: base.usual, threshold: j.threshold, multiple: q.elevated_threshold, basisDays: base.basisDays };

  if (j.state === "surge" && !surgeOpen) {
    // A new surge: one alert, with the headlines behind it.
    const heads = await all<{ title: string | null; content: string | null; url: string | null; author: string | null; published_at: string }>(
      env.DB,
      `SELECT e.title, substr(e.content, 1, 140) AS content, e.url, e.author, e.published_at
       FROM query_matches qm JOIN events e ON e.id = qm.event_id
       WHERE qm.query_id = ? AND qm.matched_at > ? ORDER BY qm.matched_at DESC LIMIT 5`,
      [q.id, since]
    );
    const text = surgeText(q, figures);
    const snapshot: SurgeSnapshot = {
      kind: "surge",
      ...figures,
      criteriaMet: text.criteriaMet,
      headlines: heads.map((h) => ({ title: (h.title ?? "").trim() || (h.content ?? "").trim(), url: h.url, source: hostOf(h.url) ?? h.author, published_at: h.published_at })),
    };
    alertId = newId();
    const rows = await all<Record<string, unknown>>(
      env.DB,
      `INSERT INTO alerts (id, query_id, level, title, description, metric_snapshot, geo_label, geo_lat, geo_lng, created_at)
       VALUES (?,?,'info',?,?,?,NULL,NULL,NULL,?) RETURNING *`,
      [alertId, q.id, text.title, text.description, JSON.stringify(snapshot), now.toISOString()]
    );
    surgeOpen = 1;
    if (rows[0]) await broadcast(env, "alert", { ...rows[0], metric_snapshot: snapshot }, q.owner_id ? [q.owner_id] : []).catch((err) => console.error("[watch] broadcast failed", err));
  } else if (surgeOpen && j.state === "surge" && alertId && prior && (prior.last24h !== last24h || prior.usual !== base.usual)) {
    // The surge continues: keep the open alert's figures current. An alert the analyst has resolved stays resolved.
    const open = await first<{ metric_snapshot: string | null }>(env.DB, "SELECT metric_snapshot FROM alerts WHERE id = ? AND resolved_at IS NULL", [alertId]);
    if (open) {
      const text = surgeText(q, figures);
      let headlines: SurgeSnapshot["headlines"] = [];
      try {
        headlines = (JSON.parse(open.metric_snapshot ?? "{}") as Partial<SurgeSnapshot>).headlines ?? [];
      } catch {
        headlines = [];
      }
      const snapshot: SurgeSnapshot = { kind: "surge", ...figures, criteriaMet: text.criteriaMet, headlines };
      await run(env.DB, "UPDATE alerts SET title = ?, description = ?, metric_snapshot = ? WHERE id = ?", [text.title, text.description, JSON.stringify(snapshot), alertId]);
    }
  } else if (surgeOpen && last24h < j.exit) {
    // Coverage has fallen back: the surge is over.
    if (alertId) await run(env.DB, "UPDATE alerts SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL", [now.toISOString(), alertId]);
    surgeOpen = 0;
    alertId = null;
  }

  const row: WatchRow = {
    query_id: q.id,
    last24h,
    usual: base.usual,
    basis_days: base.basisDays,
    busiest: base.busiest,
    baseline_at: stale ? now.toISOString() : prior!.baseline_at,
    surge_open: surgeOpen,
    alert_id: alertId,
    last_item_at: newest?.at ?? null,
    computed_at: now.toISOString(),
  };
  await run(
    env.DB,
    `INSERT INTO query_watch (query_id, last24h, usual, basis_days, busiest, baseline_at, surge_open, alert_id, last_item_at, computed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(query_id) DO UPDATE SET last24h = excluded.last24h, usual = excluded.usual, basis_days = excluded.basis_days, busiest = excluded.busiest,
       baseline_at = excluded.baseline_at, surge_open = excluded.surge_open, alert_id = excluded.alert_id, last_item_at = excluded.last_item_at, computed_at = excluded.computed_at`,
    [row.query_id, row.last24h, row.usual, row.basis_days, row.busiest, row.baseline_at, row.surge_open, row.alert_id, row.last_item_at, row.computed_at]
  );
  return toStatus(row, q);
}

/** The status the dashboard shows. Uses the stored row; works it out on the spot for a query the scheduled run has not reached yet. */
export async function getWatchStatus(env: Env, queryId: string): Promise<WatchStatus | null> {
  await ensureWatchTables(env);
  const qRow = await first<Record<string, unknown>>(env.DB, "SELECT * FROM monitoring_queries WHERE id = ?", [queryId]);
  if (!qRow) return null;
  const q = rowToMonitoringQuery(qRow);
  const row = await first<WatchRow>(env.DB, "SELECT * FROM query_watch WHERE query_id = ?", [queryId]);
  // Fresh enough: the scheduled run keeps it within WATCH_EVERY_MINUTES; allow for one missed run.
  if (row && Date.now() - Date.parse(row.computed_at) < WATCH_EVERY_MINUTES * 2 * 60_000) return toStatus(row, q);
  if (!q.is_active && row) return toStatus(row, q);
  return watchQuery(env, q, row);
}

/** The alerts the old scorer raised ("Elevated escalation: <query>") rest on
 *  a five-minute count and carry no criteria. They are closed, not deleted. */
async function retireOldSpikeAlerts(env: Env): Promise<void> {
  if ((await getState(env, "old_spike_alerts_retired")) === "1") return;
  await run(env.DB, `UPDATE alerts SET resolved_at = ? WHERE query_id IS NOT NULL AND resolved_at IS NULL AND title LIKE '% escalation: %' AND metric_snapshot NOT LIKE '%"kind"%'`, [nowIso()]);
  await setState(env, "old_spike_alerts_retired", "1");
}

/** The old scorer's table (escalation_snapshots) is no longer written or
 *  shown. It is emptied a little on each run rather than at once: a single
 *  large delete would count against the database's daily write allowance
 *  all in one go. Rows are taken in storage order, which needs no scan. */
async function trimOldSnapshots(env: Env): Promise<void> {
  if ((await getState(env, "snapshots_empty")) === "1") return;
  try {
    const res = await env.DB.prepare(`DELETE FROM escalation_snapshots WHERE rowid IN (SELECT rowid FROM escalation_snapshots LIMIT ${SNAPSHOT_TRIM_PER_RUN})`).run();
    if (Number(res.meta?.changes ?? 0) === 0) await setState(env, "snapshots_empty", "1");
  } catch (err) {
    // The table not existing is the same as it being empty.
    if (String(err).toLowerCase().includes("no such table")) await setState(env, "snapshots_empty", "1");
    else throw err;
  }
}

/** One run over every active query — called from the scheduled handler. */
export async function runQueryWatch(env: Env, now = new Date()): Promise<{ queries: number; surges: number }> {
  await ensureWatchTables(env);
  const [queryRows, watchRows] = await Promise.all([
    all<Record<string, unknown>>(env.DB, "SELECT * FROM monitoring_queries WHERE is_active = 1"),
    all<WatchRow>(env.DB, "SELECT * FROM query_watch"),
  ]);
  const prior = new Map(watchRows.map((r) => [r.query_id, r]));
  let surges = 0;
  for (const row of queryRows) {
    const q = rowToMonitoringQuery(row);
    try {
      const status = await watchQuery(env, q, prior.get(q.id) ?? null, now);
      if (status.state === "surge") surges++;
    } catch (err) {
      console.error(`[watch] query ${q.id} (${q.name}) failed:`, err);
    }
  }
  await retireOldSpikeAlerts(env).catch((err) => console.error("[watch] retiring old alerts failed", err));
  await trimOldSnapshots(env).catch((err) => console.error("[watch] trimming old snapshots failed", err));
  return { queries: queryRows.length, surges };
}

/** True on the scheduled ticks that should run the watch (the cron fires every five minutes). */
export const isWatchTick = (scheduledTime: number) => new Date(scheduledTime).getUTCMinutes() % WATCH_EVERY_MINUTES < 5;
