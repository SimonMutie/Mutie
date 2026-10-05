import { all, run, nowIso, batchRun } from "./db";
import { newId } from "./ids";
import { generateEvent, type GeneratedEvent } from "./mockGenerator";
import { evaluate, parseBooleanQuery, type ParsedQuery } from "./booleanQuery";
import { rowToMonitoringQuery } from "./mappers";
import type { Env } from "./bindings";
import type { EventRecord } from "./types";
import { buildQueryChunks, pollGdelt, type PollGdeltOptions } from "./connectors/gdelt";
import { buildSearchPlan, toGdeltQueries, toSqlPrefilter } from "./lib/querySearchPlan";
import { searchFeeds, type FeedArticle } from "./lib/feedSearch";
import { locateEventText, TEXT_LOCATED } from "./lib/eventLocation";
import { detectNonEnglish } from "./lib/translate";

export interface CompiledQuery {
  id: string;
  ownerId: string | null;
  parsed: ParsedQuery;
  /** The query as written. */
  text: string;
}

/**
 * Loads active monitoring queries and parses them fresh. Unlike the original
 * long-lived Node process (which kept a module-level AST cache warm for a
 * ~1/sec ingestion loop), each ingestion tick here runs as its own Durable
 * Object alarm invocation, so we just re-read+parse the (small) active query
 * set every time rather than trying to keep a cache coherent across isolates.
 */
export async function loadActiveCompiledQueries(env: Env): Promise<CompiledQuery[]> {
  const rows = await all<Record<string, unknown>>(env.DB, "SELECT * FROM monitoring_queries WHERE is_active = 1");
  const compiled: CompiledQuery[] = [];
  for (const row of rows) {
    const q = rowToMonitoringQuery(row);
    try {
      compiled.push({ id: q.id, ownerId: q.owner_id, parsed: parseBooleanQuery(q.boolean_query), text: q.boolean_query });
    } catch (err) {
      console.error(`[ingest] failed to compile query ${q.id} (${q.name}):`, err);
    }
  }
  return compiled;
}

/** ownerIds tells LiveFeedHub which clients' sockets should receive this broadcast (admins always do). */
async function broadcast(env: Env, type: string, payload: unknown, ownerIds: string[]) {
  const id = env.LIVE_FEED.idFromName("global");
  await env.LIVE_FEED.get(id).fetch("http://live-feed/broadcast", {
    method: "POST",
    body: JSON.stringify({ type, payload, ownerIds }),
  });
}

/** True when only the article's headline and URL were stored — its body
 *  could not be fetched, so the query engine has almost nothing to check an
 *  AND query against. */
function lacksFullText(rawMetadata: unknown): boolean {
  let meta: { fulltext?: boolean } = {};
  try {
    meta = typeof rawMetadata === "string" ? JSON.parse(rawMetadata) : ((rawMetadata as typeof meta) ?? {});
  } catch {
    meta = {};
  }
  return meta.fulltext !== true;
}

async function matchAgainstQueries(
  env: Env,
  event: EventRecord,
  compiled: CompiledQuery[],
  /** A query whose own structure-exact news search returned this article.
   *  When the article's body could not be fetched, that search result (made
   *  against the full text on GDELT's side) is accepted as the match,
   *  because the headline alone would wrongly fail an AND query. */
  trustedQueryId?: string
): Promise<{ matchedQueryIds: string[]; ownerIds: string[] }> {
  const matchedQueryIds: string[] = [];
  const ownerIds = new Set<string>();
  const trustSearch = !!trustedQueryId && lacksFullText(event.raw_metadata);
  for (const { id: queryId, ownerId, parsed } of compiled) {
    if ((trustSearch && queryId === trustedQueryId) || evaluate(parsed, { content: event.content, title: event.title, url: event.url, domain: event.author })) {
      matchedQueryIds.push(queryId);
      if (ownerId) ownerIds.add(ownerId);
      await run(env.DB, `INSERT OR IGNORE INTO query_matches (id, query_id, event_id, matched_at) VALUES (?,?,?,?)`, [
        newId(),
        queryId,
        event.id,
        nowIso(),
      ]);
    }
  }
  return { matchedQueryIds, ownerIds: Array.from(ownerIds) };
}

