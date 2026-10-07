/** Which monitoring queries are switched on as Live OSINT map layers.
 *  Kept in localStorage (per browser) so the choice survives moving between
 *  the map, a query's dashboard and the query editor, and a page reload. */
const KEY = "lens.monitoring.mapLayers";

export function loadMonitorLayerIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveMonitorLayerIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private mode / quota) — the toggle still works for this visit.
  }
}

/** Switches one query's map layer on; used when a query is created or when
 *  "Show on map" is pressed on its dashboard. */
export function enableMonitorLayer(id: string): void {
  const ids = loadMonitorLayerIds();
  ids.add(id);
  saveMonitorLayerIds(ids);
}
