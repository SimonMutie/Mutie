import type { Env } from "../bindings";
import { AFRICA_CENTROIDS, AFRICA_GEO_COUNTRIES, MIDDLE_EAST_CODES, normalizeName } from "./africaGeo";
import { discoverFeed } from "./feedDiscovery";

/**
 * Strategic humanitarian analyses: the reflections think tanks, research centres and specialist outlets publish on
 * how humanitarianism is changing (funding cuts, the humanitarian reset, localisation, Global South donors and
 * actors, the access environment, and the rest of the taxonomy below), with the Lens's focus on Africa.
 *
 * Every hour the collector reads each source's feed, keeps pieces that match the taxonomy, and stores them with the
 * themes they touch and the African countries they discuss. A piece is in scope when it is about Africa, or when it
 * is a system-level reflection (funding, reset, localisation, Global South, the future of the system) that shapes
 * Africa whether or not it names it. New pieces in scope are sent to anyone subscribed to these alerts
 * (alertDelivery.ts, scope "humanitarian").
 */

/* ── Sources ──────────────────────────────────────────────────────────── */

export interface HumSource {
  name: string;
  /** The feed, or the site's homepage when its feed is found by discovery. */
  url: string;
  /** Africa-based or Africa-focused sources: everything they publish counts as about Africa. */
  africa: boolean;
}

/**
 * Think tanks, research centres and specialist outlets that write on humanitarian policy and Africa. Sites without a
 * findable feed are reported in the source status (Live OSINT → Humanitarian → Sources), not dropped silently.
 */
export const HUM_SOURCES: HumSource[] = [
  // Humanitarian policy and practice
  { name: "The New Humanitarian", url: "https://www.thenewhumanitarian.org/rss/all.xml", africa: false },
  { name: "ODI Global (Humanitarian Policy Group)", url: "https://odi.org/en/", africa: false },
  { name: "Humanitarian Practice Network", url: "https://odihpn.org/feed/", africa: false },
  { name: "ALNAP", url: "https://www.alnap.org/", africa: false },
  { name: "ICRC Humanitarian Law & Policy blog", url: "https://blogs.icrc.org/law-and-policy/feed/", africa: false },
  { name: "ICVA", url: "https://www.icvanetwork.org/", africa: false },
  { name: "Humanitarian Outcomes", url: "https://humanitarianoutcomes.org/", africa: false },
  { name: "Global Public Policy Institute (GPPi)", url: "https://gppi.net/", africa: false },
  { name: "CHS Alliance", url: "https://www.chsalliance.org/", africa: false },
  { name: "MSF Centre for Applied Reflection on Humanitarian Practice (CRASH)", url: "https://msf-crash.org/en", africa: false },
  { name: "Development Initiatives", url: "https://devinit.org/", africa: false },
  { name: "Center on International Cooperation (NYU)", url: "https://cic.nyu.edu/", africa: false },
  { name: "Refugees International", url: "https://www.refugeesinternational.org/feed/", africa: false },
  { name: "Norwegian Refugee Council", url: "https://www.nrc.no/", africa: false },
  { name: "IPI Global Observatory", url: "https://theglobalobservatory.org/feed/", africa: false },
  { name: "Center for Global Development", url: "https://www.cgdev.org/", africa: false },
  { name: "Chatham House", url: "https://www.chathamhouse.org/", africa: false },
  { name: "International Crisis Group", url: "https://www.crisisgroup.org/", africa: false },
  { name: "Devex", url: "https://www.devex.com/", africa: false },
  // Localisation and shifting power
  { name: "Charter4Change", url: "https://charter4change.org/feed/", africa: false },
  { name: "NEAR Network", url: "https://www.near.ngo/", africa: false },
  { name: "Peace Direct", url: "https://www.peacedirect.org/feed/", africa: false },
  // African think tanks and Africa-focused analysis
  { name: "Institute for Security Studies (ISS Africa)", url: "https://issafrica.org/", africa: true },
  { name: "Africa Center for Strategic Studies", url: "https://africacenter.org/feed/", africa: true },
  { name: "ACCORD", url: "https://www.accord.org.za/feed/", africa: true },
  { name: "South African Institute of International Affairs (SAIIA)", url: "https://saiia.org.za/feed/", africa: true },
  { name: "Amani Africa", url: "https://amaniafrica-et.org/feed/", africa: true },
  { name: "ECDPM", url: "https://ecdpm.org/", africa: true },
  { name: "Africa Portal", url: "https://www.africaportal.org/", africa: true },
  { name: "The Conversation Africa", url: "https://theconversation.com/africa/articles.atom", africa: true },
  { name: "Adeso", url: "https://adesoafrica.org/", africa: true },
  { name: "West Africa Network for Peacebuilding (WANEP)", url: "https://wanep.org/wanep/", africa: true },
];

