import { all, run, nowIso } from "./db";
import { newId } from "./ids";
import { generateEvent, type GeneratedEvent } from "./mockGenerator";
import { evaluate, parseBooleanQuery, type ParsedQuery } from "./booleanQuery";
import { rowToMonitoringQuery } from "./mappers";
import type { Env } from "./bindings";
import type { EventRecord } from "./types";

interface CompiledQuery {
  id: string;
  ownerId: string | null;
  parsed: ParsedQuery;
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
      compiled.push({ id: q.id, ownerId: q.owner_id, parsed: parseBooleanQuery(q.boolean_query) });
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

async function matchAgainstQueries(
  env: Env,
  event: EventRecord,
  compiled: CompiledQuery[]
): Promise<{ matchedQueryIds: string[]; ownerIds: string[] }> {
  const matchedQueryIds: string[] = [];
  const ownerIds = new Set<string>();
  for (const { id: queryId, ownerId, parsed } of compiled) {
    if (evaluate(parsed, event.content)) {
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
      (id, source_id, source_type, author, content, url, lang, sentiment, published_at, ingested_at, geo_lat, geo_lng, geo_label, raw_metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, sourceId, ev.source_type, ev.author, ev.content, ev.url, ev.lang, ev.sentiment, publishedAt, now, ev.geo_lat, ev.geo_lng, ev.geo_label, "{}"]
  );

  return {
    id,
    source_id: sourceId,
    source_type: ev.source_type,
    external_id: null,
    author: ev.author,
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
export async function matchAndBroadcast(env: Env, event: EventRecord) {
  const compiled = await loadActiveCompiledQueries(env);
  const { matchedQueryIds, ownerIds } = await matchAgainstQueries(env, event, compiled);
  await broadcast(env, "event", { ...event, matched_query_ids: matchedQueryIds }, ownerIds);
  return matchedQueryIds;
}

/** One mock-ingestion tick: generate a synthetic event, store it, match, broadcast. Called from IngestionActor's alarm. */
export async function tickMockIngestion(env: Env) {
  const generated = generateEvent();
  const event = await insertMockEvent(env, generated);
  await matchAndBroadcast(env, event);
}
