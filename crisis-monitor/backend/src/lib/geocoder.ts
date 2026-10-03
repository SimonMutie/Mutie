import type { Env } from "../bindings";
import { first, run, nowIso } from "../db";
import { isInOrNearCountry, lookupKnownPlace, looseKey, resolvePlaceOffline, type PlaceQuery, type ResolvedLocation } from "./africaGeo";

/**
 * Online geocoding for places the article names that are in neither the
 * curated gazetteer nor GeoNames (mostly villages). Uses OpenStreetMap's
 * Nominatim search, restricted to the country the article says the event is
 * in, and re-checked against that country's border before it is used.
 *
 * Every lookup — hit or miss — is cached in D1 (geocode_cache), so each
 * distinct place name costs at most one request, ever; a handful of new
 * names a day, well inside Nominatim's usage policy (max 1 request/second,
 * identifying User-Agent). Set GEOCODER_ENABLED = "false" to switch this
 * off; resolution then goes straight from the offline gazetteers to the
 * border-checked model estimate.
 *
 * Fails soft in every case: a timeout, a block, or no result just means the
 * offline fallback chain in africaGeo.resolvePlaceOffline() decides.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const TIMEOUT_MS = 6000;
const MISS_TTL_DAYS = 14;
let lastRequestAt = 0;

async function ensureTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS geocode_cache (
      key TEXT PRIMARY KEY,
      country_code TEXT NOT NULL,
      query TEXT NOT NULL,
      lat REAL,
      lon REAL,
      display_name TEXT,
      created_at TEXT NOT NULL
    )`
  ).run();
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name?: string;
}

async function queryNominatim(countryCode: string, q: string): Promise<{ lat: number; lon: number; displayName: string | null } | null> {
  // Nominatim's policy: no more than one request per second.
  const wait = lastRequestAt + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  // Western Sahara is mostly indexed under Morocco in OSM.
  const countrycodes = countryCode === "EH" ? "eh,ma" : countryCode.toLowerCase();
  const url = `${NOMINATIM_URL}?format=jsonv2&limit=3&accept-language=en&countrycodes=${countrycodes}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "TheLensCrisisMonitor/1.0 (https://afrilensconsulting.com)" },
  });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const results = (await res.json()) as NominatimResult[];
  for (const r of results ?? []) {
    const lat = Number.parseFloat(r.lat);
    const lon = Number.parseFloat(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Border check even though the search was country-restricted.
    if (countryCode !== "EH" && !isInOrNearCountry(countryCode, lat, lon)) continue;
    return { lat, lon, displayName: r.display_name ?? null };
  }
  return null;
}

export interface GeocodeBudget {
  remaining: number;
}

/** Full resolution chain for one coded report. Order:
 *    1. curated gazetteer / GeoNames (offline, authoritative)
 *    2. geocoder cache, then a live geocoder lookup (if budget allows)
 *    3. border-checked model estimate
 *    4. named region centroid
 *    5. country centroid
 *  Steps 3-5 are africaGeo.resolvePlaceOffline(). */
export async function resolvePlace(env: Env, q: PlaceQuery, budget: GeocodeBudget): Promise<ResolvedLocation> {
  const offline = resolvePlaceOffline(q);
  // Nothing to geocode, or the place is already known offline.
  if (!q.place || lookupKnownPlace(q.countryCode, q.place)) return offline;
  if ((env.GEOCODER_ENABLED ?? "true") === "false") return offline;

  const key = `${q.countryCode}:${looseKey(q.place)}:${q.admin1 ? looseKey(q.admin1) : ""}`;
  try {
    await ensureTable(env);
    const cached = await first<{ lat: number | null; lon: number | null; created_at: string }>(env.DB, "SELECT lat, lon, created_at FROM geocode_cache WHERE key = ?", [key]);
    if (cached) {
      if (cached.lat != null && cached.lon != null) {
        return { lat: cached.lat, lon: cached.lon, precision: "place", label: q.place, method: "geocoder" };
      }
      const ageDays = (Date.now() - Date.parse(cached.created_at)) / 86_400_000;
      if (ageDays < MISS_TTL_DAYS) return offline;
    }
    if (budget.remaining <= 0) return offline;
    budget.remaining--;

    const query = q.admin1 ? `${q.place}, ${q.admin1}` : q.place;
    let hit = await queryNominatim(q.countryCode, query);
    if (!hit && q.admin1 && budget.remaining > 0) {
      budget.remaining--;
      hit = await queryNominatim(q.countryCode, q.place);
    }
    await run(
      env.DB,
      `INSERT INTO geocode_cache (key, country_code, query, lat, lon, display_name, created_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, display_name = excluded.display_name, created_at = excluded.created_at`,
      [key, q.countryCode, query, hit?.lat ?? null, hit?.lon ?? null, hit?.displayName ?? null, nowIso()]
    );
    if (hit) return { lat: hit.lat, lon: hit.lon, precision: "place", label: q.place, method: "geocoder" };
  } catch (err) {
    console.error(`[geocoder] lookup failed for "${q.place}" (${q.countryCode})`, err);
  }
  return offline;
}