/* ── Taxonomy ─────────────────────────────────────────────────────────── */

export interface HumTheme {
  id: string;
  label: string;
  /** Lower-case terms; a term ending in "*" matches any word that starts with it. */
  terms: string[];
  /** Shapes the whole system, so counts even when a piece names no African country. */
  systemic?: boolean;
}

export const HUM_THEMES: HumTheme[] = [
  {
    id: "funding",
    label: "Funding cuts & aid financing",
    systemic: true,
    terms: ["funding cut*", "aid cut*", "budget cut*", "cuts to aid", "foreign aid", "official development assistance", "oda", "usaid", "dismantl*", "aid freeze", "funding freeze", "funding gap*", "underfund*", "humanitarian financing", "humanitarian funding", "pooled fund*", "cerf", "global humanitarian overview", "donor fatigue", "donor government*", "shrinking aid", "aid budget*", "aid architecture", "financing gap", "hyper-prioriti*", "prioritisation", "prioritization"],
  },
  {
    id: "reset",
    label: "Humanitarian reset & system reform",
    systemic: true,
    terms: ["humanitarian reset", "the reset", "un80", "un reform", "system reform", "grand bargain", "iasc", "inter-agency standing committee", "flagship initiative", "humanitarian architecture", "humanitarian system", "transformation agenda", "agency merger*", "merging agencies", "emergency relief coordinator"],
  },
  {
    id: "localisation",
    label: "Localisation & shifting power",
    systemic: true,
    terms: ["localisation", "localization", "localis*", "localiz*", "locally led", "locally-led", "local actors", "local and national actors", "national ngos", "local ngos", "community-led", "shift the power", "shifting power", "power shift", "decoloni*", "charter for change", "intermediar*", "direct funding", "women-led organi*", "women's rights organi*", "proximate", "local leadership", "equitable partnership*"],
  },
  {
    id: "global-south",
    label: "Global South & non-traditional actors",
    systemic: true,
    terms: ["global south", "non-traditional donor*", "emerging donor*", "new donors", "gulf donor*", "gulf humanitarian*", "saudi aid", "ksrelief", "emirati aid", "uae aid", "qatari aid", "qatar fund for development", "kuwaiti aid", "turkish aid", "türkiye's aid", "chinese aid", "china's aid", "south-south", "brics", "india's aid", "african humanitarian agency", "african union", "au humanitarian", "solidarity-based", "middle powers", "islamic humanitarian*", "zakat", "diaspora"],
  },
  {
    id: "access",
    label: "Access & the operating environment",
    terms: ["humanitarian access", "access constraint*", "access impediment*", "bureaucratic impediment*", "humanitarian negotiation*", "negotiat* access", "armed group* engagement", "engagement with armed groups", "non-state armed group*", "deconflict*", "besieg*", "siege", "aid diversion", "obstruction of aid", "obstructing aid", "aid obstruction", "starvation as a weapon", "humanitarian corridor*", "cross-border aid", "cross-line", "denial of access", "humanitarian space", "operating environment"],
  },
  {
    id: "principles",
    label: "Principles, politicisation & sanctions",
    terms: ["humanitarian principles", "neutrality", "impartiality", "principled humanitarian*", "politicis*", "politiciz*", "instrumentalis*", "instrumentaliz*", "counter-terror*", "counterterror*", "sanctions regime*", "sanctions exemption*", "humanitarian carve-out*", "humanitarian exemption*", "militaris*", "securitis*", "international humanitarian law", "ihl"],
  },
  {
    id: "security",
    label: "Aid worker safety & risk",
    terms: ["aid worker*", "humanitarian worker*", "attacks on aid", "attacks on humanitarian*", "staff killed", "duty of care", "risk transfer", "risk sharing", "security risk management", "kidnapping of aid"],
  },
  {
    id: "nexus",
    label: "Nexus, climate & anticipatory action",
    terms: ["nexus", "humanitarian-development-peace", "triple nexus", "hdp", "anticipatory action", "early action", "early warning", "climate finance", "climate crisis", "loss and damage", "resilience", "protracted crisis", "protracted crises", "durable solutions"],
  },
  {
    id: "accountability",
    label: "Accountability & participation",
    terms: ["accountability to affected people", "accountability to affected populations", "aap", "participation revolution", "affected people", "feedback mechanism*", "community engagement", "psea", "sexual exploitation and abuse", "safeguarding"],
  },
  {
    id: "cash-digital",
    label: "Cash, data & technology",
    terms: ["cash assistance", "cash transfer*", "cash and voucher*", "digital humanitarian*", "artificial intelligence", "data protection", "biometric*", "digital identity", "humanitarian data"],
  },
  {
    id: "future",
    label: "The future of humanitarianism",
    systemic: true,
    terms: ["future of humanitarian*", "new humanitarianism", "humanitarian landscape", "humanitarian sector", "aid sector", "aid industry", "post-aid", "beyond aid", "aid dependency", "multilateralism", "multilateral system", "humanitarian model", "humanitarian action", "what next for aid", "end of aid", "rethinking aid", "rethink* humanitarian*"],
  },
];

