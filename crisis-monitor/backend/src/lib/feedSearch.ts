import type { Env } from "../bindings";
import { evaluate, type ParsedQuery } from "../booleanQuery";
import { fetchWireArticleItems } from "./osintFeed";
import type { FeedSearchHit } from "../durableObjects/africaWireActor";

/**
 * Runs monitoring queries over the news the platform collects ITSELF:
 *
 *   - "africa-wire": the crawl of African outlets' own RSS feeds (held by
 *     AfricaWireActor, re-crawled every few minutes);
 *   - "wire": the international and Africa-focused wire feeds (BBC, Al
 *     Jazeera, AllAfrica, Radio Dabanga, Sudan Tribune, ... — osintFeed.ts).
 *
 * Why this exists: a monitoring query's only source used to be a search of
 * GDELT's public API, which limits requests hard and often refuses this
 * Worker for minutes at a time ("the news search service is limiting
 * requests"). These feeds are fetched straight from the publishers, so they
 * are always available, and they are the outlets closest to the events
 * this platform watches. GDELT is still searched as well, for breadth.
 *
 * What is matched is the feed's headline and summary (not the full
 * article), judged by the same engine as everything else. So a match here
 * is a real match; the limitation runs the other way — an article whose
 * headline and summary do not carry all of an AND query's terms is missed
 * here and left for the GDELT search to find.
 */

export interface FeedArticle extends FeedSearchHit {
  origin: "africa-wire" | "wire";
}

export interface FeedQuery {
  id: string;
  /** The query as written — the feed store re-parses it on its side. */
  text: string;
  parsed: ParsedQuery;
}

async function searchAfricaWire(env: Env, queries: FeedQuery[], maxAgeHours: number, limit: number): Promise<Record<string, FeedSearchHit[]>> {
  try {
    const stub = env.AFRICA_WIRE_ACTOR.get(env.AFRICA_WIRE_ACTOR.idFromName("global"));
    const res = await stub.fetch("http://africa-wire-actor/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: queries.map((q) => ({ id: q.id, q: q.text })), maxAgeHours, limit }),
    });
    if (!res.ok) return {};
    return ((await res.json()) as { results?: Record<string, FeedSearchHit[]> }).results ?? {};
  } catch (err) {
    console.error("[feed-search] Africa Wire search failed:", err);
    return {};
  }
}

async function searchWireFeeds(queries: FeedQuery[], maxAgeHours: number): Promise<Record<string, FeedSearchHit[]>> {
  const out: Record<string, FeedSearchHit[]> = {};
  try {
    const cutoff = Date.now() - maxAgeHours * 3_600_000;
    for (const item of await fetchWireArticleItems()) {
      const published = Date.parse(item.published);
      if (!Number.isFinite(published) || published < cutoff) continue;
      const fields = { content: `${item.title} ${item.link} ${item.description}`, title: item.title, url: item.link, domain: item.domain };
      for (const q of queries) {
        if (!evaluate(q.parsed, fields)) continue;
        (out[q.id] ??= []).push({ title: item.title, text: item.description, link: item.link, published: new Date(published).toISOString(), domain: item.domain });
      }
    }
  } catch (err) {
    console.error("[feed-search] wire feed search failed:", err);
  }
  return out;
}

/** Each query's matches across both feed sets: one entry per article link,
 *  newest first, at most `limit` per query. Never throws — a source that
 *  fails contributes nothing. */
export async function searchFeeds(env: Env, queries: FeedQuery[], maxAgeHours: number, limit = 60): Promise<Map<string, FeedArticle[]>> {
  const result = new Map<string, FeedArticle[]>(queries.map((q) => [q.id, []]));
  if (queries.length === 0) return result;
  const [africa, wire] = await Promise.all([searchAfricaWire(env, queries, maxAgeHours, limit), searchWireFeeds(queries, maxAgeHours)]);
  for (const q of queries) {
    const byLink = new Map<string, FeedArticle>();
    for (const hit of wire[q.id] ?? []) byLink.set(hit.link, { ...hit, origin: "wire" });
    for (const hit of africa[q.id] ?? []) if (!byLink.has(hit.link)) byLink.set(hit.link, { ...hit, origin: "africa-wire" });
    result.set(
      q.id,
      [...byLink.values()].sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, limit)
    );
  }
  return result;
}
