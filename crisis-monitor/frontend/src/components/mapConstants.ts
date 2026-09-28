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
} as const;
export type BasemapKey = keyof typeof BASEMAPS;
