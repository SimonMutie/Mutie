import { Hono } from "hono";
import { all, first } from "../db";
import { canAccessQuery } from "../ownership";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { locateEventText } from "../lib/eventLocation";
import { sentimentFor, toneOf } from "../lib/sentiment";
import { extractTopics, queryWords } from "../lib/topics";
import { buildDigest, countTop, readAiSummary, writeAiSummary, type DayItem } from "../lib/daySummary";
import { groupStories } from "../lib/stories";
import { extractNames, risingTerms } from "../lib/names";
import { sourceMix } from "../lib/outlets";
import { evaluate, parseBooleanQuery } from "../booleanQuery";
import { getFlaggedIncidents, type IncidentView } from "../escalationIncidents";
import { ensureWatchTables, getWatchStatus } from "../queryWatch";
import { getTickBudget } from "../lib/gdeltAdaptiveBudget";
import { rowToAlert } from "../mappers";
import { run, nowIso } from "../db";
import { newId } from "../ids";
import { digestSchema, draftNotebook, ensureNotebookTables, getNotebook, NOTEBOOK_MAX, restorePrevious, saveNotebook } from "../lib/notebook";

/**
 * What a monitoring query's dashboard shows about the items the query has
 * collected: how many a day, their tone, what they talk about, where they
 * are, the items themselves, and a summary of any one day.
 *
 * Everything here is worked out from the stored items with ordinary code —
 * counting, a word list for tone (lib/sentiment.ts), recurring phrases for
 * topics (lib/topics.ts), the gazetteer for places. The one exception is
 * the optional AI text of a day's summary (lib/daySummary.ts).
 *
 * Days are the VIEWER's days: every route takes `tz`, the viewer's offset
 * from UTC in minutes (180 for Nairobi), and "5 October" means 5 October
 * there.
 */
export const queryInsightsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

queryInsightsRouter.use("*", requireAuth);

const DAY_MS = 86_400_000;
/** Tone and topics are worked out from at most this many of the most recent items in the period. */
const SAMPLE_LIMIT = 3000;
const MAP_POINT_LIMIT = 600;
/** The previous period's tone is estimated from this many of its most recent items. */
const PREVIOUS_TONE_SAMPLE = 800;
/** Top stories, names and rising terms are worked out from this many of the most recent items. */
const INSIGHT_SAMPLE = 1200;
const CONVERSATION_TYPES = new Set(["social", "forum", "darkweb"]);

interface Row {
  id: string;
  source_type: string;
  title: string | null;
  content: string | null;
  url: string | null;
  author: string | null;
  sentiment: number | null;
  published_at: string;
  ingested_at?: string | null;
}

const tzOf = (raw: string | undefined) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(-720, Math.min(840, Math.round(n))) : 0;
};
const sqlShift = (tz: number) => `${tz >= 0 ? "+" : "-"}${Math.abs(tz)} minutes`;
/** The viewer's calendar day ("2026-10-05") a moment falls on. */
const localDay = (iso: string, tz: number) => new Date(Date.parse(iso) + tz * 60_000).toISOString().slice(0, 10);
/** The UTC moments a viewer's calendar day starts and ends. */
function dayBounds(day: string, tz: number): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - tz * 60_000;
  return { from: new Date(start).toISOString(), to: new Date(start + DAY_MS).toISOString() };
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A stored row as the dashboard shows it. Stored content is "headline address text"; the address is dropped and the headline not repeated. */
function toItem(r: Row): DayItem {
  return locate(r).item;
}

