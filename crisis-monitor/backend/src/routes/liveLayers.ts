import { Hono } from "hono";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

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
interface NormalizedFeature {
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
async function cachedJson(
  request: Request,
  build: () => Promise<NormalizedFeatureCollection>,
  ttlSeconds: number = CACHE_TTL_SECONDS
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body: NormalizedFeatureCollection;
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
    const res = await fetch("https://earthquake.usgs.gov/earthquake/feed/v1.0/summary/all_day.geojson");
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
        },
      });
    }
    return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
  });
});

/** GDELT's GEO 2.0 API, in PointData mode: every geocoded news article
 *  worldwide from the last 24h matching this query, one point per distinct
 *  location. Free, keyless, but a shared public service — this is exactly
 *  the fixed query approach OSIRIS itself needs for a general "conflict
 *  events" layer (there's no single upstream endpoint for "all conflict
 *  events," only a search). `html` in GDELT's response is a ready-made
 *  link/snippet blob meant for direct display; it's stripped down to plain
 *  text here rather than passed through, since rendering arbitrary
 *  upstream HTML in the frontend would be an XSS surface for no real gain. */
liveLayersRouter.get("/conflict-events", async (c) => {
  return cachedJson(c.req.raw, async () => {
    const query = encodeURIComponent("conflict OR violence OR attack OR airstrike OR shelling OR clashes");
    const res = await fetch(
      `https://api.gdeltproject.org/api/v2/geo/geo?query=${query}&mode=PointData&format=geojson&timespan=24h`
    );
    if (!res.ok) throw new Error(`GDELT returned ${res.status}`);
    const raw = (await res.json()) as {
      features: Array<{
        properties: { name?: string; count?: number; html?: string };
        geometry: { type: string; coordinates: [number, number] };
      }>;
    };

    const features: NormalizedFeature[] = [];
    for (const [i, f] of raw.features.entries()) {
      if (f.geometry?.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates;
      const count = f.properties.count ?? 1;
      const plainText = (f.properties.html ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          id: `${f.properties.name ?? "gdelt"}-${i}`,
          title: f.properties.name ?? "Unnamed location",
          time: null, // GDELT's PointData mode reports a 24h aggregate, not a per-point timestamp
          // Reference ceiling picked empirically from typical daily GDELT
          // point-count spread, same reasoning as the earthquake magnitude
          // clamp above — an outlier hub city shouldn't flatten every
          // other point's relative sizing to zero.
          intensity: Math.max(0, Math.min(1, count / 40)),
          intensityLabel: `${count} report${count === 1 ? "" : "s"}`,
          detail: plainText.slice(0, 240),
          url: null,
        },
      });
    }
    return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
  });
});

const AIR_TRAFFIC_TTL_SECONDS = 900; // 15 min

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
          },
        });
      }
      return { type: "FeatureCollection", features, fetchedAt: new Date().toISOString() };
    },
    AIR_TRAFFIC_TTL_SECONDS
  );
});
