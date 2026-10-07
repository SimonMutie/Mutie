import type { Env } from "../../bindings";
import { all, first, run } from "../../db";
import { nameSimilarity, prefixKeys, strengthOf, type Strength } from "./match";

/**
 * Screening against the official sanctions lists, read straight from the
 * issuing bodies (all published for public reuse): the US Treasury's OFAC
 * SDN list, the UN Security Council consolidated list, the EU consolidated
 * financial sanctions list and the UK Sanctions List. These are used rather
 * than a compiled dataset because the best-known compilation (OpenSanctions)
 * is not free for work done for clients.
 *
 * Each list is downloaded on first use in a Worker and kept for 24 hours
 * (a stale copy keeps serving if a refresh fails). The parsers below are
 * written to each publisher's documented layout, and every one fails soft:
 * a list that cannot be read is reported as unavailable in the result, never
 * as "no match", because for screening those mean opposite things.
 */

export type ListId = "OFAC" | "UN" | "EU" | "UK";

export interface ListEntry {
  list: ListId;
  ref: string;
  kind: "person" | "entity" | "vessel" | "other";
  name: string;
  aliases: string[];
  countries: string[];
  programs: string[];
  listedOn: string | null;
  remarks: string | null;
}

export interface ListSource {
  id: ListId;
  label: string;
  /** Where a person can look the entry up themselves. */
  searchUrl: string;
  urls: string[];
  load: (fetched: string[]) => ListEntry[];
  /** Large XML files are read in pieces ending at these closing tags, so memory stays small. */
  stream?: RegExp;
}

const TTL_MS = 24 * 3600_000;
const FETCH_TIMEOUT_MS = 40_000;
const MAX_BYTES = 60_000_000;

// ── Small parsers ────────────────────────────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const tag = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) || null : null;
};
const tags = (block: string, name: string): string[] => [...block.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => decode(m[1].trim())).filter(Boolean);
const attr = (s: string, name: string): string | null => {
  const m = s.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decode(m[1]) || null : null;
};
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && x !== "-0-"))];

/** OFAC writes individuals as "SURNAME, Given names"; screening reads them in speaking order. */
export function speakingOrder(name: string): string {
  const m = name.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : name;
}

// ── OFAC (SDN.CSV + ALT.CSV, no header row) ──────────────────────────────

export function parseOfac(files: string[]): ListEntry[] {
  const [sdn, alt = ""] = files;
  const aliases = new Map<string, string[]>();
  for (const r of parseCsv(alt)) if (r[0] && r[3] && r[3] !== "-0-") (aliases.get(r[0]) ?? aliases.set(r[0], []).get(r[0])!).push(r[3].trim());
  const out: ListEntry[] = [];
  for (const r of parseCsv(sdn)) {
    if (!r[0] || !r[1]) continue;
    const type = (r[2] ?? "").trim().toLowerCase();
    const kind = type === "individual" ? "person" : type === "vessel" || type === "aircraft" ? "vessel" : type === "-0-" || type === "" ? "entity" : "other";
    const remarks = (r[11] ?? "").trim();
    const fix = (n: string) => (kind === "person" ? speakingOrder(n.trim()) : n.trim());
    out.push({
      list: "OFAC",
      ref: r[0].trim(),
      kind,
      name: fix(r[1]),
      aliases: uniq((aliases.get(r[0].trim()) ?? []).map(fix)),
      countries: [],
      programs: uniq((r[3] ?? "").split(/[;\]\[]/).map((p) => p.trim())),
      listedOn: null,
      remarks: remarks && remarks !== "-0-" ? remarks.slice(0, 300) : null,
    });
  }
  return out;
}

// ── UN consolidated list (XML) ───────────────────────────────────────────

