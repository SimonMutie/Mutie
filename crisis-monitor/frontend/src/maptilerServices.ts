import { maptilerKey } from "./mapProvider";
import type { RouteProfile, RouteResult } from "./api";

/**
 * MapTiler's services through its SDK, which tags every call with the page's session: all the place searches in one
 * sitting then count as one search session (rather than one request per search), and routes join the map session.
 * Results are remembered for the visit, so the same search or the same point is never asked for twice. The SDK is
 * loaded on first use (it is shared with the 3D globe, so usually already there).
 */

async function sdk() {
  const m = await import("@maptiler/sdk");
  const key = maptilerKey();
  if (!key) throw new Error("No MapTiler key");
  m.config.apiKey = key;
  return m;
}

export interface PlaceHit {
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

const forwardCache = new Map<string, Promise<PlaceHit[]>>();
/** Places matching the text, nearest the given point first. */
export function maptilerSearch(q: string, near: { lat: number; lng: number }): Promise<PlaceHit[]> {
  // Near enough is the same search: the bias point is rounded to about 100 km.
  const k = `${q.toLowerCase()}|${near.lat.toFixed(0)},${near.lng.toFixed(0)}`;
  let p = forwardCache.get(k);
  if (!p) {
    p = sdk().then(async (m) => {
      const r = await m.geocoding.forward(q, { limit: 6, proximity: [near.lng, near.lat] });
      return r.features.map((f) => {
        const name = f.text ?? f.place_name ?? "Place";
        const full = f.place_name ?? "";
        return { name, detail: full.startsWith(name) ? full.slice(name.length).replace(/^,\s*/, "") : full, lat: f.center[1], lng: f.center[0] };
      });
    });
    p.catch(() => forwardCache.delete(k));
    forwardCache.set(k, p);
  }
  return p;
}

const reverseCache = new Map<string, Promise<string | null>>();
/** What is at a point (village, district, region, country). Points within about 100 m share an answer. */
export function maptilerPlaceAt(lat: number, lng: number): Promise<string | null> {
  const k = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  let p = reverseCache.get(k);
  if (!p) {
    p = sdk().then(async (m) => {
      const r = await m.geocoding.reverse([lng, lat], { limit: 1 });
      return r.features[0]?.place_name ?? null;
    });
    p.catch(() => reverseCache.delete(k));
    reverseCache.set(k, p);
  }
  return p;
}

const PROFILE: Record<RouteProfile, "car" | "pedestrian" | "bicycle"> = { driving: "car", walking: "pedestrian", cycling: "bicycle" };
/** A road route through [lat, lng] points with MapTiler's routing, in the shape the Lens's own route service returns. */
export async function maptilerRoute(points: [number, number][], mode: RouteProfile): Promise<RouteResult> {
  const m = await sdk();
  const r = await m.routing.directionsGet({ locations: points.map(([lat, lng]) => ({ lat, lon: lng })), profile: PROFILE[mode] } as never);
  const route = r.route;
  const coordinates = route.legs.flatMap((leg, i) => (i === 0 ? leg.geometry : leg.geometry.slice(1))) as [number, number][];
  if (coordinates.length < 2) throw new Error("No route");
  const km = r.units === "mi" ? route.summary.totalLength * 1.609344 : route.summary.totalLength;
  return { coordinates, distanceMeters: km * 1000, durationSeconds: route.summary.totalTime };
}

/** MapTiler's route when it can give one, the Lens's own route service otherwise (no key, not on the plan, no road). */
let routingRefused = false;
export async function roadRouteWithFallback(points: [number, number][], mode: RouteProfile, fallback: () => Promise<RouteResult>): Promise<RouteResult> {
  if (!maptilerKey() || routingRefused) return fallback();
  try {
    return await maptilerRoute(points, mode);
  } catch (e) {
    // Refused (routing not on the plan, or the key not allowed): stop asking for the rest of the visit.
    const status = (e as { res?: { status?: number }; status?: number })?.res?.status ?? (e as { status?: number })?.status;
    if (status === 401 || status === 403) routingRefused = true;
    return fallback();
  }
}
