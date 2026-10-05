import { Hono } from "hono";
import { z } from "zod";
import { all, nowIso } from "../db";
import { newId } from "../ids";
import { validateBooleanQuery, parseBooleanQuery, evaluate } from "../booleanQuery";
import { rowToMonitoringQuery } from "../mappers";
import { canAccessQuery } from "../ownership";
import { primeQuery } from "../ingest";
import { buildSearchPlan, toGdeltQueries, toSqlPrefilter } from "../lib/querySearchPlan";
import { fetchGdeltArticles, parseGdeltDate, GdeltRateLimitError } from "../connectors/gdelt";
import { withTextLocation, locateEventText } from "../lib/eventLocation";
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
const LIVE_PREVIEW_LIMIT = 30;
const LIVE_PREVIEW_CACHE_SECONDS = 600;

interface LivePreviewArticle {
  title: string;
  url: string;
  domain: string | null;
  published_at: string;
  /** Where the headline says the story is, when it names a place. */
  place: string | null;
}

interface LivePreview {
  /** "ok" — searched; "unsearchable" — the query has nothing a news search
   *  can use (e.g. only NOT clauses or two-letter terms); "busy" — the news
   *  search service refused the request for now; "error" — it failed. */
  status: "ok" | "unsearchable" | "busy" | "error";
  /** The search actually sent, so the user can see how the query was read. */
  search: string | null;
  /** True when the search is logically the same as the query. False when
   *  the query has parts a news search cannot express (NOT, NEAR, field
   *  scopes), which the platform applies itself after fetching. */
  exact: boolean;
  articles: LivePreviewArticle[];
  message: string | null;
}

/** A live news search for the query being typed — what the query WILL fetch
 *  once saved, over the last three days. Cached for ten minutes per search
 *  string: the search service is a shared, rate-limited public API, and an
 *  editor preview must not hammer it. */
async function liveNewsPreview(booleanAst: Parameters<typeof buildSearchPlan>[0]): Promise<LivePreview> {
  const plan = buildSearchPlan(booleanAst);
  const searches = toGdeltQueries(plan);
  if (searches.length === 0) {
    return { status: "unsearchable", search: null, exact: false, articles: [], message: "This query has no word or phrase of three or more letters that a news search can look for." };
  }
  const search = searches[0];
  const cacheKey = new Request(`https://query-preview.internal/gdelt?q=${encodeURIComponent(search)}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const cached = await cache.match(cacheKey).catch(() => undefined);
  if (cached) return (await cached.json()) as LivePreview;

  try {
    const found = await fetchGdeltArticles(search, 75, "3d");
    const seen = new Set<string>();
    const articles: LivePreviewArticle[] = [];
    for (const a of found) {
      const key = (a.title ?? "").toLowerCase().trim();
      if (!a.url || !a.title || seen.has(key)) continue; // the same wire story republished under one headline
      seen.add(key);
      articles.push({ title: a.title, url: a.url, domain: a.domain ?? null, published_at: parseGdeltDate(a.seendate).toISOString(), place: locateEventText(a.title, null)?.place ?? null });
      if (articles.length >= LIVE_PREVIEW_LIMIT) break;
    }
    const result: LivePreview = { status: "ok", search, exact: plan.exact, articles, message: null };
    await cache
      .put(cacheKey, new Response(JSON.stringify(result), { headers: { "content-type": "application/json", "cache-control": `max-age=${LIVE_PREVIEW_CACHE_SECONDS}` } }))
      .catch(() => {});
    return result;
  } catch (err) {
    if (err instanceof GdeltRateLimitError) {
      return { status: "busy", search, exact: plan.exact, articles: [], message: "The news search service is limiting requests right now. Wait a minute and edit the query to try again." };
    }
    return { status: "error", search, exact: plan.exact, articles: [], message: "The news search did not respond. The query can still be saved; it will keep trying in the background." };
  }
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

  const livePromise: Promise<LivePreview | null> = body.live === true ? liveNewsPreview(parsed.ast) : Promise.resolve(null);

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