async function insertMockEvent(env: Env, ev: GeneratedEvent): Promise<EventRecord> {
  const sourceRows = await all<{ id: string }>(env.DB, "SELECT id FROM sources WHERE type = ? LIMIT 1", [ev.source_type]);
  const sourceId = sourceRows[0]?.id ?? null;
  const id = newId();
  const now = nowIso();
  const publishedAt = ev.published_at.toISOString();

  await run(
    env.DB,
    `INSERT INTO events
      (id, source_id, source_type, author, title, content, url, lang, sentiment, published_at, ingested_at, geo_lat, geo_lng, geo_label, raw_metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      sourceId,
      ev.source_type,
      ev.author,
      ev.content, // mock events don't distinguish a headline from body — title mirrors content so title:/titleCharCount: still work against something
      ev.content,
      ev.url,
      ev.lang,
      ev.sentiment,
      publishedAt,
      now,
      ev.geo_lat,
      ev.geo_lng,
      ev.geo_label,
      "{}",
    ]
  );

  return {
    id,
    source_id: sourceId,
    source_type: ev.source_type,
    external_id: null,
    author: ev.author,
    title: ev.content,
    content: ev.content,
    url: ev.url,
    lang: ev.lang,
    sentiment: ev.sentiment,
    published_at: publishedAt,
    ingested_at: now,
    geo_lat: ev.geo_lat,
    geo_lng: ev.geo_lng,
    geo_label: ev.geo_label,
    raw_metadata: {},
  };
}

/** Evaluate a freshly-inserted event (from any connector, not just the mock generator)
 *  against all active queries and broadcast it to connected dashboards. */
export async function matchAndBroadcast(env: Env, event: EventRecord, trustedQueryId?: string) {
  const compiled = await loadActiveCompiledQueries(env);
  const { matchedQueryIds, ownerIds } = await matchAgainstQueries(env, event, compiled, trustedQueryId);
  await broadcast(env, "event", { ...event, matched_query_ids: matchedQueryIds }, ownerIds);
  return matchedQueryIds;
}

/** One mock-ingestion tick: generate a synthetic event, store it, match, broadcast. Called from IngestionActor's alarm. */
export async function tickMockIngestion(env: Env) {
  const generated = generateEvent();
  const event = await insertMockEvent(env, generated);
  await matchAndBroadcast(env, event);
}

/**
 * Fetches news for ONE monitoring query and records its matches.
 *
 * The search sent to GDELT keeps the query's AND/OR structure (see
 * lib/querySearchPlan.ts) — `ethiopia tigray (conflict OR attack)` rather
 * than every term OR'd together — so what comes back is about the query's
 * subject. If the query has nothing that can be searched that way (for
 * example it is all NOT clauses), it falls back to the old broad search on
 * its positive terms.
 *
 * When the search is logically exact for the query, an article it returns
 * whose body could not be fetched is accepted as a match on the strength of
 * the search itself; that includes articles an earlier query had already
 * ingested, which are credited to this query too.
 */
export async function fetchNewsForQuery(
  env: Env,
  query: CompiledQuery,
  opts: PollGdeltOptions & { maxSearches?: number } = {}
): Promise<{ inserted: number; matched: number; rateLimited: boolean; searches: string[] }> {
  const plan = buildSearchPlan(query.parsed.ast);
  const structured = toGdeltQueries(plan);
  const searches = (structured.length > 0 ? structured : buildQueryChunks(query.parsed.positiveTerms)).slice(0, opts.maxSearches ?? 6);
  const trusted = structured.length > 0 && plan.exact ? query.id : undefined;

  const { inserted, rateLimited, seenUrls } = await pollGdelt(env, searches, opts);
  let matched = 0;
  for (const event of inserted) {
    const ids = await matchAndBroadcast(env, event, trusted);
    if (ids.includes(query.id)) matched++;
  }

  // Articles this search returned that were already in the table.
  const insertedUrls = new Set(inserted.map((e) => e.url));
  const alreadyThere = seenUrls.filter((u) => !insertedUrls.has(u));
  const statements: { sql: string; params: unknown[] }[] = [];
  for (let i = 0; i < alreadyThere.length; i += 50) {
    const chunk = alreadyThere.slice(i, i + 50);
    const rows = await all<{ id: string; title: string | null; content: string; url: string | null; author: string | null; published_at: string; raw_metadata: string }>(
      env.DB,
      `SELECT id, title, content, url, author, published_at, raw_metadata FROM events WHERE external_id IN (${chunk.map(() => "?").join(",")})`,
      chunk
    );
    for (const ev of rows) {
      const ok = evaluate(query.parsed, { content: ev.content, title: ev.title, url: ev.url, domain: ev.author }) || (!!trusted && lacksFullText(ev.raw_metadata));
      if (!ok) continue;
      statements.push({ sql: `INSERT OR IGNORE INTO query_matches (id, query_id, event_id, matched_at) VALUES (?,?,?,?)`, params: [newId(), query.id, ev.id, ev.published_at] });
      matched++;
    }
  }
  for (let i = 0; i < statements.length; i += 50) await batchRun(env.DB, statements.slice(i, i + 50));

  return { inserted: inserted.length, matched, rateLimited, searches };
}

async function getOrCreateFeedSourceId(env: Env): Promise<string | null> {
  const name = "Platform News Feeds";
  const existing = await all<{ id: string }>(env.DB, "SELECT id FROM sources WHERE name = ?", [name]);
  if (existing[0]) return existing[0].id;
  const id = newId();
  await run(env.DB, `INSERT INTO sources (id, name, type, config, created_at) VALUES (?, ?, 'news', ?, ?)`, [id, name, JSON.stringify({ connector: "feeds" }), nowIso()]);
  return id;
}

/** New feed articles stored per call — a ceiling on database writes, not a
 *  target; a later tick picks up whatever was left. */
const FEED_INGEST_MAX_NEW = 120;

/**
 * Collects, for the given queries, the matching articles from the news
 * feeds the platform crawls itself (lib/feedSearch.ts) and records them.
 *
 * This is the source that does not depend on GDELT's rate-limited search:
 * it runs on every tick, including while GDELT is refusing requests.
 * An article already held (from an earlier tick, or because GDELT found
 * the same URL) is not stored twice — it is just credited to the query.
 */
export async function ingestFeedMatches(env: Env, queries: CompiledQuery[], maxAgeHours: number): Promise<{ inserted: number; credited: number }> {
  const hits = await searchFeeds(env, queries, maxAgeHours);
  const byLink = new Map<string, { article: FeedArticle; queryIds: string[] }>();
  for (const [queryId, articles] of hits) {
    for (const article of articles) {
      const entry = byLink.get(article.link) ?? { article, queryIds: [] };
      entry.queryIds.push(queryId);
      byLink.set(article.link, entry);
    }
  }
  if (byLink.size === 0) return { inserted: 0, credited: 0 };

  const links = [...byLink.keys()];
  const held = new Map<string, { id: string; published_at: string }>();
  for (let i = 0; i < links.length; i += 50) {
    const chunk = links.slice(i, i + 50);
    const rows = await all<{ id: string; external_id: string; published_at: string }>(
      env.DB,
      `SELECT id, external_id, published_at FROM events WHERE source_type = 'news' AND external_id IN (${chunk.map(() => "?").join(",")})`,
      chunk
    );
    for (const r of rows) held.set(r.external_id, { id: r.id, published_at: r.published_at });
  }

  const sourceId = await getOrCreateFeedSourceId(env);
  // A new article is checked against every active query, not only the ones
  // asked about here, exactly as a newly fetched GDELT article is.
  const active = await loadActiveCompiledQueries(env);
  let inserted = 0;
  const credits: { sql: string; params: unknown[] }[] = [];
  for (const [link, { article, queryIds }] of byLink) {
    let stored = held.get(link);
    if (!stored) {
      if (inserted >= FEED_INGEST_MAX_NEW) continue;
      const location = locateEventText(article.title, article.text);
      const content = `${article.title} ${link} ${article.text}`.trim();
      const rows = await all<Record<string, unknown>>(
        env.DB,
        `INSERT OR IGNORE INTO events
          (id, source_id, source_type, external_id, author, title, content, url, lang, published_at, ingested_at, geo_lat, geo_lng, geo_label, raw_metadata)
         VALUES (?, ?, 'news', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          newId(),
          sourceId,
          link,
          article.domain,
          article.title,
          content,
          link,
          detectNonEnglish(`${article.title} ${article.text}`) === "ar" ? "ar" : "en", // script-level guess only
          article.published,
          nowIso(),
          location?.lat ?? null,
          location?.lon ?? null,
          location?.place ?? null,
          // fulltext:false — only the feed's headline and summary are held.
          JSON.stringify({ connector: "feeds", origin: article.origin, domain: article.domain, geo: TEXT_LOCATED, geoPrecision: location?.precision ?? null, fulltext: false }),
        ]
      );
      if (!rows[0]) continue; // stored by something else in the meantime
      inserted++;
      const event = { ...(rows[0] as unknown as EventRecord), raw_metadata: JSON.parse(String(rows[0].raw_metadata ?? "{}")) };
      const { matchedQueryIds, ownerIds } = await matchAgainstQueries(env, event, active);
      await broadcast(env, "event", { ...event, matched_query_ids: matchedQueryIds }, ownerIds).catch((err) => console.error("[feeds] broadcast failed", err));
      stored = { id: event.id, published_at: article.published };
    }
    for (const queryId of queryIds) {
      credits.push({ sql: `INSERT OR IGNORE INTO query_matches (id, query_id, event_id, matched_at) VALUES (?,?,?,?)`, params: [newId(), queryId, stored.id, stored.published_at] });
    }
  }
  for (let i = 0; i < credits.length; i += 50) await batchRun(env.DB, credits.slice(i, i + 50));
  return { inserted, credited: credits.length };
}