export function parseUn(files: string[]): ListEntry[] {
  const xml = files[0] ?? "";
  const out: ListEntry[] = [];
  for (const m of xml.matchAll(/<INDIVIDUAL>([\s\S]*?)<\/INDIVIDUAL>/g)) {
    const b = m[1];
    const name = [tag(b, "FIRST_NAME"), tag(b, "SECOND_NAME"), tag(b, "THIRD_NAME"), tag(b, "FOURTH_NAME")].filter(Boolean).join(" ");
    if (!name) continue;
    out.push({
      list: "UN",
      ref: tag(b, "REFERENCE_NUMBER") ?? tag(b, "DATAID") ?? "",
      kind: "person",
      name,
      aliases: uniq(tags(b, "ALIAS_NAME")),
      countries: uniq(tags(b.match(/<NATIONALITY>[\s\S]*?<\/NATIONALITY>/)?.[0] ?? "", "VALUE")),
      programs: uniq([tag(b, "UN_LIST_TYPE")]),
      listedOn: tag(b, "LISTED_ON"),
      remarks: tag(b, "COMMENTS1")?.slice(0, 300) ?? null,
    });
  }
  for (const m of xml.matchAll(/<ENTITY>([\s\S]*?)<\/ENTITY>/g)) {
    const b = m[1];
    const name = tag(b, "FIRST_NAME");
    if (!name) continue;
    out.push({ list: "UN", ref: tag(b, "REFERENCE_NUMBER") ?? tag(b, "DATAID") ?? "", kind: "entity", name, aliases: uniq(tags(b, "ALIAS_NAME")), countries: [], programs: uniq([tag(b, "UN_LIST_TYPE")]), listedOn: tag(b, "LISTED_ON"), remarks: tag(b, "COMMENTS1")?.slice(0, 300) ?? null });
  }
  return out;
}

// ── EU consolidated financial sanctions (FSF XML) ────────────────────────

export function parseEu(files: string[]): ListEntry[] {
  const xml = files[0] ?? "";
  const out: ListEntry[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?sanctionEntity\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?sanctionEntity>/g)) {
    const head = m[1];
    const body = m[2];
    const names = uniq([...body.matchAll(/<(?:\w+:)?nameAlias\b([^>]*?)\/?>/g)].map((n) => attr(n[1], "wholeName")));
    if (!names.length) continue;
    const subject = body.match(/<(?:\w+:)?subjectType\b([^>]*?)\/?>/)?.[1] ?? "";
    const code = (attr(subject, "code") ?? attr(subject, "classificationCode") ?? "").toLowerCase();
    out.push({
      list: "EU",
      ref: attr(head, "logicalId") ?? attr(head, "euReferenceNumber") ?? "",
      kind: code.startsWith("p") ? "person" : code.startsWith("e") ? "entity" : "other",
      name: names[0],
      aliases: names.slice(1),
      countries: uniq([...body.matchAll(/<(?:\w+:)?citizenship\b([^>]*?)\/?>/g)].map((c) => attr(c[1], "countryDescription"))),
      programs: uniq([...body.matchAll(/<(?:\w+:)?regulation\b([^>]*?)\/?>/g)].map((r) => attr(r[1], "programme"))),
      listedOn: attr(body.match(/<(?:\w+:)?regulation\b([^>]*?)\/?>/)?.[1] ?? "", "entryIntoForceDate"),
      remarks: null,
    });
  }
  return out;
}

// ── UK Sanctions List (CSV) ──────────────────────────────────────────────

export function parseUk(files: string[]): ListEntry[] {
  const rows = parseCsv(files[0] ?? "");
  const headerAt = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === "name 6"));
  if (headerAt < 0) return [];
  const header = rows[headerAt].map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = [1, 2, 3, 4, 5, 6].map((n) => col(`name ${n}`));
  const iType = col("name type");
  const iGroup = col("group id", "unique id");
  const iKind = col("group type");
  const iRegime = col("regime name", "regime");
  const iDate = col("date designated");
  const groups = new Map<string, ListEntry>();
  for (const r of rows.slice(headerAt + 1)) {
    const id = (r[iGroup] ?? "").trim();
    const name = iName
      .filter((i) => i >= 0)
      .map((i) => (r[i] ?? "").trim())
      .filter(Boolean)
      .join(" ");
    if (!id || !name) continue;
    const isPrimary = /primary name$/i.test((r[iType] ?? "").trim());
    let g = groups.get(id);
    if (!g) {
      const kindText = (r[iKind] ?? "").toLowerCase();
      g = { list: "UK", ref: id, kind: kindText.startsWith("ind") ? "person" : kindText.startsWith("ent") ? "entity" : kindText.startsWith("ship") ? "vessel" : "other", name, aliases: [], countries: [], programs: uniq([(r[iRegime] ?? "").trim()]), listedOn: (r[iDate] ?? "").trim() || null, remarks: null };
      groups.set(id, g);
    } else if (isPrimary && g.name !== name && /alias|variation/i.test(g.name)) g.name = name;
    else if (name !== g.name) g.aliases.push(name);
  }
  return [...groups.values()].map((g) => ({ ...g, aliases: uniq(g.aliases) }));
}