/** A piece must be about humanitarian action at all before its themes count. */
const HUMANITARIAN_SIGNAL = /\b(humanitarian\w*|aid|relief|ngos?|donors?|refugees?|displace\w*|idps?|famine|food insecurity|emergency response|development assistance|civil society)\b/i;

function termRegex(term: string): RegExp {
  const t = term.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? ch : `\\${ch}`));
  const body = t.endsWith("*") ? `${t.slice(0, -1)}[\\w-]*` : t;
  return new RegExp(`(?:^|[^\\w])${body}(?=$|[^\\w])`, "i");
}
const THEME_RX = HUM_THEMES.map((th) => ({ id: th.id, systemic: !!th.systemic, rx: th.terms.map(termRegex) }));

/** The themes a text touches, most-matched first, with how many terms matched. */
export function themesOf(text: string): { id: string; hits: number }[] {
  return THEME_RX.map((th) => ({ id: th.id, hits: th.rx.filter((r) => r.test(text)).length }))
    .filter((t) => t.hits > 0)
    .sort((a, b) => b.hits - a.hits);
}

/* ── Africa ───────────────────────────────────────────────────────────── */

const AFRICA_NAMES: { code: string; rx: RegExp }[] = Object.entries(AFRICA_GEO_COUNTRIES)
  .filter(([code]) => !MIDDLE_EAST_CODES.has(code))
  .flatMap(([code, info]) => [info.name, ...info.aliases].filter((n) => n.length >= 4).map((n) => ({ code, rx: new RegExp(`\\b${normalizeName(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) })));
const AFRICA_DEMONYMS: [RegExp, string][] = [
  [/\bsudanese\b/, "SD"], [/\bsouth sudanese\b/, "SS"], [/\bethiopians?\b/, "ET"], [/\beritreans?\b/, "ER"], [/\bsomalis?\b/, "SO"], [/\bkenyans?\b/, "KE"],
  [/\bugandans?\b/, "UG"], [/\bcongolese\b/, "CD"], [/\bmalians?\b/, "ML"], [/\bnigeriens?\b/, "NE"], [/\bnigerians?\b/, "NG"], [/\bburkinabe\b/, "BF"],
  [/\bchadians?\b/, "TD"], [/\bcameroonians?\b/, "CM"], [/\blibyans?\b/, "LY"], [/\bmozambicans?\b/, "MZ"], [/\bzimbabweans?\b/, "ZW"], [/\bdarfuri\b/, "SD"], [/\btigrayans?\b/, "ET"],
];
const AFRICA_REGION = /\b(africa|african|sahel|sahelian|horn of africa|lake chad|great lakes|east africa|west africa|central africa|southern africa|north africa|sub-saharan|maghreb)\b/;

/** The African countries a text discusses, most-mentioned first, and whether it is about Africa at all. */
export function africaOf(text: string): { africa: boolean; countries: string[] } {
  // "Ethiopia's" reads as "Ethiopia".
  const t = normalizeName(text.replace(/['’‘ʼ]s\b/g, ""));
  const counts = new Map<string, number>();
  for (const { code, rx } of AFRICA_NAMES) {
    const n = (t.match(new RegExp(rx.source, "g")) ?? []).length;
    if (n) counts.set(code, (counts.get(code) ?? 0) + n);
  }
  for (const [rx, code] of AFRICA_DEMONYMS) if (rx.test(t)) counts.set(code, (counts.get(code) ?? 0) + 1);
  // "South Sudan" also matches "Sudan": drop the Sudan count it caused.
  if (counts.has("SS") && counts.has("SD")) {
    const ss = (t.match(/\bsouth sudan/g) ?? []).length;
    const sd = (counts.get("SD") ?? 0) - ss;
    if (sd > 0) counts.set("SD", sd);
    else counts.delete("SD");
  }
  const countries = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return { africa: countries.length > 0 || AFRICA_REGION.test(t), countries };
}

/* ── Classifying a piece ──────────────────────────────────────────────── */

export interface HumItem {
  id: string;
  url: string;
  title: string;
  summary: string;
  source: string;
  published: string;
  themes: string[];
  countries: string[];
  africa: boolean;
  /** Africa-focused, or a system-level reflection that shapes Africa: shown by default and alerted on. */
  inScope: boolean;
  score: number;
}

export function classify(raw: { url: string; title: string; summary: string; source: HumSource; published: string }): HumItem | null {
  const text = `${raw.title}. ${raw.summary}`;
  if (!HUMANITARIAN_SIGNAL.test(text)) return null;
  const themes = themesOf(text);
  if (themes.length === 0) return null;
  const { africa: mentionsAfrica, countries } = africaOf(text);
  const africa = mentionsAfrica || raw.source.africa;
  const systemic = themes.some((t) => THEME_RX.find((x) => x.id === t.id)?.systemic);
  // A single loose hit outside the systemic themes, on a piece that is not about Africa, is noise.
  if (!africa && !systemic) return null;
  const score = themes.reduce((n, t) => n + t.hits, 0) + (africa ? 2 : 0) + (systemic ? 1 : 0);
  return {
    id: hashId(raw.url || raw.title),
    url: raw.url,
    title: raw.title,
    summary: raw.summary.slice(0, 700),
    source: raw.source.name,
    published: raw.published,
    themes: themes.map((t) => t.id),
    countries,
    africa,
    inScope: africa || systemic,
    score,
  };
}

/* ── Feeds ────────────────────────────────────────────────────────────── */

// Escaped markup (&lt;p&gt;) is unescaped before tags are stripped, so it does not survive as text.
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "’")
    .replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;|&#8221;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Items from an RSS or Atom feed: title, link, date and summary. */
export function parseFeed(xml: string): { title: string; url: string; published: string; summary: string }[] {
  const out: { title: string; url: string; published: string; summary: string }[] = [];
  const tag = (block: string, names: string[]) => {
    for (const n of names) {
      const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
      if (m) return m[1];
    }
    return "";
  };
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi), ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = decode(tag(b, ["title"]));
    let url = decode(tag(b, ["link"]));
    if (!url) url = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? "";
    const dateRaw = decode(tag(b, ["pubDate", "published", "updated", "dc:date"]));
    const date = Date.parse(dateRaw);
    const summary = decode(tag(b, ["description", "summary", "content:encoded", "content"]));
    if (!title || !url || !Number.isFinite(date)) continue;
    out.push({ title, url: url.trim(), published: new Date(date).toISOString(), summary });
  }
  return out;
}

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
  return `hum_${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/* ── Storage and collection ───────────────────────────────────────────── */

let ready = false;
export async function ensureHumTables(db: D1Database): Promise<void> {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hum_analyses (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, source TEXT NOT NULL, published TEXT NOT NULL, themes TEXT NOT NULL, countries TEXT NOT NULL, africa INTEGER NOT NULL, in_scope INTEGER NOT NULL, score INTEGER NOT NULL, first_seen TEXT NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hum_analyses_published ON hum_analyses(published)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hum_analyses_first_seen ON hum_analyses(first_seen)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hum_sources (url TEXT PRIMARY KEY, name TEXT NOT NULL, feed_url TEXT, checked_at TEXT, status TEXT, error TEXT, items INTEGER NOT NULL DEFAULT 0, kept INTEGER NOT NULL DEFAULT 0, last_ok TEXT)`),
  ]);
  ready = true;
}

/** Test hook. */
export function resetHumTables(): void {
  ready = false;
}

const COLLECT_EVERY_MS = 60 * 60_000;
const REDISCOVER_MS = 7 * 24 * 3600_000;
/** Pieces older than this when first seen are not stored: the panel is about what is new. */
const MAX_AGE_DAYS = 120;

type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLens/1.0; +https://afrilensconsulting.com)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(20000) });

/** Reads every source (at most hourly), stores new pieces in scope of the taxonomy, and returns how many were new. */
export async function collectHumanitarianAnalyses(env: Env, opts: { force?: boolean; now?: Date; fetcher?: Fetcher; discover?: typeof discoverFeed } = {}): Promise<{ ran: boolean; added: number; sources: number }> {
  const db = env.DB;
  const now = opts.now ?? new Date();
  const fetcher = opts.fetcher ?? defaultFetch;
  const discover = opts.discover ?? discoverFeed;
  await ensureHumTables(db);
  const last = await db.prepare(`SELECT MAX(checked_at) AS t FROM hum_sources`).first<{ t: string | null }>();
  if (!opts.force && last?.t && now.getTime() - Date.parse(last.t) < COLLECT_EVERY_MS) return { ran: false, added: 0, sources: 0 };

  const states = new Map((await db.prepare(`SELECT url, feed_url, checked_at, status FROM hum_sources`).all<{ url: string; feed_url: string | null; checked_at: string | null; status: string | null }>()).results?.map((r) => [r.url, r]) ?? []);
  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000).toISOString();
  let added = 0;

  const one = async (src: HumSource) => {
    const state = states.get(src.url);
    let feedUrl = state?.feed_url ?? null;
    try {
      if (!feedUrl || (state?.checked_at && now.getTime() - Date.parse(state.checked_at) > REDISCOVER_MS && state.status !== "ok")) {
        const found = await discover(src.url);
        if (found.status !== "ok") throw new Error(found.status === "no_feed" ? "No feed found on this site" : found.message);
        feedUrl = found.feedUrl;
      }
      const res = await fetcher(feedUrl);
      if (!res.ok) throw new Error(`Feed returned ${res.status}`);
      const entries = parseFeed(await res.text());
      const kept = entries
        .filter((e) => e.published >= cutoff)
        .map((e) => classify({ ...e, source: src }))
        .filter((x): x is HumItem => x !== null);
      if (kept.length) {
        const results = await db.batch(
          kept.map((it) =>
            db
              .prepare(`INSERT OR IGNORE INTO hum_analyses (id, url, title, summary, source, published, themes, countries, africa, in_scope, score, first_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
              .bind(it.id, it.url, it.title, it.summary, it.source, it.published, JSON.stringify(it.themes), JSON.stringify(it.countries), it.africa ? 1 : 0, it.inScope ? 1 : 0, it.score, now.toISOString())
          )
        );
        added += results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
      }
      await db
        .prepare(`INSERT INTO hum_sources (url, name, feed_url, checked_at, status, error, items, kept, last_ok) VALUES (?,?,?,?,'ok',NULL,?,?,?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, feed_url = excluded.feed_url, checked_at = excluded.checked_at, status = 'ok', error = NULL, items = excluded.items, kept = excluded.kept, last_ok = excluded.last_ok`)
        .bind(src.url, src.name, feedUrl, now.toISOString(), entries.length, kept.length, now.toISOString())
        .run();
    } catch (err) {
      await db
        .prepare(`INSERT INTO hum_sources (url, name, feed_url, checked_at, status, error) VALUES (?,?,?,?,'error',?) ON CONFLICT(url) DO UPDATE SET name = excluded.name, feed_url = COALESCE(excluded.feed_url, hum_sources.feed_url), checked_at = excluded.checked_at, status = 'error', error = excluded.error`)
        .bind(src.url, src.name, feedUrl, now.toISOString(), err instanceof Error ? err.message.slice(0, 300) : String(err))
        .run();
    }
  };

  // A few at a time, so one slow site does not hold the rest.
  const queue = [...HUM_SOURCES];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) await one(s);
  }));
  await db.prepare(`DELETE FROM hum_analyses WHERE first_seen < ?`).bind(new Date(now.getTime() - 365 * 86_400_000).toISOString()).run();
  return { ran: true, added, sources: HUM_SOURCES.length };
}

