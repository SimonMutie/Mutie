import { Hono } from "hono";
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLong, degreesLat } from "satellite.js";
import { Reader as MmdbReader, type CountryResponse } from "mmdb-lib";
import { Buffer } from "node:buffer";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { REAL_SHIPPING_LANES } from "../data/maritimeLanes";
import { COUNTRY_CENTROIDS as GDELT_SOURCE_COUNTRY_CENTROIDS } from "../connectors/gdelt";

/**
 * Live world-events feed gateway — the same idea as OSIRIS's own "no key
 * required" API layer (osirisai.live/docs): each route absorbs one public
 * upstream source's own quirks (format, rate limits, occasional 500s) and
 * hands the frontend one consistent GeoJSON FeatureCollection, so the map
 * renderer never has to know which feed a point came from.
 *
 * Gated behind requireAuth like every other route in this app (the whole
 * Lens is a logged-in tool, not a public site) — this isn't the same
 * "public no-key" posture OSIRIS advertises for itself, just this app's
 * normal access model applied to a new set of routes.
 */
export const liveLayersRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

liveLayersRouter.use("*", requireAuth);

/** A point-only GeoJSON feature with the small, fixed set of display fields
 *  every layer normalizes into — kept deliberately generic (no
 *  earthquake- or conflict-specific fields) so the frontend layer renderer
 *  and popup are shared code across all three current layers, and any
 *  layer added later. */
export interface NormalizedFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    title: string;
    /** ISO 8601 UTC. */
    time: string | null;
    /** 0-1 relative severity within this layer's own scale, for sizing/color
     *  — e.g. earthquake magnitude normalized against a fixed reference
     *  range. Not comparable across layers. */
    intensity: number;
    /** Short human label for the intensity value, e.g. "M 5.4" or "12 reports". */
    intensityLabel: string;
    detail: string;
    url: string | null;
    /** Air-traffic only — see the classifier just above the /air-traffic
     *  route for exactly what each value means and how confident it is.
     *  Every other layer leaves this undefined. */
    aviationClass?: "commercial" | "private" | "military";
    /** Space Tracking only — see SATELLITE_CATEGORY_GROUPS just above the
     *  /satellites route for exactly which real CelesTrak group(s) each
     *  value is sourced from. Every other layer leaves this undefined. */
    satelliteCategory?: "starlink-comms" | "military-intel" | "gps-nav" | "earth-observation" | "stations-telescopes";
    /** Natural-events only — derived directly from NASA EONET's own
     *  `categories[0].title` (see classifyNaturalEvent() just above
     *  /natural-events), not a guess: EONET already tells us whether an
     *  event is a wildfire or a severe storm. Every other EONET category
     *  (volcanoes, floods, drought, etc.) is left undefined here since
     *  OSIRIS's real Natural Hazards flyout only exposes these two plus
     *  Earthquakes (which comes from a separate feed entirely). */
    naturalHazardCategory?: "wildfire" | "severe-weather";
  };
}

interface NormalizedFeatureCollection {
  type: "FeatureCollection";
  features: NormalizedFeature[];
  /** When this response was actually produced upstream (server time if the
   *  cached copy is being served), so the frontend can show a real "as of"
   *  time instead of implying every poll got fresh data. */
  fetchedAt: string;
}

const CACHE_TTL_SECONDS = 60;

/** Wraps one upstream fetch + normalize step with the Cache API, so N
 *  concurrent viewers of the Lens cost this Worker one upstream request per
 *  TTL window, not N. Cache-Control on the response is what actually
 *  drives `caches.default`'s storage duration; the header is also honest
 *  to any downstream cache (e.g. Cloudflare's edge cache) that might see it.
 *  `ttlSeconds` is overridable per route — OpenSky's anonymous quota is far
 *  stricter than USGS/EONET/GDELT's, so that route asks for a much longer
 *  window rather than sharing the default. */
async function cachedJson<T>(
  request: Request,
  build: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL_SECONDS
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body: T;
  try {
    body = await build();
  } catch (err) {
    // Upstream failure — never cached, so the next request retries rather
    // than serving a stale error for a full TTL window.
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "Upstream feed unavailable", detail: message }, { status: 502 });
  }

  const response = Response.json(body, {
    headers: { "Cache-Control": `public, max-age=${ttlSeconds}` },
  });
  // waitUntil isn't available here (no ExecutionContext plumbed through this
  // helper) — cache.put's own promise is awaited directly instead, which
  // only adds the write latency once per TTL window, not per viewer.
  await cache.put(cacheKey, response.clone());
  return response;
}

/** USGS's own real-time feed is already a GeoJSON FeatureCollection; this
 *  is a reshape, not a real fetch-and-parse-something-foreign job. Public
 *  domain (US government work), no key, no rate limit posted. */
liveLayersRouter.get("/earthquakes", async (c) => {
  return cachedJson(c.req.raw, async () => {
    const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson");
    if (!res.ok) throw new Error(`USGS returned ${res.status}`);
    const raw = (await res.json()) as {
      features: Array<{
        id: string;
        properties: { mag: number | null; place: string | null; time: number; url: string | null; type: string };
        geometry: { type: string; coordinates: [number, number, number] };
      }>;
    };

    const features: NormalizedFeature[] = [];
    for (const f of raw.features) {
      if (f.geometry?.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates;
      const mag = f.properties.mag ?? 0;
      // M8+ is an extreme, rare outlier — clamping the reference range there
      // means the 0-1 scale stays meaningful for the M2-M6 events that make
      // up the vast majority of a typical day's feed, instead of every
      // ordinary quake compressing into the bottom of the scale because the
      // scale was stretched to fit one M8 event.
      const intensity = Math.max(0, Math.min(1, mag / 8));
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          id: f.id,
          title: f.properties.place ?? "Unknown location",
          time: f.properties.time ? new Date(f.properties.time).toISOString() : null,
          intensity,
          intensityLabel: `M ${mag.toFixed(1)}`,
          detail: f.properties.type ?? "earthquake",
          url: f.properties.url,
        },
      });
    }
    return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
  });
});

/** EONET's own category titles map directly onto two of OSIRIS's three real
 *  Natural Hazards rows — no invented classification, just reading the
 *  field EONET already provides. The third row (Earthquakes) is a
 *  completely separate feed (USGS, above), matching how OSIRIS's own count
 *  for that row doesn't come from EONET either. */
function classifyNaturalEvent(categoryTitle: string): "wildfire" | "severe-weather" | undefined {
  if (categoryTitle === "Wildfires") return "wildfire";
  if (categoryTitle === "Severe Storms") return "severe-weather";
  return undefined;
}

/** NASA EONET's open natural-event catalog (wildfires, storms, volcanoes,
 *  floods, etc). Public domain, no key. Each event can carry several
 *  geometry entries over its lifetime (a storm's tracked path); only the
 *  most recent is shown here — this is a live snapshot layer, not a
 *  temporal-animation one. Polygon-geometry events (some wildfire
 *  perimeters) are skipped rather than faked into a point, matching the
 *  "never pretend geometry exists" principle used elsewhere in this map
 *  stack. */
liveLayersRouter.get("/natural-events", async (c) => {
  return cachedJson(c.req.raw, async () => {
    const res = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300");
    if (!res.ok) throw new Error(`NASA EONET returned ${res.status}`);
    const raw = (await res.json()) as {
      events: Array<{
        id: string;
        title: string;
        categories: Array<{ title: string }>;
        geometry: Array<{ date: string; type: string; coordinates: unknown }>;
        sources: Array<{ url: string }>;
      }>;
    };

    const features: NormalizedFeature[] = [];
    for (const e of raw.events) {
      const latest = e.geometry[e.geometry.length - 1];
      if (!latest || latest.type !== "Point") continue;
      const [lon, lat] = latest.coordinates as [number, number];
      const category = e.categories[0]?.title ?? "Event";
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          id: e.id,
          title: e.title,
          time: latest.date ?? null,
          // EONET carries no severity scale — every open event is weighted
          // equally rather than inventing a number this feed doesn't provide.
          intensity: 0.6,
          intensityLabel: category,
          detail: category,
          url: e.sources[0]?.url ?? null,
          naturalHazardCategory: classifyNaturalEvent(category),
        },
      });
    }
    return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
  });
});

/** BROKEN-ENDPOINT FIX: this used to call GDELT's separate GEO 2.0 API
 *  (api/v2/geo/geo, mode=PointData) for true per-location geocoding, one
 *  point per distinct place. Live-testing it directly (while chasing
 *  "GDELT events not firing anything") found that endpoint now returns a
 *  bare HTTP 404 unconditionally — including for GDELT's own documented
 *  example URLs from its 2017 announcement post
 *  (https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/), which all
 *  404 the same way. It's been retired or moved at some point since then
 *  without anything in this codebase noticing (the one other caller,
 *  /activity-index in globalStatus.ts, degraded silently because its
 *  result just feeds a best-effort score with no visible error surface —
 *  this route wasn't so lucky, since it's a real map layer).
 *
 *  Replaced with GDELT's DOC 2.0 API (api/v2/doc/doc, mode=artlist) —
 *  confirmed live and already proven in production by this app's own
 *  ingestion pipeline (connectors/gdelt.ts) — aggregated by each article's
 *  `sourcecountry` field into one point per country, using the same
 *  country-name→centroid table already used there. This is a real,
 *  functioning tradeoff, not a silent downgrade: country-level rather than
 *  city-level granularity, and only for countries in that centroid table
 *  (a country outside it is silently skipped, same "skip rather than
 *  mislocate" policy as every other centroid lookup in this file). */
const GDELT_TIMEOUT_MS = 20000;

function isGdeltTimeout(err: unknown): boolean {
  return err instanceof Error && /abort|timeout/i.test(err.message + err.name);
}
function isGdeltRateLimited(err: unknown): boolean {
  return err instanceof Error && /\b429\b/.test(err.message);
}

