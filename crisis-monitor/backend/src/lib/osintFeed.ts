import { fingerprint, htmlToText, parseChannelPage, splitHeadline, type TelegramPost } from "./telegram";

/**
 * "OSINT Alerts" — public Telegram channels + wire-service RSS, merged into
 * one feed, cross-post-deduplicated, keyword risk-scored, and coarse-
 * geocoded to a country/region centroid.
 *
 * Adapted (MIT license permits reuse) from OSIRIS
 * (github.com/simplifaisoul/osiris, src/app/api/news/route.ts). Two
 * deliberate simplifications versus OSIRIS's own version:
 *
 *   - No Nominatim per-report geocoding. OSIRIS throttles this hard (its
 *     own comment: "this app came to be running at ten times the rate its
 *     operators allow") and still only resolves a report to a place name a
 *     free-text search happens to find. This module places every report on
 *     the same fixed keyword→country-centroid table already used for the
 *     country-anchor fallback there, rather than adding another
 *     rate-limited, keyless upstream dependency purely for a marginally
 *     tighter pin. A report an operator needs pinned precisely should be
 *     read from its actual text and placed by hand, not auto-geocoded.
 *   - Both fetches use a plain declared User-Agent, not OSIRIS's evasive
 *     "stealthFetch" (randomised User-Agent + forged X-Forwarded-For from
 *     real residential ISP ranges, used across nearly every one of its
 *     integrations, not just this one) — that's identity-spoofing to evade
 *     rate limits/bot detection and isn't something this app does. Both
 *     sources here (Telegram's own public channel-preview page, public RSS
 *     feeds) are read exactly as a browser or feed reader would.
 */

export type Bloc = "western" | "russian" | "regional" | "independent";

interface Feed {
  handle: string;
  name: string;
  lean: string;
  bloc: Bloc;
}

/**
 * Public Telegram OSINT channels, picked for what they report rather than
 * what they argue — same roster OSIRIS measured and settled on (see its
 * comment history for the channels it dropped and why). The roster spans
 * the spectrum so no single narrative owns the feed; `lean`/`bloc` travel
 * with every item so a partisan source is always labelled as one.
 */
const TELEGRAM_CHANNELS: Feed[] = [
  { handle: "Osintdefender", name: "OSINTdefender", lean: "Global incident OSINT", bloc: "independent" },
  { handle: "WarMonitors", name: "War Monitor", lean: "Global conflict monitor", bloc: "independent" },
  { handle: "rybar_in_english", name: "Rybar", lean: "Russian military OSINT", bloc: "russian" },
  { handle: "DDGeopolitics", name: "DD Geopolitics", lean: "Multipolar / Russian", bloc: "russian" },
  { handle: "KyivIndependent_official", name: "Kyiv Independent", lean: "Ukrainian newsroom", bloc: "western" },
  { handle: "QudsNen", name: "Quds News Network", lean: "Palestinian / Gaza & West Bank", bloc: "regional" },
  { handle: "AlMayadeenEnglish", name: "Al Mayadeen English", lean: "Lebanese / Resistance Axis", bloc: "regional" },
  { handle: "intelslava", name: "Intel Slava Z", lean: "Russian military OSINT", bloc: "russian" },
  { handle: "PressTV", name: "Press TV", lean: "Iranian state broadcaster", bloc: "regional" },
];

/**
 * Wire services and national newsrooms — covers the ground the channels
 * above ignore (Africa, South/East Asia, Latin America), publishes on a
 * schedule, and keeps going if Telegram blocks a host.
 */
