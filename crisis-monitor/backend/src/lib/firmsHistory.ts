import type { Env } from "../bindings";

/**
 * Keeps a running history of NASA FIRMS satellite fire detections in D1, so the
 * map can show a timeline (the last 30 days, and growing) instead of only the
 * live 24-hour and 7-day windows.
 *
 * The collector runs from the Worker's cron (see index.ts scheduled()). Each run
 * pulls the FIRMS 7-day window for the same regions and satellites the live
 * route uses, then stores every detection under the same id the live route
 * uses, so repeated runs over the overlapping 7-day window are harmless
 * (INSERT OR IGNORE). Runs are spaced about three hours apart: a 7-day window
 * refreshed that often never leaves a gap.
 *
 * Needs FIRMS_MAP_KEY. Without it the collector does nothing and says why.
 */

/** Same regions and satellites as the live route in routes/liveLayers.ts. */
export const FIRMS_HISTORY_REGIONS = ["Northern_and_Central_Africa", "Southern_Africa"] as const;
export const FIRMS_HISTORY_SATELLITES = {
  noaa20: "NOAA-20 (VIIRS)",
  snpp: "Suomi NPP (VIIRS)",
  noaa21: "NOAA-21 (VIIRS)",
} as const;
export type FireSatellite = keyof typeof FIRMS_HISTORY_SATELLITES;

/** South, west, north, east, as the live route uses it. */
const BBOX = "-35,-18,38,52";
/** WFS page size and the most pages fetched per region and satellite in one run (about 100,000 detections). */
const PAGE = 5000;
const MAX_PAGES = 20;
/** Gap between collection runs. */
const MIN_INTERVAL_MS = 3 * 3600_000;
/** A run that has not finished within this time is treated as dead, so a stuck run cannot block the next. */
const IN_FLIGHT_MS = 15 * 60_000;
const RUN_KEY = "firms";

const schemaReady = new WeakSet<object>();

