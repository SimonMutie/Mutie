import type { Env } from "../bindings";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { AFRICA_SOURCES, PAN_AFRICAN, INSTITUTION, GLOBAL_AFRICA_DESK } from "../data/africaSources";
import { SOURCE_NAMES, STATE_MEDIA } from "../data/sourceNames";
import { AFRICA_GEO_COUNTRIES } from "./africaGeo";
import { EXPANSION, EXPANSION_VERSION, RERATED } from "../data/registerExpansion";
import { RATINGS, OWNERSHIP_LABEL, RELIABILITY_LABEL, type Ownership, type Reliability } from "../data/sourceRatings";

/**
 * The Sources Register: the outlets, institutions and data providers behind
 * the platform's reporting, grouped by region and country, with links. It is
 * what to show a client who asks "what are your sources?".
 *
 * Two roles, kept apart on purpose so the register never claims more than is true:
 *   - "pulled":    the platform reads from it (the Africa Wire crawl, the wire feeds, the data APIs).
 *   - "reference": a credible body used to check and cross-reference reporting; nothing is pulled from it.
 *
 * It is seeded once, from the same lists the platform actually reads from, and
 * is then the admin's to edit. Super admin only (see routes/sourceRegister.ts).
 */

export type SourceKind = "local_media" | "state_media" | "wire" | "international" | "institution" | "data" | "government";
export type SourceRole = "pulled" | "reference";

export const KINDS: Record<SourceKind, string> = {
  local_media: "Local media",
  state_media: "State or public media",
  wire: "News agency / wire",
  international: "International media",
  institution: "Research / institution",
  data: "Data provider",
  government: "Government / multilateral body",
};