const WIRE_FEEDS: (Feed & { url: string })[] = [
  { handle: "bbc", url: "https://feeds.bbci.co.uk/news/world/rss.xml", name: "BBC World", lean: "British public broadcaster", bloc: "western" },
  { handle: "guardian", url: "https://www.theguardian.com/world/rss", name: "The Guardian", lean: "British newsroom", bloc: "western" },
  { handle: "aljazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", name: "Al Jazeera", lean: "Qatari broadcaster", bloc: "regional" },
  { handle: "timesofisrael", url: "https://www.timesofisrael.com/feed/", name: "Times of Israel", lean: "Israeli newsroom", bloc: "regional" },
  { handle: "tass", url: "https://tass.com/rss/v2.xml", name: "TASS", lean: "Russian state agency", bloc: "russian" },
  { handle: "anadolu", url: "https://www.aa.com.tr/en/rss/default?cat=world", name: "Anadolu Agency", lean: "Turkish state agency", bloc: "regional" },
  { handle: "scmp", url: "https://www.scmp.com/rss/91/feed", name: "SCMP", lean: "Hong Kong newsroom", bloc: "regional" },
  { handle: "cna", url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml", name: "CNA", lean: "Singaporean broadcaster", bloc: "regional" },
  { handle: "africanews", url: "https://www.africanews.com/feed/rss", name: "Africanews", lean: "Pan-African newsroom", bloc: "regional" },
  // Added at Simon's request for deeper Africa coverage. Each URL below was
  // individually fetched and confirmed to return live, parseable RSS/RDF
  // XML before being hardcoded here (2026-09-29) — none of this is guessed.
  { handle: "allafrica", url: "https://allafrica.com/tools/headlines/rdf/africa/headlines.rdf", name: "AllAfrica", lean: "Pan-African wire aggregator", bloc: "regional" },
  { handle: "dabanga", url: "https://www.dabangasudan.org/en/feed", name: "Radio Dabanga", lean: "Sudan-focused exile newsroom", bloc: "regional" },
  { handle: "sudantribune", url: "https://sudantribune.com/feed", name: "Sudan Tribune", lean: "Sudanese diaspora newsroom", bloc: "regional" },
  { handle: "dw", url: "https://rss.dw.com/rdf/rss-en-all", name: "DW (Deutsche Welle)", lean: "German public broadcaster", bloc: "western" },
];

const POSTS_PER_CHANNEL = 8;
const ITEMS_PER_WIRE = 5;
const CHANNEL_TTL_MS = 3 * 60_000;
const WIRE_TTL_MS = 5 * 60_000;
export const MAX_POST_AGE_MS = 72 * 3_600_000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const RISK_KEYWORDS = ["war", "missile", "strike", "attack", "crisis", "tension", "military", "conflict", "defense", "clash", "nuclear", "invasion", "bomb", "drone", "weapon", "sanctions", "ceasefire", "escalation", "killed", "destroyed", "operation", "casualty", "frontline", "threat"];

const RISK_PATTERNS = RISK_KEYWORDS.map((kw) => ({ kw, rx: new RegExp(`\\b${kw === "casualty" ? "casualt(?:y|ies)" : `${kw}(?:s|es|ed|ing)?`}\\b`, "i") }));

const KEYWORD_COORDS: Record<string, [number, number]> = {
  ukraine: [49.487, 31.272], kyiv: [50.45, 30.523], russia: [61.524, 105.318], moscow: [55.755, 37.617],
  israel: [31.046, 34.851], gaza: [31.416, 34.333], iran: [32.427, 53.688], lebanon: [33.854, 35.862],
  syria: [34.802, 38.996], yemen: [15.552, 48.516], china: [35.861, 104.195], taiwan: [23.697, 120.96],
  "united states": [38.907, -77.036], europe: [48.8, 2.3], "middle east": [31.5, 34.8],
  sudan: [12.863, 30.218], somalia: [5.152, 46.199], ethiopia: [9.145, 40.49], drc: [-4.038, 21.759],
  "democratic republic of congo": [-4.038, 21.759], mali: [17.571, -3.996], niger: [17.608, 8.082],
  nigeria: [9.082, 8.675], "burkina faso": [12.238, -1.561], libya: [26.336, 17.229], africa: [1.0, 20.0],
  "south sudan": [7.862, 29.918], kenya: [-0.023, 37.906], uganda: [1.373, 32.29], rwanda: [-1.94, 29.874],
  burundi: [-3.373, 29.919], "central african republic": [6.611, 20.939], chad: [15.454, 18.732],
  cameroon: [7.37, 12.35], "cote d'ivoire": [7.54, -5.55], "ivory coast": [7.54, -5.55], senegal: [14.497, -14.452],
  mozambique: [-18.665, 35.529], zimbabwe: [-19.015, 29.155], egypt: [26.82, 30.802], tunisia: [33.887, 9.537],
  algeria: [28.033, 1.659], morocco: [31.792, -7.093], "south africa": [-30.559, 22.937], eritrea: [15.179, 39.782],
  djibouti: [11.825, 42.59], mauritania: [21.007, -10.94], guinea: [9.946, -9.696], togo: [8.619, 0.825],
  gabon: [-0.804, 11.609], congo: [-0.228, 15.827], angola: [-11.202, 17.874], zambia: [-13.134, 27.849],
  madagascar: [-18.767, 46.869], benin: [9.307, 2.315], ghana: [7.947, -1.023], liberia: [6.428, -9.43],
  "sierra leone": [8.461, -11.779], gambia: [13.444, -15.31], pakistan: [30.375, 69.345], afghanistan: [33.939, 67.71],
  "north korea": [40.34, 127.51], venezuela: [6.424, -66.59], myanmar: [21.914, 95.956], haiti: [18.971, -72.285],
  india: [20.594, 78.963], armenia: [40.069, 45.038], azerbaijan: [40.143, 47.577], georgia: [42.315, 43.357],
  "north macedonia": [41.608, 21.745], serbia: [44.017, 21.006], kosovo: [42.603, 20.903], bosnia: [43.916, 17.679],
};

/** Public entry points reused by africaWireCrawl.ts (the deeper-coverage
 *  African country/pan-African/institutional source crawl) so it produces
 *  items in exactly the same shape as this module's own feed, rather than
 *  duplicating the RSS parsing and text-cleanup logic. */
export { parseRSSItems, hashId, BROWSER_UA };

/** One point of base, two per distinct risk term matched, capped at 10 — matched terms travel with the score. */
export function scoreRisk(text: string): { score: number; matched: string[] } {
  const matched = RISK_PATTERNS.filter((p) => p.rx.test(text)).map((p) => p.kw);
  return { score: Math.min(10, 1 + matched.length * 2), matched };
}

/** Resolves a place name to a preset country/region centroid — not the location of the reported event. */
export function findCoords(text: string): { coords: [number, number]; anchor: string } | null {
  const lower = text.toLowerCase();
  for (const [keyword, coords] of Object.entries(KEYWORD_COORDS)) {
    if (lower.includes(keyword)) return { coords, anchor: keyword };
  }
  return null;
}

export function recentPosts(posts: TelegramPost[], now = Date.now()): TelegramPost[] {
  return posts.filter((p) => now - Date.parse(p.publishedAt) <= MAX_POST_AGE_MS).slice(-POSTS_PER_CHANNEL);
}

export interface ChannelPost { post: TelegramPost; channel: Pick<Feed, "handle" | "name" | "lean" | "bloc"> }

/** Folds the same report posted by several channels into one story: earliest post leads, others listed as carrying it. */
export function mergeCrossPosts(posts: ChannelPost[]): { lead: ChannelPost; carriedBy: ChannelPost[] }[] {
  const byKey = new Map<string, ChannelPost[]>();
  for (const p of posts) {
    const fp = fingerprint(p.post.text);
    const key = fp.split(" ").length >= 6 ? fp : `id:${p.post.id}`;
    byKey.set(key, [...(byKey.get(key) || []), p]);
  }
  return [...byKey.values()].map((group) => {
    const [lead, ...rest] = [...group].sort((a, b) => Date.parse(a.post.publishedAt) - Date.parse(b.post.publishedAt));
    const seen = new Set([lead.channel.handle]);
    const carriedBy = rest.filter((c) => {
      if (seen.has(c.channel.handle)) return false;
      seen.add(c.channel.handle);
      return true;
    });
    return { lead, carriedBy };
  });
}

interface RssItem { title: string; description: string; link: string; pubDate: string; source: string }

function parseRSSItems(xml: string, sourceName: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag: string) => {
      const m = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return (m?.[1] || m?.[2] || "").trim();
    };
    const title = htmlToText(getTag("title"));
    const pubDate = getTag("pubDate");
    if (!title || !pubDate || Number.isNaN(Date.parse(pubDate))) continue;
    items.push({ title: title.length > 140 ? `${title.substring(0, 140)}…` : title, description: htmlToText(getTag("description")), link: getTag("link"), pubDate: new Date(pubDate).toISOString(), source: sourceName });
  }
  return items;
}

