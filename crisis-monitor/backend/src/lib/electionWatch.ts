import type { Env } from "../bindings";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { parseBooleanQuery } from "../booleanQuery";
import { searchFeeds } from "./feedSearch";
import { fetchGdeltArticles, GdeltRateLimitError, parseGdeltDate } from "../connectors/gdelt";
import { buildSearchPlan, toGdeltQueries } from "./querySearchPlan";

/**
 * Kenya Election Watch: the live half.
 *
 * Every fifteen minutes the platform's own news feeds (the Africa Wire crawl
 * and the wire feeds) are read for Kenyan political reporting. Each item is
 * coded from its headline and feed summary by written rules into one of the
 * categories below, placed in a county where the text names one, and grouped
 * with other reports of the same event. What is stored is the headline, a
 * short feed summary and the link: never the content of a hateful message.
 *
 * These are reports of events, coded by rules, and they say so: every item
 * starts "auto" (unverified) and an analyst can verify or reject it. The
 * dashboard counts events (clusters of reports), not articles.
 *
 * Reports that bear on the election product itself (a new poll, a
 * declaration, an IEBC notice, a court ruling on the date) become "leads" in
 * a queue for an analyst. They are never written into the polls or the
 * candidate list automatically: a wrong number there is worse than a late one.
 */

export const CATEGORIES = ["political_violence", "protest_policing", "abduction", "election_admin", "intimidation", "hate_speech", "disinformation", "coverage"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  political_violence: "Political violence",
  protest_policing: "Protest violence and policing",
  abduction: "Abductions and disappearances",
  election_admin: "Attacks on election administration",
  intimidation: "Threats and intimidation",
  hate_speech: "Hate speech and incitement",
  disinformation: "Election disinformation",
  coverage: "Election coverage",
};

/* ── counties ─────────────────────────────────────────────── */

export const COUNTY_LIST: [string, string][] = [
  ["001", "Mombasa"], ["002", "Kwale"], ["003", "Kilifi"], ["004", "Tana River"], ["005", "Lamu"], ["006", "Taita Taveta"], ["007", "Garissa"], ["008", "Wajir"], ["009", "Mandera"], ["010", "Marsabit"],
  ["011", "Isiolo"], ["012", "Meru"], ["013", "Tharaka-Nithi"], ["014", "Embu"], ["015", "Kitui"], ["016", "Machakos"], ["017", "Makueni"], ["018", "Nyandarua"], ["019", "Nyeri"], ["020", "Kirinyaga"],
  ["021", "Murang'a"], ["022", "Kiambu"], ["023", "Turkana"], ["024", "West Pokot"], ["025", "Samburu"], ["026", "Trans Nzoia"], ["027", "Uasin Gishu"], ["028", "Elgeyo-Marakwet"], ["029", "Nandi"], ["030", "Baringo"],
  ["031", "Laikipia"], ["032", "Nakuru"], ["033", "Narok"], ["034", "Kajiado"], ["035", "Kericho"], ["036", "Bomet"], ["037", "Kakamega"], ["038", "Vihiga"], ["039", "Bungoma"], ["040", "Busia"],
  ["041", "Siaya"], ["042", "Kisumu"], ["043", "Homa Bay"], ["044", "Migori"], ["045", "Kisii"], ["046", "Nyamira"], ["047", "Nairobi"],
];
const COUNTY_BY_CODE = new Map(COUNTY_LIST);
export const countyName = (code: string | null | undefined) => (code ? COUNTY_BY_CODE.get(code) ?? null : null);

