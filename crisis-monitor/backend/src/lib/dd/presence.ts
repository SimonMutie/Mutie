import type { Env } from "../../bindings";
import { fetchGdeltArticles } from "../../connectors/gdelt";
import { parseBooleanQuery } from "../../booleanQuery";
import { searchFeeds } from "../feedSearch";
import { callStructured } from "../llm";
import { nameSimilarity, nameTokens, normalizeName, STRONG } from "./match";
import type { Check, Kind } from "./sources";

/**
 * Media coverage and online presence: a quick picture of how much the
 * subject is in the news, from which outlets, and what the coverage is
 * about; and where the subject has public accounts and what is being said
 * about it on the open social networks.
 *
 * Honest limits, stated in the report: X, Facebook, Instagram, LinkedIn
 * and TikTok offer no open search for this use, so activity on them is not
 * measured. What is covered is (a) official accounts recorded in Wikidata,
 * (b) public posts on Mastodon and Bluesky, and (c) search links to open by
 * hand. Headline-level reading only, so the summary says so.
 */

let coverageDelayMs = 6000;
/** For tests. */
export const setCoverageDelay = (ms: number) => void (coverageDelayMs = ms);

const UA = "TheLens-DueDiligence/1.0 (+https://afrilensconsulting.com)";

// ── Mainstream media coverage ────────────────────────────────────────────

