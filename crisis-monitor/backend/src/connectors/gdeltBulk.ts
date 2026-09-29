import { unzipSync } from "fflate";
import type { Env } from "../bindings";

/**
 * GDELT's Event Export bulk files — published to plain HTTP, refreshed every
 * 15 minutes, with no auth and no query-rate throttling at all (it's a
 * static file download, not the shared ElasticSearch-backed query API that
 * conflict-events/global-incidents/activity-index/social-listening all hit
 * and occasionally get 429'd from). This is GDELT's own documented answer to
 * high-volume/rate-limited use:
 * https://blog.gdeltproject.org/ukraine-api-rate-limiting-web-ngrams-3-0/
 *
 * This module ingests those files into D1 (see migration_023) so the map
 * layers can be served straight from D1 instead of live-querying GDELT on
 * every poll. It is deliberately GLOBAL, not Africa-only: Activity Index
 * already tracks non-African hotspots (Ukraine, Myanmar, etc.) via GDELT,
 * and Global Incidents/Conflict Events are both advertised as global layers
 * — scoping ingestion to Africa would silently break those. What keeps row
 * volume manageable instead is a content filter: only CAMEO QuadClass 3
 * ("Verbal Conflict") and 4 ("Material Conflict") events are kept, since
 * that's the actual signal all three of these features are looking for —
 * most GDELT events are routine/cooperative and irrelevant to them anyway.
 *
 * What this does NOT replace: Social Listening's arbitrary boolean-query
 * search. GDELT's bulk export/GKG files carry structured event fields only
 * — no article titles — so they can't produce the readable headlines Social
 * Listening's "Top articles" list shows. That feature keeps using the live
 * DOC 2.0 API per query, which is a much smaller request volume now that
 * it's a manual, user-triggered fetch rather than an auto-poll.
 */

const LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const RETENTION_DAYS = 14;
const EXPORT_COLUMN_COUNT = 61;

// Column indices in GDELT's Event Export CSV (tab-separated, no header) —
// this exact 61-column layout has been stable since the 2.0 format launched
// in 2015; see the GDELT 2.0 Event codebook.
const COL_GLOBAL_EVENT_ID = 0;
const COL_SQLDATE = 1;
const COL_EVENT_CODE = 26;
const COL_QUAD_CLASS = 29;
const COL_GOLDSTEIN = 30;
const COL_NUM_MENTIONS = 31;
const COL_AVG_TONE = 34;
const COL_ACTION_GEO_FULLNAME = 52;
const COL_ACTION_GEO_LAT = 56;
const COL_ACTION_GEO_LONG = 57;
const COL_DATE_ADDED = 59;
const COL_SOURCE_URL = 60;

/** Formats a Date as GDELT's own DATEADDED shape (YYYYMMDDHHMMSS, UTC) so it
 *  string-compares correctly against that column. Exported for reuse by
 *  countryEscalation.ts, which runs its own aggregate queries against this
 *  table rather than going through queryBulkEvents(). */
export function toGdeltTimestamp(d: Date): string {
  const iso = d.toISOString(); // "2026-09-29T05:20:00.000Z"
  return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19);
}

function findExportUrl(lastUpdateText: string): string | null {
  const line = lastUpdateText.split("\n").find((l) => l.includes(".export.CSV.zip"));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  return parts[parts.length - 1] ?? null;
}

function parseExportTimestamp(url: string): string | null {
  const match = url.match(/(\d{14})\.export\.CSV\.zip/);
  return match ? match[1] : null;
}