/** Spellings and towns that name a county, longest first so "tharaka nithi" beats "meru". */
const PLACE_TO_COUNTY: [string, string][] = (() => {
  const m: [string, string][] = [];
  for (const [code, name] of COUNTY_LIST) {
    m.push([name.toLowerCase().replace(/['’]/g, "").replace(/-/g, " "), code]);
  }
  const towns: Record<string, string[]> = {
    "047": ["kibera", "githurai", "kasarani", "embakasi", "eastleigh", "kamukunji", "dagoretti", "westlands", "kawangware", "mathare", "korogocho", "kangemi", "ruaraka", "langata", "roysambu", "nairobi city", "cbd"],
    "022": ["thika", "ruiru", "juja", "limuru", "kikuyu", "githunguri", "kabete"],
    "032": ["naivasha", "gilgil", "molo", "njoro", "subukia"],
    "027": ["eldoret", "turbo", "burnt forest", "moiben"],
    "034": ["kitengela", "rongai", "ngong", "kiserian", "isinya", "loitokitok"],
    "003": ["mtwapa", "malindi", "watamu", "mariakani"],
    "001": ["likoni", "nyali", "changamwe", "kisauni"],
    "026": ["kitale", "kiminini"],
    "019": ["karatina", "mukurweini"],
    "031": ["nanyuki", "nyahururu", "rumuruti"],
    "016": ["athi river", "mavoko", "kangundo"],
    "017": ["wote", "makindu"],
    "044": ["awendo", "rongo", "isebania", "kehancha"],
    "042": ["ahero", "maseno", "muhoroni"],
    "041": ["bondo", "ugunja", "ukwala"],
    "039": ["webuye", "kimilili", "malakisi"],
    "037": ["mumias", "butere", "malava", "lurambi"],
    "010": ["moyale", "marsabit town"],
    "023": ["lodwar", "kakuma"],
    "025": ["maralal"],
    "013": ["chuka", "marimanti"],
    "020": ["kerugoya", "kutus", "wanguru"],
    "024": ["kapenguria", "sigor"],
    "028": ["iten", "kapsowar"],
    "030": ["kabarnet", "marigat"],
    "006": ["voi", "wundanyi", "taveta"],
    "004": ["hola", "garsen"],
    "002": ["ukunda", "diani", "kinango"],
    "005": ["mpeketoni", "witu"],
    "045": ["ogembo", "suneka"],
    "035": ["litein", "kipkelion"],
    "036": ["sotik", "mulot"],
    "021": ["kenol", "maragua"],
    "014": ["runyenjes", "siakago"],
    "012": ["maua", "nkubu", "timau"],
    "007": ["dadaab", "balambala"],
    "038": ["mbale", "luanda", "hamisi"],
    "046": ["keroka"],
    "018": ["ol kalou", "engineer"],
  };
  for (const [code, list] of Object.entries(towns)) for (const t of list) m.push([t, code]);
  return m.sort((a, b) => b[0].length - a[0].length);
})();

/** The county a text names, preferring one in the headline. */
export function findCounty(title: string, text: string): string | null {
  const find = (s: string) => {
    const hay = ` ${s.toLowerCase().replace(/['’]/g, "").replace(/-/g, " ").replace(/[^a-z0-9 ]+/g, " ")} `;
    let best: { at: number; code: string } | null = null;
    for (const [name, code] of PLACE_TO_COUNTY) {
      const at = hay.indexOf(` ${name} `);
      if (at >= 0 && (!best || at < best.at)) best = { at, code };
    }
    return best?.code ?? null;
  };
  return find(title) ?? find(text);
}

/* ── coding ───────────────────────────────────────────────── */

export interface Coding {
  category: string;
  severity: 1 | 2 | 3;
  fatalities: number | null;
  countyCode: string | null;
}

const POLITICAL =
  /\b(election|elections|electoral|iebc|ncic|campaign|campaigns|rally|rallies|aspirant|aspirants|politician|politicians|political|politics|mp|mps|mca|mcas|senator|governor|presidential|opposition|uda|odm|dcp|jubilee|wiper|azimio|kenya kwanza|united opposition|primaries|manifesto|ballot|voters?|nominations?|running mate|flagbearer|gachagua|ruto|kalonzo|matiangi|sifuna|raila|oburu|karua|maraga|wamalwa|muturi|protests?|protesters?|demonstrations?|demonstrators|gen z|saba saba)\b/i;
const ELECTION_TERMS = /\b(iebc|election|elections|electoral|aspirants?|opinion polls?|campaign|campaigns|candidates?|voter registration|primaries|nominations?|running mate|flagbearer|presidential bid|declares? (?:interest|bid)|2027)\b/i;
const VIOLENCE =
  /\b(attack(?:ed|s)?|violence|violent|clash(?:es|ed)?|goons|thugs|hired youths|tear ?gas(?:ed)?|abduct(?:ed|ion|ions)?|kidnap(?:ped|ping)?|torched|arson|set ablaze|petrol bomb|shot|shooting|gunshots?|killed|murder(?:ed)?|stabbed|lynch(?:ed)?|mob|chaos|assaulted|roughed up|stoned|vandali[sz]ed|beaten|machete)\b/i;
const HATE = /\b(hate speech|incitement|inciting|incite[sd]?|ncic|ethnic (?:hatred|contempt|incitement|profiling|tension|slur)|tribal (?:remarks|slurs?|rhetoric|incitement|hatred)|tribalism|dehumani[sz]\w*|inflammatory|derogatory)\b/i;
const DISINFO = /\b(disinformation|misinformation|fake news|deepfakes?|fake (?:video|audio|account|accounts|poll|results)|propaganda|doctored)\b/i;
const THREAT = /\b(threat(?:s|ened|ening)?|threaten\w*|intimidat\w+|harass\w*|death threats?)\b/i;
const ABDUCT = /\b(abduct\w*|kidnap\w*|disappear\w*|forced disappearance)\b/i;
const POLICING = /\b(teargas|tear gas|live bullets?|brutality|protests?|protesters?|demonstrat\w+)\b/i;
const IEBC_TARGET = /\biebc\b.*\b(offices?|registration cent(?:re|er)s?|clerks?|staff|officials?|vandali[sz]\w*|torch\w*)\b|\b(offices?|registration cent(?:re|er)s?|clerks?|staff|officials?)\b.*\biebc\b/i;
const EXPLAINER = /^(?:how|why|what|opinion|analysis|editorial|explainer|explained|comment|letters?)\b|\b(?:opinion|analysis|editorial|explainer):/i;
const NOT_POLITICS = /\b(football|league|premier league|match report|goalkeeper|transfer window|rugby|athletics|marathon|bank robbery|road accident|traffic accident)\b/i;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, dozens: 24 };
const DEATH = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?)\s+(?:\w+\s+){0,2}?(?:were\s+)?(?:killed|dead|died|shot dead|murdered|lynched)\b|\b(?:killed|dead|died)\s+(\d{1,3})\b/i;

/** How many deaths a text states, or 1 for a bare "shot dead" / "killed", or null. */
export function deathsStated(text: string): number | null {
  const m = DEATH.exec(text);
  if (m) {
    const raw = (m[1] ?? m[2] ?? "").toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw] ?? null;
    if (n !== null && n > 0 && n < 500) return n;
  }
  return /\b(shot dead|killed|murdered|lynched|stabbed to death|died)\b/i.test(text) ? 1 : null;
}

export function codeReport(title: string, summary: string, domain: string): Coding | null {
  const text = `${title}. ${summary}`.replace(/\s+/g, " ");
  const kenyan = /\b(kenya|kenyan|kenyans)\b/i.test(text) || /\.ke$/.test(domain) || findCounty(title, summary) !== null || /\b(iebc|ncic|ruto|gachagua|kalonzo|sifuna|raila|azimio|kenya kwanza)\b/i.test(text);
  if (!kenyan || !POLITICAL.test(text) || NOT_POLITICS.test(title)) return null;
  const countyCode = findCounty(title, summary);
  const explainer = EXPLAINER.test(title.trim());

  let category: Category | null = null;
  if (!explainer) {
    if (HATE.test(text)) category = "hate_speech";
    else if (DISINFO.test(text)) category = "disinformation";
    else if (VIOLENCE.test(text)) {
      if (IEBC_TARGET.test(text)) category = "election_admin";
      else if (ABDUCT.test(text)) category = "abduction";
      else if (POLICING.test(text)) category = "protest_policing";
      else category = "political_violence";
    } else if (THREAT.test(text)) category = "intimidation";
  }
  if (!category) {
    if (!ELECTION_TERMS.test(text)) return null;
    return { category: "coverage", severity: 1, fatalities: null, countyCode };
  }
  const deaths = ["political_violence", "protest_policing", "abduction", "election_admin"].includes(category) ? deathsStated(text) : null;
  let severity: 1 | 2 | 3 = 1;
  if (deaths) severity = 3;
  else if (/\b(injur\w+|wounded|shot|arson|torched|ablaze|abduct\w*|kidnap\w*|tear ?gas\w*|machete|arrest\w*|charged|summoned)\b/i.test(text)) severity = 2;
  return { category, severity, fatalities: deaths, countyCode };
}

/** What kind of lead, if any, a coverage item is for the election product. */
export function leadKind(title: string, summary: string): "poll" | "declaration" | "iebc" | "court" | null {
  const t = `${title}. ${summary}`;
  if (/\b(opinion poll|poll (?:shows|finds|puts|reveals|says)|new survey|survey (?:shows|finds)|infotrak|tifa|politrack|mizani|ipsos|radio africa)\b/i.test(t) && /\b(presiden\w*|ruto|2027|gachagua|kalonzo|sifuna|matiangi)\b/i.test(t)) return "poll";
  if (/\b(declares?|declared|declaration|launch(?:es|ed)? (?:his |her )?(?:presidential )?(?:bid|campaign)|will (?:vie|run) for (?:the )?president|flagbearer|running mate|presidential bid)\b/i.test(t) && /\b(presiden\w*|2027)\b/i.test(t)) return "declaration";
  if (/\biebc\b/i.test(t) && /\b(gazette|notice|timetable|deadline|register|registration|boundar\w+|commissioners?|chairperson|date)\b/i.test(t)) return "iebc";
  if (/\b(high court|supreme court|court of appeal)\b/i.test(t) && /\b(election date|impeach\w*|gachagua|iebc|2027)\b/i.test(t)) return "court";
  return null;
}

/* ── configuration per country ────────────────────────────── */

export interface WatchTables {
  items: string;
  leads: string;
  content: string;
  state: string;
  /** Changes the collector proposes from news, waiting for an approver. */
  proposals: string;
}

/**
 * One watch per country. The engine is the same for each; what differs is
 * the feed query, the coding rules, the categories, the place list and the
 * kinds of lead and content. Tables are named from the key so the two
 * countries never share rows.
 */
export interface Watch {
  key: string;
  csvName: string;
  t: WatchTables;
  categories: readonly string[];
  labels: Record<string, string>;
  /** What a stored place code looks like (validated on write). */
  placeRe: RegExp;
  query: string;
  code: (title: string, summary: string, domain: string) => Coding | null;
  leadKind: (title: string, summary: string) => string | null;
  leadKinds: readonly string[];
  contentKinds: readonly string[];
  /** Categories that carry a death toll. */
  deathCategories: readonly string[];
  /** Display names for place codes. */
  places?: Map<string, string>;
}

const tablesFor = (prefix: string): WatchTables => ({ items: `${prefix}_items`, leads: `${prefix}_leads`, content: `${prefix}_content`, state: `${prefix}_state`, proposals: `${prefix}_proposals` });

/* ── storage ──────────────────────────────────────────────── */

const ready = new Map<string, Promise<unknown>>();
export function resetElectionWatchCheck() {
  ready.clear();
}

export async function ensureElectionWatchTables(env: Env, W: Watch = KE_WATCH): Promise<void> {
  let p = ready.get(W.key);
  if (!p) {
    const t = W.t;
    p = (async () => {
      await run(env.DB, `CREATE TABLE IF NOT EXISTS ${t.items} (
        id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT, domain TEXT, published_at TEXT NOT NULL,
        category TEXT NOT NULL, severity INTEGER NOT NULL DEFAULT 1, county_code TEXT, fatalities INTEGER,
        cluster_id TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'rules', status TEXT NOT NULL DEFAULT 'auto', note TEXT,
        created_at TEXT NOT NULL, reviewed_at TEXT)`);
      await run(env.DB, `CREATE INDEX IF NOT EXISTS idx_${t.items}_pub ON ${t.items} (published_at)`);
      await run(env.DB, `CREATE INDEX IF NOT EXISTS idx_${t.items}_cluster ON ${t.items} (cluster_id)`);
      await run(env.DB, `CREATE TABLE IF NOT EXISTS ${t.leads} (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE, domain TEXT, published_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)`);
      await run(env.DB, `CREATE TABLE IF NOT EXISTS ${t.content} (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (kind, id))`);
      await run(env.DB, `CREATE TABLE IF NOT EXISTS ${t.state} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      await run(env.DB, `CREATE TABLE IF NOT EXISTS ${t.proposals} (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, lead_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
        data TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT)`);
    })().catch((err) => {
      ready.delete(W.key);
      throw err;
    });
    ready.set(W.key, p);
  }
  await p;
}

const STOP = new Set(["with", "from", "that", "this", "after", "over", "says", "kenya", "kenyan", "south", "sudan", "sudanese"]);
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
}

/** The cluster an item joins: a recent item of the same category (and place) with a similar headline, else its own. */
export async function clusterFor(env: Env, category: string, placeCode: string | null, title: string, publishedAt: string, W: Watch = KE_WATCH): Promise<string | null> {
  if (category === "coverage") return null;
  const t = Date.parse(publishedAt);
  const lo = new Date(t - 2 * 86_400_000).toISOString();
  const hi = new Date(t + 2 * 86_400_000).toISOString();
  const rows = await all<{ cluster_id: string; title: string; county_code: string | null }>(env.DB, `SELECT cluster_id, title, county_code FROM ${W.t.items} WHERE category = ? AND published_at BETWEEN ? AND ? ORDER BY published_at DESC LIMIT 80`, [category, lo, hi]);
  const mine = tokens(title);
  for (const r of rows) {
    const samePlace = placeCode && r.county_code === placeCode;
    if (jaccard(mine, tokens(r.title)) >= (samePlace ? 0.34 : 0.55)) return r.cluster_id;
  }
  return null;
}

/* ── collection ───────────────────────────────────────────── */

export interface CollectResult {
  scanned: number;
  inserted: number;
  leads: number;
}

/** A story as the collectors hand it over: the feeds, or GDELT's archive. */
export interface ElectionHit {
  title?: string | null;
  link?: string | null;
  domain: string | null;
  published: string;
  text?: string | null;
}

/** Codes each story by its headline and summary and stores what this country's watch keeps. Idempotent: a link is stored once. */
async function storeElectionHits(env: Env, hits: ElectionHit[], W: Watch): Promise<{ inserted: number; leads: number }> {
  let inserted = 0;
  let leads = 0;
  const now = nowIso();
  for (const h of hits) {
    const title = (h.title ?? "").replace(/\s+/g, " ").trim();
    if (!title || !h.link) continue;
    const summary = (h.text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 420);
    const code = W.code(title, summary, h.domain ?? "");
    if (!code) continue;
    const existing = await first<{ id: string }>(env.DB, `SELECT id FROM ${W.t.items} WHERE url = ?`, [h.link]);
    if (existing) continue;
    const id = newId();
    const cluster = (await clusterFor(env, code.category, code.countyCode, title, h.published, W)) ?? id;
    await run(env.DB, `INSERT OR IGNORE INTO ${W.t.items} (id, url, title, summary, domain, published_at, category, severity, county_code, fatalities, cluster_id, method, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'rules','auto',?)`, [
      id, h.link, title, summary, h.domain, h.published, code.category, code.severity, code.countyCode, code.fatalities, cluster, now,
    ]);
    inserted++;
    if (code.category === "coverage") {
      const kind = W.leadKind(title, summary);
      if (kind) {
        await run(env.DB, `INSERT OR IGNORE INTO ${W.t.leads} (id, kind, title, url, domain, published_at, status, created_at) VALUES (?,?,?,?,?,?, 'pending', ?)`, [newId(), kind, title, h.link, h.domain, h.published, now]);
        leads++;
      }
    }
  }
  return { inserted, leads };
}

/** Reads the platform's own feeds once and stores what this country's watch codes. Idempotent: an article is stored once. */
export async function collectElectionItems(env: Env, maxAgeHours = 30, W: Watch = KE_WATCH): Promise<CollectResult> {
  await ensureElectionWatchTables(env, W);
  const parsed = parseBooleanQuery(W.query);
  const hits = (await searchFeeds(env, [{ id: "ew", text: W.query, parsed }], maxAgeHours, 700)).get("ew") ?? [];
  const { inserted, leads } = await storeElectionHits(env, hits, W);
  const now = nowIso();
  await run(env.DB, `INSERT INTO ${W.t.state} (key, value) VALUES ('last_collect', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [now]);
  await run(env.DB, `INSERT INTO ${W.t.state} (key, value) VALUES ('last_scanned', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(hits.length)]);
  return { scanned: hits.length, inserted, leads };
}

export interface BackfillResult {
  status: "done" | "rate_limited" | "failed";
  timespan: string | null;
  /** Archive searches made. */
  searches: number;
  /** Searches that GDELT answered as full: it returns at most 250 stories each, so more may exist. */
  capped: number;
  scanned: number;
  inserted: number;
  leads: number;
}

/** How far back the archive search reaches. GDELT documents three months; its newer notes say a full search reaches
 *  back to January 2017, so "full" is tried first and "3months" used if GDELT refuses it. */
const BACKFILL_SPANS = ["full", "3months"] as const;

/** Stores what the archive returned for one search. */
async function storeArchive(env: Env, articles: Awaited<ReturnType<typeof fetchGdeltArticles>>, W: Watch) {
  const hits: ElectionHit[] = articles.map((a) => ({
    title: a.title,
    link: a.url,
    domain: a.domain,
    published: parseGdeltDate(a.seendate).toISOString(),
    text: "",
  }));
  return { scanned: hits.length, ...(await storeElectionHits(env, hits, W)) };
}

/**
 * Reads GDELT's news archive for this watch's query, as far back as GDELT allows, in one search per query.
 * Repeat runs skip stories already stored.
 */
export async function backfillElectionFromGdelt(env: Env, W: Watch = KE_WATCH): Promise<BackfillResult> {
  await ensureElectionWatchTables(env, W);
  const queries = toGdeltQueries(buildSearchPlan(parseBooleanQuery(W.query).ast));
  const result: BackfillResult = { status: "done", timespan: null, searches: 0, capped: 0, scanned: 0, inserted: 0, leads: 0 };
  for (const q of queries) {
    let articles: Awaited<ReturnType<typeof fetchGdeltArticles>> | null = null;
    for (const span of BACKFILL_SPANS) {
      try {
        articles = await fetchGdeltArticles(q, 250, span);
        result.timespan = span;
        break;
      } catch (err) {
        if (err instanceof GdeltRateLimitError) {
          result.status = "rate_limited";
          return result;
        }
        console.error(`[election-backfill:${W.key}] archive search over "${span}" failed`, err);
      }
    }
    if (!articles) {
      result.status = "failed";
      continue;
    }
    result.searches++;
    if (articles.length >= 250) result.capped++;
    const stored = await storeArchive(env, articles, W);
    result.scanned += stored.scanned;
    result.inserted += stored.inserted;
    result.leads += stored.leads;
  }
  if (result.status === "done" && result.searches > 0) {
    await run(env.DB, `INSERT INTO ${W.t.state} (key, value) VALUES ('gdelt_backfill', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [`${nowIso()} ${result.timespan}`]);
  }
  return result;
}

/* ── a period read in slices, resumable ───────────────────── */

/** A period is read in slices this long, so each one fits in GDELT's 250-story answer. */
const SLICE_MS = 14 * 86_400_000;
/** Pause between GDELT searches: GDELT refuses a quick burst of requests from one source. */
const PACE_MS = 1500;

export interface ArchiveJob {
  months: number;
  /** Reading goes back from here; a slice ends at `cursor`. Epoch milliseconds. */
  cursor: number;
  /** The earliest moment the period reaches. Epoch milliseconds. */
  from: number;
  status: "running" | "rate_limited" | "done";
  slicesDone: number;
  slicesTotal: number;
  scanned: number;
  inserted: number;
  capped: number;
  updatedAt: string;
  /** Set when GDELT refused a search: no further searches until this moment (epoch milliseconds). */
  retryAt?: number;
}

const JOB_KEY = "archive_job";
/** Where GDELT's "try again" moment is kept. It belongs to the source, not to one period, so every read respects it. */
const RETRY_KEY = "archive_retry_at";
/** Even when GDELT asks for less, wait at least this long after a refusal: a quick retry only extends the refusal. */
const MIN_COOLDOWN_MS = 5 * 60_000;

async function retryAt(env: Env, W: Watch): Promise<number | null> {
  const row = await first<{ value: string }>(env.DB, `SELECT value FROM ${W.t.state} WHERE key = ?`, [RETRY_KEY]);
  const at = row ? Number(row.value) : NaN;
  return Number.isFinite(at) ? at : null;
}

async function setRetryAt(env: Env, W: Watch, at: number | null) {
  if (at === null) {
    await run(env.DB, `DELETE FROM ${W.t.state} WHERE key = ?`, [RETRY_KEY]);
    return;
  }
  await run(env.DB, `INSERT INTO ${W.t.state} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [RETRY_KEY, String(at)]);
}

export async function archiveJob(env: Env, W: Watch = KE_WATCH): Promise<ArchiveJob | null> {
  await ensureElectionWatchTables(env, W);
  const row = await first<{ value: string }>(env.DB, `SELECT value FROM ${W.t.state} WHERE key = ?`, [JOB_KEY]);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as ArchiveJob;
  } catch {
    return null;
  }
}

async function saveJob(env: Env, W: Watch, job: ArchiveJob) {
  job.updatedAt = nowIso();
  await run(env.DB, `INSERT INTO ${W.t.state} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JOB_KEY, JSON.stringify(job)]);
}

/**
 * Starts a read of `months` months back (or continues the one running), working through it in two-week slices.
 * Each slice is saved as it finishes, so a rate-limited run resumes where it stopped. Call it again to carry on.
 * `maxSlices` bounds one call; the scheduled collection carries a running read forward between calls.
 */
export async function runArchiveJob(env: Env, W: Watch = KE_WATCH, opts: { months?: number; maxSlices?: number; paceMs?: number } = {}): Promise<ArchiveJob | null> {
  await ensureElectionWatchTables(env, W);
  const current = await archiveJob(env, W);
  let job: ArchiveJob | null = current;
  if (opts.months && (!current || current.months !== opts.months || current.status === "done")) {
    const now = Date.now();
    const from = now - opts.months * 30 * 86_400_000;
    job = { months: opts.months, cursor: now, from, status: "running", slicesDone: 0, slicesTotal: Math.ceil((now - from) / SLICE_MS), scanned: 0, inserted: 0, capped: 0, updatedAt: nowIso() };
    await saveJob(env, W, job);
  }
  if (!job || job.status === "done") return job;

  // GDELT refused us recently: wait for its moment instead of asking again on every tick and click.
  const wait = await retryAt(env, W);
  if (wait && Date.now() < wait) {
    job.status = "rate_limited";
    job.retryAt = wait;
    await saveJob(env, W, job);
    return job;
  }
  job.retryAt = undefined;

  const queries = toGdeltQueries(buildSearchPlan(parseBooleanQuery(W.query).ast));
  const maxSlices = opts.maxSlices ?? 2;
  const pace = opts.paceMs ?? PACE_MS;
  let ran = 0;
  while (job.cursor > job.from && ran < maxSlices) {
    const end = job.cursor;
    const start = Math.max(job.from, end - SLICE_MS);
    let rateLimited = false;
    for (const q of queries) {
      if (pace > 0) await new Promise((r) => setTimeout(r, pace));
      try {
        const articles = await fetchGdeltArticles(q, 250, "full", { start: new Date(start), end: new Date(end) });
        if (articles.length >= 250) job.capped++;
        const stored = await storeArchive(env, articles, W);
        job.scanned += stored.scanned;
        job.inserted += stored.inserted;
      } catch (err) {
        if (err instanceof GdeltRateLimitError) {
          rateLimited = true;
          const at = Date.now() + Math.max(err.retryAfterMs, MIN_COOLDOWN_MS);
          await setRetryAt(env, W, at);
          job.retryAt = at;
          break;
        }
        console.error(`[election-archive:${W.key}] slice search failed`, err);
      }
    }
    if (rateLimited) {
      // Keep this slice for the next call, and stop now.
      job.status = "rate_limited";
      await saveJob(env, W, job);
      return job;
    }
    job.cursor = start;
    job.slicesDone++;
    job.retryAt = undefined;
    await setRetryAt(env, W, null);
    ran++;
    job.status = job.cursor > job.from ? "running" : "done";
    await saveJob(env, W, job);
  }
  if (job.cursor <= job.from) job.status = "done";
  await saveJob(env, W, job);
  return job;
}

/** Runs the archive backfill once per watch, until it has completed. */
export async function backfillElectionIfNeeded(env: Env, W: Watch = KE_WATCH): Promise<BackfillResult | null> {
  await ensureElectionWatchTables(env, W);
  const done = await first<{ value: string }>(env.DB, `SELECT value FROM ${W.t.state} WHERE key = 'gdelt_backfill'`);
  if (done) return null;
  return backfillElectionFromGdelt(env, W);
}

/* ── dashboard ────────────────────────────────────────────── */

export interface ItemRow {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  domain: string | null;
  published_at: string;
  category: string;
  severity: number;
  county_code: string | null;
  fatalities: number | null;
  cluster_id: string;
  method: string;
  status: "auto" | "verified" | "rejected";
  note: string | null;
}

const weekStart = (iso: string) => {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
};

export async function buildDashboard(env: Env, days = 90, W: Watch = KE_WATCH) {
  await ensureElectionWatchTables(env, W);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await all<ItemRow>(env.DB, `SELECT * FROM ${W.t.items} WHERE published_at >= ? AND category != 'coverage' AND status != 'rejected' ORDER BY published_at DESC LIMIT 6000`, [since]);

  // One event per cluster: the earliest report, with the highest severity and toll and the number of reports behind it.
  const clusters = new Map<string, { first: ItemRow; reports: number; severity: number; fatalities: number; verified: boolean; counties: Set<string> }>();
  for (const r of rows) {
    const c = clusters.get(r.cluster_id);
    if (!c) clusters.set(r.cluster_id, { first: r, reports: 1, severity: r.severity, fatalities: r.fatalities ?? 0, verified: r.status === "verified", counties: new Set(r.county_code ? [r.county_code] : []) });
    else {
      c.reports++;
      c.severity = Math.max(c.severity, r.severity);
      c.fatalities = Math.max(c.fatalities, r.fatalities ?? 0);
      c.verified ||= r.status === "verified";
      if (r.county_code) c.counties.add(r.county_code);
      if (r.published_at < c.first.published_at) c.first = r;
    }
  }
  const events = [...clusters.values()];
  const byCategory: Record<string, number> = {};
  const byCounty: Record<string, { events: number; deaths: number }> = {};
  const weekly = new Map<string, Record<string, number>>();
  let deaths = 0;
  let verified = 0;
  const now = Date.now();
  let last7 = 0;
  let prev7 = 0;
  for (const e of events) {
    byCategory[e.first.category] = (byCategory[e.first.category] ?? 0) + 1;
    deaths += e.fatalities;
    if (e.verified) verified++;
    const county = [...e.counties][0] ?? e.first.county_code;
    if (county) {
      const c = (byCounty[county] ??= { events: 0, deaths: 0 });
      c.events++;
      c.deaths += e.fatalities;
    }
    const w = weekStart(e.first.published_at);
    const wk = weekly.get(w) ?? {};
    wk[e.first.category] = (wk[e.first.category] ?? 0) + 1;
    weekly.set(w, wk);
    const age = (now - Date.parse(e.first.published_at)) / 86_400_000;
    if (age <= 7) last7++;
    else if (age <= 14) prev7++;
  }
  const state = await all<{ key: string; value: string }>(env.DB, `SELECT key, value FROM ${W.t.state}`);
  const st = Object.fromEntries(state.map((s) => [s.key, s.value]));
  const coverage = await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM ${W.t.items} WHERE category = 'coverage' AND published_at >= ?`, [since]);
  return {
    days,
    events: events.length,
    reports: rows.length,
    verified,
    deaths,
    last7,
    prev7,
    coverageItems: coverage?.n ?? 0,
    byCategory,
    byCounty,
    weekly: [...weekly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, v]) => ({ week, ...v })),
    lastCollectAt: st.last_collect ?? null,
    lastScanned: st.last_scanned ? Number(st.last_scanned) : null,
  };
}

export const COLLECTION_QUERY =
  '(Kenya OR Kenyan OR Nairobi OR IEBC OR NCIC OR Ruto OR Gachagua OR Kalonzo OR "Matiang\'i" OR Sifuna OR Raila OR Oburu OR "Kenya Kwanza" OR Azimio OR "United Opposition" OR DCP OR "Gen Z")';

/* ── the Kenya watch ──────────────────────────────────────── */

export const KE_WATCH: Watch = {
  key: "ke",
  csvName: "kenya-election-watch",
  t: tablesFor("ew"),
  categories: CATEGORIES,
  labels: CATEGORY_LABELS,
  placeRe: /^\d{3}$/,
  query: COLLECTION_QUERY,
  code: codeReport,
  leadKind,
  leadKinds: ["poll", "declaration", "iebc", "court"],
  contentKinds: ["poll", "candidate", "milestone", "candidate-input", "stronghold", "realignment"],
  deathCategories: ["political_violence", "protest_policing", "abduction", "election_admin"],
  places: new Map(COUNTY_LIST),
};
