/**
 * GDELT connector — real, live mainstream-media source.
 *
 * GDELT (gdeltproject.org) is a free, public database of global news
 * monitored across print, broadcast, and web sources in 100+ languages,
 * updated every 15 minutes. Its DOC 2.0 API needs no API key and no
 * account, which makes it the natural first "real" source to wire up
 * before tackling sources that need paid access (social platform APIs)
 * or licensed access (dark web threat intel).
 *
 * Docs: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
 *
 * Design: rather than translating our internal Boolean syntax into GDELT's
 * own query language, we ask GDELT broadly for anything touching the
 * *positive* terms across all active monitoring queries (cheap recall),
 * then run every returned article back through our own Boolean engine
 * (`matchAndBroadcast`) for precise, per-query matching/alerting — the
 * same two-stage "broad recall, precise filter" pattern a production
 * pipeline would use with any upstream search API.
 *
 * Runs from the Worker's `scheduled()` handler on a Cron Trigger
 * (every 5 minutes — see wrangler.toml — matching GDELT's own 15-minute
 * index refresh rate, so polling faster just wastes requests).
 */
import { all, run, nowIso } from "../db";
import { newId } from "../ids";
import type { Env } from "../bindings";
import type { EventRecord } from "../types";

const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";

// Rough centroids for GDELT's `sourcecountry` field, used only so articles have
// *something* plottable on the map. This is a coarse stand-in for real geocoding —
// a production pipeline should extract location from article text/NLP instead.
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  Kenya: [-1.2864, 36.8172],
  Nigeria: [9.082, 8.6753],
  Philippines: [12.8797, 121.774],
  Indonesia: [-0.7893, 113.9213],
  Bangladesh: [23.685, 90.3563],
  Haiti: [18.9712, -72.2852],
  Ukraine: [48.3794, 31.1656],
  Lebanon: [33.8547, 35.8623],
  Pakistan: [30.3753, 69.3451],
  Mexico: [23.6345, -102.5528],
  "South Africa": [-30.5595, 22.9375],
  Brazil: [-14.235, -51.9253],
  India: [20.5937, 78.9629],
  Egypt: [26.8206, 30.8025],
  Thailand: [15.87, 100.9925],
  "United States": [37.0902, -95.7129],
  "United Kingdom": [55.3781, -3.436],
  France: [46.2276, 2.2137],
  Germany: [51.1657, 10.4515],
  China: [35.8617, 104.1954],
  Japan: [36.2048, 138.2529],
  Israel: [31.0461, 34.8516],
  "Saudi Arabia": [23.8859, 45.0792],
  Turkey: [38.9637, 35.2433],
  Russia: [61.524, 105.3188],
  Ethiopia: [9.145, 40.4897],
  Sudan: [12.8628, 30.2176],
  Somalia: [5.1521, 46.1996],
  Myanmar: [21.9139, 95.9562],
  "Sri Lanka": [7.8731, 80.7718],
  Colombia: [4.5709, -74.2973],
  Venezuela: [6.4238, -66.5897],
  Yemen: [15.5527, 48.5164],
  Syria: [34.8021, 38.9968],
  Iraq: [33.2232, 43.6793],
  Afghanistan: [33.9391, 67.71],
};

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string; // e.g. "20260807T121500Z"
  domain: string;
  language: string;
  sourcecountry: string;
}

function parseGdeltDate(seendate: string): Date {
  const m = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date();
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

const GDELT_CHUNK_SIZE = 10; // terms per OR-group — stays well under GDELT's per-request length/complexity limit
const GDELT_CHUNK_STAGGER_MS = 2500; // pause between a query's own chunk requests — GDELT's free API rate-limits aggressively; wide spacing avoids tripping it

/** Splits a flat list of terms pulled from an active monitoring query into one
 *  or more GDELT-compatible OR-queries. GDELT treats bare space-separated words
 *  as AND, so we explicitly OR them and quote multi-word phrases — and GDELT's
 *  DOC API requires any OR'd term list to be wrapped in parentheses, rejecting a
 *  bare "a OR b OR c" with a plain-text error ("Queries containing OR'd terms
 *  must be surrounded by ()") instead of JSON.
 *
 *  Previously this hard-capped at 10 terms and silently dropped the rest, which
 *  meant a real-world topic query with lots of synonyms/place names would just
 *  never search on most of its terms. Chunking instead means a query can have
 *  any number of terms — each chunk becomes its own GDELT request, and
 *  `pollGdelt` merges + dedupes the results — at the cost of one extra HTTP
 *  call per chunk beyond the first. */
export function buildQueryChunks(terms: string[], chunkSize = GDELT_CHUNK_SIZE): string[] {
  const unique = Array.from(new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean)));
  if (unique.length === 0) return ["(crisis OR emergency OR disaster)"]; // sane fallback if no queries are active yet

  const chunks: string[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const quoted = unique.slice(i, i + chunkSize).map((t) => (t.includes(" ") ? `"${t}"` : t));
    chunks.push(quoted.length > 1 ? `(${quoted.join(" OR ")})` : quoted[0]);
  }
  return chunks;
}