/** Creates the tables on first use. Safe to call repeatedly (IF NOT EXISTS), and once per isolate it is a no-op. */
export async function ensureFireHistorySchema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS fire_detections (
      id TEXT PRIMARY KEY,
      acq_date TEXT NOT NULL,
      acq_time TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      satellite TEXT NOT NULL,
      frp REAL,
      confidence TEXT,
      daynight TEXT,
      collected_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fire_detections_date ON fire_detections (acq_date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fire_collector_runs (
      run_key TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT,
      fetched INTEGER,
      inserted INTEGER,
      truncated TEXT,
      error TEXT
    )`),
  ]);
  schemaReady.add(db);
}

export interface FireCollectResult {
  skipped: boolean;
  reason?: string;
  fetched: number;
  inserted: number;
  /** Region and satellite pairs where the page cap was reached, so the run may have missed detections. */
  truncated: string[];
  errors: string[];
}

interface FetchedFeature {
  lat: number;
  lon: number;
  satellite: FireSatellite;
  date: string;
  time: string;
  frp: number;
  confidence: string;
  daynight: string | null;
}

async function fetchJob(key: string, region: string, sat: FireSatellite, window: "24hrs" | "7days"): Promise<{ features: FetchedFeature[]; truncated: boolean }> {
  const source = `fires_${sat}_${window}`;
  const features: FetchedFeature[] = [];
  let start = 0;
  let previousFirstId: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://firms.modaps.eosdis.nasa.gov/mapserver/wfs/${region}/${encodeURIComponent(key)}/?SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0&TYPENAME=ms:${source}&STARTINDEX=${start}&COUNT=${PAGE}&SRSNAME=urn:ogc:def:crs:EPSG::4326&BBOX=${BBOX},urn:ogc:def:crs:EPSG::4326&outputformat=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`FIRMS ${region} ${sat} returned ${res.status}`);
    const data = (await res.json()) as { features?: { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }[] };
    const batch = data.features ?? [];
    if (batch.length === 0) return { features, truncated: false };

    // Guard against a server that ignores STARTINDEX and keeps returning the same first page.
    const firstId = JSON.stringify(batch[0]?.properties ?? null) + JSON.stringify(batch[0]?.geometry ?? null);
    if (firstId === previousFirstId) return { features, truncated: false };
    previousFirstId = firstId;

    for (const f of batch) {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const p = f.properties ?? {};
      if (typeof p.acq_date !== "string") continue;
      const time = typeof p.acq_time === "string" || typeof p.acq_time === "number" ? String(p.acq_time).padStart(4, "0") : "0000";
      const frp = typeof p.frp === "number" ? p.frp : Number(p.frp) || 0;
      features.push({
        lat: lat as number,
        lon: lon as number,
        satellite: sat,
        date: p.acq_date,
        time,
        frp,
        confidence: p.confidence != null ? String(p.confidence) : "",
        daynight: typeof p.daynight === "string" ? p.daynight : null,
      });
    }
    if (batch.length < PAGE) return { features, truncated: false };
    start += PAGE;
  }
  return { features, truncated: true };
}

/** Same shape as the live route's id, without its 24-hour or 7-day window suffix, so repeated runs over the overlapping window dedupe. */
export function fireDetectionId(lat: number, lon: number, date: string, time: string, sat: FireSatellite): string {
  return `firms:${lat.toFixed(4)}:${lon.toFixed(4)}:${date}:${time}:fires_${sat}`;
}

/** Stores one job's detections. Each job is written as soon as it is fetched, so a run cut short still keeps what it had. */
async function storeFeatures(db: D1Database, features: FetchedFeature[], collectedAt: string): Promise<number> {
  const stmt = `INSERT OR IGNORE INTO fire_detections (id, acq_date, acq_time, lat, lon, satellite, frp, confidence, daynight, collected_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  let inserted = 0;
  const CHUNK = 100;
  for (let i = 0; i < features.length; i += CHUNK) {
    const results = await db.batch(
      features.slice(i, i + CHUNK).map((f) =>
        db.prepare(stmt).bind(fireDetectionId(f.lat, f.lon, f.date, f.time, f.satellite), f.date, f.time, f.lat, f.lon, f.satellite, f.frp, f.confidence, f.daynight, collectedAt)
      )
    );
    for (const res of results) inserted += res.meta?.changes ?? 0;
  }
  return inserted;
}

/**
 * One collection run. The first successful run pulls the 7-day window to backfill the timeline. Later runs pull the
 * 24-hour window, which is a seventh of the size, so a run stays well inside the Worker's limits. Runs overlap, so
 * nothing is missed while the cron keeps running.
 */
export async function collectFireDetections(env: Env, now: Date = new Date()): Promise<FireCollectResult> {
  const key = env.FIRMS_MAP_KEY;
  if (!key) return { skipped: true, reason: "FIRMS_MAP_KEY is not set", fetched: 0, inserted: 0, truncated: [], errors: [] };
  const db = env.DB;
  await ensureFireHistorySchema(db);

  const last = await db
    .prepare(`SELECT started_at, finished_at, status FROM fire_collector_runs WHERE run_key = ?`)
    .bind(RUN_KEY)
    .first<{ started_at: string; finished_at: string | null; status: string | null }>();
  const nowMs = now.getTime();
  if (last) {
    const startedMs = Date.parse(last.started_at);
    const finishedMs = last.finished_at ? Date.parse(last.finished_at) : NaN;
    const inFlight = nowMs - startedMs < IN_FLIGHT_MS && !(finishedMs >= startedMs);
    if (inFlight) return { skipped: true, reason: "a run is already in progress", fetched: 0, inserted: 0, truncated: [], errors: [] };
    if (Number.isFinite(finishedMs) && nowMs - finishedMs < MIN_INTERVAL_MS) {
      return { skipped: true, reason: "last run was less than three hours ago", fetched: 0, inserted: 0, truncated: [], errors: [] };
    }
  }
  const window: "24hrs" | "7days" = last?.status === "ok" ? "24hrs" : "7days";

  await db
    .prepare(
      `INSERT INTO fire_collector_runs (run_key, started_at, finished_at, status, fetched, inserted, truncated, error)
       VALUES (?, ?, NULL, 'running', 0, 0, NULL, NULL)
       ON CONFLICT(run_key) DO UPDATE SET started_at = excluded.started_at, finished_at = NULL, status = 'running', error = NULL`
    )
    .bind(RUN_KEY, now.toISOString())
    .run();

  const jobs = FIRMS_HISTORY_REGIONS.flatMap((region) =>
    (Object.keys(FIRMS_HISTORY_SATELLITES) as FireSatellite[]).map((sat) => ({ region, sat }))
  );
  const errors: string[] = [];
  const truncated: string[] = [];
  let fetched = 0;
  let inserted = 0;
  // One job at a time: each is stored before the next starts.
  for (const job of jobs) {
    const label = `${job.region} ${job.sat}`;
    try {
      const got = await fetchJob(key, job.region, job.sat, window);
      if (got.truncated) truncated.push(label);
      fetched += got.features.length;
      inserted += await storeFeatures(db, got.features, new Date().toISOString());
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await db
    .prepare(
      `UPDATE fire_collector_runs SET finished_at = ?, status = ?, fetched = ?, inserted = ?, truncated = ?, error = ? WHERE run_key = ?`
    )
    .bind(
      new Date().toISOString(),
      errors.length === jobs.length ? "failed" : errors.length ? "partial" : "ok",
      fetched,
      inserted,
      truncated.length ? truncated.join("; ") : null,
      errors.length ? errors.join("; ") : null,
      RUN_KEY
    )
    .run();

  return { skipped: false, fetched, inserted, truncated, errors };
}