async function fetchGdeltPointsOnce(query: string): Promise<NormalizedFeature[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=250&sort=hybridrel&timespan=24h`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(GDELT_TIMEOUT_MS),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLensBot/1.0)" },
  });
  if (!res.ok) throw new Error(`GDELT returned ${res.status}`);
  const raw = (await res.json()) as {
    articles?: Array<{ title?: string; sourcecountry?: string }>;
  };

  const byCountry = new Map<string, { count: number; titles: string[] }>();
  for (const a of raw.articles ?? []) {
    if (!a.sourcecountry) continue;
    const entry = byCountry.get(a.sourcecountry) ?? { count: 0, titles: [] };
    entry.count += 1;
    if (a.title && entry.titles.length < 3) entry.titles.push(a.title);
    byCountry.set(a.sourcecountry, entry);
  }

  const features: NormalizedFeature[] = [];
  for (const [country, entry] of byCountry.entries()) {
    const centroid = GDELT_SOURCE_COUNTRY_CENTROIDS[country];
    if (!centroid) continue; // not in the known-name table — skip rather than mislocate
    const [lat, lng] = centroid;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        id: `gdelt-${country}`,
        title: country,
        time: null, // aggregated over the whole 24h window, not per-article
        // Reference ceiling picked empirically from typical daily GDELT
        // article-count spread per country, same reasoning as the
        // earthquake magnitude clamp above — one outlier country
        // shouldn't flatten every other point's relative sizing to zero.
        intensity: Math.max(0, Math.min(1, entry.count / 40)),
        intensityLabel: `${entry.count} report${entry.count === 1 ? "" : "s"}`,
        detail: entry.titles.join(" · ").slice(0, 240),
        url: null,
      },
    });
  }
  return features;
}

export async function fetchGdeltPoints(query: string): Promise<NormalizedFeature[]> {
  try {
    return await fetchGdeltPointsOnce(query);
  } catch (err) {
    // GDELT's free API rate-limits aggressively under load — already
    // observed and documented for the cron ingestion loop (see index.ts's
    // scheduled() comment: "has been observed returning 429 under fairly
    // light load"). A short backoff before the one retry gives it a moment
    // instead of hammering straight back into the same limit; retrying a
    // timeout immediately is fine since that's not a load-shedding signal.
    if (isGdeltRateLimited(err)) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      try {
        return await fetchGdeltPointsOnce(query);
      } catch (retryErr) {
        if (isGdeltRateLimited(retryErr)) throw new Error("GDELT rate-limited this request (429) even after backing off — its free API is shared and under load; try again in a minute");
        throw retryErr;
      }
    }
    if (!isGdeltTimeout(err)) throw err;
    try {
      return await fetchGdeltPointsOnce(query);
    } catch (retryErr) {
      if (isGdeltTimeout(retryErr)) throw new Error(`GDELT did not respond within ${GDELT_TIMEOUT_MS / 1000}s (tried twice) — it may be under load, try again shortly`);
      throw retryErr;
    }
  }
}

// GDELT's own index refreshes every 15 minutes, and its free API rate-limits
// aggressively under concurrent load — polling it every 60s (this app's
// standard layer-poll cadence) was almost certainly what tipped it into 429s
// once conflict-events, global-incidents, activity-index, and Social
// Listening's map points were all hitting it independently. A 10-minute
// cache means the frontend can still poll every 60s without each of those
// polls becoming a real upstream request more than once per 10 minutes.
const GDELT_LAYER_CACHE_TTL_SECONDS = 600;

liveLayersRouter.get("/conflict-events", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const features = await fetchGdeltPoints("conflict OR violence OR attack OR airstrike OR shelling OR clashes");
      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    GDELT_LAYER_CACHE_TTL_SECONDS
  );
});

/** OSIRIS's real THREATS & INTEL flyout has a "Global Incidents" row
 *  alongside its (narrower) "GDELT Events" row. ACLED would be the more
 *  obvious real source for a broad global-incidents feed, but its EULA
 *  explicitly bars a commercial entity from using it in the entity's own
 *  dashboard without a corporate license (checked directly against
 *  acleddata.com/eula, not assumed) — exactly what this would be. So this
 *  is a second, deliberately broader GDELT query instead: still real,
 *  still keyless, still no license restriction, just a wider net (unrest,
 *  disasters, crime, explosions — not only armed-conflict terms) than
 *  /conflict-events casts. The two counts will legitimately differ from
 *  whatever OSIRIS's own two rows show, same as every other layer in this
 *  app that reproduces OSIRIS's UI structure with this app's own real,
 *  independently-sourced data rather than its exact numbers. */
liveLayersRouter.get("/global-incidents", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const features = await fetchGdeltPoints(
        "incident OR explosion OR protest OR unrest OR riot OR disaster OR accident OR crime OR terrorism OR emergency"
      );
      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    GDELT_LAYER_CACHE_TTL_SECONDS
  );
});

const AIR_TRAFFIC_TTL_SECONDS = 900; // 15 min

/** Real, sourced (not invented) signals for splitting OpenSky's one global
 *  feed into Commercial / Private / Military, used by the frontend's
 *  Aviation group. Each function documents exactly what it can and can't
 *  actually tell — this is deliberately NOT a "Private Jets" 4th category:
 *  telling a business jet apart from an ordinary private aircraft needs a
 *  real aircraft-type lookup (make/model), which would mean one API call
 *  per aircraft against OpenSky's separate metadata endpoint — completely
 *  infeasible against thousands of aircraft on an anonymous, rate-limited
 *  quota, so that split isn't attempted rather than being faked.
 *
 *  - Military: icao24 falls in the ICAO24 address block the US DoD is
 *    documented to use (0xADF000–0xAFFFFF — cross-checked against real
 *    assigned military tail numbers, e.g. AE219D/ADFD74/AE2B43, published
 *    by live-mobile-mode-s.eu's own military Mode-S registry for the US).
 *    This only ever catches broadcasting US military aircraft in this one
 *    documented block — most military aircraft worldwide don't broadcast
 *    ADS-B at all, and no comparably well-documented public block exists
 *    for other countries' forces, so this is a real but partial signal,
 *    not a claim of global military coverage.
 *  - Commercial: callsign matches the standard ICAO scheduled-flight
 *    callsign shape (ICAO Doc 8585's 3-letter operator designator + a
 *    numeric flight number, e.g. "UAL2451") — a real, standardized
 *    convention, not a guess, and one that doesn't depend on an airline
 *    code allowlist that could itself be wrong or incomplete.
 *  - Everything else (an aircraft registration as its own callsign, like
 *    "N12345" or "G-ABCD", or no callsign at all) is general aviation —
 *    labeled "Private" here, business jets included. */
const US_MILITARY_ICAO24_MIN = 0xadf000;
const US_MILITARY_ICAO24_MAX = 0xafffff;
const COMMERCIAL_CALLSIGN_RE = /^[A-Z]{3}\d{1,4}[A-Z]?$/;

function classifyAviation(icao24: string, callsign: string | null): "commercial" | "private" | "military" {
  const hex = Number.parseInt(icao24, 16);
  if (!Number.isNaN(hex) && hex >= US_MILITARY_ICAO24_MIN && hex <= US_MILITARY_ICAO24_MAX) return "military";
  const trimmed = callsign?.trim().toUpperCase() ?? "";
  if (COMMERCIAL_CALLSIGN_RE.test(trimmed)) return "commercial";
  return "private";
}

/** OpenSky Network's anonymous (keyless) global state vector snapshot.
 *  Anonymous accounts get a much smaller daily credit budget than a
 *  registered account would, and a full-globe query costs several credits
 *  per call — so this route is cached far longer than the others (15 min,
 *  vs. the usual 60s). One shared cache entry means every viewer of this
 *  Lens instance costs the upstream budget one call per 15 minutes, not
 *  one call per viewer per poll. Positions this stale are still a real,
 *  reasonably representative snapshot of global air traffic, just not a
 *  second-by-second tracker — being a good citizen of a free anonymous
 *  quota matters more here than freshness. */
liveLayersRouter.get("/air-traffic", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const res = await fetch("https://opensky-network.org/api/states/all");
      if (!res.ok) throw new Error(`OpenSky returned ${res.status}`);
      const raw = (await res.json()) as {
        time: number;
        // Each state vector is a fixed-position array, not an object — this
        // is OpenSky's own wire format (documented at openskynetwork.github.io),
        // not a shape chosen here.
        states: Array<
          [
            string, // icao24
            string | null, // callsign
            string, // origin_country
            number | null, // time_position
            number | null, // last_contact
            number | null, // longitude
            number | null, // latitude
            number | null, // baro_altitude
            boolean, // on_ground
            number | null, // velocity (m/s)
            number | null, // true_track (deg)
            number | null, // vertical_rate
            number[] | null, // sensors
            number | null, // geo_altitude
            string | null, // squawk
            boolean, // spi
            number, // position_source
          ]
        > | null;
      };

      const features: NormalizedFeature[] = [];
      for (const s of raw.states ?? []) {
        const [icao24, callsign, originCountry, , , lon, lat, , onGround, velocity] = s;
        if (lon == null || lat == null || onGround) continue;
        const speedKts = velocity != null ? velocity * 1.94384 : 0;
        // Reference ceiling near a fast commercial jet's typical cruise
        // speed — same "don't let one outlier flatten everything else"
        // reasoning as the other layers' intensity scales above.
        const intensity = Math.max(0, Math.min(1, speedKts / 550));
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {
            id: icao24,
            title: callsign?.trim() || icao24,
            time: raw.time ? new Date(raw.time * 1000).toISOString() : null,
            intensity,
            intensityLabel: velocity != null ? `${Math.round(speedKts)} kt` : "in flight",
            detail: originCountry,
            url: null,
            aviationClass: classifyAviation(icao24, callsign),
          },
        });
      }
      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    AIR_TRAFFIC_TTL_SECONDS
  );
});

/** Country-code (ISO 3166-1 alpha-2) centroids, for attributing a feed
 *  entry that only carries a country code (never a precise lat/lng) to an
 *  approximate map position. Deliberately country-level, not a guess at
 *  street-level — that's genuinely the limit of what the source data
 *  claims to know, and reporting a fake precise position would be worse
 *  than reporting an honest, coarser one. Only the countries actually
 *  likely to show up in a global malware-infrastructure feed are included;
 *  an unlisted code is skipped entirely rather than plotted at (0, 0). */
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  US: [39.8, -98.6], CA: [56.1, -106.3], MX: [23.6, -102.5], BR: [-14.2, -51.9], AR: [-38.4, -63.6],
  GB: [55.4, -3.4], IE: [53.4, -8.2], FR: [46.2, 2.2], DE: [51.2, 10.5], NL: [52.1, 5.3],
  BE: [50.5, 4.5], LU: [49.8, 6.1], CH: [46.8, 8.2], AT: [47.5, 14.6], IT: [41.9, 12.6],
  ES: [40.5, -3.7], PT: [39.4, -8.2], SE: [60.1, 18.6], NO: [60.5, 8.5], FI: [61.9, 25.7],
  DK: [56.3, 9.5], PL: [51.9, 19.1], CZ: [49.8, 15.5], SK: [48.7, 19.7], HU: [47.2, 19.5],
  RO: [45.9, 25.0], BG: [42.7, 25.5], GR: [39.1, 21.8], UA: [48.4, 31.2], RU: [61.5, 105.3],
  BY: [53.7, 27.9], MD: [47.4, 28.4], LT: [55.2, 23.9], LV: [56.9, 24.6], EE: [58.6, 25.0],
  TR: [38.9, 35.2], IR: [32.4, 53.7], IQ: [33.2, 43.7], SA: [23.9, 45.1], AE: [23.4, 53.8],
  IL: [31.0, 34.9], EG: [26.8, 30.8], ZA: [-30.6, 22.9], NG: [9.1, 8.7], KE: [-0.0, 37.9],
  ET: [9.1, 40.5], SS: [7.0, 30.0], SD: [12.9, 30.2], MA: [31.8, -7.1], DZ: [28.0, 1.7],
  CN: [35.9, 104.2], HK: [22.3, 114.2], TW: [23.7, 121.0], JP: [36.2, 138.3], KR: [35.9, 127.8],
  KP: [40.3, 127.5], VN: [14.1, 108.3], TH: [15.9, 100.9], MY: [4.2, 101.9], SG: [1.35, 103.8],
  ID: [-0.8, 113.9], PH: [12.9, 121.8], IN: [20.6, 79.0], PK: [30.4, 69.3], BD: [23.7, 90.4],
  AU: [-25.3, 133.8], NZ: [-41.0, 174.9], KZ: [48.0, 66.9], UZ: [41.4, 64.6],
  UY: [-32.5, -55.8], CL: [-35.7, -71.5], CO: [4.6, -74.3], PE: [-9.2, -75.0], VE: [6.4, -66.6],
  PA: [8.5, -80.8], CR: [9.7, -83.8], DO: [18.7, -70.2], JM: [18.1, -77.3], CU: [21.5, -77.8],
  IS: [64.9, -19.0], HR: [45.1, 15.2], SI: [46.2, 15.0], RS: [44.0, 21.0], AL: [41.2, 20.2],
  CY: [35.1, 33.4], MT: [35.9, 14.4], LI: [47.2, 9.5], MC: [43.7, 7.4], MN: [46.9, 103.8],
  QA: [25.4, 51.2], KW: [29.3, 47.5], OM: [21.5, 55.9], JO: [30.6, 36.2], LB: [33.9, 35.9],
  SY: [34.8, 39.0], YE: [15.6, 48.5], AF: [33.9, 67.7], LK: [7.9, 80.7], NP: [28.4, 84.1],
  MM: [21.9, 96.0], KH: [12.6, 105.0], LA: [19.9, 102.5], GE: [42.3, 43.4], AM: [40.1, 45.0],
  AZ: [40.1, 47.6],
};

/** Feodo Tracker (part of abuse.ch, the same nonprofit threat-intel
 *  community behind URLhaus and ThreatFox): a free, keyless, continuously
 *  updated list of IP addresses currently confirmed to be running a
 *  botnet command-and-control server for one of a handful of well-known
 *  malware families. This is genuinely real, actively-maintained threat
 *  intelligence — not the "attack in progress" animated-line theater that
 *  vendor marketing cyberattack maps show (which is illustrative, not
 *  live telemetry). What it represents is precise: confirmed C2
 *  infrastructure locations (by the hosting country the IP resolves to,
 *  which may itself be a proxy or bulletproof-hosting jurisdiction rather
 *  than the operator's real location) — not attacks landing anywhere in
 *  real time. Labeled honestly as that on the frontend rather than as a
 *  generic "cyberattacks" layer. */
liveLayersRouter.get("/malware-infrastructure", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const res = await fetch("https://feodotracker.abuse.ch/downloads/ipblocklist.json");
      if (!res.ok) throw new Error(`Feodo Tracker returned ${res.status}`);
      const raw = (await res.json()) as Array<{
        ip_address: string;
        port: number;
        status: string;
        hostname: string | null;
        as_number: number | null;
        as_name: string | null;
        country: string | null;
        malware: string | null;
        first_seen: string | null;
        last_online: string | null;
      }>;

      // Several C2 servers commonly share a hosting country — jittering
      // each one a small random amount around that country's centroid
      // keeps them visually distinguishable as separate points instead of
      // one dot silently absorbing N servers, without implying any of
      // them has a precision the source data doesn't actually have.
      const jitter = () => (Math.random() - 0.5) * 4;

      const features: NormalizedFeature[] = [];
      for (const entry of raw) {
        if (entry.status !== "online") continue; // only currently-active C2s, not historical/offline entries
        const centroid = entry.country ? COUNTRY_CENTROIDS[entry.country.toUpperCase()] : undefined;
        if (!centroid) continue; // unattributable country code — skip rather than mislocate
        const [lat, lng] = centroid;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng + jitter(), lat + jitter()] },
          properties: {
            id: `${entry.ip_address}:${entry.port}`,
            title: entry.malware ?? "Unknown malware family",
            time: entry.last_online,
            intensity: 0.7,
            intensityLabel: entry.country ?? "Unknown",
            detail: entry.as_name ?? entry.hostname ?? "",
            url: null,
          },
        });
      }
      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    600 // 10 min — this list refreshes on abuse.ch's side roughly hourly, not second-by-second
  );
});

/** Module-scope, not per-request: within one warm Worker isolate this
 *  avoids re-parsing the GeoLite2 database on every single request, on top
 *  of the Cache API layer below that avoids re-downloading it. Cleared
 *  naturally whenever the isolate recycles (a fresh cold start just
 *  re-fetches from cache/upstream), so this is a speed optimization, not a
 *  source of staleness beyond what the Cache API TTL already allows. */
let geoliteReaderCache: { reader: MmdbReader<CountryResponse>; cachedAt: number } | null = null;
const GEOLITE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — GeoLite2 itself only publishes new builds ~weekly, and country-level assignment changes rarely

/** MaxMind's "gzip" download isn't a bare gzip of the .mmdb file — it's a
 *  gzip-compressed **tar archive** containing a dated folder with the
 *  .mmdb plus COPYRIGHT.txt/README.txt (confirmed against a real
 *  third-party bug report — github.com/amule-org/amule PR #1624 — after
 *  this route's first version, which skipped this step, turned out to
 *  fail: MmdbReader can't parse a raw tar stream). This is a minimal,
 *  dependency-free reader for exactly the subset of the tar format
 *  actually needed here (find the first entry ending in ".mmdb", read its
 *  USTAR octal size field, return its bytes) — not a general-purpose tar
 *  library, since nothing else in this pipeline needs one. */
function extractMmdbFromTar(tarBytes: Uint8Array): Uint8Array {
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // an all-zero block marks the end of the archive
    const nameEnd = header.subarray(0, 100).indexOf(0);
    const name = decoder.decode(header.subarray(0, nameEnd === -1 ? 100 : nameEnd));
    const sizeField = decoder.decode(header.subarray(124, 136)).replace(/\0/g, "").trim();
    const size = Number.parseInt(sizeField, 8) || 0;
    const dataStart = offset + 512;
    if (name.endsWith(".mmdb")) return tarBytes.slice(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512; // skip this entry's data, rounded up to the next 512-byte block
  }
  throw new Error("No .mmdb file found inside MaxMind's GeoLite2 tar archive");
}

/** Downloads (or serves from cache) MaxMind's free GeoLite2-Country
 *  database and returns a ready-to-query reader. Free tier, but a
 *  registered account + license key is required (MaxMind's own download
 *  API, not a paywall on the data itself) — GeoLite2 is explicitly
 *  licensed for commercial use with attribution, unlike the free tiers of
 *  IP-geolocation *APIs* like IPinfo (which bar exactly this "embed it in
 *  your own commercial dashboard" use case — checked directly against
 *  ipinfo.io/terms-of-service before choosing this instead). Cached via
 *  the Cache API as the already-extracted .mmdb bytes (not the raw
 *  tar.gz), so a cold isolate doesn't need to re-download from MaxMind or
 *  redo the tar extraction either. */
async function getGeoliteCountryReader(env: Env): Promise<MmdbReader<CountryResponse> | null> {
  if (!env.MAXMIND_ACCOUNT_ID || !env.MAXMIND_LICENSE_KEY) return null; // not configured yet — /live-malware reports this plainly rather than guessing a location

  if (geoliteReaderCache && Date.now() - geoliteReaderCache.cachedAt < GEOLITE_REFRESH_MS) {
    return geoliteReaderCache.reader;
  }

  const cache = caches.default;
  const cacheKey = new Request("https://internal.the-lens/geolite2-country.mmdb");
  let bytes: Uint8Array;
  const cached = await cache.match(cacheKey);
  if (cached) {
    bytes = new Uint8Array(await cached.arrayBuffer());
  } else {
    const auth = "Basic " + btoa(`${env.MAXMIND_ACCOUNT_ID}:${env.MAXMIND_LICENSE_KEY}`);
    const res = await fetch("https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=gzip", {
      headers: { Authorization: auth },
      redirect: "follow", // MaxMind's own docs note this permalink 302s to a presigned R2 URL
    });
    if (!res.ok || !res.body) throw new Error(`MaxMind GeoLite2 download returned ${res.status}`);
    // One gzip layer wraps a tar archive — decompressed with the
    // platform's own native Compression Streams API (no JS gzip
    // dependency needed), then unwrapped with extractMmdbFromTar above.
    const decompressed = res.body.pipeThrough(new DecompressionStream("gzip"));
    const tarBytes = new Uint8Array(await new Response(decompressed).arrayBuffer());
    bytes = extractMmdbFromTar(tarBytes);
    await cache.put(cacheKey, new Response(bytes.slice(0), { headers: { "Cache-Control": `public, max-age=${GEOLITE_REFRESH_MS / 1000}` } }));
  }

  const reader = new MmdbReader<CountryResponse>(Buffer.from(bytes));
  geoliteReaderCache = { reader, cachedAt: Date.now() };
  return reader;
}

interface ThreatFoxIoc {
  ioc: string;
  ioc_type: string;
  threat_type: string;
  malware_printable: string;
  first_seen: string;
  confidence_level: number;
}

/** ThreatFox (abuse.ch): a real, free indicator-of-compromise feed —
 *  active malware C2/distribution IOCs reported in the last 24h. Requires
 *  the same Auth-Key abuse.ch now mandates across its APIs (see
 *  ABUSECH_AUTH_KEY in bindings.ts). Only ioc_type "ip:port" entries are
 *  usable here — ThreatFox's other IOC types (domains, URLs, hashes)
 *  carry no IP to geolocate at all, so they're skipped rather than
 *  mislocated or dropped onto a fake point. */
async function fetchThreatFoxIps(authKey: string): Promise<ThreatFoxIoc[]> {
  const res = await fetch("https://threatfox-api.abuse.ch/api/v1/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Auth-Key": authKey },
    body: JSON.stringify({ query: "get_iocs", days: 1 }),
  });
  if (!res.ok) throw new Error(`ThreatFox returned ${res.status}`);
  const raw = (await res.json()) as { query_status: string; data?: ThreatFoxIoc[] };
  if (raw.query_status !== "ok") throw new Error(`ThreatFox query_status: ${raw.query_status}`);
  return (raw.data ?? []).filter((d) => d.ioc_type === "ip:port");
}

/** "Live Malware" — matches OSIRIS's real NETWORK INTEL flyout (screenshot:
 *  a dedicated rail group with LIVE MALWARE and BOTNET C2 SERVERS rows).
 *  Real ThreatFox IOC data, geolocated to a country centroid via GeoLite2
 *  — both credentials genuinely required, so this 502s with a specific,
 *  honest reason (not a generic upstream failure) until an account owner
 *  sets ABUSECH_AUTH_KEY and the two MAXMIND_* secrets. See the comments
 *  on fetchThreatFoxIps and getGeoliteCountryReader for why each one is
 *  sourced the way it is (ACLED and IPinfo were both considered and
 *  rejected over commercial-use licensing terms). */
liveLayersRouter.get("/live-malware", async (c) => {
  if (!c.env.ABUSECH_AUTH_KEY) {
    return Response.json({ error: "Live Malware not configured — ABUSECH_AUTH_KEY secret is unset" }, { status: 502 });
  }
  const geolite = await getGeoliteCountryReader(c.env);
  if (!geolite) {
    return Response.json({ error: "Live Malware not configured — MAXMIND_ACCOUNT_ID/MAXMIND_LICENSE_KEY secrets are unset" }, { status: 502 });
  }

  return cachedJson(
    c.req.raw,
    async () => {
      const iocs = await fetchThreatFoxIps(c.env.ABUSECH_AUTH_KEY!);
      const jitter = () => (Math.random() - 0.5) * 4; // same reasoning as /malware-infrastructure's own jitter — several IOCs sharing one country shouldn't collapse onto one point

      const features: NormalizedFeature[] = [];
      for (const ioc of iocs) {
        const ip = ioc.ioc.split(":")[0];
        let countryCode: string | undefined;
        try {
          countryCode = geolite.get(ip)?.country?.iso_code;
        } catch {
          continue; // malformed/unparseable IP — skip rather than mislocate
        }
        const centroid = countryCode ? COUNTRY_CENTROIDS[countryCode.toUpperCase()] : undefined;
        if (!centroid) continue;
        const [lat, lng] = centroid;
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng + jitter(), lat + jitter()] },
          properties: {
            id: ioc.ioc,
            title: ioc.malware_printable || ioc.threat_type,
            time: ioc.first_seen,
            intensity: Math.max(0, Math.min(1, ioc.confidence_level / 100)),
            intensityLabel: `${ioc.confidence_level}% confidence`,
            detail: countryCode ?? "Unknown",
            url: null,
          },
        });
      }
      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    600 // 10 min — matches /malware-infrastructure's own TTL; ThreatFox's get_iocs endpoint itself only covers the last 24h, not second-by-second data anyway
  );
});

/** Major ports, naval bases, and shipping chokepoints — a static reference
 *  dataset, not a live feed. This is deliberate, not a placeholder: checked
 *  directly against OSIRIS's own open-source code (github.com/enzg/
 *  osiris-live) rather than assumed, its own "Maritime" layer turns out to
 *  be exactly this — the same fixed list of ports/chokepoints/bases,
 *  refreshed once a day, zero external API calls. There is no free global
 *  live-AIS source to match (see the /air-traffic comment above for the
 *  same reasoning applied to flights, where OpenSky actually does exist);
 *  unlike flights, for ships nothing keyless and truly global does. So
 *  this reproduces real, public, verifiable facts (published cargo
 *  throughput, canal traffic shares, named naval fleets) rather than
 *  faking vessel positions that would look live but wouldn't be. */
const MARITIME_PORTS: Array<{ name: string; country: string; lat: number; lng: number; kind: "container" | "energy" | "naval"; stat: string }> = [
  { name: "Shanghai", country: "CN", lat: 31.23, lng: 121.47, kind: "container", stat: "47.3M TEU/yr — world's busiest container port" },
  { name: "Singapore", country: "SG", lat: 1.26, lng: 103.84, kind: "container", stat: "37.2M TEU/yr" },
  { name: "Ningbo-Zhoushan", country: "CN", lat: 29.87, lng: 121.55, kind: "container", stat: "33.3M TEU/yr" },
  { name: "Shenzhen", country: "CN", lat: 22.54, lng: 114.05, kind: "container", stat: "30.0M TEU/yr" },
  { name: "Busan", country: "KR", lat: 35.10, lng: 129.04, kind: "container", stat: "22.7M TEU/yr" },
  { name: "Rotterdam", country: "NL", lat: 51.90, lng: 4.50, kind: "container", stat: "14.5M TEU/yr — Europe's largest port" },
  { name: "Dubai (Jebel Ali)", country: "AE", lat: 25.01, lng: 55.06, kind: "container", stat: "14.0M TEU/yr" },
  { name: "Antwerp", country: "BE", lat: 51.30, lng: 4.40, kind: "container", stat: "12.0M TEU/yr" },
  { name: "Los Angeles", country: "US", lat: 33.74, lng: -118.27, kind: "container", stat: "9.9M TEU/yr — busiest US container port" },
  { name: "Hamburg", country: "DE", lat: 53.55, lng: 9.97, kind: "container", stat: "8.7M TEU/yr" },
  { name: "Felixstowe", country: "GB", lat: 51.96, lng: 1.35, kind: "container", stat: "3.8M TEU/yr — UK's busiest container port" },
  { name: "Colombo", country: "LK", lat: 6.94, lng: 79.84, kind: "container", stat: "7.2M TEU/yr" },
  { name: "Ras Tanura", country: "SA", lat: 26.64, lng: 50.16, kind: "energy", stat: "≈ 6.5M bpd throughput — world's largest oil export terminal" },
  { name: "Fujairah", country: "AE", lat: 25.14, lng: 56.35, kind: "energy", stat: "≈ 3.5M bpd, key bunkering hub outside the Strait of Hormuz" },
  { name: "Novorossiysk", country: "RU", lat: 44.72, lng: 37.77, kind: "energy", stat: "≈ 2.8M bpd — Russia's main Black Sea oil terminal" },
  { name: "Houston Ship Channel", country: "US", lat: 29.73, lng: -95.27, kind: "energy", stat: "≈ 2.5M bpd — core of US Gulf Coast refining" },
  { name: "Kharg Island", country: "IR", lat: 29.24, lng: 50.33, kind: "energy", stat: "≈ 2.0M bpd — Iran's main oil export terminal" },
  { name: "Primorsk", country: "RU", lat: 60.35, lng: 28.70, kind: "energy", stat: "≈ 1.6M bpd — Russia's main Baltic oil terminal" },
  { name: "Norfolk Naval Station", country: "US", lat: 36.95, lng: -76.33, kind: "naval", stat: "US Atlantic Fleet — world's largest naval base" },
  { name: "San Diego Naval Base", country: "US", lat: 32.69, lng: -117.15, kind: "naval", stat: "US Pacific Fleet" },
  { name: "Pearl Harbor", country: "US", lat: 21.35, lng: -157.97, kind: "naval", stat: "US Pacific Fleet" },
  { name: "Yokosuka", country: "JP", lat: 35.28, lng: 139.67, kind: "naval", stat: "US 7th Fleet forward base" },
  { name: "Severomorsk", country: "RU", lat: 69.07, lng: 33.42, kind: "naval", stat: "Russian Northern Fleet HQ" },
  { name: "Tartus", country: "SY", lat: 34.89, lng: 35.89, kind: "naval", stat: "Russia's only Mediterranean naval facility" },
  { name: "Zhanjiang", country: "CN", lat: 21.20, lng: 110.39, kind: "naval", stat: "PLA Navy South Sea Fleet HQ" },
  { name: "Portsmouth", country: "GB", lat: 50.80, lng: -1.11, kind: "naval", stat: "Royal Navy home port" },
  { name: "Toulon", country: "FR", lat: 43.12, lng: 5.93, kind: "naval", stat: "French Navy Mediterranean fleet HQ" },
  { name: "Visakhapatnam", country: "IN", lat: 17.69, lng: 83.30, kind: "naval", stat: "Indian Navy Eastern Naval Command HQ" },
];

const MARITIME_CHOKEPOINTS: Array<{ name: string; lat: number; lng: number; stat: string }> = [
  { name: "Strait of Hormuz", lat: 26.57, lng: 56.25, stat: "≈ 21M bpd oil transits — world's most critical oil chokepoint" },
  { name: "Strait of Malacca", lat: 2.50, lng: 101.50, stat: "≈ 16M bpd oil; busiest strait by vessel count" },
  { name: "Suez Canal", lat: 30.43, lng: 32.34, stat: "≈ 12% of world trade by volume" },
  { name: "Bab el-Mandeb", lat: 12.58, lng: 43.33, stat: "≈ 6.2M bpd oil — gateway between Red Sea and Gulf of Aden" },
  { name: "Panama Canal", lat: 9.08, lng: -79.68, stat: "≈ 5% of world trade by volume" },
  { name: "Turkish Straits (Bosphorus/Dardanelles)", lat: 41.12, lng: 29.07, stat: "≈ 3M bpd oil — sole Black Sea outlet" },
  { name: "Danish Straits", lat: 55.70, lng: 12.60, stat: "≈ 3.2M bpd oil — sole Baltic Sea outlet" },
  { name: "Taiwan Strait", lat: 24.00, lng: 119.00, stat: "≈ 88% of the world's largest container ships transit annually" },
];

liveLayersRouter.get("/maritime", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const features: NormalizedFeature[] = [];
      for (const p of MARITIME_PORTS) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [p.lng, p.lat] },
          properties: {
            id: `port:${p.name}`,
            title: p.name,
            time: null,
            intensity: p.kind === "naval" ? 0.5 : 0.7,
            intensityLabel: p.kind === "container" ? "Port" : p.kind === "energy" ? "Energy terminal" : "Naval base",
            detail: p.stat,
            url: null,
          },
        });
      }
      for (const cp of MARITIME_CHOKEPOINTS) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [cp.lng, cp.lat] },
          properties: {
            id: `chokepoint:${cp.name}`,
            title: cp.name,
            time: null,
            intensity: 0.9,
            intensityLabel: "Chokepoint",
            detail: cp.stat,
            url: null,
          },
        });
      }
      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    86400 // 1 day — this is reference data, not a feed; nothing here changes minute to minute
  );
});

/** Operating nuclear power stations worldwide — another static reference
 *  dataset, same reasoning as MARITIME_PORTS above: there's no live,
 *  keyless global feed for this (and nothing here would meaningfully
 *  change minute to minute even if there were), so this reproduces real,
 *  public facts instead of faking a live sensor network. Sourced from
 *  Wikipedia's "List of nuclear power stations" (in turn drawn from the
 *  IAEA's Power Reactor Information System), restricted to sites currently
 *  listed as operating — under-construction and permanently-shut-down
 *  sites are left out since OSIRIS's own "Nuclear Facilities" row reads as
 *  current facilities, not a historical registry. Not an exhaustive IAEA
 *  export, but a substantial, real, individually-verifiable list (173
 *  sites) rather than a placeholder handful. */
const NUCLEAR_FACILITIES: Array<{ name: string; country: string; lat: number; lng: number }> = [
  { name: "Akademik Lomonosov", country: "RU", lat: 69.7097, lng: 170.3061 },
  { name: "Almaraz", country: "ES", lat: 39.80806, lng: -5.69694 },
  { name: "Angra", country: "BR", lat: -23.00833, lng: -44.47389 },
  { name: "Arkansas Nuclear One", country: "US", lat: 35.31028, lng: -93.23139 },
  { name: "Ascó", country: "ES", lat: 41.2, lng: 0.56944 },
  { name: "Astravets", country: "BY", lat: 54.76194, lng: 26.12 },
  { name: "Atucha", country: "AR", lat: -33.9675, lng: -59.205 },
  { name: "Balakovo", country: "RU", lat: 52.09111, lng: 47.95528 },
  { name: "Barakah", country: "AE", lat: 23.985, lng: 52.28361 },
  { name: "Beaver Valley", country: "US", lat: 40.62333, lng: -80.43056 },
  { name: "Belleville", country: "FR", lat: 47.50972, lng: 2.875 },
  { name: "Beloyarsk", country: "RU", lat: 56.84167, lng: 61.3225 },
  { name: "Beznau", country: "CH", lat: 47.55194, lng: 8.22778 },
  { name: "Blayais", country: "FR", lat: 45.25583, lng: -0.69306 },
  { name: "Bohunice", country: "SK", lat: 48.49444, lng: 17.68194 },
  { name: "Borssele", country: "NL", lat: 51.43083, lng: 3.71833 },
  { name: "Braidwood", country: "US", lat: 41.24361, lng: -88.22917 },
  { name: "Browns Ferry", country: "US", lat: 34.70389, lng: -87.11861 },
  { name: "Bruce", country: "CA", lat: 44.32528, lng: -81.59944 },
  { name: "Brunswick", country: "US", lat: 33.95833, lng: -78.01028 },
  { name: "Bugey", country: "FR", lat: 45.8, lng: 5.27083 },
  { name: "Bushehr", country: "IR", lat: 28.82972, lng: 50.88611 },
  { name: "Byron", country: "US", lat: 42.07417, lng: -89.28194 },
  { name: "Callaway", country: "US", lat: 38.76167, lng: -91.78 },
  { name: "Calvert Cliffs", country: "US", lat: 38.43194, lng: -76.44222 },
  { name: "Catawba", country: "US", lat: 35.05167, lng: -81.07 },
  { name: "Cattenom", country: "FR", lat: 49.41583, lng: 6.21806 },
  { name: "Cernavodă", country: "RO", lat: 44.32222, lng: 28.05722 },
  { name: "Changjiang", country: "CN", lat: 19.46028, lng: 108.9 },
  { name: "Chashma", country: "PK", lat: 32.39028, lng: 71.4625 },
  { name: "Chinon", country: "FR", lat: 47.23056, lng: 0.17056 },
  { name: "Chooz", country: "FR", lat: 50.09, lng: 4.78944 },
  { name: "Civaux", country: "FR", lat: 46.45667, lng: 0.65278 },
  { name: "Clinton", country: "US", lat: 40.17222, lng: -88.835 },
  { name: "Cofrentes", country: "ES", lat: 39.21667, lng: -1.05 },
  { name: "Columbia", country: "US", lat: 46.47111, lng: -119.33389 },
  { name: "Comanche Peak", country: "US", lat: 32.29833, lng: -97.785 },
  { name: "Cooper", country: "US", lat: 40.36194, lng: -95.64139 },
  { name: "Cruas", country: "FR", lat: 44.63306, lng: 4.75667 },
  { name: "Dampierre", country: "FR", lat: 47.73306, lng: 2.51667 },
  { name: "Darlington", country: "CA", lat: 43.87278, lng: -78.71972 },
  { name: "Davis-Besse", country: "US", lat: 41.59667, lng: -83.08639 },
  { name: "Daya Bay", country: "CN", lat: 22.59778, lng: 114.54361 },
  { name: "Diablo Canyon", country: "US", lat: 35.21083, lng: -120.85611 },
  { name: "Doel", country: "BE", lat: 51.32472, lng: 4.25861 },
  { name: "Donald C. Cook", country: "US", lat: 41.97528, lng: -86.56583 },
  { name: "Dresden", country: "US", lat: 41.38972, lng: -88.26806 },
  { name: "Dukovany", country: "CZ", lat: 49.085, lng: 16.14889 },
  { name: "Edwin I. Hatch", country: "US", lat: 31.93417, lng: -82.34389 },
  { name: "Embalse", country: "AR", lat: -32.232, lng: -64.443 },
  { name: "Fermi", country: "US", lat: 41.96278, lng: -83.2575 },
  { name: "Fangchenggang", country: "CN", lat: 21.66667, lng: 108.56306 },
  { name: "Fangjiashan", country: "CN", lat: 30.44139, lng: 120.94167 },
  { name: "Flamanville", country: "FR", lat: 49.53639, lng: -1.88167 },
  { name: "Forsmark", country: "SE", lat: 60.40333, lng: 18.16667 },
  { name: "Fuqing", country: "CN", lat: 25.44417, lng: 119.44611 },
  { name: "Genkai", country: "JP", lat: 33.51556, lng: 129.83722 },
  { name: "Ginna", country: "US", lat: 43.27778, lng: -77.31 },
  { name: "Gösgen", country: "CH", lat: 47.36583, lng: 7.96667 },
  { name: "Golfech", country: "FR", lat: 44.10667, lng: 0.84528 },
  { name: "Grand Gulf", country: "US", lat: 32.00667, lng: -91.04833 },
  { name: "Gravelines", country: "FR", lat: 51.01528, lng: 2.13611 },
  { name: "Haiyang", country: "CN", lat: 36.70917, lng: 121.38167 },
  { name: "Hamaoka", country: "JP", lat: 34.62361, lng: 138.1425 },
  { name: "Hanbit", country: "KR", lat: 35.415, lng: 126.42389 },
  { name: "Hanul", country: "KR", lat: 37.09278, lng: 129.38361 },
  { name: "Hartlepool", country: "GB", lat: 54.635, lng: -1.18083 },
  { name: "H. B. Robinson", country: "US", lat: 34.40278, lng: -80.15833 },
  { name: "Heysham", country: "GB", lat: 54.02889, lng: -2.91611 },
  { name: "Higashidōri", country: "JP", lat: 41.18806, lng: 141.39028 },
  { name: "Hongyanhe", country: "CN", lat: 39.79778, lng: 121.47194 },
  { name: "Hope Creek", country: "US", lat: 39.46778, lng: -75.53806 },
  { name: "Ikata", country: "JP", lat: 33.49083, lng: 132.31139 },
  { name: "James A. FitzPatrick", country: "US", lat: 43.5233, lng: -76.3983 },
  { name: "Joseph M. Farley", country: "US", lat: 31.22306, lng: -85.11167 },
  { name: "Kalinin", country: "RU", lat: 57.90556, lng: 35.06028 },
  { name: "Kaiga", country: "IN", lat: 14.86528, lng: 74.43944 },
  { name: "Kakrapar", country: "IN", lat: 21.23861, lng: 73.35 },
  { name: "Karachi", country: "PK", lat: 24.847167, lng: 66.78825 },
  { name: "Kashiwazaki-Kariwa", country: "JP", lat: 37.42917, lng: 138.59528 },
  { name: "Khmelnytskyi", country: "UA", lat: 50.30139, lng: 26.64972 },
  { name: "Koeberg", country: "ZA", lat: -33.67639, lng: 18.43194 },
  { name: "Kola", country: "RU", lat: 67.46667, lng: 32.46667 },
  { name: "Kori", country: "KR", lat: 35.31694, lng: 129.3 },
  { name: "Kozloduy", country: "BG", lat: 43.74611, lng: 23.77056 },
  { name: "Krško", country: "SI", lat: 45.93833, lng: 15.51556 },
  { name: "Kudankulam", country: "IN", lat: 8.16833, lng: 77.7125 },
  { name: "Kursk", country: "RU", lat: 51.675, lng: 35.60556 },
  { name: "Laguna Verde", country: "MX", lat: 19.72083, lng: -96.40639 },
  { name: "LaSalle", country: "US", lat: 41.24556, lng: -88.66917 },
  { name: "Leibstadt", country: "CH", lat: 47.60306, lng: 8.18472 },
  { name: "Leningrad", country: "RU", lat: 59.84722, lng: 29.04361 },
  { name: "Leningrad II", country: "RU", lat: 59.83056, lng: 29.05722 },
  { name: "Limerick", country: "US", lat: 40.22667, lng: -75.58722 },
  { name: "Ling Ao", country: "CN", lat: 22.60472, lng: 114.55139 },
  { name: "Loviisa", country: "FI", lat: 60.37222, lng: 26.34722 },
  { name: "McGuire", country: "US", lat: 35.4325, lng: -80.94833 },
  { name: "Madras", country: "IN", lat: 12.5575, lng: 80.175 },
  { name: "Metsamor", country: "AM", lat: 40.18083, lng: 44.14889 },
  { name: "Mihama", country: "JP", lat: 35.70333, lng: 135.96333 },
  { name: "Millstone", country: "US", lat: 41.31194, lng: -72.16861 },
  { name: "Monticello", country: "US", lat: 45.33361, lng: -93.84917 },
  { name: "Mochovce", country: "SK", lat: 48.26389, lng: 18.45694 },
  { name: "Narora", country: "IN", lat: 28.15806, lng: 78.40944 },
  { name: "Nine Mile Point", country: "US", lat: 43.52083, lng: -76.40694 },
  { name: "Ningde", country: "CN", lat: 27.04611, lng: 120.28833 },
  { name: "Nogent", country: "FR", lat: 48.51528, lng: 3.51778 },
  { name: "North Anna", country: "US", lat: 38.06056, lng: -77.78944 },
  { name: "Novovoronezh I", country: "RU", lat: 51.275, lng: 39.2 },
  { name: "Novovoronezh II", country: "RU", lat: 51.277, lng: 39.203 },
  { name: "Oconee", country: "US", lat: 34.79389, lng: -82.89806 },
  { name: "Ōi", country: "JP", lat: 35.54056, lng: 135.65194 },
  { name: "Olkiluoto", country: "FI", lat: 61.23694, lng: 21.44083 },
  { name: "Onagawa", country: "JP", lat: 38.40111, lng: 141.49972 },
  { name: "Oskarshamn", country: "SE", lat: 57.41556, lng: 16.67111 },
  { name: "Paks", country: "HU", lat: 46.5725, lng: 18.85417 },
  { name: "Palo Verde", country: "US", lat: 33.38917, lng: -112.865 },
  { name: "Paluel", country: "FR", lat: 49.85806, lng: 0.63556 },
  { name: "Penly", country: "FR", lat: 49.97667, lng: 1.21194 },
  { name: "Peach Bottom", country: "US", lat: 39.75833, lng: -76.26806 },
  { name: "Perry", country: "US", lat: 41.80083, lng: -81.14333 },
  { name: "Pickering", country: "CA", lat: 43.81167, lng: -79.06583 },
  { name: "Point Beach", country: "US", lat: 44.28111, lng: -87.53667 },
  { name: "Point Lepreau", country: "CA", lat: 45.06889, lng: -66.45472 },
  { name: "Prairie Island", country: "US", lat: 44.62167, lng: -92.63306 },
  { name: "Qinshan", country: "CN", lat: 30.43556, lng: 120.95639 },
  { name: "Quad Cities", country: "US", lat: 41.72639, lng: -90.31 },
  { name: "Rajasthan", country: "IN", lat: 24.87222, lng: 75.61389 },
  { name: "Ringhals", country: "SE", lat: 57.25972, lng: 12.11083 },
  { name: "River Bend", country: "US", lat: 30.7567, lng: -91.333 },
  { name: "Rivne", country: "UA", lat: 51.32778, lng: 25.89167 },
  { name: "Rostov", country: "RU", lat: 47.59944, lng: 42.37194 },
  { name: "Saint-Alban", country: "FR", lat: 45.40444, lng: 4.75444 },
  { name: "Saint-Laurent", country: "FR", lat: 47.72, lng: 1.5775 },
  { name: "Saint Lucie", country: "US", lat: 27.34861, lng: -80.24639 },
  { name: "Salem", country: "US", lat: 39.46278, lng: -75.53556 },
  { name: "Sanmen", country: "CN", lat: 29.10111, lng: 121.63972 },
  { name: "Seabrook", country: "US", lat: 42.89889, lng: -70.85083 },
  { name: "Sendai", country: "JP", lat: 31.83361, lng: 130.18972 },
  { name: "Sequoyah", country: "US", lat: 35.22639, lng: -85.09167 },
  { name: "Shearon Harris", country: "US", lat: 35.6333, lng: -78.955 },
  { name: "Shidao Bay", country: "CN", lat: 36.9722, lng: 122.5289 },
  { name: "Shika", country: "JP", lat: 37.06111, lng: 136.72639 },
  { name: "Shimane", country: "JP", lat: 35.53833, lng: 132.99917 },
  { name: "Sizewell B", country: "GB", lat: 52.21333, lng: 1.61861 },
  { name: "Smolensk", country: "RU", lat: 54.16917, lng: 33.24667 },
  { name: "South Texas", country: "US", lat: 28.79556, lng: -96.04889 },
  { name: "South Ukraine", country: "UA", lat: 47.81667, lng: 31.21667 },
  { name: "Surry", country: "US", lat: 37.16556, lng: -76.69778 },
  { name: "Susquehanna", country: "US", lat: 41.08889, lng: -76.14889 },
  { name: "Taishan", country: "CN", lat: 21.90944, lng: 112.97917 },
  { name: "Takahama", country: "JP", lat: 35.52222, lng: 135.50472 },
  { name: "Tarapur", country: "IN", lat: 19.82778, lng: 72.66111 },
  { name: "Temelín", country: "CZ", lat: 49.18, lng: 14.37611 },
  { name: "Tianwan", country: "CN", lat: 34.68694, lng: 119.45972 },
  { name: "Tihange", country: "BE", lat: 50.53472, lng: 5.2725 },
  { name: "Tokai", country: "JP", lat: 36.46639, lng: 140.60667 },
  { name: "Tomari", country: "JP", lat: 43.03611, lng: 140.5125 },
  { name: "Torness", country: "GB", lat: 55.96806, lng: -2.40917 },
  { name: "Tricastin", country: "FR", lat: 44.32972, lng: 4.73222 },
  { name: "Trillo", country: "ES", lat: 40.70111, lng: -2.62194 },
  { name: "Tsuruga", country: "JP", lat: 35.67278, lng: 136.07722 },
  { name: "Turkey Point", country: "US", lat: 25.43417, lng: -80.33056 },
  { name: "Vandellòs", country: "ES", lat: 40.95139, lng: 0.86667 },
  { name: "Virgil C. Summer", country: "US", lat: 34.29861, lng: -81.31472 },
  { name: "Vogtle", country: "US", lat: 33.14306, lng: -81.76583 },
  { name: "Waterford", country: "US", lat: 29.99528, lng: -90.47111 },
  { name: "Watts Bar", country: "US", lat: 35.60278, lng: -84.78944 },
  { name: "Wolf Creek", country: "US", lat: 38.23889, lng: -95.68889 },
  { name: "Wolseong", country: "KR", lat: 35.71111, lng: 129.475 },
  { name: "Yangjiang", country: "CN", lat: 21.70972, lng: 112.26056 },
  { name: "Zaporizhzhia", country: "UA", lat: 47.51222, lng: 34.58583 },
  { name: "Zhangzhou", country: "CN", lat: 23.8292, lng: 117.4917 },
];

interface AisSnapshot {
  connected: boolean;
  vessels: { mmsi: number; name: string | null; lat: number; lng: number; speedKn: number | null; courseDeg: number | null; lastUpdate: string }[];
  fetchedAt: string;
}

/** Real global live vessel positions from AISstream.io, held by
 *  AisIngestionActor's persistent outbound WebSocket (see that file for
 *  the connection/reconnect logic and bindings.ts's AISSTREAM_API_KEY
 *  comment for why this source, chosen after checking the alternatives
 *  directly and its explicit lack of published terms accepted as a known
 *  trade-off). A short 15s cache here isn't slowing anything down —
 *  AISstream.io itself pushes updates continuously, so this just caps how
 *  often concurrent Lens viewers each re-poll the Durable Object. */
liveLayersRouter.get("/ais-vessels", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      if (!c.env.AISSTREAM_API_KEY) {
        throw new Error("AISSTREAM_API_KEY not set — sign up free at aisstream.io, generate a key, and set it as a Worker secret");
      }
      const id = c.env.AIS_INGESTION_ACTOR.idFromName("global");
      const resp = await c.env.AIS_INGESTION_ACTOR.get(id).fetch("http://ais-ingestion-actor/snapshot");
      const snapshot = await resp.json<AisSnapshot>();

      const features: NormalizedFeature[] = snapshot.vessels.map((v) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lng, v.lat] },
        properties: {
          id: `vessel:${v.mmsi}`,
          title: v.name ?? `MMSI ${v.mmsi}`,
          time: v.lastUpdate,
          intensity: v.speedKn !== null ? Math.min(v.speedKn / 25, 1) : 0.3,
          intensityLabel: v.speedKn !== null ? `${v.speedKn.toFixed(1)} kn` : "Speed unknown",
          detail: v.courseDeg !== null ? `Course ${v.courseDeg.toFixed(0)}°` : "AIS position report",
          url: null,
        },
      }));
      return { type: "FeatureCollection", features, fetchedAt: snapshot.fetchedAt, connected: snapshot.connected };
    },
    15
  );
});

interface UcdpEvent {
  id: number;
  date_start: string;
  date_end: string;
  latitude: number;
  longitude: number;
  best: number;
  type_of_violence: string;
  side_a: string;
  side_b: string;
  country: string;
  conflict_name?: string;
}

const UCDP_VIOLENCE_TYPES: Record<string, string> = {
  "1": "State-based violence",
  "2": "Non-state violence",
  "3": "One-sided violence",
};

/** UCDP's Georeferenced Event Dataset (GED) — validated, academically-coded
 *  historical conflict events (CC BY 4.0, verified commercial-safe directly
 *  against ucdp.uu.se/downloads). A deliberately different thing from
 *  /conflict-events above (GDELT's real-time, unverified news-mention
 *  feed): this is slower to update but each event carries a real
 *  best-estimate death toll and a validated actor pairing, not a text
 *  match. Requires UCDP_API_TOKEN (see bindings.ts for how to request one
 *  — it's not self-serve, so this reports plainly that it's unconfigured
 *  rather than 502ing with no explanation). Scoped to the last 180 days —
 *  UCDP publishes the GED periodically, not daily, so a shorter window
 *  would often show nothing at all. */
liveLayersRouter.get("/ucdp-conflict-events", async (c) => {
  if (!c.env.UCDP_API_TOKEN) {
    return Response.json(
      { error: "UCDP Conflict Events not configured — UCDP_API_TOKEN secret is unset (request one from UCDP first, see bindings.ts's comment)" },
      { status: 502 }
    );
  }
  return cachedJson(
    c.req.raw,
    async () => {
      const startDate = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
      const url = `https://ucdpapi.pcr.uu.se/api/gedevents/26.1?pagesize=500&StartDate=${startDate}`;
      const res = await fetch(url, {
        headers: { "x-ucdp-access-token": c.env.UCDP_API_TOKEN! },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`UCDP API returned ${res.status}`);
      const data = (await res.json()) as { Result?: UcdpEvent[] };
      const events = data.Result ?? [];

      const features: NormalizedFeature[] = events
        .filter((e) => Number.isFinite(e.latitude) && Number.isFinite(e.longitude))
        .map((e) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [e.longitude, e.latitude] },
          properties: {
            id: `ucdp:${e.id}`,
            title: `${e.side_a} vs ${e.side_b}`,
            time: e.date_end ?? e.date_start ?? null,
            intensity: Math.min((e.best ?? 0) / 50, 1),
            intensityLabel: `${e.best ?? 0} killed (best est.)`,
            detail: `${UCDP_VIOLENCE_TYPES[e.type_of_violence] ?? "Conflict event"} — ${e.country}${e.conflict_name ? ` (${e.conflict_name})` : ""}`,
            url: null,
          },
        }));

      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    3600
  );
});