// ── The four lists ───────────────────────────────────────────────────────

export const LIST_SOURCES: ListSource[] = [
  {
    id: "OFAC",
    label: "US Treasury OFAC (SDN list)",
    searchUrl: "https://sanctionssearch.ofac.treas.gov/",
    urls: ["https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV", "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV"],
    load: parseOfac,
  },
  {
    id: "UN",
    label: "UN Security Council consolidated list",
    searchUrl: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list",
    urls: ["https://scsanctions.un.org/resources/xml/en/consolidated.xml"],
    load: parseUn,
    stream: /<\/(?:INDIVIDUAL|ENTITY)>/g,
  },
  {
    id: "EU",
    label: "EU consolidated financial sanctions",
    searchUrl: "https://www.sanctionsmap.eu/",
    urls: ["https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"],
    load: parseEu,
    stream: /<\/(?:\w+:)?sanctionEntity>/g,
  },
  {
    id: "UK",
    label: "UK Sanctions List (FCDO)",
    searchUrl: "https://sanctionslist.fcdo.gov.uk/",
    urls: ["https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv"],
    load: parseUk,
  },
];

interface Loaded {
  fetchedAt: number;
  entries: ListEntry[];
  /** four-letter name-start -> indexes into entries */
  index: Map<string, number[]>;
}

/** Lists put straight into memory by tests; the real lists live in D1. */
const primed = new Map<ListId, Loaded>();
export function resetListCache(): void {
  primed.clear();
}
export function primeList(id: ListId, entries: ListEntry[]): void {
  primed.set(id, { fetchedAt: Date.now(), entries, index: buildIndex(entries) });
}

function buildIndex(entries: ListEntry[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const keys = new Set<string>();
    for (const n of [e.name, ...e.aliases]) for (const k of prefixKeys(n, e.kind === "person" ? "person" : "entity")) keys.add(k);
    for (const k of keys) (index.get(k) ?? index.set(k, []).get(k)!).push(i);
  });
  return index;
}

// ── Storage (D1) ─────────────────────────────────────────────────────────
// The lists are large, so they are downloaded and parsed in pieces by a
// background refresh and kept in D1 as small rows; a screening reads only
// the few candidate entries it needs. Nothing big is held in a request.

let tablesReady = false;
export function resetListTableCheck(): void {
  tablesReady = false;
}
async function ensureTables(env: Env): Promise<void> {
  if (tablesReady) return;
  await run(env.DB, "CREATE TABLE IF NOT EXISTS dd_list_meta (list TEXT PRIMARY KEY, gen INTEGER NOT NULL, entries INTEGER NOT NULL, fetched_at TEXT, error TEXT, error_at TEXT)");
  await run(env.DB, "CREATE TABLE IF NOT EXISTS dd_list_entries (list TEXT NOT NULL, gen INTEGER NOT NULL, rid TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (list, gen, rid))");
  await run(env.DB, "CREATE TABLE IF NOT EXISTS dd_list_keys (key TEXT NOT NULL, list TEXT NOT NULL, gen INTEGER NOT NULL, rid TEXT NOT NULL)");
  await run(env.DB, "CREATE INDEX IF NOT EXISTS idx_dd_list_keys ON dd_list_keys (key, list, gen)");
  tablesReady = true;
}

interface Meta {
  list: string;
  gen: number;
  entries: number;
  fetched_at: string | null;
  error: string | null;
  error_at: string | null;
}

async function* xmlPieces(res: Response, close: RegExp): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    if (buf.length > 800_000 || done) {
      let cut = -1;
      for (const m of buf.matchAll(close)) cut = (m.index ?? 0) + m[0].length;
      if (cut > 0) {
        yield buf.slice(0, cut);
        buf = buf.slice(cut);
      }
    }
    if (done) break;
  }
}

