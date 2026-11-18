import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * The MapTiler key for the paid basemaps, fetched once after sign-in (the admin sets it in Settings; it is kept in
 * the database, never in the code). Map components call useMapTilerKey() so they redraw with the better maps as
 * soon as the key arrives; without a key every map keeps its free basemap.
 */
let key: string | null = null;
let loaded = false;
const EVENT = "lens:map-provider";

export const maptilerKey = () => key;

export async function loadMapProvider(): Promise<void> {
  try {
    const r = await api.getMapProvider();
    key = r.maptiler || null;
  } catch {
    key = null;
  }
  loaded = true;
  window.dispatchEvent(new Event(EVENT));
}

/** After the admin saves a new key in Settings. */
export function setMapTilerKey(next: string | null): void {
  key = next || null;
  loaded = true;
  window.dispatchEvent(new Event(EVENT));
}

export function useMapTilerKey(): { key: string | null; loaded: boolean } {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return { key, loaded };
}

export const MAPTILER_ATTRIBUTION = '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">&copy; OpenStreetMap contributors</a>';

/** A raster tile address for a MapTiler map style; {r} gives sharper (@2x) tiles on high-density screens. */
export const maptilerRaster = (style: string, ext: "png" | "jpg" = "png") => `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}{r}.${ext}?key=${key ?? ""}`;
/** A MapTiler vector style (for the 3D globe). */
export const maptilerStyle = (style: string) => `https://api.maptiler.com/maps/${style}/style.json?key=${key ?? ""}`;
/** MapTiler's elevation tiles (for 3D terrain). */
export const maptilerTerrain = () => `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${key ?? ""}`;
