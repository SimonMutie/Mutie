/**
 * OFAC SDN sanctioned-entity lookup.
 *
 * Adapted (MIT license permits reuse) from OSIRIS
 * (github.com/simplifaisoul/osiris, src/lib/sanctions.ts) — same source,
 * same approach, ported onto this Worker's fetch/in-memory-cache pattern
 * instead of Next.js.
 *
 * Source: OpenSanctions (opensanctions.org) `us_ofac_sdn` dataset,
 * distributed as a CSV under CC-BY 4.0. OpenSanctions normalises the
 * upstream US Treasury SDN data into a flat schema, which is far easier to
 * consume than the raw SDN XML.
 *
 * The whole list (~7 MB, low-tens-of-thousands of entries) is downloaded
 * once on first use per Worker isolate and refreshed lazily every 24h —
 * the same "shared, process-wide cache" pattern already used elsewhere in
 * this backend (e.g. the OpenSky/satellite fetches in liveLayers.ts).
 * Concurrent requests that arrive while a fetch is in flight wait on the
 * same promise (single-flight). If a refresh fails after the cache has
 * gone stale, the previous snapshot keeps serving rather than going blind.
 */

const SDN_CSV_URL = "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv";

const TTL_MS = 24 * 60 * 60 * 1000;

export type Schema = "Person" | "Organization" | "Company" | "Vessel" | "Airplane" | "LegalEntity" | "Security" | string;

export interface SanctionEntry {
  id: string;
  schema: Schema;
  name: string;
  aliases: string[];
  countries: string[];
  programs: string[];
  sanctions: string;
  first_seen?: string;
  last_seen?: string;
}

interface LoadedList {
  fetchedAt: number;
  entries: SanctionEntry[];
  byNormName: Map<string, SanctionEntry[]>;
}

let cache: LoadedList | null = null;
let inflight: Promise<LoadedList> | null = null;

/** Lower-case, strip punctuation, collapse whitespace. Used for both index keys and incoming query normalisation. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal CSV parser tolerant of double-quoted fields with embedded commas, newlines and `""` escapes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignore — handled by the \n branch
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function loadList(): Promise<LoadedList> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(SDN_CSV_URL, { signal: AbortSignal.timeout(30_000), headers: { Accept: "text/csv" } });
      if (!res.ok) throw new Error(`OpenSanctions HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("OpenSanctions CSV empty");

      const headers = rows[0];
      const idx = (col: string) => headers.indexOf(col);
      const i = {
        id: idx("id"),
        schema: idx("schema"),
        name: idx("name"),
        aliases: idx("aliases"),
        countries: idx("countries"),
        programs: idx("program_ids"),
        sanctions: idx("sanctions"),
        first_seen: idx("first_seen"),
        last_seen: idx("last_seen"),
      };

      const entries: SanctionEntry[] = [];
      const byNormName = new Map<string, SanctionEntry[]>();

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row[i.name]) continue;
        const entry: SanctionEntry = {
          id: row[i.id] || "",
          schema: row[i.schema] || "LegalEntity",
          name: row[i.name],
          aliases: (row[i.aliases] || "").split(";").map((s) => s.trim()).filter(Boolean),
          countries: (row[i.countries] || "").split(";").map((s) => s.trim()).filter(Boolean),
          programs: (row[i.programs] || "").split(";").map((s) => s.trim()).filter(Boolean),
          sanctions: row[i.sanctions] || "",
          first_seen: i.first_seen >= 0 ? row[i.first_seen] : undefined,
          last_seen: i.last_seen >= 0 ? row[i.last_seen] : undefined,
        };
        entries.push(entry);

        const keys = new Set<string>([entry.name, ...entry.aliases].map(normName));
        for (const key of keys) {
          if (!key) continue;
          const list = byNormName.get(key);
          if (list) list.push(entry);
          else byNormName.set(key, [entry]);
        }
      }

      const loaded = { fetchedAt: Date.now(), entries, byNormName };
      cache = loaded;
      return loaded;
    } catch (e) {
      if (cache) return cache;
      throw e;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Strict exact-match lookup — the correct screen for a wallet/entity string where false positives must be avoided. */
export async function matchExact(query: string): Promise<SanctionEntry[]> {
  if (!query || query.length < 3) return [];
  const list = await loadList();
  return list.byNormName.get(normName(query)) ?? [];
}

/** Substring + contains search, ranked: exact name, exact alias, substring of name, substring of alias. */
export async function search(query: string, opts: { schema?: Schema; limit?: number } = {}): Promise<SanctionEntry[]> {
  if (!query || query.length < 4) return [];
  const list = await loadList();
  const q = normName(query);
  const limit = opts.limit ?? 50;

  const exactName: SanctionEntry[] = [];
  const exactAlias: SanctionEntry[] = [];
  const subName: SanctionEntry[] = [];
  const subAlias: SanctionEntry[] = [];
  const seen = new Set<string>();

  const push = (bucket: SanctionEntry[], e: SanctionEntry) => {
    if (seen.has(e.id)) return;
    if (opts.schema && e.schema !== opts.schema) return;
    seen.add(e.id);
    bucket.push(e);
  };

  for (const entry of list.entries) {
    const nameNorm = normName(entry.name);
    if (nameNorm === q) push(exactName, entry);
    else if (entry.aliases.some((a) => normName(a) === q)) push(exactAlias, entry);
    else if (nameNorm.includes(q)) push(subName, entry);
    else if (entry.aliases.some((a) => normName(a).includes(q))) push(subAlias, entry);
    if (seen.size >= limit * 4) break;
  }

  return [...exactName, ...exactAlias, ...subName, ...subAlias].slice(0, limit);
}

/** Number of indexed entries, for diagnostics. */
export async function indexSize(): Promise<number> {
  const list = await loadList();
  return list.entries.length;
}