function locate(r: Row): { item: DayItem; lat: number | null; lon: number | null; precision: string | null } {
  const body = (r.content ?? "").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  const title = (r.title ?? "").trim() || body.slice(0, 110);
  const rest = body.toLowerCase().startsWith(title.toLowerCase()) ? body.slice(title.length).replace(/^[\s.:–—-]+/, "") : body;
  const snippet = rest.length > 260 ? `${rest.slice(0, rest.lastIndexOf(" ", 260))}…` : rest;
  const conversation = CONVERSATION_TYPES.has(r.source_type);
  const loc = locateEventText(title, rest);
  const item: DayItem = {
    id: r.id,
    kind: conversation ? "conversation" : "event",
    source_type: r.source_type,
    title,
    snippet,
    url: r.url,
    source: conversation ? (r.author ?? null) : (hostOf(r.url) ?? r.author ?? null),
    published_at: r.published_at,
    sentiment: sentimentFor(r.sentiment, title, rest.slice(0, 500)),
    place: loc?.place ?? null,
    province: loc?.province ? `${loc.province}, ${loc.place.split(", ").pop()}` : null,
  };
  return { item, lat: loc?.lat ?? null, lon: loc?.lon ?? null, precision: loc?.precision ?? null };
}

const ROW_COLUMNS = "e.id, e.source_type, e.title, substr(e.content, 1, 900) AS content, e.url, e.author, e.sentiment, e.published_at, e.ingested_at";
const FROM_MATCHES = "FROM query_matches qm JOIN events e ON e.id = qm.event_id";

async function accessibleQuery(c: { env: Env; get: (k: "userId" | "role") => string }, queryId: string) {
  if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role") as never, queryId))) return null;
  return first<{ id: string; name: string; boolean_query: string; created_at?: string | null }>(c.env.DB, "SELECT * FROM monitoring_queries WHERE id = ?", [queryId]);
}

/** The start of the bucket a moment falls in for the place grid: its day, or the Monday of its week, in the viewer's time. */
function gridBucket(iso: string, tz: number, weekly: boolean): string {
  const local = new Date(Date.parse(iso) + tz * 60_000);
  if (weekly) local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return local.toISOString().slice(0, 10);
}

/** Where the items of a period are, period by period: the places most often named, each with its count per day (per week for a period over a fortnight). */
function placeTrend(items: DayItem[], from: string, to: string, tz: number) {
  const weekly = Date.parse(to) - Date.parse(from) > 14 * DAY_MS;
  const buckets: string[] = [];
  for (let t = Date.parse(from); ; t += DAY_MS) {
    const b = gridBucket(new Date(Math.min(t, Date.parse(to))).toISOString(), tz, weekly);
    if (buckets[buckets.length - 1] !== b) buckets.push(b);
    if (t >= Date.parse(to)) break;
  }
  const index = new Map(buckets.map((b, i) => [b, i]));
  const rows = new Map<string, { label: string; total: number; counts: number[] }>();
  for (const i of items) {
    if (!i.place) continue;
    const at = index.get(gridBucket(i.published_at, tz, weekly));
    if (at === undefined) continue;
    let r = rows.get(i.place);
    if (!r) rows.set(i.place, (r = { label: i.place, total: 0, counts: buckets.map(() => 0) }));
    r.total++;
    r.counts[at]++;
  }
  return { bucket: weekly ? ("week" as const) : ("day" as const), buckets, rows: [...rows.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label)).slice(0, 8) };
}

