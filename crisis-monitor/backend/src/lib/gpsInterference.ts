/**
 * GPS interference over Africa and the Red Sea, read from aircraft broadcasts.
 *
 * Aircraft with ADS-B transponders broadcast how sure they are of their own position (NACp, from satellite
 * navigation). When several aircraft in the same area report poor accuracy, the satellite signal there is being
 * jammed or spoofed, or is otherwise degraded. This is the method public interference maps use; a single aircraft
 * with poor accuracy can be a faulty receiver, so an area needs several aircraft before it is shown.
 *
 * Source: adsb.lol, a community ADS-B network whose data is open (ODbL, attribution required), read every five
 * minutes by the aircraft collector (lib/aircraftCollector.ts) over Africa and the Middle East. Each aircraft is
 * recorded once per square and day. A square is 0.5 degrees (about 55 km) on a side.
 */
const CELL = 0.5;
const KEEP_DAYS = 8;
/** NACp below 8 means the aircraft is unsure of its position by more than 93 m: poor for an airliner. */
export const POOR_NACP = 8;
/** Fewest distinct aircraft in a square before it is shown. */
export const MIN_AIRCRAFT = 3;
/** Share of aircraft with poor accuracy above which a square is "high" or "medium", as public maps use. */
export const HIGH_SHARE = 0.1;
export const MEDIUM_SHARE = 0.02;

export interface AircraftReading {
  hex: string;
  lat: number;
  lon: number;
  poor: boolean;
}

/** The aircraft that carry an accuracy figure, marked poor or not. */
export function readingsFrom(aircraft: { hex: string; lat: number; lon: number; nacp: number | null }[]): AircraftReading[] {
  return aircraft.filter((a) => a.nacp !== null).map((a) => ({ hex: a.hex, lat: a.lat, lon: a.lon, poor: (a.nacp as number) < POOR_NACP }));
}

export function cellOf(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL) * CELL}:${Math.floor(lon / CELL) * CELL}`;
}

const ready = new WeakSet<object>();
async function ensureSchema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS gps_aircraft (day TEXT NOT NULL, cell TEXT NOT NULL, hex TEXT NOT NULL, poor INTEGER NOT NULL, PRIMARY KEY (day, cell, hex))`).run();
  ready.add(db);
}

/** Records one collection's readings: each aircraft once per square and day, marked poor if it ever was. */
export async function recordGpsReadings(db: D1Database, readings: AircraftReading[], now: Date = new Date()): Promise<void> {
  await ensureSchema(db);
  const day = now.toISOString().slice(0, 10);
  // Several rows per statement keeps the number of statements down; D1 allows 100 bound values in one.
  const ROWS = 25;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < readings.length; i += ROWS) {
    const part = readings.slice(i, i + ROWS);
    stmts.push(
      db
        .prepare(`INSERT INTO gps_aircraft (day, cell, hex, poor) VALUES ${part.map(() => "(?,?,?,?)").join(",")} ON CONFLICT(day, cell, hex) DO UPDATE SET poor = MAX(poor, excluded.poor)`)
        .bind(...part.flatMap((r) => [day, cellOf(r.lat, r.lon), r.hex, r.poor ? 1 : 0]))
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  if (now.getUTCMinutes() < 5) await db.prepare(`DELETE FROM gps_aircraft WHERE day < ?`).bind(new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)).run();
}

export interface GpsCell {
  lat: number;
  lon: number;
  aircraft: number;
  poor: number;
  share: number;
  level: "low" | "medium" | "high";
}

export function levelOf(share: number): GpsCell["level"] {
  return share > HIGH_SHARE ? "high" : share > MEDIUM_SHARE ? "medium" : "low";
}

export function summariseCells(rows: { cell: string; aircraft: number; poor: number }[]): GpsCell[] {
  return rows
    .filter((r) => r.aircraft >= MIN_AIRCRAFT)
    .map((r) => {
      const [lat, lon] = r.cell.split(":").map(Number);
      const share = r.poor / r.aircraft;
      return { lat: lat + CELL / 2, lon: lon + CELL / 2, aircraft: r.aircraft, poor: r.poor, share, level: levelOf(share) };
    });
}

/** Squares for the last `days` UTC days (each aircraft counted once per square), with the state of each area read. */
export async function gpsInterference(db: D1Database, days = 2, now: Date = new Date()) {
  await ensureSchema(db);
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .prepare(`SELECT cell, COUNT(DISTINCT hex) AS aircraft, COUNT(DISTINCT CASE WHEN poor = 1 THEN hex END) AS poor FROM gps_aircraft WHERE day >= ? GROUP BY cell`)
    .bind(since)
    .all<{ cell: string; aircraft: number; poor: number }>();
  return {
    cells: summariseCells(rows.results ?? []),
    since,
    method: `Aircraft broadcasting poor position accuracy (NACp below ${POOR_NACP}) as a share of all ADS-B aircraft seen in each 0.5-degree square since ${since}. Squares with fewer than ${MIN_AIRCRAFT} aircraft are not shown. High: over ${HIGH_SHARE * 100}%. Medium: over ${MEDIUM_SHARE * 100}%. Poor accuracy is a sign of jamming or spoofing, not proof of it.`,
    attribution: "Aircraft data: adsb.lol (ODbL)",
  };
}
