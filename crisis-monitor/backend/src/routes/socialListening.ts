import { Hono } from "hono";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

/**
 * Keyword-driven "social listening" — the one piece of Sprinklr's product
 * category (real-time social/media monitoring, sentiment, and volume
 * tracking around a topic) that's a genuine fit for a crisis-intelligence
 * tool. Built after the rest of Sprinklr's suite (unified inbox,
 * publishing/content calendar) was scoped out — the user chose to skip
 * publishing for now and pointed at Postiz for that if it's revisited.
 *
 * Full social-platform firehoses are paid-enterprise-only or scraping-ToS
 * violations for a commercial product — checked directly before building
 * anything here, same discipline as every other source this session:
 *  - Twitter/X: paid API tiers, ToS bars scraping.
 *  - Reddit: its Data API Terms explicitly prohibit commercial use without
 *    a separately negotiated license (reported around $12k/month, plus a
 *    mandatory approval review as of mid-2026) — same category of blocker
 *    as UN Comtrade and Cloudflare Radar this session. Not built.
 *  - Instagram/TikTok/Facebook: no usable public read API at all without a
 *    business partnership. Not built.
 *
 * What's actually built here, both checked as genuinely open:
 *  - GDELT's DOC 2.0 API (already relied on elsewhere in this app for
 *    /activity-index and /news) scores real-time online news/blog
 *    coverage's average "tone" — a documented, published sentiment metric
 *    — for ANY keyword, not just this app's fixed conflict-related
 *    queries. That's the sentiment/volume trend below. Free, no key, same
 *    source already in production use. GDELT's `query` parameter natively
 *    supports boolean search — implicit AND between bare terms, uppercase
 *    OR, "quoted phrases", -negation, and (parenthetical grouping) — so a
 *    Sprinklr-style advanced query is passed straight through with no
 *    translation layer; see buildBooleanQuery below for the one bit of
 *    normalization applied (stripping characters GDELT's query parser
 *    rejects outright).
 *  - Mastodon's public search API for actual live social posts mentioning
 *    the keyword — a fully open federated network with no commercial-use
 *    restriction found (unlike Reddit's explicit one). Needs a personal
 *    access token (free, instant, no approval wait — see
 *    MASTODON_ACCESS_TOKEN's comment in bindings.ts), since full-text
 *    status search needs an authenticated call even for public posts.
 *    Optional: this route works without it, just without the Mastodon
 *    section, same graceful-degradation pattern as every other optional
 *    key in this app. Mastodon's search does NOT support boolean operators
 *    — a raw AND/OR/NOT query is sent to it as literal text, which will
 *    usually just under-match; the frontend says this plainly rather than
 *    pretending Mastodon results respect the same query language as GDELT.
 *
 * BUG FIX (previously reported "nothing happens when I type a keyword"):
 * the original version of this route ran all four upstream calls through
 * Promise.allSettled and quietly turned every rejection into an empty
 * array, with no way for a caller to tell "no coverage exists for this
 * query" apart from "every upstream call actually failed". That is almost
 * certainly what the user was seeing: a request that succeeded with a
 * 200 and { toneTimeline: [], volumeTimeline: [], topArticles: [] }, an
 * empty-looking panel, and no error text anywhere. Fixed by:
 *  1. Treating a GDELT response that parses as JSON but has an
 *     error/status shape (GDELT returns these with HTTP 200) as a real
 *     failure instead of "zero data points".
 *  2. Surfacing a message from res.json() failing on a non-JSON body
 *     (e.g. an HTML error page) instead of letting that exception vanish
 *     into Promise.allSettled.
 *  3. Returning a `sourceErrors` object alongside the (still
 *     best-effort/partial) data, so the frontend can show *why* a section
 *     is empty instead of just rendering nothing.
 */
export const socialListeningRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

socialListeningRouter.use("*", requireAuth);

const CACHE_TTL_SECONDS = 180;