/* ── Reading ──────────────────────────────────────────────────────────── */

export interface HumItemView extends HumItem {
  firstSeen: string;
  /** Where to pin it on the map: the African country it discusses most, if any. */
  lat: number | null;
  lng: number | null;
}

function rowToView(r: Record<string, unknown>): HumItemView {
  const countries = JSON.parse(String(r.countries ?? "[]")) as string[];
  const pin = countries.map((c) => AFRICA_CENTROIDS[c]).find(Boolean) ?? null;
  return {
    id: String(r.id),
    url: String(r.url),
    title: String(r.title),
    summary: String(r.summary ?? ""),
    source: String(r.source),
    published: String(r.published),
    themes: JSON.parse(String(r.themes ?? "[]")),
    countries,
    africa: !!r.africa,
    inScope: !!r.in_scope,
    score: Number(r.score),
    firstSeen: String(r.first_seen),
    lat: pin ? pin[0] : null,
    lng: pin ? pin[1] : null,
  };
}

export async function listHumanitarianAnalyses(db: D1Database, opts: { days?: number; all?: boolean; limit?: number } = {}): Promise<HumItemView[]> {
  await ensureHumTables(db);
  const since = new Date(Date.now() - (opts.days ?? 60) * 86_400_000).toISOString();
  const rows = await db
    .prepare(`SELECT * FROM hum_analyses WHERE published >= ? ${opts.all ? "" : "AND in_scope = 1"} ORDER BY published DESC LIMIT ?`)
    .bind(since, Math.min(opts.limit ?? 300, 1000))
    .all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToView);
}