async function getState(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM gdelt_ingest_state WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setState(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare("INSERT INTO gdelt_ingest_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export interface BulkIngestResult {
  skipped: boolean;
  reason?: string;
  fileTimestamp?: string;
  insertedRows?: number;
}

interface ParsedRow {
  id: string;
  eventDate: string;
  dateAdded: string;
  lat: number;
  lon: number;
  placeName: string;
  goldstein: number | null;
  numMentions: number | null;
  avgTone: number | null;
  eventCode: string;
  quadClass: number;
  sourceUrl: string;
}

function parseFloatOrNull(s: string): number | null {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseExportCsv(csvText: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const line of csvText.split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < EXPORT_COLUMN_COUNT) continue;
    const quadClass = Number.parseInt(cols[COL_QUAD_CLASS], 10);
    if (quadClass !== 3 && quadClass !== 4) continue; // conflict-toned only — see module doc comment
    const lat = Number.parseFloat(cols[COL_ACTION_GEO_LAT]);
    const lon = Number.parseFloat(cols[COL_ACTION_GEO_LONG]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // no usable point to plot
    const id = cols[COL_GLOBAL_EVENT_ID];
    const dateAdded = cols[COL_DATE_ADDED];
    if (!id || !dateAdded) continue;
    rows.push({
      id,
      eventDate: cols[COL_SQLDATE],
      dateAdded,
      lat,
      lon,
      placeName: cols[COL_ACTION_GEO_FULLNAME] || "Unknown location",
      goldstein: parseFloatOrNull(cols[COL_GOLDSTEIN]),
      numMentions: parseIntOrNull(cols[COL_NUM_MENTIONS]),
      avgTone: parseFloatOrNull(cols[COL_AVG_TONE]),
      eventCode: cols[COL_EVENT_CODE] || "",
      quadClass,
      sourceUrl: cols[COL_SOURCE_URL] || "",
    });
  }
  return rows;
}

/** One ingestion tick: checks GDELT's lastupdate.txt (a few hundred bytes,
 *  safe to check every cron tick even though the export itself only changes
 *  every 15 minutes), and only downloads+parses the actual export zip when
 *  it's a new file. Safe to call from a 5-minute cron — most ticks will find
 *  nothing new and return `skipped: true` almost immediately. */
export async function ingestGdeltBulkEvents(env: Env): Promise<BulkIngestResult> {
  const lastUpdateRes = await fetch(LASTUPDATE_URL, { signal: AbortSignal.timeout(10000) });
  if (!lastUpdateRes.ok) return { skipped: true, reason: `lastupdate.txt returned ${lastUpdateRes.status}` };
  const lastUpdateText = await lastUpdateRes.text();
  const exportUrl = findExportUrl(lastUpdateText);
  const fileTimestamp = exportUrl ? parseExportTimestamp(exportUrl) : null;
  if (!exportUrl || !fileTimestamp) return { skipped: true, reason: "could not parse lastupdate.txt" };

  const lastSeen = await getState(env, "last_export_timestamp");
  if (lastSeen === fileTimestamp) return { skipped: true, reason: "already ingested this export", fileTimestamp };

  const zipRes = await fetch(exportUrl, { signal: AbortSignal.timeout(20000) });
  if (!zipRes.ok) return { skipped: true, reason: `export zip returned ${zipRes.status}`, fileTimestamp };
  const zipBuf = new Uint8Array(await zipRes.arrayBuffer());
  const unzipped = unzipSync(zipBuf);
  const csvFileName = Object.keys(unzipped)[0];
  if (!csvFileName) return { skipped: true, reason: "export zip had no entries", fileTimestamp };
  const csvText = new TextDecoder().decode(unzipped[csvFileName]);

  const rows = parseExportCsv(csvText);
  const nowIso = new Date().toISOString();
  const BATCH_SIZE = 50;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((r) =>
      env.DB.prepare(
        `INSERT INTO gdelt_bulk_events (id, event_date, date_added, lat, lon, place_name, goldstein, num_mentions, avg_tone, event_code, quad_class, source_url, ingested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      ).bind(r.id, r.eventDate, r.dateAdded, r.lat, r.lon, r.placeName, r.goldstein, r.numMentions, r.avgTone, r.eventCode, r.quadClass, r.sourceUrl, nowIso)
    );
    await env.DB.batch(stmts);
  }

  // Retention — date_added is GDELT's own YYYYMMDDHHMMSS string, so a plain
  // string comparison against a same-format cutoff works correctly.
  const cutoff = toGdeltTimestamp(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000));
  await env.DB.prepare("DELETE FROM gdelt_bulk_events WHERE date_added < ?").bind(cutoff).run();

  await setState(env, "last_export_timestamp", fileTimestamp);
  return { skipped: false, fileTimestamp, insertedRows: rows.length };
}

export interface BulkEventPoint {
  id: string;
  lat: number;
  lon: number;
  placeName: string;
  goldstein: number | null;
  numMentions: number | null;
  avgTone: number | null;
  quadClass: number;
  sourceUrl: string;
  dateAdded: string;
}

interface BulkEventRow {
  id: string;
  lat: number;
  lon: number;
  place_name: string;
  goldstein: number | null;
  num_mentions: number | null;
  avg_tone: number | null;
  quad_class: number;
  source_url: string;
  date_added: string;
}

/** Reads back ingested events for the map layers — `minQuadClass: 4` for a
 *  narrower "material conflict only" feed (Conflict Events), omitted for
 *  the broader "verbal or material conflict" feed (Global Incidents,
 *  Activity Index). */
export async function queryBulkEvents(env: Env, opts: { hours: number; minQuadClass?: number }): Promise<BulkEventPoint[]> {
  const cutoff = toGdeltTimestamp(new Date(Date.now() - opts.hours * 60 * 60 * 1000));
  const base = "SELECT id, lat, lon, place_name, goldstein, num_mentions, avg_tone, quad_class, source_url, date_added FROM gdelt_bulk_events WHERE date_added >= ?";
  const stmt = opts.minQuadClass
    ? env.DB.prepare(`${base} AND quad_class >= ? ORDER BY date_added DESC LIMIT 2000`).bind(cutoff, opts.minQuadClass)
    : env.DB.prepare(`${base} ORDER BY date_added DESC LIMIT 2000`).bind(cutoff);
  const { results } = await stmt.all<BulkEventRow>();
  return (results ?? []).map((r) => ({
    id: r.id,
    lat: r.lat,
    lon: r.lon,
    placeName: r.place_name,
    goldstein: r.goldstein,
    numMentions: r.num_mentions,
    avgTone: r.avg_tone,
    quadClass: r.quad_class,
    sourceUrl: r.source_url,
    dateAdded: r.date_added,
  }));
}
