import { Hono } from "hono";
import { all, first } from "../db";
import { canAccessQuery } from "../ownership";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { locateEventText } from "../lib/eventLocation";
import { sentimentFor, toneOf } from "../lib/sentiment";
import { extractTopics, queryWords } from "../lib/topics";
import { buildDigest, countTop, readAiSummary, writeAiSummary, type DayItem } from "../lib/daySummary";

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
  };
  return { item, lat: loc?.lat ?? null, lon: loc?.lon ?? null, precision: loc?.precision ?? null };
}

const ROW_COLUMNS = "e.id, e.source_type, e.title, substr(e.content, 1, 900) AS content, e.url, e.author, e.sentiment, e.published_at";
const FROM_MATCHES = "FROM query_matches qm JOIN events e ON e.id = qm.event_id";

async function accessibleQuery(c: { env: Env; get: (k: "userId" | "role") => string }, queryId: string) {
  if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role") as never, queryId))) return null;
  return first<{ id: string; name: string; boolean_query: string }>(c.env.DB, "SELECT id, name, boolean_query FROM monitoring_queries WHERE id = ?", [queryId]);
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

  const [counts, sample] = await Promise.all([
    all<{ bucket: string | null; source_type: string; count: number }>(
      c.env.DB,
      `SELECT substr(datetime(e.published_at, ?), 1, ${bucketLen}) AS bucket, e.source_type, COUNT(*) AS count
       ${FROM_MATCHES} WHERE qm.query_id = ? AND e.published_at >= ? AND e.published_at <= ?
       GROUP BY bucket, e.source_type`,
      [sqlShift(tz), query.id, from, to]
    ),
    all<Row>(c.env.DB, `SELECT ${ROW_COLUMNS} ${FROM_MATCHES} WHERE qm.query_id = ? AND e.published_at >= ? AND e.published_at <= ? ORDER BY e.published_at DESC LIMIT ?`, [query.id, from, to, SAMPLE_LIMIT]),
  ]);

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
