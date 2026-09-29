import { htmlToText } from "./telegram";

/**
 * Generic RSS/Atom feed discovery for an arbitrary homepage URL.
 *
 * This exists because durableObjects/africaWireActor.ts crawls ~260 African
 * newsroom, pan-African and institutional homepages (data/africaSources.ts)
 * that Simon supplied as plain homepage URLs, not feed URLs — there's no
 * way to know in advance which of them expose RSS, or at what path, without
 * fabricating an answer. So this looks it up the same way a feed reader
 * would: read the homepage's own <link rel="alternate"> autodiscovery tag
 * first (the standard, deliberate way a site advertises its feed), and only
 * falls back to guessing a handful of well-known conventional paths
 * (WordPress's /feed/, etc.) if that tag is missing. A source with neither
 * is recorded as having no discoverable feed — never assigned a guessed URL
 * that was never actually confirmed to return a feed.
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 7000;

const LINK_TAG_RX = /<link\b[^>]*>/gi;
const REL_ALTERNATE_RX = /rel=["']alternate["']/i;
const TYPE_FEED_RX = /type=["']application\/(?:rss|atom)\+xml["']/i;
const HREF_RX = /href=["']([^"']+)["']/i;

/** Conventional feed paths tried, in order, when a site's HTML carries no
 *  autodiscovery <link> tag. Each candidate is only accepted once its
 *  response body is confirmed to actually look like RSS/Atom XML (see
 *  looksLikeFeed) — the path list itself is just where to look, not a claim
 *  that any given site has one there. */
const FALLBACK_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/rss/", "/atom.xml", "/feeds/posts/default"];

function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 400).trimStart().toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<rss") || head.startsWith("<feed") || head.startsWith("<rdf");
}

async function tryFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractAutodiscoveredFeed(html: string, baseUrl: string): string | null {
  const tags = html.match(LINK_TAG_RX) ?? [];
  for (const tag of tags) {
    if (!REL_ALTERNATE_RX.test(tag) || !TYPE_FEED_RX.test(tag)) continue;
    const href = tag.match(HREF_RX)?.[1];
    if (!href) continue;
    try {
      return new URL(htmlToText(href), baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

export type FeedDiscoveryResult =
  | { status: "ok"; feedUrl: string }
  | { status: "no_feed" }
  | { status: "error"; message: string };

/** Looks up a working feed URL for a homepage. Does not parse or return
 *  items — africaWireActor.ts calls this once per source (then caches the
 *  result, see there), and fetches the discovered feedUrl itself on every
 *  subsequent cycle without re-running discovery. */
export async function discoverFeed(homepage: string): Promise<FeedDiscoveryResult> {
  let origin: string;
  try {
    origin = new URL(homepage).origin;
  } catch {
    return { status: "error", message: "invalid homepage URL" };
  }

  const html = await tryFetch(homepage);
  if (html === null) return { status: "error", message: "homepage unreachable" };

  const autodiscovered = extractAutodiscoveredFeed(html, homepage);
  if (autodiscovered) {
    const body = await tryFetch(autodiscovered);
    if (body && looksLikeFeed(body)) return { status: "ok", feedUrl: autodiscovered };
    // The tag pointed somewhere that didn't actually pan out — fall through
    // to the conventional-path guesses rather than trusting a dead link.
  }

  for (const path of FALLBACK_PATHS) {
    const candidate = origin + path;
    const body = await tryFetch(candidate);
    if (body && looksLikeFeed(body)) return { status: "ok", feedUrl: candidate };
  }

  return { status: "no_feed" };
}
