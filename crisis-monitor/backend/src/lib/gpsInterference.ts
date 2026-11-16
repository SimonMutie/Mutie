import type { Env } from "../bindings";

/**
 * GPS interference over Africa and the Red Sea, read from aircraft broadcasts.
 *
 * Aircraft with ADS-B transponders broadcast how sure they are of their own position (NACp, from satellite
 * navigation). When several aircraft in the same area report poor accuracy, the satellite signal there is being
 * jammed or spoofed, or is otherwise degraded. This is the method public interference maps use; a single aircraft
 * with poor accuracy can be a faulty receiver, so an area needs several aircraft before it is shown.
 *
 * Source: adsb.lol, a community ADS-B network whose data is open (ODbL, attribution required). Each cron tick reads
 * a few of the areas below, in rotation, and records each aircraft once per area square and day. A square is
 * 0.5 degrees (about 55 km) on a side.
 */
export const GPS_SOURCE = "https://api.adsb.lol/v2/point";
/** Centres of the areas read, with a radius of 250 nautical miles (about 460 km) each. */
export const GPS_AREAS: { name: string; lat: number; lon: number }[] = [
  { name: "Northern Red Sea and Suez", lat: 28.0, lon: 33.5 },
  { name: "Central Red Sea and Port Sudan", lat: 20.0, lon: 38.0 },
  { name: "Bab al-Mandab and Eritrea", lat: 14.0, lon: 42.0 },
  { name: "Gulf of Aden and Somaliland", lat: 11.5, lon: 47.5 },
  { name: "Cairo and the Nile delta", lat: 30.5, lon: 31.0 },
  { name: "Eastern Libya", lat: 31.5, lon: 21.0 },
  { name: "Western Libya and Tunisia", lat: 33.0, lon: 12.5 },
  { name: "Khartoum and central Sudan", lat: 15.5, lon: 32.5 },
  { name: "Darfur and Chad border", lat: 13.5, lon: 24.5 },
  { name: "Ethiopian highlands", lat: 9.5, lon: 38.5 },
  { name: "Mogadishu and southern Somalia", lat: 2.5, lon: 45.0 },
  { name: "Nairobi and the Great Lakes", lat: -1.5, lon: 34.5 },
  { name: "Lake Chad", lat: 12.5, lon: 14.5 },
  { name: "Central Sahel", lat: 13.5, lon: 2.0 },
];
const AREAS_PER_TICK = 4;
const RADIUS_NM = 250;
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

/** The ADS-B aircraft in one area response that carry an accuracy figure. MLAT and other position sources are left out: they do not report NACp. */
export function readAircraft(body: unknown): AircraftReading[] {
  const list = (body as { ac?: unknown[] } | null)?.ac;
  if (!Array.isArray(list)) return [];
  const out: AircraftReading[] = [];
  for (const a of list as Record<string, unknown>[]) {
    const hex = typeof a.hex === "string" ? a.hex.toLowerCase() : null;
    const lat = typeof a.lat === "number" ? a.lat : null;
    const lon = typeof a.lon === "number" ? a.lon : null;
    const type = typeof a.type === "string" ? a.type : "";
    if (!hex || lat === null || lon === null || !type.startsWith("adsb")) continue;
    if (typeof a.nac_p !== "number") continue;
    out.push({ hex, lat, lon, poor: a.nac_p < POOR_NACP });
  }
  return out;
}

export function cellOf(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL) * CELL}:${Math.floor(lon / CELL) * CELL}`;
}

const ready = new WeakSet<object>();
async function ensureSchema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS gps_aircraft (day TEXT NOT NULL, cell TEXT NOT NULL, hex TEXT NOT NULL, poor INTEGER NOT NULL, PRIMARY KEY (day, cell, hex))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS gps_areas (name TEXT PRIMARY KEY, read_at TEXT NOT NULL, status TEXT NOT NULL, aircraft INTEGER NOT NULL)`),
  ]);
  ready.add(db);
}

type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { headers: { Accept: "application/json", "User-Agent": "TheLens/1.0 (crisis monitoring)" }, signal: AbortSignal.timeout(15000) });

/** One cron tick: the areas read longest ago, a few at a time. */
export async function collectGpsInterference(env: Env, fetcher: Fetcher = defaultFetch, now: Date = new Date()): Promise<{ read: string[]; aircraft: number }> {
  const db = env.DB;
  await ensureSchema(db);
  const rows = await db.prepare(`SELECT name, read_at FROM gps_areas`).all<{ name: string; read_at: string }>();
  const readAt = new Map((rows.results ?? []).map((r) => [r.name, r.read_at]));
  const due = [...GPS_AREAS].sort((a, b) => (readAt.get(a.name) ?? "").localeCompare(readAt.get(b.name) ?? "")).slice(0, AREAS_PER_TICK);
  const day = now.toISOString().slice(0, 10);
  let total = 0;
  for (const area of due) {
    let status = "ok";
    let aircraft: AircraftReading[] = [];
    try {
      const res = await fetcher(`${GPS_SOURCE}/${area.lat}/${area.lon}/${RADIUS_NM}`);
      if (!res.ok) status = `adsb.lol returned ${res.status}`;
      else aircraft = readAircraft(await res.json());
    } catch (err) {
      status = `could not be reached: ${err instanceof Error ? err.message : String(err)}`;
    }
    for (let i = 0; i < aircraft.length; i += 80) {
      await db.batch(
        aircraft.slice(i, i + 80).map((a) =>
          db
            .prepare(`INSERT INTO gps_aircraft (day, cell, hex, poor) VALUES (?,?,?,?) ON CONFLICT(day, cell, hex) DO UPDATE SET poor = MAX(poor, excluded.poor)`)
            .bind(day, cellOf(a.lat, a.lon), a.hex, a.poor ? 1 : 0)
        )
      );
    }
    total += aircraft.length;
    await db
      .prepare(`INSERT INTO gps_areas (name, read_at, status, aircraft) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET read_at = excluded.read_at, status = excluded.status, aircraft = excluded.aircraft`)
      .bind(area.name, now.toISOString(), status, aircraft.length)
      .run();
  }
  await db.prepare(`DELETE FROM gps_aircraft WHERE day < ?`).bind(new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)).run();
  return { read: due.map((a) => a.name), aircraft: total };
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
  const areas = await db.prepare(`SELECT name, read_at, status, aircraft FROM gps_areas`).all<{ name: string; read_at: string; status: string; aircraft: number }>();
  return {
    cells: summariseCells(rows.results ?? []),
    areas: GPS_AREAS.map((a) => {
      const r = (areas.results ?? []).find((x) => x.name === a.name);
      return { name: a.name, readAt: r?.read_at ?? null, status: r?.status ?? "not read yet", aircraft: r?.aircraft ?? 0 };
    }),
    since,
    method: `Aircraft broadcasting poor position accuracy (NACp below ${POOR_NACP}) as a share of all ADS-B aircraft seen in each 0.5-degree square since ${since}. Squares with fewer than ${MIN_AIRCRAFT} aircraft are not shown. High: over ${HIGH_SHARE * 100}%. Medium: over ${MEDIUM_SHARE * 100}%. Poor accuracy is a sign of jamming or spoofing, not proof of it.`,
    attribution: "Aircraft data: adsb.lol (ODbL)",
  };
}