/** Real, computed sea-lane geometries — see maritimeLanes.ts for exactly
 *  how these were generated and sanity-checked (searoute-js over a real
 *  marnet/Oak Ridge maritime network, not hand-drawn waypoints). Served as
 *  reference data, same 1-day cache as /maritime and /nuclear-facilities. */
liveLayersRouter.get("/maritime-lines", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => ({ lanes: REAL_SHIPPING_LANES, fetchedAt: new Date().toISOString() }),
    86400
  );
});

liveLayersRouter.get("/nuclear-facilities", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const features: NormalizedFeature[] = NUCLEAR_FACILITIES.map((f) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [f.lng, f.lat] },
        properties: {
          id: `nuclear:${f.name}`,
          title: f.name,
          time: null,
          intensity: 0.6,
          intensityLabel: "Nuclear facility",
          detail: f.country,
          url: null,
        },
      }));
      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    86400 // 1 day — reference data, same reasoning as /maritime
  );
});

interface IssPosition {
  lat: number;
  lng: number;
  /** Rough estimate (ISS orbital ground speed is ~27,600 km/h and nearly
   *  constant at its stable orbital altitude — this isn't derived from two
   *  fixes, just a documented constant), so it's not upstream data being
   *  claimed as more precise than it is. */
  speedKmh: number;
  timestamp: string;
}