/** Pieces in scope first seen after `since`, newest first, for alerts. */
export async function newHumanitarianSince(db: D1Database, since: string, limit = 10): Promise<HumItemView[]> {
  await ensureHumTables(db);
  const rows = await db.prepare(`SELECT * FROM hum_analyses WHERE in_scope = 1 AND first_seen > ? ORDER BY score DESC, published DESC LIMIT ?`).bind(since, limit).all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToView);
}

export async function humanitarianSourceStatus(db: D1Database): Promise<{ name: string; url: string; status: string; error: string | null; items: number; kept: number; lastOk: string | null }[]> {
  await ensureHumTables(db);
  const rows = (await db.prepare(`SELECT * FROM hum_sources`).all<Record<string, unknown>>()).results ?? [];
  const byUrl = new Map(rows.map((r) => [String(r.url), r]));
  return HUM_SOURCES.map((s) => {
    const r = byUrl.get(s.url);
    return { name: s.name, url: s.url, status: r ? String(r.status) : "not yet checked", error: r?.error != null ? String(r.error) : null, items: Number(r?.items ?? 0), kept: Number(r?.kept ?? 0), lastOk: r?.last_ok != null ? String(r.last_ok) : null };
  });
}

export const themeLabel = (id: string) => HUM_THEMES.find((t) => t.id === id)?.label ?? id;
