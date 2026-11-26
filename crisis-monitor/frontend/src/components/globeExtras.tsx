import { useEffect, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { maptilerKey } from "../mapProvider";
import { loadLensFocus, LENS_FOCUS_STYLE } from "../lensFocus";

/**
 * MapTiler content drawn on the 3D globe, beneath the Lens's own markers and above the basemap:
 *  - the Lens basemap's Africa and Middle East focus,
 *  - sea-floor depth (MapTiler Ocean) and land cover (MapTiler Landcover),
 *  - the admin's own datasets uploaded to MapTiler (MapTiler Data, as GeoJSON).
 * Each adds its layers once, then shows or hides them.
 */

/** Layers that sit under the Lens's data: basemaps, relief, these overlays and weather. */
export const UNDER = ["lens-basemap-", "lens-relief-", "lens-overlay-", "lens-focus-", "lens-data-", "lens-weather-", "lens-control-"];
/** The first Lens data layer (markers, lines, heat): new under-layers go just beneath it. */
export function firstDataLayer(map: MapLibreMap): string | undefined {
  return (map.getStyle().layers ?? []).find((l) => l.id.startsWith("lens-") && !UNDER.some((p) => l.id.startsWith(p)))?.id;
}

function setVisible(map: MapLibreMap, ids: string[], on: boolean) {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/** The Lens basemap's focus: the world outside Africa and the Middle East dimmed, the region outlined. */
export function GlobeFocus({ map, on }: { map: MapLibreMap | null; on: boolean }) {
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const ids = ["lens-focus-mask", "lens-focus-outline"];
    if (map.getLayer(ids[0])) {
      setVisible(map, ids, on);
      return;
    }
    if (!on) return;
    loadLensFocus().then((f) => {
      if (cancelled || map.getLayer(ids[0])) return;
      const before = firstDataLayer(map);
      map.addSource("lens-focus-mask", { type: "geojson", data: f.mask as never });
      map.addSource("lens-focus-outline", { type: "geojson", data: f.outline as never });
      map.addLayer({ id: "lens-focus-mask", type: "fill", source: "lens-focus-mask", paint: { "fill-color": LENS_FOCUS_STYLE.maskColor, "fill-opacity": LENS_FOCUS_STYLE.maskOpacity } }, before);
      map.addLayer({ id: "lens-focus-outline", type: "line", source: "lens-focus-outline", paint: { "line-color": LENS_FOCUS_STYLE.line, "line-opacity": LENS_FOCUS_STYLE.lineOpacity, "line-width": 1.1 } }, before);
    });
    return () => {
      cancelled = true;
    };
  }, [map, on]);
  return null;
}

/** Sea-floor depth colours (MapTiler Ocean), from shallow shelf to the deep ocean, metres below sea level. */
const DEPTH_STOPS: [number, string][] = [[-50, "#5fb4d6"], [-200, "#3f93c0"], [-1000, "#2a6fa3"], [-3000, "#1c4f82"], [-6000, "#123566"]];
/** Land cover colours (MapTiler Landcover classes). */
const COVER: Record<string, string> = { crop: "#c9b458", grass: "#8fb35a", scrub: "#a8925a", tree: "#4d8f4a", forest: "#2f6b3a", snow: "#e8eef2" };

export interface GlobeOverlayState {
  seaDepth: boolean;
  landcover: boolean;
}