async function open(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": "TheLens-DueDiligence/1.0 (+https://afrilensconsulting.com)", Accept: "*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("file too large");
  return res;
}

async function writeEntries(env: Env, id: ListId, gen: number, entries: ListEntry[], startRid: number): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  const keyRows: [string, string][] = [];
  entries.forEach((e, i) => {
    const rid = String(startRid + i);
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO dd_list_entries (list, gen, rid, data) VALUES (?,?,?,?)").bind(id, gen, rid, JSON.stringify(e)));
    const keys = new Set<string>();
    for (const n of [e.name, ...e.aliases]) for (const k of prefixKeys(n, e.kind === "person" ? "person" : "entity")) keys.add(k);
    for (const k of keys) keyRows.push([k, rid]);
  });
  for (let i = 0; i < keyRows.length; i += 24) {
    const part = keyRows.slice(i, i + 24);
    stmts.push(env.DB.prepare(`INSERT INTO dd_list_keys (key, list, gen, rid) VALUES ${part.map(() => "(?,?,?,?)").join(",")}`).bind(...part.flatMap(([k, rid]) => [k, id, gen, rid])));
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

const inflight = new Map<ListId, Promise<{ entries: number }>>();

/** Downloads one list and replaces the stored copy. The old copy keeps serving until the new one is complete. */
export function refreshList(env: Env, id: ListId): Promise<{ entries: number }> {
  const running = inflight.get(id);
  if (running) return running;
  const p = (async () => {
    await ensureTables(env);
    const src = LIST_SOURCES.find((s) => s.id === id)!;
    const gen = Date.now();
    let total = 0;
    try {
      if (src.stream) {
        for (const url of src.urls) {
          for await (const piece of xmlPieces(await open(url), src.stream)) {
            const entries = src.load([piece]);
            await writeEntries(env, id, gen, entries, total);
            total += entries.length;
          }
        }
      } else {
        const files: string[] = [];
        for (const url of src.urls) files.push(await (await open(url)).text());
        const entries = src.load(files);
        for (let i = 0; i < entries.length; i += 400) await writeEntries(env, id, gen, entries.slice(i, i + 400), i);
        total = entries.length;
      }
      if (total < 50) throw new Error(`the file was read but held only ${total} entries, so its layout has probably changed`);
      await run(env.DB, "INSERT INTO dd_list_meta (list, gen, entries, fetched_at, error, error_at) VALUES (?,?,?,?,NULL,NULL) ON CONFLICT(list) DO UPDATE SET gen=excluded.gen, entries=excluded.entries, fetched_at=excluded.fetched_at, error=NULL, error_at=NULL", [id, gen, total, new Date(gen).toISOString()]);
      await run(env.DB, "DELETE FROM dd_list_entries WHERE list = ? AND gen <> ?", [id, gen]);
      await run(env.DB, "DELETE FROM dd_list_keys WHERE list = ? AND gen <> ?", [id, gen]);
      return { entries: total };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await run(env.DB, "DELETE FROM dd_list_entries WHERE list = ? AND gen = ?", [id, gen]).catch(() => undefined);
      await run(env.DB, "DELETE FROM dd_list_keys WHERE list = ? AND gen = ?", [id, gen]).catch(() => undefined);
      await run(env.DB, "INSERT INTO dd_list_meta (list, gen, entries, error, error_at) VALUES (?,0,0,?,?) ON CONFLICT(list) DO UPDATE SET error=excluded.error, error_at=excluded.error_at", [id, message, new Date().toISOString()]).catch(() => undefined);
      throw err;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

/** For the daily background run: refreshes any list that is missing or over a day old, one at a time. Failures are retried after an hour. */
export async function refreshStaleLists(env: Env): Promise<void> {
  await ensureTables(env);
  const metas = await all<Meta>(env.DB, "SELECT * FROM dd_list_meta");
  for (const src of LIST_SOURCES) {
    const m = metas.find((x) => x.list === src.id);
    const fresh = m?.fetched_at && Date.now() - Date.parse(m.fetched_at) < TTL_MS;
    const recentFail = m?.error_at && Date.now() - Date.parse(m.error_at) < 3600_000;
    if (fresh || recentFail) continue;
    await refreshList(env, src.id).catch((err) => console.error(`[dd] refresh ${src.id} failed:`, err));
  }
}

export async function listStatuses(env: Env): Promise<ListStatus[]> {
  const metas = await ensureTables(env).then(() => all<Meta>(env.DB, "SELECT * FROM dd_list_meta")).catch(() => [] as Meta[]);
  return LIST_SOURCES.map((src) => {
    const p = primed.get(src.id);
    if (p) return { id: src.id, label: src.label, searchUrl: src.searchUrl, status: "ok", entries: p.entries.length, asOf: new Date(p.fetchedAt).toISOString() } as ListStatus;
    const m = metas.find((x) => x.list === src.id);
    if (m && m.entries >= 50) {
      const stale = !!m.fetched_at && Date.now() - Date.parse(m.fetched_at) > 3 * TTL_MS;
      return { id: src.id, label: src.label, searchUrl: src.searchUrl, status: "ok", entries: m.entries, asOf: m.fetched_at ?? undefined, stale, error: stale && m.error ? `Latest refresh failed: ${m.error}` : undefined } as ListStatus;
    }
    return { id: src.id, label: src.label, searchUrl: src.searchUrl, status: "unavailable", error: m?.error ?? "Not downloaded yet." } as ListStatus;
  });
}

// ── Screening ────────────────────────────────────────────────────────────

export interface ListHit {
  list: ListId;
  ref: string;
  kind: ListEntry["kind"];
  name: string;
  matchedName: string;
  score: number;
  strength: Strength;
  countries: string[];
  programs: string[];
  listedOn: string | null;
  remarks: string | null;
}

export interface ListStatus {
  id: ListId;
  label: string;
  searchUrl: string;
  status: "ok" | "unavailable";
  entries?: number;
  asOf?: string;
  stale?: boolean;
  error?: string;
}

export function screenAgainst(loaded: Loaded, names: string[], kind: "person" | "entity"): ListHit[] {
  const candidates = new Set<number>();
  for (const q of names) for (const k of prefixKeys(q, kind)) for (const i of loaded.index.get(k) ?? []) candidates.add(i);
  const hits: ListHit[] = [];
  for (const i of candidates) {
    const e = loaded.entries[i];
    let best = 0;
    let bestName = e.name;
    for (const q of names)
      for (const n of [e.name, ...e.aliases]) {
        const s = nameSimilarity(q, n, kind);
        if (s > best) {
          best = s;
          bestName = n;
        }
      }
    const strength = strengthOf(best);
    if (!strength) continue;
    hits.push({ list: e.list, ref: e.ref, kind: e.kind, name: e.name, matchedName: bestName, score: best, strength, countries: e.countries, programs: e.programs, listedOn: e.listedOn, remarks: e.remarks });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}

export async function screenSanctions(env: Env, names: string[], kind: "person" | "entity"): Promise<{ hits: ListHit[]; statuses: ListStatus[] }> {
  const statuses = await listStatuses(env);
  const hits: ListHit[] = [];
  for (const src of LIST_SOURCES) {
    const st = statuses.find((x) => x.id === src.id)!;
    if (st.status !== "ok") continue;
    try {
      const p = primed.get(src.id);
      if (p) {
        hits.push(...screenAgainst(p, names, kind));
        continue;
      }
      const m = await first<Meta>(env.DB, "SELECT * FROM dd_list_meta WHERE list = ?", [src.id]);
      if (!m) continue;
      const keys = [...new Set(names.flatMap((n) => prefixKeys(n, kind)))];
      const rids = new Set<string>();
      for (let i = 0; i < keys.length; i += 40) {
        const part = keys.slice(i, i + 40);
        const rows = await all<{ rid: string }>(env.DB, `SELECT DISTINCT rid FROM dd_list_keys WHERE list = ? AND gen = ? AND key IN (${part.map(() => "?").join(",")}) LIMIT 5000`, [src.id, m.gen, ...part]);
        rows.forEach((r) => rids.add(r.rid));
      }
      const list = [...rids].slice(0, 8000);
      const entries: ListEntry[] = [];
      for (let i = 0; i < list.length; i += 90) {
        const part = list.slice(i, i + 90);
        const rows = await all<{ data: string }>(env.DB, `SELECT data FROM dd_list_entries WHERE list = ? AND gen = ? AND rid IN (${part.map(() => "?").join(",")})`, [src.id, m.gen, ...part]);
        for (const r of rows) entries.push(JSON.parse(r.data) as ListEntry);
      }
      hits.push(...screenAgainst({ fetchedAt: 0, entries, index: buildIndex(entries) }, names, kind));
    } catch (err) {
      st.status = "unavailable";
      st.error = err instanceof Error ? err.message : String(err);
    }
  }
  return { hits: hits.sort((a, b) => b.score - a.score), statuses };
}