/** The period asked for: `from`/`to` (ISO), defaulting to the last 30 days. */
function periodOf(fromRaw: string | undefined, toRaw: string | undefined): { from: string; to: string } {
  const to = toRaw && Number.isFinite(Date.parse(toRaw)) ? new Date(toRaw) : new Date();
  const from = fromRaw && Number.isFinite(Date.parse(fromRaw)) ? new Date(fromRaw) : new Date(to.getTime() - 30 * DAY_MS);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * GET /:queryId/overview?from=&to=&tz=
 * Items per day (per hour for a period of two days or less), tone per day,
 * topics, and the located items for the map.
 */
queryInsightsRouter.get("/:queryId/overview", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  const tz = tzOf(c.req.query("tz"));
  const { from, to } = periodOf(c.req.query("from"), c.req.query("to"));
  const hourly = Date.parse(to) - Date.parse(from) <= 2 * DAY_MS;
  const bucketLen = hourly ? 13 : 10;

  // The period of the same length just before this one, for "change on the previous period".
  // Its items are counted by the same statement as this period's, so the comparison costs no second pass.
  const prevFrom = new Date(Date.parse(from) - (Date.parse(to) - Date.parse(from))).toISOString();
  // A query holds items from three days before it was written; before that there is nothing to compare with.
  const created = query.created_at ? Date.parse(query.created_at) : NaN;
  const prevPartial = Number.isFinite(created) && created - 3 * DAY_MS > Date.parse(prevFrom);

  // An item is matched when it is collected, which is at or after it was published. So nothing published in
  // the period was matched before the period began, and the match index can skip everything older — which,
  // for a query that has run for months, is most of what it holds. A day's margin allows for odd timestamps.
  const matchedSince = (iso: string) => new Date(Date.parse(iso) - DAY_MS).toISOString();

  const [allCounts, sample, prevSample] = await Promise.all([
    all<{ bucket: string | null; source_type: string; cur: number; count: number }>(
      c.env.DB,
      `SELECT substr(datetime(e.published_at, ?), 1, ${bucketLen}) AS bucket, e.source_type, (e.published_at >= ?) AS cur, COUNT(*) AS count
       ${FROM_MATCHES} WHERE qm.query_id = ? AND qm.matched_at >= ? AND e.published_at >= ? AND e.published_at <= ?
       GROUP BY bucket, e.source_type, cur`,
      [sqlShift(tz), from, query.id, matchedSince(prevFrom), prevFrom, to]
    ),
    all<Row>(c.env.DB, `SELECT ${ROW_COLUMNS} ${FROM_MATCHES} WHERE qm.query_id = ? AND qm.matched_at >= ? AND e.published_at >= ? AND e.published_at <= ? ORDER BY e.published_at DESC LIMIT ?`, [
      query.id,
      matchedSince(from),
      from,
      to,
      SAMPLE_LIMIT,
    ]),
    prevPartial
      ? Promise.resolve([] as Pick<Row, "title" | "content" | "sentiment">[])
      : all<Pick<Row, "title" | "content" | "sentiment">>(
          c.env.DB,
          `SELECT e.title, substr(e.content, 1, 500) AS content, e.sentiment ${FROM_MATCHES} WHERE qm.query_id = ? AND qm.matched_at >= ? AND e.published_at >= ? AND e.published_at < ? ORDER BY e.published_at DESC LIMIT ?`,
          [query.id, matchedSince(prevFrom), prevFrom, from, PREVIOUS_TONE_SAMPLE]
        ),
  ]);
  const counts = allCounts.filter((r) => Number(r.cur) === 1);
  const prevTotal = allCounts.filter((r) => Number(r.cur) !== 1).reduce((n, r) => n + Number(r.count), 0);
  let prevNegative: number | null = null;
  if (prevSample.length > 0) {
    let negative = 0;
    for (const r of prevSample) {
      const text = (r.content ?? "").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
      if (toneOf(sentimentFor(r.sentiment, r.title, text)) === "negative") negative++;
    }
    prevNegative = Number((negative / prevSample.length).toFixed(3));
  }

  // Every bucket in the period, including the empty ones, so the line shows quiet days as zero.
  const key = (ms: number) => new Date(ms + tz * 60_000).toISOString().slice(0, bucketLen);
  const step = hourly ? 3_600_000 : DAY_MS;
  const volume = new Map<string, { bucket: string; count: number; events: number; conversations: number }>();
  const firstLocal = Date.parse(from) + tz * 60_000;
  const startMs = Math.floor(firstLocal / step) * step - tz * 60_000;
  for (let t = startMs; t <= Date.parse(to); t += step) volume.set(key(t), { bucket: key(t), count: 0, events: 0, conversations: 0 });
  let total = 0;
  for (const row of counts) {
    if (!row.bucket) continue;
    const bucket = row.bucket.replace(" ", "T");
    const v = volume.get(bucket) ?? { bucket, count: 0, events: 0, conversations: 0 };
    v.count += row.count;
    if (CONVERSATION_TYPES.has(row.source_type)) v.conversations += row.count;
    else v.events += row.count;
    volume.set(bucket, v);
    total += row.count;
  }

  const located = sample.map(locate);
  const items = located.map((l) => l.item);
  const tone = new Map<string, { bucket: string; negative: number; neutral: number; positive: number; sum: number }>();
  const overall = { negative: 0, neutral: 0, positive: 0, sum: 0 };
  for (const i of items) {
    const bucket = hourly ? key(Date.parse(i.published_at)) : localDay(i.published_at, tz);
    const t = tone.get(bucket) ?? { bucket, negative: 0, neutral: 0, positive: 0, sum: 0 };
    const label = toneOf(i.sentiment);
    t[label]++;
    t.sum += i.sentiment;
    overall[label]++;
    overall.sum += i.sentiment;
    tone.set(bucket, t);
  }
  const average = (sum: number, n: number) => (n ? Number((sum / n).toFixed(3)) : 0);

  const points = located
    .filter((l) => l.lat != null && l.lon != null)
    .slice(0, MAP_POINT_LIMIT)
    .map(({ item: i, lat, lon, precision }) => ({ id: i.id, lat, lon, place: i.place, precision, title: i.title, snippet: i.snippet, url: i.url, source: i.source, kind: i.kind, published_at: i.published_at, sentiment: i.sentiment }));
  const locatedCount = located.filter((l) => l.lat != null).length;

  return c.json({
    queryId: query.id,
    from,
    to,
    tz,
    bucket: hourly ? "hour" : "day",
    total,
    volume: [...volume.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
    sentiment: {
      overall: { negative: overall.negative, neutral: overall.neutral, positive: overall.positive, average: average(overall.sum, items.length) },
      series: [...tone.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).map((t) => ({ bucket: t.bucket, negative: t.negative, neutral: t.neutral, positive: t.positive, average: average(t.sum, t.negative + t.neutral + t.positive) })),
    },
    topics: extractTopics(
      items.map((i) => ({ id: i.id, title: i.title, text: i.snippet, sentiment: i.sentiment })),
      { limit: 30, exclude: queryWords(query.boolean_query) }
    ),
    outlets: countTop(items.filter((i) => i.kind === "event").map((i) => i.source), 10),
    places: countTop(items.map((i) => i.place), 10),
    // Where the news outlets are based, relative to the countries the reporting is about.
    sourceMix: sourceMix(items.filter((i) => i.kind === "event").map((i) => ({ source: i.source, place: i.place }))),
    placeTrend: hourly ? null : placeTrend(items, from, to, tz),
    previous: { from: prevFrom, to: from, total: prevTotal, negative: prevNegative, partial: prevPartial },
    // When the newest of these items was collected (not when it was published).
    lastCollectedAt: sample.reduce<string | null>((best, r) => (r.ingested_at && (!best || r.ingested_at > best) ? r.ingested_at : best), null),
    points,
    located: locatedCount,
    // Tone, topics and the map are worked out from the most recent items when the period holds more than this.
    sampled: { used: items.length, total },
    fetchedAt: new Date().toISOString(),
  });
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * GET /:queryId/stream?from=&to=|day=&tz=&kind=&q=&limit=&offset=
 * The items themselves, newest first. `kind` is "event" (news) or
 * "conversation" (social and forum posts); `q` finds a word or phrase in the
 * headline or text.
 */
queryInsightsRouter.get("/:queryId/stream", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  const tz = tzOf(c.req.query("tz"));
  const day = c.req.query("day");
  const bounds = day ? dayBounds(day, tz) : periodOf(c.req.query("from"), c.req.query("to"));
  if (!bounds) return c.json({ error: "day must be YYYY-MM-DD" }, 400);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 500);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const where = ["qm.query_id = ?", "e.published_at >= ?", `e.published_at ${day ? "<" : "<="} ?`];
  const params: unknown[] = [query.id, bounds.from, bounds.to];
  const kind = c.req.query("kind");
  if (kind === "event") where.push("e.source_type NOT IN ('social','forum','darkweb')");
  else if (kind === "conversation") where.push("e.source_type IN ('social','forum','darkweb')");
  // D1 refuses LIKE patterns over 50 bytes; a longer phrase is searched by its opening.
  const q = (c.req.query("q") ?? "").trim().slice(0, 40);
  if (q) {
    let pattern = `%${escapeLike(q)}%`;
    while (new TextEncoder().encode(pattern).length > 50) pattern = `%${escapeLike(q.slice(0, pattern.length - 4))}%`;
    where.push("(e.title LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  const [rows, count] = await Promise.all([
    all<Row>(c.env.DB, `SELECT ${ROW_COLUMNS} ${FROM_MATCHES} WHERE ${where.join(" AND ")} ORDER BY e.published_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n ${FROM_MATCHES} WHERE ${where.join(" AND ")}`, params),
  ]);
  return c.json({ total: count?.n ?? 0, offset, limit, items: rows.map(toItem).map((i) => ({ ...i, tone: toneOf(i.sentiment) })) });
});

/** A day's items for its digest and summary: every item up to a ceiling. */
async function dayItems(env: Env, queryId: string, bounds: { from: string; to: string }): Promise<{ items: DayItem[]; total: number }> {
  const [rows, count] = await Promise.all([
    all<Row>(env.DB, `SELECT ${ROW_COLUMNS} ${FROM_MATCHES} WHERE qm.query_id = ? AND e.published_at >= ? AND e.published_at < ? ORDER BY e.published_at DESC LIMIT 1500`, [queryId, bounds.from, bounds.to]),
    first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n ${FROM_MATCHES} WHERE qm.query_id = ? AND e.published_at >= ? AND e.published_at < ?`, [queryId, bounds.from, bounds.to]),
  ]);
  return { items: rows.map(toItem), total: count?.n ?? rows.length };
}

/**
 * GET /:queryId/day?day=YYYY-MM-DD&tz=
 * One day: its digest (no AI) and, if one has been written, its AI summary.
 */
queryInsightsRouter.get("/:queryId/day", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  const tz = tzOf(c.req.query("tz"));
  const day = c.req.query("day") ?? "";
  const bounds = dayBounds(day, tz);
  if (!bounds) return c.json({ error: "day must be YYYY-MM-DD" }, 400);
  const { items, total } = await dayItems(c.env, query.id, bounds);
  const ai = await readAiSummary(c.env, query.id, day, tz, total).catch(() => ({ status: "none" as const }));
  return c.json({ day, tz, ...bounds, digest: buildDigest(items, total, queryWords(query.boolean_query)), ai });
});

/**
 * POST /:queryId/day-summary  { day, tz }
 * Writes (or returns the stored) AI summary of a day. Inside the free daily
 * AI allowance and its own daily count; says why when it cannot be written.
 */
queryInsightsRouter.post("/:queryId/day-summary", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { day?: string; tz?: number };
  const tz = tzOf(String(body.tz ?? 0));
  const day = String(body.day ?? "");
  const bounds = dayBounds(day, tz);
  if (!bounds) return c.json({ error: "day must be YYYY-MM-DD" }, 400);
  const { items, total } = await dayItems(c.env, query.id, bounds);
  const stored = await readAiSummary(c.env, query.id, day, tz, total);
  if (stored.status === "ready") return c.json(stored);
  try {
    return c.json(await writeAiSummary(c.env, query.id, query.name, day, tz, items, total));
  } catch (err) {
    console.error("[day-summary] failed", err);
    return c.json({ status: "unavailable", reason: "The summary could not be written just now. The digest below needs no AI." });
  }
});

// ── Stories, names and rising terms ──────────────────────────────────────

/** A short-lived answer cache, so that a dashboard left open (it refreshes itself) does not redo this work every few minutes. Per isolate; nothing is stored. */
const remembered = new Map<string, { at: number; value: unknown }>();
async function remember<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = remembered.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await compute();
  if (remembered.size > 200) remembered.clear();
  remembered.set(key, { at: Date.now(), value });
  return value;
}
/** Test hook. */
export function resetInsightCache(): void {
  remembered.clear();
}

/**
 * GET /:queryId/insights?from=&to=&tz=
 * What the period's reporting is made of: its top stories (reports of the
 * same event grouped, ranked by how many outlets carried them), the names
 * most often written, and the terms that rose within the period. Worked out
 * from headlines and openings with ordinary code; see lib/stories.ts and
 * lib/names.ts for exactly how, and for what each can get wrong.
 */
queryInsightsRouter.get("/:queryId/insights", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  const { from, to } = periodOf(c.req.query("from"), c.req.query("to"));
  // Ten-minute steps: a moving period asked for again a few minutes later is the same question.
  const key = `${query.id}|${from.slice(0, 15)}|${to.slice(0, 15)}`;
  const body = await remember(key, 5 * 60_000, async () => {
    const rows = await all<Row>(c.env.DB, `SELECT ${ROW_COLUMNS} ${FROM_MATCHES} WHERE qm.query_id = ? AND qm.matched_at >= ? AND e.published_at >= ? AND e.published_at <= ? ORDER BY e.published_at DESC LIMIT ?`, [
      query.id,
      new Date(Date.parse(from) - DAY_MS).toISOString(),
      from,
      to,
      INSIGHT_SAMPLE,
    ]);
    const items = rows.map(toItem);
    const exclude = queryWords(query.boolean_query);
    const docs = items.map((i) => ({ id: i.id, title: i.title, text: i.snippet, sentiment: i.sentiment, published_at: i.published_at }));
    // The halves are halves of the period asked for, not of whatever happens to have been collected.
    const splitAt = (Date.parse(from) + Date.parse(to)) / 2;
    return {
      stories: groupStories(items.filter((i) => i.kind === "event").map((i) => ({ id: i.id, title: i.title, url: i.url, source: i.source, published_at: i.published_at, sentiment: i.sentiment, place: i.place }))),
      names: extractNames(docs, { limit: 20, exclude, splitAt }),
      rising: risingTerms(docs, { limit: 10, exclude, splitAt }),
      splitAt: new Date(splitAt).toISOString(),
      used: items.length,
    };
  });
  return c.json({ queryId: query.id, from, to, ...body, fetchedAt: new Date().toISOString() });
});

// ── The watch: status, alerts, matching incidents, collection health ─────

/** A flagged incident as the alerts panel shows it. */
function incidentCard(i: IncidentView) {
  return {
    id: i.id,
    level: i.level,
    headline: i.headline,
    summary: i.summary,
    place: i.locationLabel ? `${i.locationLabel}, ${i.countryName}` : i.countryName,
    lat: i.lat,
    lon: i.lon,
    geoPrecision: i.geoPrecision,
    preliminary: i.preliminary,
    criteriaMet: i.criteriaMet,
    fatalitiesMax: i.fatalitiesMax,
    reportCount: i.reportCount,
    lastEventDate: i.lastEventDate,
    updatedAt: i.updatedAt,
    sources: i.sources.slice(0, 6).map((s) => ({ n: s.n, url: s.url, title: s.title, domain: s.domain })),
    sourceCount: i.sources.length,
  };
}

/** Everything about an incident the query's own wording can be tested against. */
const incidentText = (i: IncidentView) => [i.headline, i.summary, i.assessment, i.locationLabel, i.countryName, ...i.places, ...i.actors, ...i.sources.map((s) => s.title ?? "")].filter(Boolean).join(". ");

async function collectionHealth(env: Env) {
  const feeds = await remember("health:feeds", 10 * 60_000, async () => {
    try {
      const stub = env.AFRICA_WIRE_ACTOR.get(env.AFRICA_WIRE_ACTOR.idFromName("global"));
      const res = await stub.fetch("http://africa-wire-actor/health");
      return res.ok ? ((await res.json()) as { total: number; ok: number; no_feed: number; error: number; pending: number }) : null;
    } catch {
      return null;
    }
  });
  let search: { state: "off" | "ok" | "paused"; minutes?: number } = { state: "off" };
  if ((env.GDELT_ENABLED ?? "false") === "true") {
    try {
      const { cooldownRemainingMs } = await getTickBudget(env);
      search = cooldownRemainingMs > 0 ? { state: "paused", minutes: Math.ceil(cooldownRemainingMs / 60_000) } : { state: "ok" };
    } catch {
      search = { state: "ok" };
    }
  }
  return { feeds, search };
}

/**
 * GET /:queryId/watch
 * What the alerts panel shows: how the last 24 hours compare with what is
 * usual for this query; its open alerts; the escalation incidents (coded
 * against the written criteria by the incident pipeline) that this query's
 * own wording matches; the alerts most recently closed; and whether
 * collection is healthy.
 */
queryInsightsRouter.get("/:queryId/watch", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  await ensureWatchTables(c.env);

  // The status first: working it out is what opens or closes this query's surge alert, and the lists below must show the result.
  const status = await getWatchStatus(c.env, query.id).catch((err) => {
    console.error("[watch] status failed", err);
    return null;
  });
  const [alertRows, closedRows, flagged, health] = await Promise.all([
    all<Record<string, unknown>>(c.env.DB, "SELECT * FROM alerts WHERE query_id = ? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 20", [query.id]),
    all<Record<string, unknown>>(c.env.DB, "SELECT * FROM alerts WHERE query_id = ? AND resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 12", [query.id]),
    remember("flagged-incidents", 60_000, () => getFlaggedIncidents(c.env)).catch((err) => {
      console.error("[watch] incidents failed", err);
      return [] as IncidentView[];
    }),
    collectionHealth(c.env),
  ]);

  let incidents: ReturnType<typeof incidentCard>[] = [];
  try {
    const parsed = parseBooleanQuery(query.boolean_query);
    incidents = flagged.filter((i) => evaluate(parsed, { content: incidentText(i), title: i.headline })).map(incidentCard);
  } catch {
    incidents = []; // a query that cannot be parsed matches nothing
  }

  // Alerts the retired five-minute scorer raised carry no criteria; they are not listed as history.
  const closed = closedRows
    .map(rowToAlert)
    .filter((a) => (a.metric_snapshot as { kind?: string } | undefined)?.kind === "surge")
    .slice(0, 5);

  return c.json({ queryId: query.id, status, alerts: alertRows.map(rowToAlert), incidents, closed, health, fetchedAt: new Date().toISOString() });
});

// ── Notes on the timeline ────────────────────────────────────────────────

const NOTE_MAX = 600;

/** GET /:queryId/notes — the analyst's notes on this query, each pinned to a day. */
queryInsightsRouter.get("/:queryId/notes", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  await ensureWatchTables(c.env);
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT id, day, body, author_id, author_name, created_at FROM query_notes WHERE query_id = ? ORDER BY day DESC, created_at DESC LIMIT 500", [query.id]);
  return c.json(rows);
});

/** POST /:queryId/notes { day: "YYYY-MM-DD", body } */
queryInsightsRouter.post("/:queryId/notes", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  const input = (await c.req.json().catch(() => ({}))) as { day?: string; body?: string };
  const day = String(input.day ?? "");
  const body = String(input.body ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return c.json({ error: "day must be YYYY-MM-DD" }, 400);
  if (!body) return c.json({ error: "A note needs some text." }, 400);
  if (body.length > NOTE_MAX) return c.json({ error: `A note can be at most ${NOTE_MAX} characters.` }, 400);
  await ensureWatchTables(c.env);
  const author = await first<{ display_name: string | null; username: string | null }>(c.env.DB, "SELECT display_name, username FROM users WHERE id = ?", [c.get("userId")]).catch(() => null);
  const note = { id: newId(), day, body, author_id: c.get("userId"), author_name: author?.display_name || author?.username || null, created_at: nowIso() };
  await run(c.env.DB, "INSERT INTO query_notes (id, query_id, day, body, author_id, author_name, created_at) VALUES (?,?,?,?,?,?,?)", [note.id, query.id, note.day, note.body, note.author_id, note.author_name, note.created_at]);
  return c.json(note, 201);
});

/** DELETE /:queryId/notes/:noteId — by whoever wrote it, or an admin. */
queryInsightsRouter.delete("/:queryId/notes/:noteId", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  await ensureWatchTables(c.env);
  const note = await first<{ author_id: string | null }>(c.env.DB, "SELECT author_id FROM query_notes WHERE id = ? AND query_id = ?", [c.req.param("noteId"), query.id]);
  if (!note) return c.json({ error: "Note not found" }, 404);
  if (c.get("role") !== "admin" && note.author_id !== c.get("userId")) return c.json({ error: "Only the person who wrote a note can delete it." }, 403);
  await run(c.env.DB, "DELETE FROM query_notes WHERE id = ?", [c.req.param("noteId")]);
  return c.json({ ok: true });
});

// ── The Analyst Notebook's analytical summary ────────────────────────────

async function authorName(c: { env: Env; get: (k: "userId") => string }): Promise<string | null> {
  const a = await first<{ display_name: string | null; username: string | null }>(c.env.DB, "SELECT display_name, username FROM users WHERE id = ?", [c.get("userId")]).catch(() => null);
  return a?.display_name || a?.username || null;
}

const emptyNotebook = (queryId: string) => ({ query_id: queryId, body: "", previous_body: null, source: "manual", model: null, period_from: null, period_to: null, generated_at: null, updated_at: null, updated_by_name: null });

/** GET /:queryId/notebook — the shared summary text, or an empty one. */
queryInsightsRouter.get("/:queryId/notebook", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  return c.json((await getNotebook(c.env, query.id)) ?? emptyNotebook(query.id));
});

/** PUT /:queryId/notebook { body, expected_updated_at } — the analyst's own edit. */
queryInsightsRouter.put("/:queryId/notebook", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  const input = (await c.req.json().catch(() => ({}))) as { body?: unknown; expected_updated_at?: unknown };
  if (typeof input.body !== "string") return c.json({ error: "body must be text" }, 400);
  if (input.body.length > NOTEBOOK_MAX) return c.json({ error: `The summary can be at most ${NOTEBOOK_MAX.toLocaleString()} characters.` }, 400);
  const result = await saveNotebook(c.env, query.id, input.body, typeof input.expected_updated_at === "string" ? input.expected_updated_at : null, await authorName(c));
  return result.ok ? c.json(result.row) : c.json({ error: result.error }, result.status);
});

/** POST /:queryId/notebook/draft { digest } — the model's reading of the dashboard, replacing the text (the old text is kept for "restore"). */
queryInsightsRouter.post("/:queryId/notebook/draft", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  const parsed = digestSchema.safeParse(((await c.req.json().catch(() => ({}))) as { digest?: unknown }).digest);
  if (!parsed.success) return c.json({ error: "The dashboard's figures could not be read. Reload the page and try again." }, 400);
  const result = await draftNotebook(c.env, query, parsed.data, await authorName(c));
  return result.ok ? c.json(result.row) : c.json({ error: result.error }, result.status);
});

/** POST /:queryId/notebook/restore — swaps back to the text a redraft replaced. */
queryInsightsRouter.post("/:queryId/notebook/restore", async (c) => {
  const query = await accessibleQuery(c, c.req.param("queryId"));
  if (!query) return c.json({ error: "Query not found" }, 404);
  await ensureNotebookTables(c.env);
  const row = await restorePrevious(c.env, query.id, await authorName(c));
  return row ? c.json(row) : c.json({ error: "There is no earlier text to restore." }, 404);
});