/** open-notify.org's ISS position API — free, keyless, no documented rate
 *  limit, returns the ISS's current subpoint (the ground location directly
 *  beneath it) once per call. A 5s cache TTL is a compromise: the ISS moves
 *  roughly 2.3km per real second, so anything longer would visibly lag a
 *  live marker, but this route existing at all means every viewer of this
 *  Lens instance shares one upstream call per 5s window rather than one
 *  each. */
liveLayersRouter.get("/iss", async (c) => {
  return cachedJson<IssPosition>(
    c.req.raw,
    async () => {
      const res = await fetch("https://api.open-notify.org/iss-now.json");
      if (!res.ok) throw new Error(`open-notify returned ${res.status}`);
      const raw = (await res.json()) as { timestamp: number; iss_position: { latitude: string; longitude: string } };
      return {
        lat: parseFloat(raw.iss_position.latitude),
        lng: parseFloat(raw.iss_position.longitude),
        speedKmh: 27_600,
        timestamp: new Date(raw.timestamp * 1000).toISOString(),
      };
    },
    5
  );
});

interface NewsItem {
  id: string;
  title: string;
  source: string;
  link: string;
  publishedAt: string | null;
}

interface NewsFeed {
  items: NewsItem[];
  fetchedAt: string;
}

/** A handful of real broadcaster/wire-service RSS feeds — the same category
 *  OSIRIS itself uses (it lists 25+; this starts with a representative
 *  handful of major, freely-syndicated world-news feeds rather than trying
 *  to match that count in one pass). Fetched and parsed here rather than
 *  client-side because these feeds don't set CORS headers for arbitrary
 *  browser origins, so a direct frontend fetch would simply fail — this is
 *  a genuine proxy need, not just cache/rate-limit hygiene. Minimal regex
 *  parsing rather than a full XML parser: Workers has no DOMParser, and
 *  RSS's <item>/<title>/<link>/<pubDate> structure is regular enough
 *  across these particular feeds to extract reliably without one. */