export interface CoverageItem {
  title: string;
  url: string;
  domain: string;
  published: string | null;
  /** Rated from the headline by the analyst model; absent when it could not be rated. */
  sentiment?: "positive" | "neutral" | "negative";
}
export interface CoverageResult {
  total: number;
  /** Articles per calendar month, oldest first. */
  byMonth: { month: string; count: number }[];
  topOutlets: { domain: string; count: number }[];
  recent: CoverageItem[];
  /** What the coverage is about, from headlines. */
  themes: string[];
  tone: "positive" | "neutral" | "mixed" | "negative" | "unclear";
  overview: string;
  aiWritten: boolean;
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const gdeltDay = (s: string) => (s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);

const COVERAGE_SCHEMA = {
  type: "object",
  properties: {
    themes: { type: "array", items: { type: "string" }, description: "Up to 5 short themes the coverage is about" },
    tone: { type: "string", enum: ["positive", "neutral", "mixed", "negative", "unclear"] },
    overview: { type: "string", description: "Two or three plain sentences on how prominent the subject is in the news and what the coverage is about." },
    headlines: {
      type: "array",
      description: "Sentiment toward the subject of each of the first 15 headlines, by number",
      items: { type: "object", properties: { index: { type: "integer" }, sentiment: { type: "string", enum: ["positive", "neutral", "negative"] } }, required: ["index", "sentiment"] },
    },
  },
  required: ["themes", "tone", "overview", "headlines"],
};

export async function checkMediaCoverage(env: Env, input: { names: string[]; kind: Kind; country: string | null }): Promise<Check<CoverageResult>> {
  const id = "media_coverage";
  const label = "Mainstream media coverage (GDELT and platform feeds, last 3 months)";
  try {
    const primary = input.names[0];
    // GDELT allows about one request every five seconds; this runs beside the adverse-media search, so it waits its turn.
    await new Promise((r) => setTimeout(r, coverageDelayMs));
    const found = new Map<string, CoverageItem>();
    const gd = await fetchGdeltArticles(`"${primary}"`, 75, "3months").catch(() => []);
    for (const a of gd) found.set(a.url, { title: a.title, url: a.url, domain: a.domain || hostOf(a.url), published: gdeltDay(a.seendate) });
    try {
      const q = `"${primary}"`;
      const res = await searchFeeds(env, [{ id: "c", text: q, parsed: parseBooleanQuery(q) }], 90 * 24, 40);
      for (const list of res.values()) for (const h of list) if (!found.has(h.link)) found.set(h.link, { title: h.title, url: h.link, domain: h.domain || hostOf(h.link), published: h.published ? h.published.slice(0, 10) : null });
    } catch {
      /* feeds are a bonus */
    }
    // Headlines often drop "Company"/"Ltd", so the name without suffixes (two or more words) counts too.
    const keys = input.names.flatMap((n) => {
      const full = normalizeName(n);
      const core = nameTokens(n, "entity").join(" ");
      return core !== full && core.split(" ").length >= 2 ? [full, core] : [full];
    }).filter(Boolean);
    const items = [...found.values()].filter((i) => keys.some((k) => normalizeName(i.title).includes(k)));
    if (!items.length) {
      const note = gd.length === 0 ? "No articles came back; the news search may have been rate-limited, so absence here is weak evidence." : undefined;
      return { id, label, state: "ok", note, hits: [{ total: 0, byMonth: [], topOutlets: [], recent: [], themes: [], tone: "unclear", overview: "No headlines naming the subject were found in the last three months.", aiWritten: false }] };
    }
    items.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
    const months = new Map<string, number>();
    const outlets = new Map<string, number>();
    for (const i of items) {
      if (i.published) months.set(i.published.slice(0, 7), (months.get(i.published.slice(0, 7)) ?? 0) + 1);
      if (i.domain) outlets.set(i.domain, (outlets.get(i.domain) ?? 0) + 1);
    }
    const byMonth = [...months.entries()].sort().map(([month, count]) => ({ month, count }));
    const topOutlets = [...outlets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([domain, count]) => ({ domain, count }));

    let themes: string[] = [];
    let tone: CoverageResult["tone"] = "unclear";
    let overview = `${items.length} headlines naming the subject in the last three months, most from ${topOutlets.slice(0, 3).map((o) => o.domain).join(", ")}.`;
    let aiWritten = false;
    const ai = await callStructured<{ themes: string[]; tone: CoverageResult["tone"]; overview: string; headlines?: { index: number; sentiment: "positive" | "neutral" | "negative" }[] }>(env, {
      role: "analyst",
      system:
        "You summarise news coverage of a subject for a due-diligence analyst, from headlines only. Some headlines may concern a different person or company with a similar name; ignore those that clearly do. Be neutral and factual, never imply guilt, and say that this is based on headlines.",
      user: `SUBJECT: ${primary} (${input.kind === "person" ? "public figure" : "organisation"}${input.country ? `, ${input.country}` : ""})\nARTICLES FOUND: ${items.length}\n\nHEADLINES (newest first, numbered from 0):\n${items.slice(0, 40).map((i, n) => `[${n}] ${i.published ?? "undated"} ${i.domain}: ${i.title}`).join("\n")}`,
      schema: COVERAGE_SCHEMA,
      toolName: "summarise_coverage",
      toolDescription: "Summarise the news coverage.",
      maxTokens: 500,
    }).catch(() => null);
    if (ai?.data?.overview) {
      themes = (ai.data.themes ?? []).slice(0, 5);
      tone = ai.data.tone ?? "unclear";
      overview = ai.data.overview;
      aiWritten = true;
      for (const h of ai.data.headlines ?? []) if (items[h.index]) items[h.index].sentiment = h.sentiment;
    }
    return { id, label, state: "ok", hits: [{ total: items.length, byMonth, topOutlets, recent: items.slice(0, 10), themes, tone, overview, aiWritten }] };
  } catch (err) {
    return { id, label, state: "unavailable", note: err instanceof Error ? err.message : String(err), hits: [] };
  }
}

// ── Social media presence ────────────────────────────────────────────────

export interface OfficialAccount {
  platform: string;
  url: string;
  handle: string;
}
export interface SocialPost {
  network: "Mastodon" | "Bluesky";
  author: string;
  text: string;
  url: string;
  published: string | null;
}
export interface SocialResult {
  /** Accounts the subject's Wikidata entry lists, with the entry they came from. */
  accounts: OfficialAccount[];
  accountsFrom: string | null;
  posts: SocialPost[];
  networksSearched: string[];
  networksFailed: string[];
  searchLinks: { label: string; url: string }[];
  overview: string;
}

const ACCOUNT_PROPS: Record<string, { platform: string; url: (v: string) => string }> = {
  P856: { platform: "Website", url: (v) => v },
  P2002: { platform: "X (Twitter)", url: (v) => `https://x.com/${v}` },
  P2013: { platform: "Facebook", url: (v) => `https://www.facebook.com/${v}` },
  P2003: { platform: "Instagram", url: (v) => `https://www.instagram.com/${v}/` },
  P2397: { platform: "YouTube", url: (v) => `https://www.youtube.com/channel/${v}` },
  P4264: { platform: "LinkedIn", url: (v) => `https://www.linkedin.com/company/${v}` },
  P7085: { platform: "TikTok", url: (v) => `https://www.tiktok.com/@${v}` },
};

async function wd<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": UA, Accept: "application/json" } });
  return res.ok ? ((await res.json().catch(() => null)) as T | null) : null;
}

