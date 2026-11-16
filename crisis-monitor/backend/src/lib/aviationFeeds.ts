/**
 * Aircraft positions for the Aviation layers when OpenSky cannot be reached.
 *
 * OpenSky refuses many requests from cloud servers (it answered the Lens with Cloudflare's 522, "connection timed
 * out"). adsb.lol is a free, open community network (ODbL) with no key at present. It has no single worldwide
 * snapshot, so the Lens asks for the aircraft within 250 nautical miles of a set of points that cover the air
 * routes of Africa and the Middle East, plus its worldwide list of military aircraft.
 */
export const ADSB_LOL = "https://api.adsb.lol/v2";

/** Centres of the circles read, chosen to cover the main air routes and capitals of Africa and the Middle East. */
export const AIRCRAFT_POINTS: [number, number][] = [
  // North Africa
  [33.5, -7], [36, 3], [34, 10], [31, 20], [30, 31], [24.5, 33],
  // Middle East
  [32.5, 36], [33, 44], [25, 46], [25, 55], [21, 40], [15, 45], [32, 52],
  // West Africa and the Sahel
  [14.5, -16], [9, -12], [6, -3], [7, 4], [12, 8.5], [13, 1.5], [12.5, -7.5], [18, -15],
  // Central Africa
  [12, 16], [4, 15], [-3.5, 15], [-1, 26],
  // East Africa and the Horn
  [15.5, 33], [9, 39], [2, 45], [-1.5, 37], [0.5, 31.5], [-6.5, 38.5], [11.5, 43.5],
  // Southern Africa and the islands
  [-13, 28], [-18, 31], [-26, 28], [-33.5, 19.5], [-19, 47], [-25.5, 32.5], [-12, 17], [-22.5, 17], [-20.5, 57.5],
];
const RADIUS_NM = 250;
const BATCH = 10;

export interface AircraftPosition {
  hex: string;
  callsign: string | null;
  lat: number;
  lon: number;
  speedKts: number | null;
  /** True when the adsb.lol aircraft database lists the airframe as military. */
  military: boolean;
  registration: string | null;
  aircraftType: string | null;
  /** Barometric altitude in feet. */
  altitudeFt: number | null;
  /** Heading over the ground, degrees from north. */
  trackDeg: number | null;
  /** Position accuracy category (NACp) broadcast by ADS-B aircraft; null for other position sources. Used for GPS interference. */
  nacp: number | null;
}

/** Airborne aircraft with a position, from one adsb.lol response. */
export function readAdsbLol(body: unknown): AircraftPosition[] {
  const list = (body as { ac?: unknown[] } | null)?.ac;
  if (!Array.isArray(list)) return [];
  const out: AircraftPosition[] = [];
  for (const a of list as Record<string, unknown>[]) {
    if (typeof a.hex !== "string" || typeof a.lat !== "number" || typeof a.lon !== "number") continue;
    if (a.alt_baro === "ground") continue;
    const flags = typeof a.dbFlags === "number" ? a.dbFlags : 0;
    const callsign = typeof a.flight === "string" && a.flight.trim() ? a.flight.trim() : null;
    out.push({
      hex: a.hex.replace(/^~/, "").toLowerCase(),
      callsign,
      lat: a.lat,
      lon: a.lon,
      speedKts: typeof a.gs === "number" ? a.gs : null,
      military: (flags & 1) === 1,
      registration: typeof a.r === "string" ? a.r : null,
      aircraftType: typeof a.t === "string" ? a.t : null,
      altitudeFt: typeof a.alt_baro === "number" ? a.alt_baro : null,
      trackDeg: typeof a.track === "number" ? a.track : null,
      nacp: typeof a.type === "string" && a.type.startsWith("adsb") && typeof a.nac_p === "number" ? a.nac_p : null,
    });
  }
  return out;
}

type Fetcher = (url: string) => Promise<Response>;
const defaultFetch: Fetcher = (url) => fetch(url, { headers: { Accept: "application/json", "User-Agent": "TheLens/1.0 (crisis monitoring)" }, signal: AbortSignal.timeout(12000) });

/** Every aircraft adsb.lol sees over Africa and the Middle East, plus its worldwide military list, each counted once. */
export async function fetchAdsbLolAircraft(fetcher: Fetcher = defaultFetch): Promise<{ aircraft: AircraftPosition[]; pointsRead: number; pointsFailed: number }> {
  const urls = [`${ADSB_LOL}/mil`, ...AIRCRAFT_POINTS.map(([lat, lon]) => `${ADSB_LOL}/point/${lat}/${lon}/${RADIUS_NM}`)];
  const byHex = new Map<string, AircraftPosition>();
  let failed = 0;
  for (let i = 0; i < urls.length; i += BATCH) {
    const results = await Promise.all(
      urls.slice(i, i + BATCH).map(async (url) => {
        try {
          const res = await fetcher(url);
          if (!res.ok) return null;
          return readAdsbLol(await res.json());
        } catch {
          return null;
        }
      })
    );
    for (const r of results) {
      if (!r) {
        failed++;
        continue;
      }
      for (const a of r) {
        const had = byHex.get(a.hex);
        byHex.set(a.hex, had ? { ...had, military: had.military || a.military } : a);
      }
    }
  }
  return { aircraft: [...byHex.values()], pointsRead: urls.length - failed, pointsFailed: failed };
}
