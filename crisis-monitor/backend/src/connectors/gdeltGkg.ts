import { unzipSync } from "fflate";
import type { Env } from "../bindings";

/**
 * GDELT's GKG (Global Knowledge Graph) bulk files — the second of the three
 * zip files GDELT publishes every 15 minutes alongside the Event Export
 * already ingested by gdeltBulk.ts (same lastupdate.txt index, same
 * unauthenticated static-file download, same zero rate-limit exposure: see
 * that file's doc comment for why this whole bulk-file family is the right
 * way to pull real volume out of GDELT without touching the rate-limited
 * live DOC 2.0 query API at all).
 *
 * Why this is worth a second ingestion pipeline rather than just pulling
 * more out of Event Export: Event Export only carries CAMEO-coded
 * actor-to-actor interactions (a protest, a clash) plus a per-event tone
 * score. GKG is built from the article text itself and carries two things
 * Event Export has no equivalent of:
 *   - V1COUNTS: every "N killed / N wounded / N displaced / N kidnapped /
 *     N arrested"-shaped count GDELT's NLP found mentioned in the article
 *     text, each tagged with a type (KILL/WOUND/DISPLACED/KIDNAP/ARREST/
 *     etc.) and a number — a real casualty/displacement signal with no
 *     Event Export analogue.
 *   - A per-article average tone (V1.5TONE) independent of whether GDELT
 *     could CAMEO-code any actor interaction in the piece at all, so
 *     coverage with no identified actor pair (an unattributed bombing, a
 *     natural disaster) still gets a relevance signal here even when it
 *     would produce nothing in Event Export.
 *
 * Column layout verified directly against GDELT's own GKG 2.1 codebook
 * (data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf)
 * rather than assumed — this is a 27-column, semicolon/hash-delimited format
 * that's easy to get subtly wrong, so only the handful of fields actually
 * used below are parsed, and only once confirmed against that document.
 *
 * Scope note: GDELT's third 15-minute bulk file, Mentions (which tracks
 * repeat coverage of the same event — an amplification/resonance signal,
 * not a new event source), is deliberately NOT ingested here. It adds a
 * third schema to get right for a lower-value signal than GKG's casualty
 * counts; left as a clean follow-up rather than rushed in alongside this.
 */

const LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const RETENTION_DAYS = 14;
const GKG_COLUMN_COUNT = 27;

// GKG 2.1 column indices (0-based) — see module doc comment for the source.
const COL_RECORD_ID = 0;
const COL_DATE = 1; // V2.1DATE, YYYYMMDDHHMMSS
const COL_SOURCE_NAME = 3; // V2SOURCECOMMONNAME
const COL_DOCUMENT_URL = 4; // V2DOCUMENTIDENTIFIER
const COL_COUNTS = 5; // V1COUNTS — the V2.1COUNTS column (6) carries the same leading fields plus extra char-offset fields we don't need, so V1 is the simpler, sufficient one to parse
const COL_LOCATIONS = 10; // V2ENHANCEDLOCATIONS
const COL_TONE = 15; // V1.5TONE

/** Count-mention types that signal real human impact worth surfacing
 *  alongside the article's tone — the same kind of signal a conflict
 *  analyst scans a report for by hand. Anything else GDELT's NLP counted
 *  (e.g. generic "ARREST" of a single person in an unrelated story) is left
 *  out rather than treated as conflict-relevant on its own. */
const IMPACT_COUNT_TYPES = new Set(["KILL", "WOUND", "DISPLACED", "KIDNAP"]);

function parseFloatOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** V1COUNTS entries look like "KILL#12#CRISISLEX_...#1#Kenya#KE#...#-1.28#36.8#...;WOUND#4#...". Each
 *  semicolon-separated entry's first two "#"-fields (type, count) are
 *  stable across the V1/V2.1 variants — only the trailing offset fields
 *  differ — so only those two are read, picking the single largest
 *  impact-typed count rather than trying to reconcile several into one
 *  number (a story mentioning both a death toll and an unrelated arrest
 *  count isn't double-counted). */
function extractPeakImpactCount(countsField: string): { type: string; count: number } | null {
  let best: { type: string; count: number } | null = null;
  for (const entry of countsField.split(";")) {
    const parts = entry.split("#");
    const type = parts[0]?.toUpperCase();
    const count = Number.parseInt(parts[1] ?? "", 10);
    if (!type || !IMPACT_COUNT_TYPES.has(type) || !Number.isFinite(count)) continue;
    if (!best || count > best.count) best = { type, count };
  }
  return best;
}

/** V2ENHANCEDLOCATIONS entries are "#"-delimited:
 *  Type#FullName#CountryCode#ADM1#ADM2#Lat#Lon#FeatureID, several of these
 *  joined with ";" per article. Takes the first entry with a parseable
 *  lat/lon rather than every location mentioned — same "one point to plot"
 *  simplification gdeltBulk.ts's Event Export parsing already makes. */
function extractFirstLocation(locationsField: string): { lat: number; lon: number; placeName: string } | null {
  for (const entry of locationsField.split(";")) {
    const parts = entry.split("#");
    const lat = parseFloatOrNull(parts[5]);
    const lon = parseFloatOrNull(parts[6]);
    if (lat === null || lon === null) continue;
    return { lat, lon, placeName: parts[1] || "Unknown location" };
  }
  return null;
}

function findGkgUrl(lastUpdateText: string): string | null {
  const line = lastUpdateText.split("\n").find((l) => l.includes(".gkg.csv.zip"));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  return parts[parts.length - 1] ?? null;
}

function parseGkgTimestamp(url: string): string | null {
  const match = url.match(/(\d{14})\.gkg\.csv\.zip/);
  return match ? match[1] : null;
}

async function ensureTable(env: Env): Promise<void> {
  // Self-provisioned the same way lib/gdeltAdaptiveBudget.ts's table is —
  // this app's D1 schema is otherwise applied by hand via
  // `wrangler d1 execute` with no migration files checked into the repo
  // (see gdeltBulk.ts's "migration_023" comment), so a brand-new table adds
  // zero deploy-time risk only if it creates itself on first use like this.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS gdelt_gkg_events (
      id TEXT PRIMARY KEY,
      date_added TEXT NOT NULL,
      source_name TEXT,
      document_url TEXT,
      avg_tone REAL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      place_name TEXT,
      impact_type TEXT,
      impact_count INTEGER,
      ingested_at TEXT NOT NULL
    )`
  ).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_gdelt_gkg_date_added ON gdelt_gkg_events (date_added)`).run();
}

