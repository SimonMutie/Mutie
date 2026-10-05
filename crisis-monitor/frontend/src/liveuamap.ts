/**
 * Links from an escalation marker to Liveuamap's own live map of the same
 * country, opened where the marker is.
 *
 * This is a link out and nothing more: no Liveuamap data is read, copied or
 * shown inside The Lens (their events are available only through their paid
 * API, and taking them from the site would breach their terms).
 *
 * Liveuamap runs a separate map per country or region, each on its own
 * address. Only addresses confirmed to exist are listed here (checked
 * 2026-10-05); every other country falls back to the Africa-wide map, which
 * the link still opens at the marker's position. `?ll=<lat>,<lon>&zoom=<n>`
 * is Liveuamap's own way of opening a map at a place.
 */

/** ISO country code -> the Liveuamap map that covers it. */
const MAP_FOR_COUNTRY: Record<string, string> = {
  SD: "sudan", // "South Sudan and Sudan News"
  SS: "sudan",
  ET: "ethiopia",
  SO: "somalia",
  NG: "nigeria",
  CD: "drcongo",
  LY: "libya",
  EG: "egypt",
  ZA: "southafrica",
  YE: "yemen",
  // The Sahel map
  ML: "sahel",
  BF: "sahel",
  NE: "sahel",
  TD: "sahel",
  MR: "sahel",
  // The West Africa map (which is also where Western Sahara is covered)
  EH: "westafrica",
  SN: "westafrica",
  GM: "westafrica",
  GN: "westafrica",
  GW: "westafrica",
  SL: "westafrica",
  LR: "westafrica",
  CI: "westafrica",
  GH: "westafrica",
  TG: "westafrica",
  BJ: "westafrica",
};
const FALLBACK_MAP = "africa";

const MAP_NAMES: Record<string, string> = {
  sudan: "Sudan",
  ethiopia: "Ethiopia",
  somalia: "Somalia",
  nigeria: "Nigeria",
  drcongo: "DR Congo",
  libya: "Libya",
  egypt: "Egypt",
  southafrica: "South Africa",
  yemen: "Yemen",
  sahel: "Sahel",
  westafrica: "West Africa",
  africa: "Africa",
};

/** How far in to open, by how precisely the marker itself is placed. */
const ZOOM: Record<string, number> = { place: 9, approximate: 8, region: 7, country: 6 };

export interface LiveuamapLink {
  url: string;
  /** "Sudan", "Sahel", "Africa" — which of their maps this opens. */
  mapName: string;
}

export function liveuamapLink(countryCode: string | null | undefined, lat: number, lon: number, precision?: string | null): LiveuamapLink {
  const map = MAP_FOR_COUNTRY[(countryCode ?? "").toUpperCase()] ?? FALLBACK_MAP;
  const zoom = ZOOM[precision ?? ""] ?? 7;
  const at = Number.isFinite(lat) && Number.isFinite(lon) ? `?zoom=${zoom}&ll=${lat.toFixed(5)}%2C${lon.toFixed(5)}` : "";
  return { url: `https://${map}.liveuamap.com/${at}`, mapName: MAP_NAMES[map] ?? "Africa" };
}

/** Opens the link in a new tab. Must be called directly from the click
 *  that asked for it, or the browser treats it as an unwanted pop-up. */
export function openLiveuamap(link: LiveuamapLink): void {
  window.open(link.url, "_blank", "noopener,noreferrer");
}
