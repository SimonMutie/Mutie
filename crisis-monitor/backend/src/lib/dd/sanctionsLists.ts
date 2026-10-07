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
  },
  {
    id: "EU",
    label: "EU consolidated financial sanctions",
    searchUrl: "https://www.sanctionsmap.eu/",
    urls: ["https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"],
    load: parseEu,
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

const cache = new Map<ListId, Loaded>();
const inflight = new Map<ListId, Promise<Loaded>>();
const lastError = new Map<ListId, string>();

export function resetListCache(): void {
  cache.clear();
  inflight.clear();
  lastError.clear();
}

/** For tests: put a parsed list straight into the cache. */
export function primeList(id: ListId, entries: ListEntry[]): void {
  cache.set(id, { fetchedAt: Date.now(), entries, index: buildIndex(entries) });
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

async function download(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { "User-Agent": "TheLens-DueDiligence/1.0 (+https://afrilensconsulting.com)", Accept: "*/*" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new Error("file too large");
  return res.text();
}

async function loadSource(src: ListSource): Promise<Loaded> {
  const hit = cache.get(src.id);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;
  const running = inflight.get(src.id);
  if (running) return running;
  const p = (async () => {
    try {
      const files = await Promise.all(src.urls.map(download));
      const entries = src.load(files);
      if (entries.length < 50) throw new Error(`the file was read but held only ${entries.length} entries, so its layout has probably changed`);
      const loaded = { fetchedAt: Date.now(), entries, index: buildIndex(entries) };
      cache.set(src.id, loaded);
      lastError.delete(src.id);
      return loaded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError.set(src.id, message);
      // A copy we already hold keeps serving; with none, the failure is reported.
      if (hit) return hit;
      throw err;
    } finally {
      inflight.delete(src.id);
    }
  })();
  inflight.set(src.id, p);
  return p;
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

export async function screenSanctions(names: string[], kind: "person" | "entity"): Promise<{ hits: ListHit[]; statuses: ListStatus[] }> {
  const results = await Promise.allSettled(LIST_SOURCES.map((s) => loadSource(s)));
  const hits: ListHit[] = [];
  const statuses: ListStatus[] = [];
  results.forEach((r, i) => {
    const src = LIST_SOURCES[i];
    if (r.status === "fulfilled") {
      hits.push(...screenAgainst(r.value, names, kind));
      statuses.push({ id: src.id, label: src.label, searchUrl: src.searchUrl, status: "ok", entries: r.value.entries.length, asOf: new Date(r.value.fetchedAt).toISOString(), stale: Date.now() - r.value.fetchedAt >= TTL_MS });
    } else {
      statuses.push({ id: src.id, label: src.label, searchUrl: src.searchUrl, status: "unavailable", error: lastError.get(src.id) ?? (r.reason instanceof Error ? r.reason.message : String(r.reason)) });
    }
  });
  return { hits: hits.sort((a, b) => b.score - a.score), statuses };
}
