import { checkStock } from "../lib/quota";
import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso } from "../db";
import { newId } from "../ids";
import { validateBooleanQuery, parseBooleanQuery, evaluate } from "../booleanQuery";
import { rowToMonitoringQuery } from "../mappers";
import { canAccessQuery } from "../ownership";
import { primeQuery } from "../ingest";
import { buildSearchPlan, toGdeltQueries, toSqlPrefilter } from "../lib/querySearchPlan";
import { fetchGdeltArticles, parseGdeltDate, GdeltRateLimitError } from "../connectors/gdelt";
import { withTextLocation, locateEventText } from "../lib/eventLocation";
import { searchFeeds } from "../lib/feedSearch";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const queriesRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

queriesRouter.use("*", requireAuth);

const createSchema = z.object({
  name: z.string().min(1),
  boolean_query: z.string().min(1),
  category: z.string().default("general"),
  baseline_window_minutes: z.number().int().positive().default(60),
  elevated_threshold: z.number().positive().default(2.5),
  critical_threshold: z.number().positive().default(4.0),
});

/** Admins see every query (including unowned "house" ones); clients see only their own. Includes a 2h match count for the query list UI. */
queriesRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const twoHoursAgo = new Date(Date.now() - 120 * 60_000).toISOString();

  const baseSql = `
    SELECT q.*, COUNT(qm.id) AS match_count
    FROM monitoring_queries q
    LEFT JOIN query_matches qm ON qm.query_id = q.id AND qm.matched_at > ?
    ${isAdmin ? "" : "WHERE q.owner_id = ?"}
    GROUP BY q.id
    ORDER BY q.created_at DESC
  `;
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    baseSql,
    isAdmin ? [twoHoursAgo] : [twoHoursAgo, c.get("userId")]
  );
  return c.json(rows.map((row) => ({ ...rowToMonitoringQuery(row), match_count: Number(row.match_count ?? 0) })));
});

queriesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const validationError = validateBooleanQuery(parsed.data.boolean_query);
  if (validationError) {
    return c.json({ error: `Invalid boolean query: ${validationError}` }, 400);
  }

  if (c.get("role") !== "admin") {
    const owned = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM monitoring_queries WHERE owner_id IN (SELECT id FROM users WHERE client_id = (SELECT client_id FROM users WHERE id = ?) OR id = ?)`, [c.get("userId"), c.get("userId")]);
    const over = await checkStock(c, "monitoring_queries", owned?.n ?? 0);
    if (over) return over;
  }

  const id = newId();
  const now = nowIso();
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `INSERT INTO monitoring_queries
      (id, name, boolean_query, category, baseline_window_minutes, elevated_threshold, critical_threshold, owner_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *`,
    [
      id,
      parsed.data.name,
      parsed.data.boolean_query,
      parsed.data.category,
      parsed.data.baseline_window_minutes,
      parsed.data.elevated_threshold,
      parsed.data.critical_threshold,
      c.get("userId"),
      now,
      now,
    ]
  );

  // In the background, so creation itself stays fast: a first news search
  // for exactly what this query asks for (last three days), then a scan of
  // what is already held. The dashboard picks the matches up on its next poll.
  c.executionCtx.waitUntil(
    primeQuery(c.env, id, parsed.data.boolean_query, c.get("userId")).catch((err) => console.error(`[query-prime] failed for query ${id}:`, err))
  );

  return c.json(rowToMonitoringQuery(rows[0]), 201);
});

queriesRouter.post("/validate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const booleanQuery = (body as Record<string, unknown>)?.boolean_query;
  if (typeof booleanQuery !== "string") {
    return c.json({ error: "boolean_query must be a string" }, 400);
  }
  const error = validateBooleanQuery(booleanQuery);
  return c.json({ valid: error === null, error });
});

const PREVIEW_LOOKBACK_HOURS = 72;
const PREVIEW_SCAN_LIMIT = 3000; // how many candidate rows to examine at most
const PREVIEW_PAGE_SIZE = 250; // read a page at a time — see the route's doc comment
const PREVIEW_RESULT_LIMIT = 20; // how many matches to actually return
const LIVE_PREVIEW_LIMIT = 40;
const LIVE_PREVIEW_CACHE_SECONDS = 600;

interface LivePreviewArticle {
  title: string;
  url: string;
  domain: string | null;
  published_at: string;
  /** Where the headline says the story is, when it names a place. */
  place: string | null;
  /** "feeds" — from the news feeds the platform crawls itself;
   *  "search" — from the wider news search (GDELT). */
  source: "feeds" | "search";
}

interface LivePreview {
  /** "ok" — there is a result to show (possibly an empty one);
   *  "busy" — nothing in the platform's feeds, and the wider news search
   *  refused the request for now; "error" — likewise, but it failed. */
  status: "ok" | "busy" | "error";
  /** The wider search actually sent, so the user can see how the query was
   *  read. Null when the query has nothing that search can look for. */
  search: string | null;
  /** True when that search is logically the same as the query. False when
   *  the query has parts a news search cannot express (NOT, NEAR, field
   *  scopes), which the platform applies itself after fetching. */
  exact: boolean;
  articles: LivePreviewArticle[];
  /** Why there is nothing to show (status busy / error). */
  message: string | null;
  /** Shown above the list when it is incomplete, e.g. the wider search was
   *  rate-limited and only the platform's own feeds are listed. */
  notice: string | null;
}

type WiderSearch = { state: "ok"; articles: LivePreviewArticle[] } | { state: "unsearchable" | "busy" | "error" };

/** The wider news search (GDELT) for a query, over the last three days.
 *  Cached for ten minutes per search string: it is a shared, rate-limited
 *  public API, and an editor preview must not hammer it. Only successful
 *  searches are cached. */
async function widerNewsSearch(search: string | undefined): Promise<WiderSearch> {
  if (!search) return { state: "unsearchable" };
  const cacheKey = new Request(`https://query-preview.internal/gdelt-v2?q=${encodeURIComponent(search)}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(cacheKey).catch(() => undefined);
  if (cached) return { state: "ok", articles: (await cached.json()) as LivePreviewArticle[] };
  try {
    const found = await fetchGdeltArticles(search, 75, "3d");
    const articles: LivePreviewArticle[] = [];
    for (const a of found) {
      if (!a.url || !a.title) continue;
      articles.push({ title: a.title, url: a.url, domain: a.domain ?? null, published_at: parseGdeltDate(a.seendate).toISOString(), place: locateEventText(a.title, null)?.place ?? null, source: "search" });
    }
    await cache
      .put(cacheKey, new Response(JSON.stringify(articles), { headers: { "content-type": "application/json", "cache-control": `max-age=${LIVE_PREVIEW_CACHE_SECONDS}` } }))
      .catch(() => {});
    return { state: "ok", articles };
  } catch (err) {
    if (!(err instanceof GdeltRateLimitError)) console.error(`[query-preview] wider news search failed for "${search}":`, err);
    return { state: err instanceof GdeltRateLimitError ? "busy" : "error" };
  }
}

/** What the query being typed will fetch once saved, over the last three
 *  days, from both of its sources:
 *
 *   - the news feeds the platform crawls itself (always available), and
 *   - the wider news search, GDELT (broader, but often rate-limited).
 *
 *  When the wider search is unavailable the feed matches are still shown,
 *  with a notice saying the list is partial — the preview used to show
 *  nothing but "limiting requests" in that case. */
async function liveNewsPreview(env: Env, booleanQuery: string, parsed: ReturnType<typeof parseBooleanQuery>): Promise<LivePreview> {
  const plan = buildSearchPlan(parsed.ast);
  const search = toGdeltQueries(plan)[0];
  const [feedHits, wider] = await Promise.all([
    searchFeeds(env, [{ id: "preview", text: booleanQuery, parsed }], 72, LIVE_PREVIEW_LIMIT),
    widerNewsSearch(search),
  ]);

  const articles: LivePreviewArticle[] = [];
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const add = (a: LivePreviewArticle) => {
    const titleKey = a.title.toLowerCase().trim();
    if (seenUrls.has(a.url) || seenTitles.has(titleKey)) return; // the same story republished under one headline
    seenUrls.add(a.url);
    seenTitles.add(titleKey);
    articles.push(a);
  };
  for (const f of feedHits.get("preview") ?? []) {
    add({ title: f.title, url: f.link, domain: f.domain, published_at: f.published, place: locateEventText(f.title, f.text)?.place ?? null, source: "feeds" });
  }
  const fromFeeds = articles.length;
  if (wider.state === "ok") wider.articles.forEach(add);
  articles.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  const base = { search: search ?? null, exact: plan.exact, articles: articles.slice(0, LIVE_PREVIEW_LIMIT) };

  if (wider.state === "ok") return { status: "ok", ...base, message: null, notice: null };
  if (wider.state === "unsearchable") {
    return { status: "ok", ...base, message: null, notice: "Only the platform's own news feeds were checked: the wider news search needs a word or phrase of at least three letters to look for." };
  }
  const why = wider.state === "busy" ? "is limiting requests right now" : "did not respond";
  if (fromFeeds > 0) {
    return { status: "ok", ...base, message: null, notice: `This list is from the platform's own news feeds only. The wider news search ${why}; press Search again in a minute to add its results.` };
  }
  return {
    status: wider.state,
    ...base,
    message: `Nothing in the platform's own news feeds matches this query, and the wider news search ${why}. Press Search again in a minute. The query can be saved in the meantime; it keeps fetching in the background.`,
    notice: null,
  };
}

/** Read-only preview for the query editor. Two parts:
 *
 *  - `matches`: articles the platform already holds that match the query,
 *    judged by the same evaluate() used for real ingestion.
 *  - `live` (only when the request sets `live: true`): a live news search
 *    for the query — what it will start fetching once saved.
 *
 *  The scan of held articles is pre-filtered in SQL to rows that could
 *  match and read a page at a time. It used to select the 3,000 newest
 *  articles with their full text in one statement, which is what failed
 *  with a 500 once the table had grown. */
queriesRouter.post("/preview", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const booleanQuery = body?.boolean_query;
  if (typeof booleanQuery !== "string" || booleanQuery.trim().length === 0) {
    return c.json({ error: "boolean_query must be a non-empty string" }, 400);
  }

  let parsed;
  try {
    parsed = parseBooleanQuery(booleanQuery);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Invalid boolean query" }, 400);
  }

  const livePromise: Promise<LivePreview | null> = body.live === true ? liveNewsPreview(c.env, booleanQuery, parsed) : Promise.resolve(null);

  const cutoff = new Date(Date.now() - PREVIEW_LOOKBACK_HOURS * 60 * 60_000).toISOString();
  const prefilter = toSqlPrefilter(buildSearchPlan(parsed.ast));
  const matches: Record<string, unknown>[] = [];
  let scanned = 0;
  let storedError: string | null = null;
  try {
    scan: for (let offset = 0; offset < PREVIEW_SCAN_LIMIT; offset += PREVIEW_PAGE_SIZE) {
      const rows = await all<Record<string, unknown>>(
        c.env.DB,
        `SELECT id, source_type, title, content, url, author, published_at, geo_lat, geo_lng, geo_label, raw_metadata
         FROM events WHERE published_at > ?${prefilter ? ` AND ${prefilter.sql}` : ""}
         ORDER BY published_at DESC LIMIT ? OFFSET ?`,
        [cutoff, ...(prefilter?.params ?? []), PREVIEW_PAGE_SIZE, offset]
      );
      for (const raw of rows) {
        scanned++;
        const fields = {
          content: String(raw.content ?? ""),
          title: (raw.title as string | null) ?? null,
          url: (raw.url as string | null) ?? null,
          domain: (raw.author as string | null) ?? null,
        };
        if (!evaluate(parsed, fields)) continue;
        const row = withTextLocation(raw);
        matches.push({
          id: row.id,
          source_type: row.source_type,
          title: row.title,
          content: String(row.content ?? "").slice(0, 400),
          url: row.url,
          published_at: row.published_at,
          geo_label: row.geo_label,
        });
        if (matches.length >= PREVIEW_RESULT_LIMIT) break scan;
      }
      if (rows.length < PREVIEW_PAGE_SIZE) break;
    }
  } catch (err) {
    // The live search below is still worth returning if the stored scan fails.
    console.error("[query-preview] stored-article scan failed:", err);
    storedError = err instanceof Error ? err.message : "Could not read stored articles";
  }

  const live = await livePromise;
  if (storedError && !live) return c.json({ error: `Could not check stored articles: ${storedError}` }, 500);

  return c.json({
    matches,
    scanned,
    lookback_hours: PREVIEW_LOOKBACK_HOURS,
    truncated: matches.length >= PREVIEW_RESULT_LIMIT,
    stored_error: storedError,
    live,
  });
});

