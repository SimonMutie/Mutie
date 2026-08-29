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
} as const;
export type BasemapKey = keyof typeof BASEMAPS;