export function GlobeOverlays({ map, state }: { map: MapLibreMap | null; state: GlobeOverlayState }) {
  useEffect(() => {
    if (!map) return;
    const key = maptilerKey();
    if (!key) return;
    const depthIds = ["lens-overlay-depth-fill", "lens-overlay-depth-lines", "lens-overlay-depth-labels"];
    if (state.seaDepth && !map.getLayer(depthIds[0])) {
      const before = firstDataLayer(map);
      map.addSource("lens-overlay-ocean", { type: "vector", url: `https://api.maptiler.com/tiles/ocean/tiles.json?key=${key}` });
      const depth = ["to-number", ["get", "depth"], 0] as unknown as ExpressionSpecification;
      map.addLayer({ id: depthIds[0], type: "fill", source: "lens-overlay-ocean", "source-layer": "contour", paint: { "fill-color": ["interpolate", ["linear"], depth, ...DEPTH_STOPS.slice().reverse().flat()] as unknown as ExpressionSpecification, "fill-opacity": 0.55 } }, before);
      map.addLayer({ id: depthIds[1], type: "line", source: "lens-overlay-ocean", "source-layer": "contour_line", paint: { "line-color": "rgba(170, 215, 240, 0.35)", "line-width": 0.6 } }, before);
      map.addLayer({ id: depthIds[2], type: "symbol", source: "lens-overlay-ocean", "source-layer": "contour_line", minzoom: 5, layout: { "symbol-placement": "line", "text-field": ["concat", ["to-string", ["abs", depth]], " m"], "text-size": 9.5, "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#bfe3f5", "text-halo-color": "#06223c", "text-halo-width": 1 } }, before);
    }
    setVisible(map, depthIds, state.seaDepth);
    const coverIds = ["lens-overlay-landcover"];
    if (state.landcover && !map.getLayer(coverIds[0])) {
      map.addSource("lens-overlay-landcover", { type: "vector", url: `https://api.maptiler.com/tiles/landcover/tiles.json?key=${key}` });
      const match = ["match", ["get", "class"], ...Object.entries(COVER).flat(), "rgba(0,0,0,0)"] as unknown as ExpressionSpecification;
      map.addLayer({ id: coverIds[0], type: "fill", source: "lens-overlay-landcover", "source-layer": "globallandcover", paint: { "fill-color": match, "fill-opacity": 0.45 } }, firstDataLayer(map));
    }
    setVisible(map, coverIds, state.landcover);
  }, [map, state.seaDepth, state.landcover]);
  return null;
}

export const LANDCOVER_KEY = Object.entries(COVER);
export const DEPTH_KEY = DEPTH_STOPS;

/** A dataset from the admin's MapTiler account, as GeoJSON, fetched once per page (through MapTiler's SDK, so it
 *  counts within the map session). */
export interface MapTilerDataset {
  id: string;
  label: string;
  color: string;
}
const datasetCache = new Map<string, Promise<GeoJSON.FeatureCollection>>();
export function loadDataset(id: string): Promise<GeoJSON.FeatureCollection> {
  let p = datasetCache.get(id);
  if (!p) {
    p = import("@maptiler/sdk").then(async (sdk) => {
      const key = maptilerKey();
      if (key) sdk.config.apiKey = key;
      return (await sdk.data.get(id)) as unknown as GeoJSON.FeatureCollection;
    });
    p.catch(() => datasetCache.delete(id));
    datasetCache.set(id, p);
  }
  return p;
}

/** The chosen datasets on the globe: areas filled, lines drawn, points as dots, with their name on hover. */
export function GlobeDatasets({ map, datasets, onError }: { map: MapLibreMap | null; datasets: MapTilerDataset[]; onError?: (label: string) => void }) {
  const [loaded, setLoaded] = useState<Record<string, GeoJSON.FeatureCollection>>({});
  useEffect(() => {
    for (const d of datasets) {
      if (loaded[d.id]) continue;
      loadDataset(d.id)
        .then((fc) => setLoaded((m) => ({ ...m, [d.id]: fc })))
        .catch(() => onError?.(d.label));
    }
  }, [datasets, loaded, onError]);
  useEffect(() => {
    if (!map) return;
    const shown = new Set(datasets.map((d) => d.id));
    for (const d of datasets) {
      const fc = loaded[d.id];
      if (!fc) continue;
      const src = `lens-data-${d.id}`;
      if (!map.getSource(src)) {
        const before = firstDataLayer(map);
        map.addSource(src, { type: "geojson", data: fc as never });
        map.addLayer({ id: `${src}-fill`, type: "fill", source: src, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": d.color, "fill-opacity": 0.22 } }, before);
        map.addLayer({ id: `${src}-line`, type: "line", source: src, filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]], paint: { "line-color": d.color, "line-width": 1.6 } }, before);
        map.addLayer({ id: `${src}-point`, type: "circle", source: src, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": d.color, "circle-radius": 4.5, "circle-stroke-color": "rgba(0,0,0,0.45)", "circle-stroke-width": 1 } }, before);
      } else {
        (map.getSource(src) as GeoJSONSource).setData(fc as never);
      }
    }
    // Hide the ones no longer chosen.
    for (const l of map.getStyle().layers ?? []) {
      const m = /^lens-data-(.+)-(fill|line|point)$/.exec(l.id);
      if (m) map.setLayoutProperty(l.id, "visibility", shown.has(m[1]) ? "visible" : "none");
    }
  }, [map, datasets, loaded]);
  return null;
}