const BACKFILL_LOOKBACK_HOURS = 72;
const BACKFILL_MAX_EVENTS = 3000;
const BACKFILL_PAGE_SIZE = 250;

/**
 * Runs when a query is created or its text changes: scans recent existing
 * events and records matches for anything that already qualifies, so the
 * query isn't limited to what is ingested from this point forward.
 * matched_at is the event's own published_at (not "now"), so backfilled
 * matches land at their real point in time on the volume/history charts.
 *
 * The scan is pre-filtered in SQL to rows that could match (see
 * toSqlPrefilter) and read a page at a time: pulling thousands of full
 * article bodies in one statement is what made the editor's preview fail.
 */
export async function backfillQueryMatches(env: Env, queryId: string, booleanQuery: string): Promise<number> {
  let parsed: ParsedQuery;
  try {
    parsed = parseBooleanQuery(booleanQuery);
  } catch {
    return 0;
  }

  const cutoff = new Date(Date.now() - BACKFILL_LOOKBACK_HOURS * 60 * 60_000).toISOString();
  const prefilter = toSqlPrefilter(buildSearchPlan(parsed.ast));
  let matched = 0;
  for (let offset = 0; offset < BACKFILL_MAX_EVENTS; offset += BACKFILL_PAGE_SIZE) {
    const events = await all<{ id: string; content: string; title: string | null; url: string | null; author: string | null; published_at: string }>(
      env.DB,
      `SELECT id, content, title, url, author, published_at FROM events
       WHERE published_at > ?${prefilter ? ` AND ${prefilter.sql}` : ""}
       ORDER BY published_at DESC LIMIT ? OFFSET ?`,
      [cutoff, ...(prefilter?.params ?? []), BACKFILL_PAGE_SIZE, offset]
    );
    const statements: { sql: string; params: unknown[] }[] = [];
    for (const ev of events) {
      if (evaluate(parsed, { content: ev.content, title: ev.title, url: ev.url, domain: ev.author })) {
        statements.push({ sql: `INSERT OR IGNORE INTO query_matches (id, query_id, event_id, matched_at) VALUES (?,?,?,?)`, params: [newId(), queryId, ev.id, ev.published_at] });
        matched++;
      }
    }
    for (let i = 0; i < statements.length; i += 50) await batchRun(env.DB, statements.slice(i, i + 50));
    if (events.length < BACKFILL_PAGE_SIZE) break;
  }
  return matched;
}