async function officialAccounts(name: string, kind: Kind): Promise<{ accounts: OfficialAccount[]; from: string | null }> {
  const s = await wd<{ search?: { id: string }[] }>(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&uselang=en&type=item&limit=6&format=json&origin=*`);
  const ids = (s?.search ?? []).map((x) => x.id);
  if (!ids.length) return { accounts: [], from: null };
  type Ent = { id: string; labels?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]>; claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> };
  const got = await wd<{ entities?: Record<string, Ent> }>(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=labels|aliases|claims&languages=en&format=json&origin=*`);
  for (const e of Object.values(got?.entities ?? {})) {
    const names = [...Object.values(e.labels ?? {}).map((l) => l.value), ...Object.values(e.aliases ?? {}).flat().map((a) => a.value)];
    const score = Math.max(0, ...names.map((n) => nameSimilarity(name, n, kind)));
    const human = (e.claims?.P31 ?? []).some((c) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id === "Q5");
    if (score < STRONG || (kind === "person") !== human) continue;
    const accounts: OfficialAccount[] = [];
    for (const [prop, meta] of Object.entries(ACCOUNT_PROPS)) {
      const v = e.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
      if (typeof v === "string" && v && (prop !== "P856" || /^https?:\/\//i.test(v))) accounts.push({ platform: meta.platform, url: meta.url(v), handle: v });
    }
    if (accounts.length) return { accounts, from: `https://www.wikidata.org/wiki/${e.id}` };
  }
  return { accounts: [], from: null };
}

const strip = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

async function mastodonPosts(name: string, token: string): Promise<SocialPost[]> {
  const res = await fetch(`https://mastodon.social/api/v2/search?q=${encodeURIComponent(`"${name}"`)}&type=statuses&limit=20`, { signal: AbortSignal.timeout(12_000), headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } });
  if (!res.ok) throw new Error(`Mastodon answered ${res.status}`);
  const body = (await res.json()) as { statuses?: { url: string; created_at: string; content: string; account: { acct: string } }[] };
  return (body.statuses ?? []).map((s) => ({ network: "Mastodon" as const, author: `@${s.account.acct}`, text: strip(s.content).slice(0, 280), url: s.url, published: s.created_at?.slice(0, 10) ?? null }));
}

async function blueskyPosts(name: string): Promise<SocialPost[]> {
  const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(`"${name}"`)}&limit=20&sort=latest`, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Bluesky answered ${res.status}`);
  const body = (await res.json()) as { posts?: { uri: string; author: { handle: string }; record?: { text?: string; createdAt?: string } }[] };
  return (body.posts ?? []).map((p) => ({ network: "Bluesky" as const, author: `@${p.author.handle}`, text: (p.record?.text ?? "").replace(/\s+/g, " ").slice(0, 280), url: `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`, published: p.record?.createdAt?.slice(0, 10) ?? null }));
}

export function socialSearchLinks(name: string): { label: string; url: string }[] {
  const q = encodeURIComponent(name);
  const qq = encodeURIComponent(`"${name}"`);
  return [
    { label: "X (Twitter): search", url: `https://x.com/search?q=${qq}&f=user` },
    { label: "Facebook: search pages", url: `https://www.facebook.com/search/pages/?q=${q}` },
    { label: "LinkedIn: search companies and people", url: `https://www.linkedin.com/search/results/all/?keywords=${q}` },
    { label: "YouTube: search", url: `https://www.youtube.com/results?search_query=${q}` },
    { label: "Instagram: search (via Google)", url: `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com ${name}`)}` },
    { label: "TikTok: search", url: `https://www.tiktok.com/search?q=${q}` },
  ];
}

export async function checkSocial(env: Env, input: { names: string[]; kind: Kind }): Promise<Check<SocialResult>> {
  const id = "social";
  const label = "Social media presence (Wikidata accounts, Mastodon, Bluesky)";
  const name = input.names[0];
  try {
    const [acc, masto, bsky] = await Promise.allSettled([officialAccounts(name, input.kind), env.MASTODON_ACCESS_TOKEN ? mastodonPosts(name, env.MASTODON_ACCESS_TOKEN) : Promise.resolve(null), blueskyPosts(name)]);
    const searched: string[] = [];
    const failed: string[] = [];
    const posts: SocialPost[] = [];
    if (masto.status === "fulfilled" && masto.value) (searched.push("Mastodon"), posts.push(...masto.value));
    else if (masto.status === "rejected") failed.push("Mastodon");
    if (bsky.status === "fulfilled") (searched.push("Bluesky"), posts.push(...bsky.value));
    else failed.push("Bluesky");
    posts.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));
    const accounts = acc.status === "fulfilled" ? acc.value.accounts : [];
    const accountsFrom = acc.status === "fulfilled" ? acc.value.from : null;
    const social = accounts.filter((a) => a.platform !== "Website");
    const parts: string[] = [];
    parts.push(social.length ? `Official accounts on record: ${social.map((a) => a.platform).join(", ")}.` : accounts.length ? "Only an official website is on record; no social accounts are listed in Wikidata." : "No official social accounts are listed in Wikidata (absence there does not mean none exist).");
    parts.push(searched.length ? `${posts.length} recent public post${posts.length === 1 ? "" : "s"} naming the subject on ${searched.join(" and ")}.` : "No open social network could be searched.");
    parts.push("Activity on X, Facebook, Instagram, LinkedIn and TikTok is not measured; use the search links.");
    const state = searched.length || accounts.length ? "ok" : "unavailable";
    return {
      id,
      label,
      state,
      note: state === "unavailable" ? "Neither Wikidata nor any open social network could be reached." : failed.length ? `Not reachable: ${failed.join(", ")}` : undefined,
      hits: [{ accounts, accountsFrom, posts: posts.slice(0, 10), networksSearched: searched, networksFailed: failed, searchLinks: socialSearchLinks(name), overview: parts.join(" ") }],
    };
  } catch (err) {
    return { id, label, state: "unavailable", note: err instanceof Error ? err.message : String(err), hits: [] };
  }
}