async function cachedJson<T>(request: Request, build: () => Promise<T>, ttlSeconds = CACHE_TTL_SECONDS): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body: T;
  try {
    body = await build();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Social listening feed unavailable", detail: message }, { status: 502 });
  }

  const response = Response.json(body, { headers: { "Cache-Control": `public, max-age=${ttlSeconds}` } });
  await cache.put(cacheKey, response.clone());
  return response;
}

interface TonePoint {
  date: string;
  avgTone: number;
}
interface VolumePoint {
  date: string;
  count: number;
}
interface ListArticle {
  title: string;
  url: string;
  domain: string;
  seenAt: string | null;
  language: string | null;
}
interface MastodonPost {
  id: string;
  url: string;
  author: string;
  content: string;
  createdAt: string;
}
interface SourceErrors {
  tone?: string;
  volume?: string;
  articles?: string;
  mastodon?: string;
}

/** GDELT timeline dates come back as "YYYYMMDDHHMMSS" — normalized to ISO
 *  so the frontend never has to know GDELT's own format. */
function parseGdeltDate(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

/** Passes a Sprinklr-style boolean query straight through to GDELT, which
 *  understands the same shape natively (bare terms = AND, OR, "phrase",
 *  -negate, (grouping)) — the only normalization needed is trimming
 *  whitespace and collapsing curly/smart quotes a browser autocorrect
 *  might introduce, since GDELT only recognizes straight double quotes. */
function buildBooleanQuery(raw: string): string {
  return raw.trim().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/** GDELT returns HTTP 200 even for a malformed/unsupported query, with a
 *  JSON (or, sometimes, HTML) body describing the problem instead of a
 *  `timeline`/`articles` field — this pulls that message out when present. */
function extractGdeltErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (obj.status === "error" && typeof obj.message === "string") return obj.message;
  return null;
}

// GDELT's free API is noticeably slower than most (its timeline modes scan
// its full rolling archive on every call) and has occasional slow spells —
// 10s was too tight and was aborting essentially every request, which is
// what produced the "timeout" errors across all three sections at once
// (tone/volume/articles are three separate GDELT calls, so if GDELT itself
// is briefly slow, all three fail together, exactly as observed). Bumped to
// 20s, plus one retry specifically for a timeout (not for a real HTTP
// error, which retrying won't fix) since a single slow response shouldn't
// need the person to manually hit Search again.
const GDELT_TIMEOUT_MS = 20000;

async function fetchGdeltJsonOnce(query: string, params: Record<string, string>, label: string): Promise<unknown> {
  const search = new URLSearchParams({ query, format: "json", timespan: "7d", ...params });
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${search.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(GDELT_TIMEOUT_MS), headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLensBot/1.0)" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label}: GDELT returned HTTP ${res.status}`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // GDELT serves an HTML "no results"/error page (not JSON) for some
    // malformed queries — surface a snippet rather than a bare parse error.
    throw new Error(`${label}: GDELT returned a non-JSON response (${text.slice(0, 160).replace(/\s+/g, " ")})`);
  }
  const gdeltError = extractGdeltErrorMessage(data);
  if (gdeltError) throw new Error(`${label}: ${gdeltError}`);
  return data;
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && /abort|timeout/i.test(err.message + err.name);
}

async function fetchGdeltJson(query: string, params: Record<string, string>, label: string): Promise<unknown> {
  try {
    return await fetchGdeltJsonOnce(query, params, label);
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    try {
      return await fetchGdeltJsonOnce(query, params, label);
    } catch (retryErr) {
      if (isTimeoutError(retryErr)) throw new Error(`${label}: GDELT did not respond within ${GDELT_TIMEOUT_MS / 1000}s (tried twice) — it may be under load, try again shortly`);
      throw retryErr;
    }
  }
}

async function fetchGdeltTimeline(query: string, mode: "timelinetone" | "timelinevolraw"): Promise<Array<{ date: string; value: number }>> {
  const data = (await fetchGdeltJson(query, { mode }, mode === "timelinetone" ? "Tone" : "Volume")) as {
    timeline?: Array<{ data?: Array<{ date: string; value: number }> }>;
  };
  return data.timeline?.[0]?.data ?? [];
}

