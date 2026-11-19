/**
 * Road routes for the Route tool (Live OSINT) and road routes on the incident map: tried in turn until one answers,
 * so one refusing or failing server does not stop routing.
 *
 * 1. The OpenStreetMap community's routing servers (routing.openstreetmap.de): OSRM with separate car, foot and
 *    bike graphs. They ask callers to identify themselves, which the User-Agent does.
 * 2. Valhalla on the same community's servers (valhalla1.openstreetmap.de): a different engine and server.
 * 3. OSRM's own demo server (router.project-osrm.org): car only, and it refuses some traffic; last resort.
 *
 * All use OpenStreetMap data. Points are [lat, lng]; the result's coordinates are [lng, lat] (GeoJSON order).
 */

export type RouteMode = "driving" | "walking" | "cycling";

export interface RoadRoute {
  coordinates: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
}

const UA = "TheLens/1.0 (+https://afrilensconsulting.com; crisis monitoring)";
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const OSM_DE_PROFILE: Record<RouteMode, string> = { driving: "routed-car", walking: "routed-foot", cycling: "routed-bike" };
const VALHALLA_COSTING: Record<RouteMode, string> = { driving: "auto", walking: "pedestrian", cycling: "bicycle" };

async function osrm(base: string, profile: string, points: [number, number][], f: Fetcher): Promise<Omit<RoadRoute, "provider">> {
  const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const res = await f(`${base}/route/v1/${profile}/${coords}?overview=full&geometries=geojson`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`returned ${res.status}`);
  const raw = (await res.json()) as { code: string; routes?: { geometry: { coordinates: [number, number][] }; distance: number; duration: number }[] };
  const r = raw.routes?.[0];
  if (raw.code !== "Ok" || !r) throw new Error("found no route between those points");
  return { coordinates: r.geometry.coordinates, distanceMeters: r.distance, durationSeconds: r.duration };
}

/** Google's encoded polyline at 6-digit precision (Valhalla's shape), to [lng, lat]. */
export function decodePolyline6(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lng += next();
    out.push([lng / 1e6, lat / 1e6]);
  }
  return out;
}

async function valhalla(mode: RouteMode, points: [number, number][], f: Fetcher): Promise<Omit<RoadRoute, "provider">> {
  const body = { locations: points.map(([lat, lon]) => ({ lat, lon })), costing: VALHALLA_COSTING[mode], directions_options: { units: "kilometers" }, directions_type: "none" };
  const res = await f(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(body))}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`returned ${res.status}`);
  const raw = (await res.json()) as { trip?: { legs: { shape: string }[]; summary: { length: number; time: number } } };
  if (!raw.trip?.legs?.length) throw new Error("found no route between those points");
  return { coordinates: raw.trip.legs.flatMap((l) => decodePolyline6(l.shape)), distanceMeters: raw.trip.summary.length * 1000, durationSeconds: raw.trip.summary.time };
}

/** A road route through the points (two or more, [lat, lng]), from the first routing server that answers. */
export async function roadRoute(points: [number, number][], mode: RouteMode, f: Fetcher = fetch): Promise<RoadRoute> {
  const tries: [string, () => Promise<Omit<RoadRoute, "provider">>][] = [
    ["OpenStreetMap routing (OSRM)", () => osrm(`https://routing.openstreetmap.de/${OSM_DE_PROFILE[mode]}`, mode === "driving" ? "driving" : mode === "walking" ? "foot" : "bike", points, f)],
    ["OpenStreetMap routing (Valhalla)", () => valhalla(mode, points, f)],
  ];
  if (mode === "driving") tries.push(["OSRM demo", () => osrm("https://router.project-osrm.org", "driving", points, f)]);
  const errors: string[] = [];
  for (const [name, attempt] of tries) {
    try {
      return { ...(await attempt()), provider: name };
    } catch (err) {
      errors.push(`${name} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`No routing server could route this: ${errors.join("; ")}`);
}
