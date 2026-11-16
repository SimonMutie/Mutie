import type { Env } from "../bindings";
import { fetchAdsbLolAircraft, type AircraftPosition } from "./aviationFeeds";
import { readingsFrom, recordGpsReadings } from "./gpsInterference";

/**
 * Collects aircraft over Africa and the Middle East every five minutes (from the cron), so the map reads a stored
 * picture instantly instead of asking 42 upstream areas on every view, and so flights can be traced afterwards.
 *
 *  - The latest picture is kept as one row (a compact list), replaced on each collection.
 *  - Every fifteen minutes each aircraft's position is added to its track, kept for three days.
 *    Set AIRCRAFT_HISTORY to "military" to keep tracks for military aircraft only, or "off" for none.
 *  - The same readings feed the GPS interference squares (lib/gpsInterference.ts).
 */
const COLLECT_EVERY_MS = 4 * 60_000;
const TRACK_EVERY_MS = 14 * 60_000;
export const TRACK_KEEP_HOURS = 72;

/** A stored aircraft: [hex, callsign, registration, type, military (0/1), lat, lon, altitude ft, speed kt, heading]. */
export type PackedAircraft = [string, string | null, string | null, string | null, 0 | 1, number, number, number | null, number | null, number | null];

export function pack(a: AircraftPosition): PackedAircraft {
  const r = (n: number | null, d: number) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);
  return [a.hex, a.callsign, a.registration, a.aircraftType, a.military ? 1 : 0, r(a.lat, 4)!, r(a.lon, 4)!, r(a.altitudeFt, 0), r(a.speedKts, 0), r(a.trackDeg, 0)];
}

const ready = new WeakSet<object>();
async function ensureSchema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS aircraft_snapshot (id INTEGER PRIMARY KEY, at TEXT NOT NULL, data TEXT NOT NULL, points_read INTEGER NOT NULL, points_failed INTEGER NOT NULL, track_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS aircraft_tracks (hex TEXT NOT NULL, ts TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, alt INTEGER, spd INTEGER, PRIMARY KEY (hex, ts))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_aircraft_tracks_ts ON aircraft_tracks (ts)`),
  ]);
  ready.add(db);
}

export interface AircraftSnapshot {
  at: string;
  aircraft: PackedAircraft[];
  pointsRead: number;
  pointsFailed: number;
}

export async function readSnapshot(db: D1Database): Promise<AircraftSnapshot | null> {
  await ensureSchema(db);
  const row = await db.prepare(`SELECT at, data, points_read, points_failed FROM aircraft_snapshot WHERE id = 1`).first<{ at: string; data: string; points_read: number; points_failed: number }>();
  if (!row) return null;
  try {
    return { at: row.at, aircraft: JSON.parse(row.data) as PackedAircraft[], pointsRead: row.points_read, pointsFailed: row.points_failed };
  } catch {
    return null;
  }
}

type Fetcher = Parameters<typeof fetchAdsbLolAircraft>[0];

export async function collectAircraft(env: Env, now: Date = new Date(), fetcher?: Fetcher): Promise<{ skipped: boolean; aircraft: number; tracked: number }> {
  const db = env.DB;
  await ensureSchema(db);
  const last = await db.prepare(`SELECT at, track_at FROM aircraft_snapshot WHERE id = 1`).first<{ at: string; track_at: string | null }>();
  if (last && now.getTime() - Date.parse(last.at) < COLLECT_EVERY_MS) return { skipped: true, aircraft: 0, tracked: 0 };

  const got = await fetchAdsbLolAircraft(fetcher);
  // A collection where nothing answered keeps the previous picture rather than wiping it.
  if (got.aircraft.length === 0) return { skipped: false, aircraft: 0, tracked: 0 };

  const packed = got.aircraft.map(pack);
  const history = (env as unknown as { AIRCRAFT_HISTORY?: string }).AIRCRAFT_HISTORY ?? "all";
  const trackDue = history !== "off" && (!last?.track_at || now.getTime() - Date.parse(last.track_at) >= TRACK_EVERY_MS);
  await db
    .prepare(
      `INSERT INTO aircraft_snapshot (id, at, data, points_read, points_failed, track_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET at = excluded.at, data = excluded.data, points_read = excluded.points_read, points_failed = excluded.points_failed, track_at = COALESCE(excluded.track_at, aircraft_snapshot.track_at)`
    )
    .bind(now.toISOString(), JSON.stringify(packed), got.pointsRead, got.pointsFailed, trackDue ? now.toISOString() : null)
    .run();

  let tracked = 0;
  if (trackDue) {
    const ts = now.toISOString().slice(0, 16);
    const keep = got.aircraft.filter((a) => history !== "military" || a.military);
    const ROWS = 16; // six values a row, under D1's 100 bound values a statement
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < keep.length; i += ROWS) {
      const part = keep.slice(i, i + ROWS);
      stmts.push(
        db
          .prepare(`INSERT OR IGNORE INTO aircraft_tracks (hex, ts, lat, lon, alt, spd) VALUES ${part.map(() => "(?,?,?,?,?,?)").join(",")}`)
          .bind(...part.flatMap((a) => [a.hex, ts, Math.round(a.lat * 1e4) / 1e4, Math.round(a.lon * 1e4) / 1e4, a.altitudeFt === null ? null : Math.round(a.altitudeFt), a.speedKts === null ? null : Math.round(a.speedKts)]))
      );
    }
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    tracked = keep.length;
    if (now.getUTCMinutes() < 15) await db.prepare(`DELETE FROM aircraft_tracks WHERE ts < ?`).bind(new Date(now.getTime() - TRACK_KEEP_HOURS * 3_600_000).toISOString().slice(0, 16)).run();
  }

  await recordGpsReadings(db, readingsFrom(got.aircraft), now).catch((err) => console.error("[gps] could not record", err));
  return { skipped: false, aircraft: packed.length, tracked };
}

export interface TrackPoint {
  t: string;
  lat: number;
  lon: number;
  alt: number | null;
  spd: number | null;
}

/** One aircraft's stored positions over the last `hours`, oldest first, ending with where it is now if it is in the latest picture. */
export async function aircraftTrack(db: D1Database, hex: string, hours: number): Promise<{ points: TrackPoint[]; current: PackedAircraft | null; snapshotAt: string | null }> {
  await ensureSchema(db);
  const since = new Date(Date.now() - Math.min(TRACK_KEEP_HOURS, Math.max(1, hours)) * 3_600_000).toISOString().slice(0, 16);
  const rows = await db
    .prepare(`SELECT ts, lat, lon, alt, spd FROM aircraft_tracks WHERE hex = ? AND ts >= ? ORDER BY ts`)
    .bind(hex.toLowerCase(), since)
    .all<{ ts: string; lat: number; lon: number; alt: number | null; spd: number | null }>();
  const snap = await readSnapshot(db);
  const current = snap?.aircraft.find((a) => a[0] === hex.toLowerCase()) ?? null;
  const points: TrackPoint[] = (rows.results ?? []).map((r) => ({ t: `${r.ts}:00Z`, lat: r.lat, lon: r.lon, alt: r.alt, spd: r.spd }));
  if (current && snap) points.push({ t: snap.at, lat: current[5], lon: current[6], alt: current[7], spd: current[8] });
  return { points, current, snapshotAt: snap?.at ?? null };
}