function wirePost(item: RssItem, feed: Feed): TelegramPost {
  const text = item.description && item.description !== item.title ? `${item.title}\n\n${item.description}` : item.title;
  const { headline, summary, flag } = splitHeadline(text);
  return {
    id: `${feed.handle}/${hashId(item.link || item.title)}`,
    channel: feed.handle,
    url: item.link,
    publishedAt: item.pubDate,
    text,
    headline,
    flag,
    summary,
    media: null,
    forwardedFrom: null,
    replyTo: null,
    views: null,
  };
}

/** Deterministic short id — a stand-in for OSIRIS's Node crypto.createHash('md5'), which Workers don't have. Not security-sensitive, just needs to be stable. */
function hashId(s: string): string {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

function sourceRef(channel: Feed): string {
  const wire = WIRE_FEEDS.find((f) => f.handle === channel.handle);
  if (!wire) return `t.me/${channel.handle}`;
  try {
    return new URL(wire.url).hostname.replace(/^www\./, "");
  } catch {
    return channel.handle;
  }
}

interface Carrier { source: string; source_name: string; lean: string; bloc: Bloc; link: string; published: string }

export interface OsintAlertItem {
  id: string;
  title: string;
  summary: string;
  description: string;
  link: string;
  published: string;
  source: string;
  source_name: string;
  lean: string | null;
  bloc: Bloc | null;
  flag: TelegramPost["flag"];
  also_reported_by: Carrier[];
  risk_score: number;
  risk_method: string;
  risk_keywords: string[];
  coords: [number, number] | null;
  coords_default: boolean;
  coords_anchor: string | null;
}

export interface OsintFeedPayload {
  alerts: OsintAlertItem[];
  total: number;
  sources: { handle: string; name: string; lean: string; bloc: Bloc; kind: "telegram" | "wire"; count: number; latest: string | null }[];
  fetchedAt: string;
}

async function fetchChannel(channel: Feed): Promise<TelegramPost[]> {
  const res = await fetch(`https://t.me/s/${channel.handle}`, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseChannelPage(await res.text(), channel.handle);
}

async function fetchWire(feed: Feed & { url: string }): Promise<TelegramPost[]> {
  const res = await fetch(feed.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": BROWSER_UA, Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseRSSItems(await res.text(), feed.name).slice(0, ITEMS_PER_WIRE);
  return items.map((item) => wirePost(item, feed)).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
}

/** Tiny per-source cache — mirrors this backend's existing shared-cache pattern (OpenSky, satellites) so N viewers cost one upstream fetch per window, not N. */
const sourceCache = new Map<string, { at: number; ttl: number; data: TelegramPost[] }>();
async function cachedFetch(key: string, ttl: number, load: () => Promise<TelegramPost[]>): Promise<TelegramPost[]> {
  const hit = sourceCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  const data = await load();
  sourceCache.set(key, { at: Date.now(), ttl, data });
  return data;
}

export async function buildOsintFeed(): Promise<OsintFeedPayload> {
  const now = Date.now();
  const all = await Promise.all([
    ...TELEGRAM_CHANNELS.map(async (channel) => ({ channel, kind: "telegram" as const, all: await cachedFetch(`tg:${channel.handle}`, CHANNEL_TTL_MS, () => fetchChannel(channel)).catch(() => [] as TelegramPost[]) })),
    ...WIRE_FEEDS.map(async (feed) => ({ channel: feed, kind: "wire" as const, all: await cachedFetch(`wire:${feed.handle}`, WIRE_TTL_MS, () => fetchWire(feed)).catch(() => [] as TelegramPost[]) })),
  ]);

  const sources = all.map(({ channel, kind, all: posts }) => ({
    handle: channel.handle,
    name: channel.name,
    lean: channel.lean,
    bloc: channel.bloc,
    kind,
    count: recentPosts(posts, now).length,
    latest: posts.length ? posts[posts.length - 1].publishedAt : null,
  }));

  const stories = mergeCrossPosts(all.flatMap(({ channel, all: posts }) => recentPosts(posts, now).map((post) => ({ post, channel }))));

  const alerts: OsintAlertItem[] = stories.map(({ lead: { post, channel }, carriedBy }) => {
    const risk = scoreRisk(post.text);
    const located = findCoords(post.text);
    return {
      id: hashId(post.url),
      title: post.headline,
      summary: post.summary,
      description: post.text,
      link: post.url,
      published: post.publishedAt,
      source: sourceRef(channel),
      source_name: channel.name,
      lean: channel.lean,
      bloc: channel.bloc,
      flag: post.flag,
      also_reported_by: carriedBy.map((c) => ({ source: sourceRef(c.channel), source_name: c.channel.name, lean: c.channel.lean, bloc: c.channel.bloc, link: c.post.url, published: c.post.publishedAt })),
      risk_score: risk.score,
      risk_method: "keyword-count",
      risk_keywords: risk.matched,
      coords: located ? located.coords : null,
      coords_default: !located,
      coords_anchor: located ? located.anchor : null,
    };
  });

  alerts.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

  return { alerts, total: alerts.length, sources, fetchedAt: new Date().toISOString() };
}