liveLayersRouter.get("/news", async (c) => {
  return cachedJson<NewsFeed>(
    c.req.raw,
    async () => {
      // Deliberately official, first-party feeds only — no third-party RSS
      // mirror/aggregator services (several exist for outlets that dropped
      // their own public RSS, like AP and Reuters, but their availability
      // and content fidelity isn't this project's to vouch for).
      const feeds: { source: string; url: string }[] = [
        { source: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
        { source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
        { source: "NYT World", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
        { source: "UN News", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml" },
      ];

      const results = await Promise.allSettled(
        feeds.map(async (f) => {
          const res = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; TheLensBot/1.0)" } });
          if (!res.ok) throw new Error(`${f.source} returned ${res.status}`);
          const xml = await res.text();
          return parseRssItems(xml, f.source);
        })
      );

      const items: NewsItem[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") items.push(...r.value);
        // A failed feed is simply omitted — one broadcaster's outage
        // shouldn't 502 the whole panel when the others are fine.
      }
      items.sort((a, b) => {
        const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        return bt - at;
      });
      return { items: items.slice(0, 60), fetchedAt: new Date().toISOString() };
    },
    300 // 5 min — headline feeds don't need second-by-second freshness, and this keeps upstream load light
  );
});

/** Extracts <item> blocks and their <title>/<link>/<pubDate> out of raw RSS
 *  XML text with regex rather than a parser — deliberately tolerant (each
 *  field is optional and independently matched) since real-world feeds
 *  vary in whether title/link use CDATA wrapping, self-closing tags, etc. */
function parseRssItems(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  for (const [i, block] of itemBlocks.entries()) {
    const title = extractRssField(block, "title");
    const link = extractRssField(block, "link");
    const pubDate = extractRssField(block, "pubDate") ?? extractRssField(block, "dc:date");
    if (!title || !link) continue;
    const publishedAt = pubDate ? new Date(pubDate).toISOString() : null;
    items.push({
      id: `${source}:${i}:${link}`,
      title,
      source,
      link,
      publishedAt: Number.isNaN(Date.parse(publishedAt ?? "")) ? null : publishedAt,
    });
  }
  return items;
}

function extractRssField(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  if (!match) return null;
  const raw = match[1];
  const cdataMatch = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(raw);
  const text = cdataMatch ? cdataMatch[1] : raw;
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim() || null;
}

/** One parsed CelesTrak TLE (Two-Line Element) record — the real, standard
 *  orbital-element wire format used across the whole satellite-tracking
 *  industry, not something invented for this app. */
interface TleRecord {
  name: string;
  line1: string;
  line2: string;
}

/** CelesTrak serves each group as plain text, 3 lines per satellite (name,
 *  then the two numbered TLE lines) — this just splits that back into
 *  records. Tolerant of blank lines / trailing whitespace, which the raw
 *  feed sometimes has. */
function parseTleText(text: string): TleRecord[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0);
  const records: TleRecord[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (line1?.startsWith("1 ") && line2?.startsWith("2 ")) {
      records.push({ name, line1, line2 });
    }
  }
  return records;
}

/** CelesTrak (celestrak.org): the real, free, keyless public source of
 *  satellite orbital elements, organized into named groups it maintains
 *  itself (github.com/CelesTrak — this isn't a scrape of someone else's
 *  repackaging). One group per fetch, matching how CelesTrak's own API is
 *  shaped. */
async function fetchCelestrakGroup(group: string): Promise<TleRecord[]> {
  const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`);
  if (!res.ok) throw new Error(`CelesTrak group "${group}" returned ${res.status}`);
  return parseTleText(await res.text());
}

/** Maps each of OSIRIS's real Space Tracking sub-categories onto the real
 *  CelesTrak group slug(s) that actually correspond to it (verified against
 *  CelesTrak's own group index, not guessed) — several categories are a
 *  union of more than one CelesTrak group because CelesTrak splits by
 *  operator/constellation, not by the coarser role-based buckets OSIRIS's
 *  UI uses. There's deliberately no separate massive fetch for an "all
 *  active satellites" catalog here: CelesTrak's own `active` group runs
 *  well into five figures, and propagating that many TLEs through SGP4 on
 *  every cache-refresh would risk this Worker's CPU budget for a result
 *  that would be unreadable clutter on the globe anyway. The "All
 *  Satellites" layer (see LAYER_DEFS in the frontend) instead shows the
 *  union of every satellite already fetched for the categories below —
 *  real, sourced data, just not a claim to track literally every catalogued
 *  object in orbit. */
const SATELLITE_CATEGORY_GROUPS: Record<string, string[]> = {
  "starlink-comms": ["starlink", "oneweb", "iridium-NEXT", "intelsat", "ses", "orbcomm", "globalstar"],
  "military-intel": ["military"],
  "gps-nav": ["gnss"],
  "earth-observation": ["resource", "weather", "planet", "spire"],
  "stations-telescopes": ["stations", "science"],
};

/** SGP4/SDP4 propagation via satellite.js (pinned to 5.0.0 — see
 *  package.json — the current 6.x release bundles a WASM module unsuited
 *  to this Worker's bundler, the same class of bug the maplibre worker
 *  script hit earlier). Returns null for a TLE satellite.js can't
 *  propagate (a handful of catalog entries are stale/decayed/malformed)
 *  rather than throwing, so one bad record doesn't drop the whole group. */
function propagateTle(rec: TleRecord, now: Date): { lat: number; lng: number } | null {
  try {
    const satrec = twoline2satrec(rec.line1, rec.line2);
    const pv = propagate(satrec, now);
    if (!pv.position || typeof pv.position === "boolean") return null;
    const gmst = gstime(now);
    const geo = eciToGeodetic(pv.position, gmst);
    const lat = degreesLat(geo.latitude);
    const lng = degreesLong(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

const SATELLITE_TTL_SECONDS = 120; // real orbital positions drift several km/s, but this cache is shared across every viewer of this Lens instance — 2 min balances "not visibly stale on the globe" against not hammering CelesTrak's free service or this Worker's own CPU budget on every request.

/** Real satellite positions for OSIRIS's "Space Tracking" layer group,
 *  computed from CelesTrak's own orbital elements rather than a static or
 *  fabricated point set — see SATELLITE_CATEGORY_GROUPS above for exactly
 *  which real CelesTrak groups back each sub-category. */
liveLayersRouter.get("/satellites", async (c) => {
  return cachedJson(
    c.req.raw,
    async () => {
      const categoryResults = await Promise.allSettled(
        Object.entries(SATELLITE_CATEGORY_GROUPS).map(async ([category, groups]) => {
          const perGroup = await Promise.allSettled(groups.map((g) => fetchCelestrakGroup(g)));
          const records: TleRecord[] = [];
          const seenNoradIds = new Set<string>();
          for (const g of perGroup) {
            if (g.status !== "fulfilled") continue; // one failing group in a union shouldn't drop the rest
            for (const rec of g.value) {
              // The same satellite can legitimately appear in more than one
              // CelesTrak group within a union (e.g. a bird cross-listed
              // under both a constellation group and a generic one) — the
              // TLE's own NORAD catalog number (line 1, columns 3-7) is a
              // real stable identifier to de-dupe on; satellite names
              // aren't guaranteed unique.
              const noradId = rec.line1.slice(2, 7);
              if (seenNoradIds.has(noradId)) continue;
              seenNoradIds.add(noradId);
              records.push(rec);
            }
          }
          return { category: category as NonNullable<NormalizedFeature["properties"]["satelliteCategory"]>, records };
        })
      );

      const now = new Date();
      const features: NormalizedFeature[] = [];
      for (const r of categoryResults) {
        if (r.status !== "fulfilled") continue; // one failing category shouldn't 502 the whole layer
        const { category, records } = r.value;
        for (const rec of records) {
          const pos = propagateTle(rec, now);
          if (!pos) continue;
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [pos.lng, pos.lat] },
            properties: {
              id: rec.line1.slice(2, 7),
              title: rec.name,
              time: now.toISOString(),
              intensity: 0.5,
              intensityLabel: "in orbit",
              detail: category.replace(/-/g, " / "),
              url: null,
              satelliteCategory: category,
            },
          });
        }
      }
      return { type: "FeatureCollection", features, fetchedAt: now.toISOString() };
    },
    SATELLITE_TTL_SECONDS
  );
});

interface RouteResult {
  /** [lng, lat] pairs, matching GeoJSON coordinate order. */
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
}

const VALID_ROUTE_PROFILES = new Set(["driving", "walking", "cycling"]);

/** OSRM's free public demo server (router.project-osrm.org) — no key
 *  required, but explicitly posted by the OSRM project as a demo/evaluation
 *  instance, not a production SLA: rate-limited and offered with no uptime
 *  guarantee. Proxied here (rather than called directly from the browser)
 *  both to share one small cache across viewers requesting the same
 *  from/to/mode, and because a production deployment that outgrows this
 *  demo instance's limits would swap the upstream URL here for a paid
 *  provider (Mapbox/ORS/self-hosted OSRM) or a real key, without any
 *  frontend change. */
liveLayersRouter.get("/route", async (c) => {
  const from = c.req.query("from"); // "lat,lng"
  const to = c.req.query("to");
  const profile = c.req.query("mode") ?? "driving";
  if (!from || !to) return Response.json({ error: "Missing from/to query params (each \"lat,lng\")" }, { status: 400 });
  if (!VALID_ROUTE_PROFILES.has(profile)) return Response.json({ error: "mode must be driving, walking, or cycling" }, { status: 400 });

  const parseLatLng = (s: string): [number, number] | null => {
    const m = /^(-?\d+\.?\d*),(-?\d+\.?\d*)$/.exec(s.trim());
    if (!m) return null;
    return [parseFloat(m[1]), parseFloat(m[2])];
  };
  const fromLatLng = parseLatLng(from);
  const toLatLng = parseLatLng(to);
  if (!fromLatLng || !toLatLng) return Response.json({ error: "from/to must be \"lat,lng\" numbers" }, { status: 400 });

  return cachedJson<RouteResult>(
    c.req.raw,
    async () => {
      // OSRM's coordinate order is lng,lat (GeoJSON convention), the
      // opposite of this route's own lat,lng query params — the query
      // params match how every other part of this app writes coordinates
      // (see resolveLocation elsewhere), the conversion happens right here.
      const coordPart = `${fromLatLng[1]},${fromLatLng[0]};${toLatLng[1]},${toLatLng[0]}`;
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/${profile}/${coordPart}?overview=full&geometries=geojson`
      );
      if (!res.ok) throw new Error(`OSRM demo server returned ${res.status}`);
      const raw = (await res.json()) as {
        code: string;
        routes?: Array<{ geometry: { coordinates: [number, number][] }; distance: number; duration: number }>;
      };
      const route = raw.routes?.[0];
      if (raw.code !== "Ok" || !route) throw new Error(`OSRM could not find a ${profile} route between those points`);
      return { coordinates: route.geometry.coordinates, distanceMeters: route.distance, durationSeconds: route.duration };
    },
    120 // 2 min — same from/to/mode requested again shortly after (e.g. a re-render) shouldn't re-hit the shared demo server
  );
});
