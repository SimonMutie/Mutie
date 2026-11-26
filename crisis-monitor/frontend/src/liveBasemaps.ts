import { maptilerExtras, maptilerKey, maptilerSession, MAPTILER_ATTRIBUTION } from "./mapProvider";

/**
 * The basemaps of Live OSINT, shared by both map engines (the 3D globe and the flat map) so any basemap works in
 * either view and looks the same in both. MapTiler's (sharper, richer) once the admin has set its key in Settings;
 * the free providers otherwise, where they have an equivalent (Outdoor, Topographic, Data and Toner need MapTiler).
 */

export type BasemapId = "lens" | "strategic" | "dark" | "streets" | "satellite-labels" | "satellite" | "outdoor" | "topo" | "ocean" | "landscape" | "muted" | "data-dark" | "data-light" | "toner";

interface Def {
  id: BasemapId;
  label: string;
  hint: string;
  /** MapTiler map style and tile format. */
  mt: { style: string; ext: "png" | "jpg" };
  /** The free equivalent, if there is one. */
  free?: { url: string; attribution: string; retina?: boolean };
}

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
const ESRI_ATTR = "Imagery &copy; Esri, Maxar, Earthstar Geographics";

const DEFS: Def[] = [
  // The Lens's own basemap: the admin's custom MapTiler style when one is set in Settings, otherwise a quiet dark
  // map; either way with the Africa and Middle East focus (the rest of the world dimmed, see lensFocus.ts).
  { id: "lens", label: "Lens", hint: "The Lens's own map: Africa and the Middle East in focus", mt: { style: "backdrop-dark", ext: "png" } },
  // Strategic: on the globe, the Lens's own navy map drawn from its borders, with a bright atmosphere (strategic/
  // strategicBase.ts); on the flat map, a quiet dark map without labels.
  { id: "strategic", label: "Strategic", hint: "Navy globe with country borders only, data first", mt: { style: "dataviz-dark", ext: "png" }, free: { url: "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", attribution: CARTO_ATTR, retina: true } },
  { id: "dark", label: "Dark", hint: "Night-time streets, the Lens's default", mt: { style: "streets-v2-dark", ext: "png" }, free: { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: CARTO_ATTR, retina: true } },
  { id: "streets", label: "Streets", hint: "Roads, towns and place names", mt: { style: "streets-v2", ext: "png" }, free: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR } },
  { id: "satellite-labels", label: "Satellite + labels", hint: "Imagery with roads and place names", mt: { style: "hybrid", ext: "jpg" }, free: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: ESRI_ATTR } },
  { id: "satellite", label: "Satellite", hint: "Imagery only", mt: { style: "satellite", ext: "jpg" }, free: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: ESRI_ATTR } },
  { id: "outdoor", label: "Outdoor", hint: "Terrain shading, tracks and contours", mt: { style: "outdoor-v2", ext: "png" } },
  { id: "topo", label: "Topographic", hint: "Relief, contours and land cover", mt: { style: "topo-v2", ext: "png" } },
  { id: "ocean", label: "Ocean", hint: "Sea-floor depth, for the Red Sea, Gulf of Aden and coasts", mt: { style: "ocean", ext: "png" } },
  { id: "landscape", label: "Landscape", hint: "Land cover: forest, grassland, farmland, desert", mt: { style: "landscape", ext: "png" } },
  { id: "muted", label: "Muted dark", hint: "Very quiet dark map, data first", mt: { style: "backdrop-dark", ext: "png" } },
  { id: "data-dark", label: "Data (dark)", hint: "Quiet dark map that lets data stand out", mt: { style: "dataviz-dark", ext: "png" } },
  { id: "data-light", label: "Data (light)", hint: "Quiet light map for printing and reports", mt: { style: "dataviz", ext: "png" } },
  { id: "toner", label: "Toner", hint: "High-contrast black and white", mt: { style: "toner-v2", ext: "png" } },
];

export interface LiveBasemap {
  id: BasemapId;
  label: string;
  hint: string;
  attribution: string;
  /** Leaflet (flat map): MapTiler's as 512-pixel tiles (see tileOptions), {r} for sharper tiles on high-density screens. */
  leafletUrl: string;
  /** MapLibre (3D globe): tile addresses and their size. */
  glTiles: string[];
  glTileSize: number;
}

/** The basemaps on offer now (all of them with the MapTiler key; the free ones otherwise). */
export function liveBasemaps(): LiveBasemap[] {
  const key = maptilerKey();
  return DEFS.flatMap((d): LiveBasemap[] => {
    if (key) {
      const custom = d.id === "lens" ? maptilerExtras().customStyle : null;
      const base = `https://api.maptiler.com/maps/${custom ? custom.id : d.mt.style}`;
      const sid = maptilerSession();
      return [{ id: d.id, label: d.label, hint: d.hint, attribution: MAPTILER_ATTRIBUTION, leafletUrl: `${base}/{z}/{x}/{y}{r}.${d.mt.ext}?key=${key}${sid ? `&mtsid=${sid}` : ""}`, glTiles: [`${base}/{z}/{x}/{y}.${d.mt.ext}?key=${key}`], glTileSize: 512 }];
    }
    if (!d.free) return [];
    const gl = d.free.url.replace("{r}", d.free.retina ? "@2x" : "");
    const glTiles = gl.includes("{s}") ? ["a", "b", "c"].map((s) => gl.replace("{s}", s)) : [gl];
    return [{ id: d.id, label: d.label, hint: d.hint, attribution: d.free.attribution, leafletUrl: d.free.url, glTiles, glTileSize: 256 }];
  });
}

/** A basemap by id, or Dark when it is not on offer (a MapTiler-only one without the key). */
export function liveBasemap(id: BasemapId): LiveBasemap {
  const all = liveBasemaps();
  return all.find((b) => b.id === id) ?? all.find((b) => b.id === "dark") ?? all[0];
}

export const BASEMAP_IDS = DEFS.map((d) => d.id);

/** The MapTiler map style of a basemap (for the static-image export). */
export const basemapStyleId = (id: BasemapId) => (id === "lens" && maptilerExtras().customStyle?.id) || (DEFS.find((d) => d.id === id) ?? DEFS[1]).mt.style;
