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
 *    source already in production use.
 *  - Mastodon's public search API for actual live social posts mentioning
 *    the keyword — a fully open federated network with no commercial-use
 *    restriction found (unlike Reddit's explicit one). Needs a personal
 *    access token (free, instant, no approval wait — see
 *    MASTODON_ACCESS_TOKEN's comment in bindings.ts), since full-text
 *    status search needs an authenticated call even for public posts.
 *    Optional: this route works without it, just without the Mastodon
 *    section, same graceful-degradation pattern as every other optional
 *    key in this app.
 *
 * IMPORTANT CAVEAT: this sandbox's network restrictions blocked
 * live-testing GDELT's exact timeline JSON field names while building
 * this — WebFetch couldn't reach api.gdeltproject.org's DOC endpoint from
 * here (unlike the already-proven geo/geo endpoint this app already uses
 * successfully in production). The parsing below follows GDELT's
 * documented, long-stable DOC 2.0 API shape, but hasn't been confirmed
 * against a live response from this session. Test it after deploying —
 * it may need a small field-name fix if GDELT's actual shape differs from
 * what's coded here.
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
    return Response.json({ error: "Upstream feed unavailable", detail: message }, { status: 502 });
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

/** GDELT timeline dates come back as "YYYYMMDDHHMMSS" — normalized to ISO
 *  so the frontend never has to know GDELT's own format. */
function parseGdeltDate(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

async function fetchGdeltTimeline(query: string, mode: "timelinetone" | "timelinevolraw"): Promise<Array<{ date: string; value: number }>> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=${mode}&format=json&timespan=7d`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLensBot/1.0)" } });
  if (!res.ok) throw new Error(`GDELT ${mode} returned ${res.status}`);
  const data = (await res.json()) as { timeline?: Array<{ data?: Array<{ date: string; value: number }> }> };
  return data.timeline?.[0]?.data ?? [];
}

async function fetchGdeltArticles(query: string): Promise<ListArticle[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=12&sort=hybridrel&timespan=7d`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLensBot/1.0)" } });
  if (!res.ok) throw new Error(`GDELT artlist returned ${res.status}`);
  const data = (await res.json()) as { articles?: Array<{ title?: string; url?: string; domain?: string; seendate?: string; language?: string }> };
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
  if (!res.ok) throw new Error(`Mastodon search returned ${res.status}`);
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
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return Response.json({ error: "Missing ?q= keyword" }, { status: 400 });
  if (q.length > 200) return Response.json({ error: "Query too long" }, { status: 400 });

  return cachedJson(c.req.raw, async () => {
    const [toneRes, volRes, artRes, mastoRes] = await Promise.allSettled([
      fetchGdeltTimeline(q, "timelinetone"),
      fetchGdeltTimeline(q, "timelinevolraw"),
      fetchGdeltArticles(q),
      c.env.MASTODON_ACCESS_TOKEN ? fetchMastodonPosts(q, c.env.MASTODON_ACCESS_TOKEN) : Promise.resolve(null as MastodonPost[] | null),
    ]);

    const toneTimeline: TonePoint[] = toneRes.status === "fulfilled" ? toneRes.value.map((p) => ({ date: parseGdeltDate(p.date), avgTone: p.value })) : [];
    const volumeTimeline: VolumePoint[] = volRes.status === "fulfilled" ? volRes.value.map((p) => ({ date: parseGdeltDate(p.date), count: p.value })) : [];
    const topArticles: ListArticle[] = artRes.status === "fulfilled" ? artRes.value : [];
    const mastodonPosts = mastoRes.status === "fulfilled" && mastoRes.value ? mastoRes.value : [];

    const latestTone = toneTimeline.length > 0 ? toneTimeline[toneTimeline.length - 1].avgTone : null;

    return {
      query: q,
      latestTone,
      toneTimeline,
      volumeTimeline,
      topArticles,
      mastodonPosts,
      mastodonAvailable: Boolean(c.env.MASTODON_ACCESS_TOKEN),
      fetchedAt: new Date().toISOString(),
    };
  });
});