const PATCHABLE_FIELDS = [
  "name",
  "boolean_query",
  "category",
  "is_active",
  "baseline_window_minutes",
  "elevated_threshold",
  "critical_threshold",
] as const;

queriesRouter.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), id))) {
    return c.json({ error: "Query not found" }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const updates: string[] = [];
  const values: unknown[] = [];

  for (const field of PATCHABLE_FIELDS) {
    if (field in body) {
      if (field === "boolean_query") {
        const err = validateBooleanQuery(String(body.boolean_query));
        if (err) return c.json({ error: `Invalid boolean query: ${err}` }, 400);
      }
      // The surge multiples (see queryWatch.ts) must be real numbers above one: a multiple of one or less would call every ordinary day a surge.
      if (field === "elevated_threshold" || field === "critical_threshold") {
        const n = Number(body[field]);
        if (!Number.isFinite(n) || n < 1.2 || n > 50) return c.json({ error: "The surge setting must be a number between 1.2 and 50." }, 400);
        updates.push(`${field} = ?`);
        values.push(n);
        continue;
      }
      updates.push(`${field} = ?`);
      values.push(field === "is_active" ? (body[field] ? 1 : 0) : body[field]);
    }
  }
  if (updates.length === 0) return c.json({ error: "No valid fields to update" }, 400);

  updates.push("updated_at = ?");
  values.push(nowIso());
  values.push(id);

  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `UPDATE monitoring_queries SET ${updates.join(", ")} WHERE id = ? RETURNING *`,
    values
  );
  if (rows.length === 0) return c.json({ error: "Query not found" }, 404);
  const updated = rowToMonitoringQuery(rows[0]);
  // A changed query text needs fresh results for its new meaning.
  if ("boolean_query" in body && updated.is_active) {
    c.executionCtx.waitUntil(
      primeQuery(c.env, id, updated.boolean_query, updated.owner_id).catch((err) => console.error(`[query-prime] failed for query ${id}:`, err))
    );
  }
  return c.json(updated);
});

queriesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), id))) {
    return c.json({ error: "Query not found" }, 404);
  }
  await c.env.DB.prepare("DELETE FROM monitoring_queries WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});
