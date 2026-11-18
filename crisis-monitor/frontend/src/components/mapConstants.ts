import { maptilerKey, maptilerRaster, MAPTILER_ATTRIBUTION } from "../mapProvider";

/** Basemap tile providers shared between IncidentsMap and MapDefaultsPanel.
 *  Lives in its own file specifically to avoid a circular import: the map
 *  needs to render MapDefaultsPanel (as its own admin-only settings icon),
 *  and MapDefaultsPanel needs this same basemap list for its own picker —
 *  having either file import the other for this would create a cycle. */
export const BASEMAPS = {
  osm: {
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  esriStreet: {
    label: "Esri Streets",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
  esriImagery: {
    label: "Esri Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
  osmHot: {
    label: "OSM Humanitarian",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>',
  },
  topo: {
    label: "OpenTopoMap",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
  cyclosm: {
    label: "CyclOSM",
    url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.cyclosm.org">CyclOSM</a> | Map data: &copy; OpenStreetMap contributors',
  },
  esriLight: {
    label: "Light grey",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors",
  },
  esriTopo: {
    label: "Esri Terrain",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, OpenStreetMap contributors",
  },
  dark: {
    // CARTO's free anonymous dark_all tiles (used here originally) started
    // requiring an API key partway through 2026 — every unauthenticated
    // request now renders an "API KEY REQUIRED" watermark instead of a map.
    // Esri's Dark Gray Canvas is the keyless equivalent, served the same
    // no-key way as the Esri Streets/Imagery entries above.
    label: "Dark",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors",
  },
  // MapTiler (paid, sharper and richer): only offered once the admin has set the key in Settings.
  mtStreets: {
    label: "MapTiler Streets",
    get url() {
      return maptilerRaster("streets-v2", "png");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
  mtDark: {
    label: "MapTiler Dark",
    get url() {
      return maptilerRaster("streets-v2-dark", "png");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
  mtDataDark: {
    label: "MapTiler Data (dark)",
    get url() {
      return maptilerRaster("dataviz-dark", "png");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
  mtDataLight: {
    label: "MapTiler Data (light)",
    get url() {
      return maptilerRaster("dataviz", "png");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
  mtOutdoor: {
    label: "MapTiler Outdoor",
    get url() {
      return maptilerRaster("outdoor-v2", "png");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
  mtTopo: {
    label: "MapTiler Topographic",
    get url() {
      return maptilerRaster("topo-v2", "png");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
  mtToner: {
    label: "MapTiler Toner",
    get url() {
      return maptilerRaster("toner-v2", "png");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
  mtSatellite: {
    label: "MapTiler Satellite",
    get url() {
      return maptilerRaster("satellite", "jpg");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
  mtHybrid: {
    label: "MapTiler Satellite + labels",
    get url() {
      return maptilerRaster("hybrid", "jpg");
    },
    attribution: MAPTILER_ATTRIBUTION,
  },
} as const;
export type BasemapKey = keyof typeof BASEMAPS;

const isMapTiler = (k: string) => k.startsWith("mt");
/** The basemaps that can be offered now: MapTiler's only once its key is set. */
export const basemapKeys = (): BasemapKey[] => (Object.keys(BASEMAPS) as BasemapKey[]).filter((k) => !isMapTiler(k) || !!maptilerKey());
/**
 * The basemap to draw for a choice: no choice (null) means the best default; a MapTiler choice without the key falls
 * back to its free equivalent; any other choice is kept exactly.
 */
export function resolveBasemap(k: string | null | undefined): BasemapKey {
  if (!k || !(k in BASEMAPS)) return defaultBasemap();
  if (isMapTiler(k) && !maptilerKey()) return k === "mtSatellite" || k === "mtHybrid" ? "esriImagery" : k === "mtDark" || k === "mtDataDark" ? "dark" : "osm";
  return k as BasemapKey;
}
/** The admin's platform default: the stock "osm" (never deliberately changed) counts as no choice. */
export const adminDefaultChoice = (k: string | null | undefined): BasemapKey | null => (k && k !== "osm" && k in BASEMAPS ? (k as BasemapKey) : null);
/** The default basemap: MapTiler Streets when the key is set, otherwise OpenStreetMap. */
export const defaultBasemap = (fallback: BasemapKey = "osm"): BasemapKey => (maptilerKey() ? (fallback === "osm" ? "mtStreets" : fallback) : fallback);