/** Everything a new (or just-edited) query needs to have results straight
 *  away: its matches in the platform's own news feeds, a first wider news
 *  search over the last three days for exactly what it asks for, then a
 *  scan of what the platform already holds. Run in the
 *  background from the create/update routes. */
export async function primeQuery(env: Env, queryId: string, booleanQuery: string, ownerId: string | null): Promise<void> {
  let parsed: ParsedQuery;
  try {
    parsed = parseBooleanQuery(booleanQuery);
  } catch {
    return;
  }
  const query: CompiledQuery = { id: queryId, ownerId, parsed, text: booleanQuery };
  // The platform's own feeds first: always available, so the query has
  // results even when the wider search below is being rate-limited.
  try {
    const f = await ingestFeedMatches(env, [query], 72);
    console.log(`[query-prime] ${queryId}: own feeds -> ${f.inserted} new articles, ${f.credited} matches`);
  } catch (err) {
    console.error(`[query-prime] feed search failed for query ${queryId}:`, err);
  }
  try {
    const r = await fetchNewsForQuery(env, query, { timespan: "3d", maxRecords: 250, fulltextBudget: 25, maxSearches: 3 });
    console.log(`[query-prime] ${queryId}: searched ${JSON.stringify(r.searches)} -> ${r.inserted} new articles, ${r.matched} matches${r.rateLimited ? " (rate limited)" : ""}`);
  } catch (err) {
    console.error(`[query-prime] news search failed for query ${queryId}:`, err);
  }
  const backfilled = await backfillQueryMatches(env, queryId, booleanQuery);
  console.log(`[query-prime] ${queryId}: ${backfilled} matches among already-ingested articles`);
}