/** Thrown specifically for HTTP 429 so callers can back off instead of just
 *  logging-and-continuing like any other failed request — retrying immediately
 *  into a rate limit just deepens it. */
export class GdeltRateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`GDELT rate limited (429)`);
  }
}

export async function fetchGdeltArticles(
  searchTerms: string,
  maxRecords = 250, // GDELT's documented max per request — was 75, starving niche/narrow topics of candidates
  timespan = "6h" // was 1h — too narrow a window for low-volume topics to have any hits at all
): Promise<GdeltArticle[]> {
  const params = new URLSearchParams({
    query: searchTerms,
    mode: "artlist",
    maxrecords: String(maxRecords),
    format: "json",
    sort: "datedesc",
    timespan,
  });

  const res = await fetch(`${GDELT_ENDPOINT}?${params.toString()}`, {
    headers: { "User-Agent": "GlobaLensCrisisMonitor/1.0 (+https://github.com/SimonMutie/Mutie)" },
  });
  if (res.status === 429 || res.status === 403) {
    // GDELT's anti-abuse layer appears to escalate from 429 (soft rate limit) to
    // 403 (harder block) under continued request volume from the same source —
    // observed directly while diagnosing this. Treat both as "back off", not as
    // a real permissions failure (this is an unauthenticated public API; there's
    // nothing to be legitimately forbidden from).
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 15_000;
    throw new GdeltRateLimitError(Number.isFinite(retryAfterMs) ? retryAfterMs : 15_000);
  }
  if (!res.ok) {
    throw new Error(`GDELT request failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  if (!text.trim()) return []; // GDELT returns an empty body (not valid JSON) when nothing matches

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // GDELT returns a non-JSON error page (HTML/plain text) when a query is
    // malformed or too complex for it to parse — log enough of the raw
    // response to diagnose which, instead of just "unexpected token".
    console.error(`[gdelt] non-JSON response for query="${searchTerms}" (first 300 chars): ${text.slice(0, 300)}`);
    throw err;
  }
  const articles = (data as { articles?: unknown })?.articles;
  return Array.isArray(articles) ? (articles as GdeltArticle[]) : [];
}

const FULLTEXT_TIMEOUT_MS = 4000;
const FULLTEXT_MAX_CHARS = 4000;
const DEFAULT_FULLTEXT_BUDGET = 15; // per pollGdelt() call — see note on fulltextCache below

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort fetch of an article's visible text.
 *
 *  This is the actual fix for narrow/AND-heavy queries never matching: GDELT's
 *  DOC API only ever returns a headline, never body text, and events were being
 *  matched against that headline alone. A query like `"cholera" AND "Nairobi"`
 *  needs both words to literally co-occur in ~10 words of headline, which is
 *  rare even when a genuinely relevant article exists — whereas a single-term
 *  query like `ebola` only ever needed one word to be present, so it looked
 *  like it "worked" while narrower queries silently starved. Pulling in the
 *  article body gives the boolean matcher enough text for multi-term queries
 *  to actually have a chance of matching.
 *
 *  Fails soft: any network error, timeout, paywall, or robots block just
 *  falls back to matching on the headline alone (the old behavior), never
 *  breaks ingestion. */
async function fetchArticleText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FULLTEXT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "GlobaLensCrisisMonitor/1.0 (+https://github.com/SimonMutie/Mutie)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    return stripHtml(html).slice(0, FULLTEXT_MAX_CHARS) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getOrCreateGdeltSourceId(env: Env): Promise<string | null> {
  const existing = await all<{ id: string }>(env.DB, "SELECT id FROM sources WHERE name = ?", ["GDELT News Wire"]);
  if (existing[0]) return existing[0].id;
  const id = newId();
  await run(env.DB, `INSERT INTO sources (id, name, type, config, created_at) VALUES (?, 'GDELT News Wire', 'news', ?, ?)`, [
    id,
    JSON.stringify({ connector: "gdelt" }),
    nowIso(),
  ]);
  return id;
}

export interface PollGdeltOptions {
  maxRecords?: number;
  timespan?: string;
  /** Per-call budget for how many *new* articles get a full-text fetch attempt
   *  (see fetchArticleText). Kept modest since a scheduled tick may call
   *  pollGdelt once per active query, and each fetch costs a real HTTP round
   *  trip against the target news site. */
  fulltextBudget?: number;
  /** Shared across every pollGdelt() call within one cron tick (pass the same
   *  Map from the caller's loop). Multiple monitoring queries' broad GDELT
   *  recall very often surfaces the same trending article — this cache means
   *  we fetch that article's body at most once per tick instead of once per
   *  query that happened to also recall it. */
  fulltextCache?: Map<string, string | null>;
  /** Shared across every pollGdelt() call within one cron tick: a mutable counter
   *  of how many more GDELT HTTP requests are allowed this tick, across ALL
   *  queries combined — not per query. Without a *global* cap, a handful of
   *  queries with many terms (chunked into many GDELT requests each) can rack up
   *  100+ requests in a single 5-minute tick against a free, unauthenticated API
   *  that has no documented rate limit but very much has a real one. Once
   *  exhausted, remaining chunks for remaining queries are simply skipped this
   *  tick and picked up on a later one — this trades completeness-per-tick for
   *  not getting the whole polling loop rate-limited. */
  requestBudget?: { remaining: number };
}

/** Fetches every chunk of a (possibly multi-chunk, "any size") query, merges
 *  and dedupes the results by URL, enriches a bounded number of new articles
 *  with full-text for better boolean matching, and inserts (deduped again by
 *  the events table's partial unique index), returning the inserted rows. */
export async function pollGdelt(env: Env, searchTermChunks: string[], opts: PollGdeltOptions = {}): Promise<EventRecord[]> {
  const sourceId = await getOrCreateGdeltSourceId(env);

  const byUrl = new Map<string, GdeltArticle>();
  let rateLimited = false;
  for (const [i, chunk] of searchTermChunks.entries()) {
    if (opts.requestBudget && opts.requestBudget.remaining <= 0) {
      console.warn(`[gdelt] request budget exhausted for this tick — skipping remaining chunks`);
      break;
    }
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, GDELT_CHUNK_STAGGER_MS));
    try {
      if (opts.requestBudget) opts.requestBudget.remaining--;
      const articles = await fetchGdeltArticles(chunk, opts.maxRecords, opts.timespan);
      for (const article of articles) {
        if (article.url) byUrl.set(article.url, article);
      }
    } catch (err) {
      if (err instanceof GdeltRateLimitError) {
        console.error(`[gdelt] rate limited (429) — stopping all GDELT polling for this tick`);
        if (opts.requestBudget) opts.requestBudget.remaining = 0; // stop every other query too, not just this one
        rateLimited = true;
        break; // keep whatever this query already found instead of discarding it
      }
      console.error(`[gdelt] chunk query failed (query="${chunk}"):`, err);
      // keep going — one bad/oversized chunk shouldn't sink the other chunks of this query
    }
  }

  const inserted: EventRecord[] = [];
  const fulltextCache = opts.fulltextCache ?? new Map<string, string | null>();
  let fulltextBudget = opts.fulltextBudget ?? DEFAULT_FULLTEXT_BUDGET;

  for (const article of byUrl.values()) {
    if (!article.url || !article.title) continue;

    // URL slugs often carry keywords too (e.g. .../2026/08/cholera-outbreak-nairobi.html),
    // so it's included in the matched text alongside the title, not just used for dedup/linking.
    let content = `${article.title} ${article.url}`;
    if (!fulltextCache.has(article.url)) {
      if (fulltextBudget > 0) {
        fulltextBudget--;
        fulltextCache.set(article.url, await fetchArticleText(article.url));
      } else {
        fulltextCache.set(article.url, null); // out of budget this tick — remember so we don't retry pointlessly
      }
    }
    const bodyText = fulltextCache.get(article.url);
    if (bodyText) content = `${content} ${bodyText}`;

    const centroid = COUNTRY_CENTROIDS[article.sourcecountry] ?? null;
    const id = newId();
    const now = nowIso();
    const publishedAt = parseGdeltDate(article.seendate).toISOString();
    const rawMetadata = JSON.stringify({ connector: "gdelt", sourcecountry: article.sourcecountry, domain: article.domain });

    const rows = await all<Record<string, unknown>>(
      env.DB,
      `INSERT OR IGNORE INTO events
        (id, source_id, source_type, external_id, author, title, content, url, lang, published_at, ingested_at, geo_lat, geo_lng, geo_label, raw_metadata)
       VALUES (?, ?, 'news', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        id,
        sourceId,
        article.url,
        article.domain ?? null,
        article.title,
        content,
        article.url,
        (article.language ?? "en").toLowerCase(),
        publishedAt,
        now,
        centroid ? centroid[0] : null,
        centroid ? centroid[1] : null,
        article.sourcecountry ?? null,
        rawMetadata,
      ]
    );

    if (rows[0]) {
      inserted.push({
        ...(rows[0] as unknown as EventRecord),
        raw_metadata: JSON.parse(String(rows[0].raw_metadata ?? "{}")),
      });
    }
  }

  if (rateLimited) {
    console.warn(`[gdelt] returning ${inserted.length} article(s) found before hitting the rate limit`);
  }

  return inserted;
}