export interface RegisterEntry {
  id: string;
  name: string;
  url: string;
  /** ISO-2 country code, or PAN (continental), INT (international), INST (institution), DATA. */
  country: string;
  region: string;
  kind: SourceKind;
  role: SourceRole;
  notes: string | null;
  /** Admiralty source reliability, A to F (F = cannot be judged yet). */
  reliability: Reliability;
  ownership: Ownership;
  /** Editorial orientation in a few words. */
  orientation: string | null;
  /** Why it is rated as it is, and what to watch for. */
  rating_note: string | null;
  /** "desk": baseline assessment; "reviewed": an analyst has checked it; "unassessed". */
  rating_basis: "desk" | "reviewed" | "unassessed";
  rated_by: string | null;
  rated_at: string | null;
  /** Main publishing language(s), e.g. "Amharic" or "Arabic/French". Null = not recorded yet. */
  language: string | null;
  /** Result of the last live check of the link: ok, blocked (site is up but refuses automated checks), dead, error. */
  link_status: "ok" | "blocked" | "dead" | "error" | null;
  link_code: number | null;
  link_checked_at: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

const REGION_OF: Record<string, string> = {};
const put = (region: string, codes: string) => codes.split(" ").forEach((c) => (REGION_OF[c] = region));
put("North Africa", "DZ EG LY MA TN MR");
put("West Africa", "BJ BF CV CI GM GH GN GW LR ML NE NG SN SL TG");
put("Central Africa", "AO CM CF TD CG CD GQ GA ST");
put("East Africa", "BI KM DJ ER ET KE MG MW MU MZ RW SC SO SS SD TZ UG ZM ZW");
put("Southern Africa", "BW LS NA ZA SZ");
put("Middle East", "SY IQ IR IL PS LB JO YE SA OM AE KW QA BH TR");
// Sudan and South Sudan are read as part of the Horn in this platform's coverage.
put("East Africa", "SD SS");

export const regionOf = (code: string): string => REGION_OF[code] ?? (code === "PAN" ? "Pan-African" : code === "INST" ? "Institutions" : code === "DATA" ? "Data providers" : "International");

/** Home countries of non-African outlets and think tanks (grouped under "International"). */
const FOREIGN: Record<string, string> = {
  RU: "Russia", CN: "China", IN: "India", GB: "United Kingdom", US: "United States", BE: "Belgium", FR: "France", DE: "Germany", ES: "Spain", PT: "Portugal",
  NL: "Netherlands", CH: "Switzerland", NO: "Norway", SE: "Sweden", DK: "Denmark", FI: "Finland", IT: "Italy", CA: "Canada", AU: "Australia", JP: "Japan", UA: "Ukraine", BR: "Brazil", AT: "Austria",
};
export const FOREIGN_CODES = new Set(Object.keys(FOREIGN));

export function countryName(code: string): string {
  if (FOREIGN[code]) return FOREIGN[code];
  if (code === "PAN") return "Pan-African";
  if (code === "INST") return "Research bodies and institutions";
  if (code === "INT") return "International";
  if (code === "DATA") return "Data providers";
  return AFRICA_GEO_COUNTRIES[code]?.name ?? code;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function nameFor(url: string): string {
  const host = hostOf(url);
  if (SOURCE_NAMES[host]) return SOURCE_NAMES[host];
  const label = host.split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type Seed = Omit<RegisterEntry, "id" | "created_at" | "updated_at" | "active" | "reliability" | "ownership" | "orientation" | "rating_note" | "rating_basis" | "rated_by" | "rated_at" | "language" | "link_status" | "link_code" | "link_checked_at">;

export interface Assessment {
  reliability: Reliability;
  ownership: Ownership;
  orientation: string | null;
  rating_note: string | null;
  rating_basis: "desk" | "unassessed";
}

/** Ratings from the country-by-country expansion and the re-rated outlets, keyed like RATINGS. */
const EXTRA_RATINGS: Record<string, [Reliability, Ownership, string | null, string | null]> = {};
for (const [, , url, , rel, own, orient, note] of EXPANSION) EXTRA_RATINGS[hostOf(url)] = [rel, own, orient, note];
for (const [host, rel, own, orient, note] of RERATED) EXTRA_RATINGS[host] = [rel, own, orient, note];

/** The baseline assessment for a link: looked up by host, then by host plus first path segment, else "not yet assessed". */
export function assessmentFor(url: string, kind: SourceKind): Assessment {
  const host = hostOf(url);
  const r = RATINGS[host] ?? EXTRA_RATINGS[host];
  if (r && !(r[0] === "F" && r[1] === "unassessed")) return { reliability: r[0], ownership: r[1], orientation: r[2] ?? null, rating_note: r[3] ?? null, rating_basis: "desk" };
  if (kind === "state_media") {
    return { reliability: "C", ownership: "state", orientation: "Official line; strong on routine events and statements", rating_note: "State-owned or state-run; not yet individually assessed. Weigh politically sensitive claims accordingly.", rating_basis: "desk" };
  }
  return {
    reliability: "F",
    ownership: "unassessed",
    orientation: null,
    rating_note: "Not yet assessed. Held at F until a track record is reviewed.",
    rating_basis: "unassessed",
  };
}

export { OWNERSHIP_LABEL, RELIABILITY_LABEL };

/** Outlets wired up directly in lib/osintFeed.ts (read as live feeds), beyond the Africa Wire list. */
const WIRE_FEED_SEEDS: Seed[] = [
  { name: "BBC News", url: "https://www.bbc.com/news/world", country: "INT", region: "International", kind: "international", role: "pulled", notes: "British public broadcaster." },
  { name: "The Guardian", url: "https://www.theguardian.com/world", country: "INT", region: "International", kind: "international", role: "pulled", notes: null },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/", country: "INT", region: "International", kind: "international", role: "pulled", notes: "Qatar-based broadcaster." },
  { name: "Deutsche Welle (DW)", url: "https://www.dw.com/en/", country: "INT", region: "International", kind: "international", role: "pulled", notes: "German public broadcaster." },
  { name: "Africanews", url: "https://www.africanews.com/", country: "PAN", region: "Pan-African", kind: "international", role: "pulled", notes: null },
  { name: "AllAfrica", url: "https://allafrica.com/", country: "PAN", region: "Pan-African", kind: "wire", role: "pulled", notes: "Aggregates content from African newsrooms." },
  { name: "Radio Dabanga", url: "https://www.dabangasudan.org/en", country: "SD", region: "East Africa", kind: "local_media", role: "pulled", notes: "Sudan-focused independent newsroom." },
  { name: "Sudan Tribune", url: "https://sudantribune.com/", country: "SD", region: "East Africa", kind: "local_media", role: "pulled", notes: "Sudanese diaspora newsroom." },
  { name: "Times of Israel", url: "https://www.timesofisrael.com/", country: "IL", region: "Middle East", kind: "local_media", role: "pulled", notes: "Israeli newsroom." },
  { name: "Anadolu Agency", url: "https://www.aa.com.tr/en", country: "TR", region: "Middle East", kind: "state_media", role: "pulled", notes: "Turkish state news agency; read with that in mind." },
  { name: "TASS", url: "https://tass.com/", country: "INT", region: "International", kind: "state_media", role: "pulled", notes: "Russian state news agency; read with that in mind and always cross-checked." },
];

/** Data providers the platform's APIs read from. */
const DATA_SEEDS: Seed[] = [
  { name: "GDELT Project", url: "https://www.gdeltproject.org/", country: "DATA", region: "Data providers", kind: "data", role: "pulled", notes: "Global event database; used for conflict-event candidates." },
  { name: "World Bank Open Data", url: "https://data.worldbank.org/", country: "DATA", region: "Data providers", kind: "data", role: "pulled", notes: "Economic indicators (CC BY 4.0)." },
  { name: "European Central Bank (via Frankfurter)", url: "https://frankfurter.dev/", country: "DATA", region: "Data providers", kind: "data", role: "pulled", notes: "Daily reference exchange rates." },
  { name: "FRED, Federal Reserve Bank of St. Louis", url: "https://fred.stlouisfed.org/", country: "DATA", region: "Data providers", kind: "data", role: "pulled", notes: "Energy prices and interest rates." },
  { name: "CoinGecko", url: "https://www.coingecko.com/", country: "DATA", region: "Data providers", kind: "data", role: "pulled", notes: "Crypto prices." },
  { name: "Natural Earth", url: "https://www.naturalearthdata.com/", country: "DATA", region: "Data providers", kind: "data", role: "pulled", notes: "Province boundaries (public domain)." },
  { name: "geoBoundaries", url: "https://www.geoboundaries.org/", country: "DATA", region: "Data providers", kind: "data", role: "pulled", notes: "Boundaries for DR Congo (CC BY 4.0)." },
  { name: "US Treasury OFAC sanctions list", url: "https://sanctionssearch.ofac.treas.gov/", country: "DATA", region: "Data providers", kind: "government", role: "pulled", notes: "Used in due-diligence screening." },
  { name: "UN Security Council consolidated list", url: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list", country: "DATA", region: "Data providers", kind: "government", role: "pulled", notes: "Used in due-diligence screening." },
  { name: "EU consolidated financial sanctions", url: "https://www.sanctionsmap.eu/", country: "DATA", region: "Data providers", kind: "government", role: "pulled", notes: "Used in due-diligence screening." },
  { name: "UK Sanctions List (FCDO)", url: "https://www.gov.uk/government/publications/the-uk-sanctions-list", country: "DATA", region: "Data providers", kind: "government", role: "pulled", notes: "Used in due-diligence screening." },
];

/** Credible bodies used to check and cross-reference reporting. Nothing is pulled from these. */
const REFERENCE_SEEDS: Seed[] = [
  { name: "ACLED (Armed Conflict Location & Event Data)", url: "https://acleddata.com/", country: "DATA", region: "Data providers", kind: "data", role: "reference", notes: "Cross-check for conflict event counts and locations." },
  { name: "Uppsala Conflict Data Program (UCDP)", url: "https://ucdp.uu.se/", country: "DATA", region: "Data providers", kind: "data", role: "reference", notes: "Cross-check for fatalities and conflict classification." },
  { name: "UN OCHA", url: "https://www.unocha.org/", country: "INST", region: "Institutions", kind: "government", role: "reference", notes: "Humanitarian situation reports." },
  { name: "ReliefWeb", url: "https://reliefweb.int/", country: "INST", region: "Institutions", kind: "government", role: "reference", notes: "Humanitarian reports and updates." },
  { name: "Integrated Food Security Phase Classification (IPC)", url: "https://www.ipcinfo.org/", country: "INST", region: "Institutions", kind: "government", role: "reference", notes: "Food-security classifications." },
  { name: "UNHCR Operational Data Portal", url: "https://data.unhcr.org/", country: "INST", region: "Institutions", kind: "government", role: "reference", notes: "Displacement and refugee figures." },
  { name: "IOM Displacement Tracking Matrix", url: "https://dtm.iom.int/", country: "INST", region: "Institutions", kind: "government", role: "reference", notes: "Internal displacement figures." },
  { name: "African Union Peace and Security Council", url: "https://papsrepository.africa-union.org/", country: "INST", region: "Institutions", kind: "government", role: "reference", notes: "Official communiqués on peace and security." },
];

/** Outlets from the country-by-country research. They are references: the platform does not crawl them. */
function expansionSeeds(): (Seed & { language: string | null })[] {
  return EXPANSION.map(([country, name, url, kind, , , , , language]) => ({
    language: language ?? null,
    name, url, country, region: regionOf(country), kind, role: "reference" as const, notes: kind === "state_media" ? "State-owned or state-run; read with that in mind." : null,
  }));
}

/** All default entries, built from the lists the platform reads from. */
export function defaultEntries(): Seed[] {
  const out: Seed[] = [];
  for (const s of AFRICA_SOURCES) {
    const host = hostOf(s.url);
    const code = s.country === PAN_AFRICAN ? "PAN" : s.country === INSTITUTION ? "INST" : s.country === GLOBAL_AFRICA_DESK ? "INT" : s.country;
    const isInst = code === "INST";
    const kind: SourceKind = isInst ? (/(\.int|afdb|uneca|worldbank|undp|un\.org|reliefweb|igad|eac|comesa|sadc|ecowas|nilebasin|africacdc)/.test(host) ? "government" : "institution") : code === "PAN" || code === "INT" ? (/(reuters|apnews|panapress)/.test(host) ? "wire" : "international") : STATE_MEDIA.has(host) ? "state_media" : "local_media";
    out.push({
      name: nameFor(s.url),
      url: s.url,
      country: code,
      region: regionOf(code),
      kind,
      // Research bodies are read by the Africa Wire as well, but their main use here is to check claims against.
      role: "pulled",
      notes: kind === "state_media" ? "State-owned or state-run; read with that in mind." : null,
    });
  }
  out.push(...WIRE_FEED_SEEDS, ...DATA_SEEDS, ...REFERENCE_SEEDS, ...expansionSeeds());
  // One entry per link.
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = e.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

let tableReady: Promise<unknown> | null = null;
export function resetRegisterCheck() {
  tableReady = null;
}

/** Creates the table and, the first time it is empty, fills it from the defaults. */
export async function ensureRegister(env: Env): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await run(
        env.DB,
        `CREATE TABLE IF NOT EXISTS source_register (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, country TEXT NOT NULL, region TEXT NOT NULL,
          kind TEXT NOT NULL, role TEXT NOT NULL, notes TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        )`
      );
      // Columns added after the first release of the register.
      const added: [string, string][] = [
        ["reliability", "TEXT"], ["ownership", "TEXT"], ["orientation", "TEXT"], ["rating_note", "TEXT"],
        ["rating_basis", "TEXT"], ["rated_by", "TEXT"], ["rated_at", "TEXT"],
        ["language", "TEXT"], ["link_status", "TEXT"], ["link_code", "INTEGER"], ["link_checked_at", "TEXT"],
      ];
      for (const [col, def] of added) {
        try {
          await env.DB.prepare(`SELECT ${col} FROM source_register LIMIT 0`).all();
        } catch {
          await env.DB.prepare(`ALTER TABLE source_register ADD COLUMN ${col} ${def}`).run().catch(() => {});
        }
      }
      const row = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM source_register");
      if ((row?.n ?? 0) === 0) await seedRegister(env);
      await addExpansion(env);
      await backfillAssessments(env);
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

/** Adds the researched outlets to a register that was seeded before they existed (once per expansion version). Never overwrites or re-adds what an admin has edited or deleted. */
async function addExpansion(env: Env): Promise<void> {
  await run(env.DB, "CREATE TABLE IF NOT EXISTS source_register_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const done = await first<{ value: string }>(env.DB, "SELECT value FROM source_register_meta WHERE key = 'expansion_version'");
  if (Number(done?.value ?? 0) >= EXPANSION_VERSION) return;
  const have = new Set((await all<{ url: string }>(env.DB, "SELECT url FROM source_register")).map((r) => hostOf(r.url)));
  const now = nowIso();
  const fresh = expansionSeeds().filter((e) => !have.has(hostOf(e.url)));
  const stmts = fresh.map((e) => {
    const a = assessmentFor(e.url, e.kind);
    return env.DB.prepare(`INSERT OR IGNORE INTO source_register (id, name, url, country, region, kind, role, notes, reliability, ownership, orientation, rating_note, rating_basis, rated_by, rated_at, language, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).bind(
      newId(), e.name, e.url, e.country, e.region, e.kind, e.role, e.notes, a.reliability, a.ownership, a.orientation, a.rating_note, a.rating_basis, a.rating_basis === "desk" ? "Afrilens desk baseline" : null, a.rating_basis === "desk" ? now : null, e.language, now, now
    );
  });
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  // Rows from an earlier version of the expansion have no language yet: fill it in, never overwriting an edit.
  const langStmts = expansionSeeds().filter((e) => e.language).map((e) => env.DB.prepare("UPDATE source_register SET language = ? WHERE lower(url) = lower(?) AND language IS NULL").bind(e.language, e.url));
  for (let i = 0; i < langStmts.length; i += 50) await env.DB.batch(langStmts.slice(i, i + 50));
  await run(env.DB, "INSERT INTO source_register_meta (key, value) VALUES ('expansion_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(EXPANSION_VERSION)]);
}

/** Gives every row that has no assessment yet its baseline one (rows an analyst has rated are never touched). */
async function backfillAssessments(env: Env): Promise<void> {
  const rows = await all<{ id: string; url: string; kind: SourceKind; rating_basis: string | null }>(env.DB, "SELECT id, url, kind, rating_basis FROM source_register WHERE rating_basis IS NULL OR rating_basis = 'unassessed'");
  const now = nowIso();
  const stmts = rows.flatMap((r) => {
    const a = assessmentFor(r.url, r.kind);
    if (a.rating_basis === "unassessed" && r.rating_basis === "unassessed") return [];
    return env.DB.prepare("UPDATE source_register SET reliability = ?, ownership = ?, orientation = ?, rating_note = ?, rating_basis = ?, rated_by = ?, rated_at = ? WHERE id = ? AND (rating_basis IS NULL OR rating_basis = 'unassessed')").bind(
      a.reliability, a.ownership, a.orientation, a.rating_note, a.rating_basis, a.rating_basis === "desk" ? "Afrilens desk baseline" : null, a.rating_basis === "desk" ? now : null, r.id
    );
  });
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

export async function seedRegister(env: Env): Promise<number> {
  const now = nowIso();
  const entries = defaultEntries();
  const stmts = entries.map((e) => {
    const a = assessmentFor(e.url, e.kind);
    return env.DB.prepare(`INSERT OR IGNORE INTO source_register (id, name, url, country, region, kind, role, notes, reliability, ownership, orientation, rating_note, rating_basis, rated_by, rated_at, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).bind(
      newId(), e.name, e.url, e.country, e.region, e.kind, e.role, e.notes, a.reliability, a.ownership, a.orientation, a.rating_note, a.rating_basis, a.rating_basis === "desk" ? "Afrilens desk baseline" : null, a.rating_basis === "desk" ? now : null, now, now
    );
  });
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return entries.length;
}

export async function listRegister(env: Env): Promise<RegisterEntry[]> {
  await ensureRegister(env);
  return all<RegisterEntry>(env.DB, "SELECT * FROM source_register ORDER BY region, country, name");
}

export type LinkStatus = "ok" | "blocked" | "dead" | "error";

/** Opens one link the way a browser would and says whether it is alive. Sites that refuse automated visits count as "blocked", not dead. */
export async function checkLink(url: string): Promise<{ status: LinkStatus; code: number | null }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AfrilensSourceCheck/1.0)", Accept: "text/html,*/*" },
    });
    const code = res.status;
    void res.body?.cancel().catch(() => {});
    if (code >= 200 && code < 400) return { status: "ok", code };
    if ([401, 403, 405, 406, 429, 451, 999].includes(code)) return { status: "blocked", code };
    if (code === 404 || code === 410 || code >= 500) return { status: "dead", code };
    return { status: "error", code };
  } catch {
    // DNS failure, refused connection, timeout, bad certificate.
    return { status: "dead", code: null };
  }
}

/** Checks the next batch of links, never-checked first, then oldest check. Returns how many are still waiting. */
export async function checkNextLinks(env: Env, limit: number, staleBefore: string): Promise<{ checked: number; remaining: number; dead: number }> {
  await ensureRegister(env);
  const rows = await all<{ id: string; url: string }>(
    env.DB,
    "SELECT id, url FROM source_register WHERE active = 1 AND (link_checked_at IS NULL OR link_checked_at < ?) ORDER BY link_checked_at IS NOT NULL, link_checked_at LIMIT ?",
    [staleBefore, limit]
  );
  const results = await Promise.all(rows.map(async (r) => ({ id: r.id, ...(await checkLink(r.url)) })));
  const now = nowIso();
  for (let i = 0; i < results.length; i += 50) {
    await env.DB.batch(results.slice(i, i + 50).map((r) => env.DB.prepare("UPDATE source_register SET link_status = ?, link_code = ?, link_checked_at = ? WHERE id = ?").bind(r.status, r.code, now, r.id)));
  }
  const left = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM source_register WHERE active = 1 AND (link_checked_at IS NULL OR link_checked_at < ?)", [staleBefore]);
  return { checked: results.length, remaining: Math.max(0, (left?.n ?? 0) - 0), dead: results.filter((r) => r.status === "dead").length };
}