async function fetchGdeltArticles(query: string): Promise<ListArticle[]> {
  const data = (await fetchGdeltJson(query, { mode: "artlist", maxrecords: "12", sort: "hybridrel" }, "Articles")) as {
    articles?: Array<{ title?: string; url?: string; domain?: string; seendate?: string; language?: string }>;
  };
  return (data.articles ?? []).map((a) => ({
    title: a.title ?? "(untitled)",
    url: a.url ?? "",
    domain: a.domain ?? "",
    seenAt: a.seendate ? parseGdeltDate(a.seendate) : null,
    language: a.language ?? null,
  }));
}

async function fetchMastodonPosts(query: string, token: string): Promise<MastodonPost[]> {
  const url = `https://mastodon.social/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=15`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Mastodon search returned HTTP ${res.status}`);
  const data = (await res.json()) as {
    statuses?: Array<{ id: string; url: string; content: string; created_at: string; account?: { username?: string; display_name?: string } }>;
  };
  return (data.statuses ?? []).map((s) => ({
    id: s.id,
    url: s.url,
    author: s.account?.display_name || s.account?.username || "unknown",
    // Mastodon returns post bodies as HTML — stripped to plain text here
    // since this is a text summary panel, not a rich post renderer.
    content: s.content.replace(/<[^>]+>/g, "").slice(0, 400),
    createdAt: s.created_at,
  }));
}

socialListeningRouter.get("/", async (c) => {
  const raw = (c.req.query("q") ?? "").trim();
  if (!raw) return Response.json({ error: "Missing ?q= keyword" }, { status: 400 });
  if (raw.length > 300) return Response.json({ error: "Query too long (300 character limit)" }, { status: 400 });
  const q = buildBooleanQuery(raw);

  return cachedJson(c.req.raw, async () => {
    const [toneRes, volRes, artRes, mastoRes] = await Promise.allSettled([
      fetchGdeltTimeline(q, "timelinetone"),
      fetchGdeltTimeline(q, "timelinevolraw"),
      fetchGdeltArticles(q),
      c.env.MASTODON_ACCESS_TOKEN ? fetchMastodonPosts(q, c.env.MASTODON_ACCESS_TOKEN) : Promise.resolve(null as MastodonPost[] | null),
    ]);

    const sourceErrors: SourceErrors = {};
    const reasonMessage = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason));

    const toneTimeline: TonePoint[] =
      toneRes.status === "fulfilled" ? toneRes.value.map((p) => ({ date: parseGdeltDate(p.date), avgTone: p.value })) : ((sourceErrors.tone = reasonMessage(toneRes)), []);
    const volumeTimeline: VolumePoint[] =
      volRes.status === "fulfilled" ? volRes.value.map((p) => ({ date: parseGdeltDate(p.date), count: p.value })) : ((sourceErrors.volume = reasonMessage(volRes)), []);
    const topArticles: ListArticle[] = artRes.status === "fulfilled" ? artRes.value : ((sourceErrors.articles = reasonMessage(artRes)), []);
    const mastodonPosts =
      mastoRes.status === "fulfilled" && mastoRes.value
        ? mastoRes.value
        : mastoRes.status === "rejected"
          ? ((sourceErrors.mastodon = reasonMessage(mastoRes)), [])
          : [];

    const latestTone = toneTimeline.length > 0 ? toneTimeline[toneTimeline.length - 1].avgTone : null;

    return {
      query: raw,
      effectiveQuery: q,
      latestTone,
      toneTimeline,
      volumeTimeline,
      topArticles,
      mastodonPosts,
      mastodonAvailable: Boolean(c.env.MASTODON_ACCESS_TOKEN),
      sourceErrors: Object.keys(sourceErrors).length > 0 ? sourceErrors : null,
      fetchedAt: new Date().toISOString(),
    };
  });
});