async function getState(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM gdelt_ingest_state WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setState(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO gdelt_ingest_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export interface GkgIngestResult {
  skipped: boolean;
  reason?: string;
  fileTimestamp?: string;
  insertedRows?: number;
}

/** Same shape as gdeltBulk.ts's ingestGdeltBulkEvents: cheap to call every
 *  5-minute cron tick (lastupdate.txt is tiny), only downloads+parses the
 *  actual GKG zip when it's a genuinely new file. A row is kept only if it
 *  has a plottable location AND (sharply negative tone OR a real
 *  impact-typed count) — same "both signals, either one qualifies" shape
 *  as the Event Export filter, so this doesn't flood the table with every
 *  routine/cooperative article GDELT's NLP touched. */
export async function ingestGdeltGkg(env: Env): Promise<GkgIngestResult> {
  await ensureTable(env);

  const lastUpdateRes = await fetch(LASTUPDATE_URL, { signal: AbortSignal.timeout(10000) });
  if (!lastUpdateRes.ok) return { skipped: true, reason: `lastupdate.txt returned ${lastUpdateRes.status}` };
  const lastUpdateText = await lastUpdateRes.text();
  const gkgUrl = findGkgUrl(lastUpdateText);
  const fileTimestamp = gkgUrl ? parseGkgTimestamp(gkgUrl) : null;
  if (!gkgUrl || !fileTimestamp) return { skipped: true, reason: "could not parse lastupdate.txt for a GKG entry" };

  const lastSeen = await getState(env, "last_gkg_timestamp");
  if (lastSeen === fileTimestamp) return { skipped: true, reason: "already ingested this GKG export", fileTimestamp };

  const zipRes = await fetch(gkgUrl, { signal: AbortSignal.timeout(20000) });
  if (!zipRes.ok) return { skipped: true, reason: `GKG zip returned ${zipRes.status}`, fileTimestamp };
  const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
  const unzipped = unzipSync(zipBuf);
  const csvFileName = Object.keys(unzipped)[0];
  if (!csvFileName) return { skipped: true, reason: "GKG zip had no entries", fileTimestamp };
  const csvText = new TextDecoder().decode(unzipped[csvFileName]);

  const nowIso = new Date().toISOString();
  const TONE_OVERRIDE_THRESHOLD = -5; // same threshold gdeltBulk.ts uses for Event Export, kept identical for a consistent definition of "conflict-toned" across both tables
  const stmts: D1PreparedStatement[] = [];
  let parsedCount = 0;

  for (const line of csvText.split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < GKG_COLUMN_COUNT) continue;

    const id = cols[COL_RECORD_ID];
    const dateAdded = cols[COL_DATE];
    if (!id || !dateAdded) continue;

    const location = extractFirstLocation(cols[COL_LOCATIONS] ?? "");
    if (!location) continue; // no plottable point — nothing to map

    const avgTone = parseFloatOrNull((cols[COL_TONE] ?? "").split(",")[0]);
    const impact = extractPeakImpactCount(cols[COL_COUNTS] ?? "");
    const isSharplyNegative = avgTone !== null && avgTone <= TONE_OVERRIDE_THRESHOLD;
    if (!impact && !isSharplyNegative) continue; // neither signal fired

    parsedCount++;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO gdelt_gkg_events (id, date_added, source_name, document_url, avg_tone, lat, lon, place_name, impact_type, impact_count, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      ).bind(
        id,
        dateAdded,
        cols[COL_SOURCE_NAME] || null,
        cols[COL_DOCUMENT_URL] || null,
        avgTone,
        location.lat,
        location.lon,
        location.placeName,
        impact?.type ?? null,
        impact?.count ?? null,
        nowIso
      )
    );
  }

  const BATCH_SIZE = 50;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await env.DB.batch(stmts.slice(i, i + BATCH_SIZE));
  }

  const cutoff = (() => {
    const iso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19);
  })();
  await env.DB.prepare("DELETE FROM gdelt_gkg_events WHERE date_added < ?").bind(cutoff).run();

  await setState(env, "last_gkg_timestamp", fileTimestamp);
  return { skipped: false, fileTimestamp, insertedRows: parsedCount };
}

export interface GkgPoint {
  id: string;
  lat: number;
  lon: number;
  placeName: string;
  sourceName: string | null;
  documentUrl: string | null;
  avgTone: number | null;
  impactType: string | null;
  impactCount: number | null;
  dateAdded: string;
}

interface GkgRow {
  id: string;
  lat: number;
  lon: number;
  place_name: string;
  source_name: string | null;
  document_url: string | null;
  avg_tone: number | null;
  impact_type: string | null;
  impact_count: number | null;
  date_added: string;
}

/** Reads back ingested GKG rows for a map layer — mirrors gdeltBulk.ts's
 *  queryBulkEvents shape so a future layer route can follow the same
 *  pattern. Not wired into any route yet (no UI consumes this table yet);
 *  this is the data-availability half of that, left for whenever the
 *  casualty/displacement-count layer is actually built. */
export async function queryGkgEvents(env: Env, opts: { hours: number }): Promise<GkgPoint[]> {
  const cutoff = (() => {
    const iso = new Date(Date.now() - opts.hours * 60 * 60 * 1000).toISOString();
    return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19);
  })();
  const { results } = await env.DB.prepare(
    `SELECT id, lat, lon, place_name, source_name, document_url, avg_tone, impact_type, impact_count, date_added
     FROM gdelt_gkg_events WHERE date_added >= ? ORDER BY date_added DESC LIMIT 2000`
  )
    .bind(cutoff)
    .all<GkgRow>();
  return (results ?? []).map((r) => ({
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    placeName: r.place_name,
    sourceName: r.source_name,
    documentUrl: r.document_url,
    avgTone: r.avg_tone,
    impactType: r.impact_type,
    impactCount: r.impact_count,
    dateAdded: r.date_added,
  }));
}
