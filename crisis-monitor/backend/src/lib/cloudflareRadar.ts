import { AFRICA_CENTROIDS } from "./africaGeo";

/**
 * Internet outages and the origins of network-layer attacks, from Cloudflare Radar. Adapted from OSIRIS's
 * cloudflare-radar route (MIT, see THIRD_PARTY_NOTICES.md).
 *
 * Outages are Cloudflare's own annotations: shutdowns, power cuts and cable cuts it has confirmed, with their cause,
 * which complements the measured drops IODA gives. Attack origins are the countries most network-layer attacks
 * came from in the last week.
 *
 * Needs a free Cloudflare API token with "Radar: Read", set as the Worker secret CLOUDFLARE_RADAR_TOKEN. Without
 * it the route says so and the layer stays empty.
 */
const RADAR = "https://api.cloudflare.com/client/v4/radar";

/** Middle East and a few other centroids [lat, lon] beyond the Africa table. */
const EXTRA: Record<string, [number, number]> = {
  YE: [15.6, 48.0], SY: [34.8, 38.9], LB: [33.9, 35.9], JO: [30.6, 36.2], PS: [31.9, 35.2], IL: [31.0, 34.9], IQ: [33.2, 43.7], IR: [32.4, 53.7],
  SA: [23.9, 45.1], AE: [23.4, 53.8], OM: [21.5, 55.9], QA: [25.4, 51.2], KW: [29.3, 47.5], BH: [26.0, 50.6], TR: [38.9, 35.2], AF: [33.9, 67.7], PK: [30.4, 69.3],
};

export function centroidFor(code: string | undefined | null, world: Record<string, [number, number]> = {}): [number, number] | null {
  if (!code) return null;
  const c = code.toUpperCase();
  return AFRICA_CENTROIDS[c] ?? EXTRA[c] ?? world[c] ?? null;
}

export interface RadarOutage {
  id: string;
  lat: number;
  lon: number;
  country: string;
  countryName: string;
  scope: string;
  eventType: string;
  cause: string;
  description: string;
  start: string;
  end: string | null;
  ongoing: boolean;
  url: string;
}

export interface RadarAttackOrigin {
  country: string;
  countryName: string;
  lat: number;
  lon: number;
  /** Share of all network-layer attack traffic, per cent. */
  share: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapOutages(result: any, world: Record<string, [number, number]> = {}): RadarOutage[] {
  const out: RadarOutage[] = [];
  for (const a of result?.annotations ?? []) {
    const names: Record<string, string> = {};
    for (const d of a?.locationsDetails ?? []) if (d?.code) names[d.code] = d.name ?? d.code;
    for (const code of Array.isArray(a?.locations) ? a.locations : []) {
      const c = centroidFor(code, world);
      if (!c) continue;
      out.push({
        id: `${a?.id ?? "outage"}-${code}`,
        lat: c[0],
        lon: c[1],
        country: code,
        countryName: names[code] || code,
        scope: a?.scope || "",
        eventType: a?.eventType || "OUTAGE",
        cause: a?.outage?.outageCause || a?.outage?.outageType || "",
        description: a?.description || "",
        start: a?.startDate || "",
        end: a?.endDate || null,
        ongoing: !a?.endDate,
        url: a?.linkedUrl || "",
      });
    }
  }
  return out;
}

export function mapAttackOrigins(result: any, world: Record<string, [number, number]> = {}): RadarAttackOrigin[] {
  const out: RadarAttackOrigin[] = [];
  for (const r of result?.top_0 ?? result?.top0 ?? []) {
    const code = r?.originCountryAlpha2 ?? r?.clientCountryAlpha2 ?? r?.originCountry;
    const c = centroidFor(code, world);
    if (!c) continue;
    out.push({ country: String(code).toUpperCase(), countryName: r?.originCountryName ?? r?.clientCountryName ?? String(code), lat: c[0], lon: c[1], share: Number(Number(r?.value).toFixed(2)) || 0 });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function radarFetch(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${RADAR}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  const json = (await res.json().catch(() => null)) as { success?: boolean; errors?: { message?: string }[]; result?: unknown } | null;
  if (!res.ok || json?.success === false) throw new Error(`Cloudflare Radar ${path.split("?")[0]}: ${json?.errors?.[0]?.message ?? res.status}`);
  return json?.result ?? {};
}

export async function readRadar(token: string | undefined, world: Record<string, [number, number]>) {
  if (!token) {
    return { configured: false, outages: [] as RadarOutage[], attackOrigins: [] as RadarAttackOrigin[], errors: ["Cloudflare Radar is not set up: add a Cloudflare API token with Radar: Read as the Worker secret CLOUDFLARE_RADAR_TOKEN."] };
  }
  const [o, a] = await Promise.allSettled([radarFetch(token, "/annotations/outages?limit=100&dateRange=28d&format=json"), radarFetch(token, "/attacks/layer3/top/locations/origin?limit=25&dateRange=7d&format=json")]);
  const errors: string[] = [];
  if (o.status === "rejected") errors.push(String(o.reason instanceof Error ? o.reason.message : o.reason));
  if (a.status === "rejected") errors.push(String(a.reason instanceof Error ? a.reason.message : a.reason));
  return {
    configured: true,
    outages: o.status === "fulfilled" ? mapOutages(o.value, world) : [],
    attackOrigins: a.status === "fulfilled" ? mapAttackOrigins(a.value, world) : [],
    errors,
  };
}
