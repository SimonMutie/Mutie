import { useEffect, useRef } from "react";
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./Map3D.css";

// MapLibre GL loads its own worker script from a URL it builds internally at
// runtime (not a `new URL(..., import.meta.url)` pattern Vite's asset
// pipeline can statically see), so Vite never bundled maplibre-gl-worker.mjs
// on its own. Worse, that worker file isn't even self-contained — it does
// `import ... from "./maplibre-gl-shared.mjs"` — so copying just the worker
// file (an earlier attempt, via a `?url` import) still 404'd one file deeper
// once the browser tried to load its sibling. vite.config.ts's
// copy-maplibre-worker-assets plugin now copies BOTH files together, as a
// pair, into dist/assets/maplibre-<version>/ so the relative import between
// them keeps working, and __MAPLIBRE_WORKER_URL__ (injected by that same
// config, via `define`) points here at build time.
declare const __MAPLIBRE_WORKER_URL__: string;
setWorkerUrl(__MAPLIBRE_WORKER_URL__);

/**
 * The 3D view, rebuilt on the same engine OSIRIS itself actually uses —
 * checked directly against its source (github.com/enzg/osiris-live,
 * src/components/OsirisMap.tsx): plain MapLibre GL JS, styled with CARTO's
 * free "Dark Matter" vector style (basemaps.cartocdn.com/gl/dark-matter-gl-
 * style/style.json — a different, still-keyless CARTO service from the
 * dark_all *raster* tiles that started requiring a key; confirmed live
 * before building this), rendered in MapLibre's native `globe` projection.
 *
 * This replaces the previous react-globe.gl/three-globe implementation,
 * which could only ever show whatever GeoJSON this app fed it (a ~180-
 * shape country outline layer, at coarsest resolution) — it fundamentally
 * cannot render a real vector-tile basemap. That mismatch was the actual
 * cause of the granularity complaint: OSIRIS's "3D" is a real slippy map
 * (streets, place names, water, admin boundaries down to the tile's own
 * detail level) wrapped onto a sphere, not a textured globe with a few
 * overlay shapes — the two look categorically different at any city-level
 * zoom, however the overlay layer itself was styled.
 *
 * Everything this app's own live-data layers need (points, paths, a
 * draw-area polygon) is added as ordinary MapLibre GeoJSON sources/layers
 * on top of that same style, which is how OsirisMap.tsx itself layers its
 * own live entities over the same base.
 */

export interface Map3DPoint {
  id: string;
  layerKey: string;
  lat: number;
  lng: number;
  color: string;
  size: number;
  title: string;
  subtitle: string;
  time: string | null;
  url: string | null;
  /** Conflict Escalation only — draws a warning-triangle label above the
   *  point instead of just the plain colored dot every other layer gets,
   *  colored by level. Undefined on every other layer. */
  escalationLevel?: "elevated" | "critical";
}

export interface Map3DPath {
  points: [number, number][]; // [lat, lng]
  label: string;
  color?: string;
}

interface Map3DProps {
  points: Map3DPoint[];
  paths: Map3DPath[];
  /** A closed [lat,lng] ring for the in-progress area-drawing shape, or null. */
  drawAreaRing: [number, number][] | null;
  onMapClick?: (lat: number, lng: number) => void;
  showDayNight: boolean;
  showBuildings: boolean;
  showTerrain: boolean;
}

/** CARTO's free, keyless vector basemap CDN — distinct from the raster
 *  Maps API tiles (cartocdn.com/.../dark_all) that started requiring a key
 *  partway through 2026 (see mapConstants.ts). This is the exact style URL
 *  OSIRIS's own OsirisMap.tsx uses. */
const CARTO_DARK_MATTER_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** AWS Open Data's public-domain Terrarium-encoded elevation tiles
 *  (registry.opendata.aws/terrain-tiles) — free, keyless, the same source
 *  MapLibre's own official terrain examples use. */
const TERRAIN_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

function toGeoJsonPoints(points: Map3DPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        layerKey: p.layerKey,
        color: p.color,
        size: p.size,
        title: p.title,
        subtitle: p.subtitle,
        time: p.time,
        url: p.url,
        escalationLevel: p.escalationLevel ?? null,
      },
    })),
  };
}

function toGeoJsonPaths(paths: Map3DPath[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: paths.map((p) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: p.points.map(([lat, lng]) => [lng, lat]) },
      properties: { label: p.label, color: p.color ?? "#3fd0ff" },
    })),
  };
}

function toGeoJsonRing(ring: [number, number][] | null): GeoJSON.FeatureCollection {
  if (!ring || ring.length < 3) return { type: "FeatureCollection", features: [] };
  const coords = ring.map(([lat, lng]) => [lng, lat]);
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] }, properties: {} }],
  };
}

/** The classic terminator-curve formula (the same math behind every
 *  "day/night" map overlay, public-domain astronomy — Leaflet.Terminator
 *  and similar libraries all compute it this way): for the sun's current
 *  declination and subsolar longitude, tan(lat) = -cos(lng - subsolarLng) /
 *  tan(decl) gives the boundary latitude at each longitude. The boundary is
 *  then closed around whichever pole is in permanent darkness right now. */
function nightHemisphereRing(date: Date): [number, number][] {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const RA = (Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad + 360) % 360;
  const decl = Math.asin(Math.sin(e) * Math.sin(L)) / rad;
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  const subsolarLng = (((RA - gmst) % 360) + 540) % 360 - 180;
  const declRad = decl * rad;

  const ring: [number, number][] = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const dLng = (lng - subsolarLng) * rad;
    const lat = Math.atan(-Math.cos(dLng) / Math.tan(declRad)) / rad;
    ring.push([lat, lng]);
  }
  // Close the polygon around whichever pole is currently fully dark.
  if (decl > 0) {
    ring.push([-90, 180]);
    ring.push([-90, -180]);
  } else {
    ring.push([90, 180]);
    ring.push([90, -180]);
  }
  return ring;
}

export default function Map3D({ points, paths, drawAreaRing, onMapClick, showDayNight, showBuildings, showTerrain }: Map3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const popupRef = useRef<Popup | null>(null);
  const onClickRef = useRef(onMapClick);
  onClickRef.current = onMapClick;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: CARTO_DARK_MATTER_STYLE,
      // Centered/zoomed on the same Africa/Middle East framing as the
      // reference screenshots, rather than a full whole-earth view — at
      // zoom ~2 the dark-matter style's land color (#0e0e0e) sits so close
      // to this view's own black page background (#000308) that continents
      // barely read against it; this starting view shows real granularity
      // (borders, place labels) immediately instead of requiring the
      // viewer to zoom in first to see anything.
      center: [40, 12],
      zoom: 3.4,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: true }), "bottom-right");

    map.on("load", () => {
      map.setProjection({ type: "globe" });
      // Without an explicit sky, the globe's rim has no atmosphere glow and
      // the void beyond it is just the page's own black background — the
      // sphere itself can visually disappear into that black backdrop.
      // These are the same blue tones the old three-globe atmosphere used.
      map.setSky({ "sky-color": "#000308", "horizon-color": "#1a2a4d", "horizon-fog-blend": 0.6, "atmosphere-blend": 0.4 });

      map.addSource("osiris-points", { type: "geojson", data: toGeoJsonPoints([]) });
      map.addLayer({
        id: "osiris-points-circle",
        type: "circle",
        source: "osiris-points",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["+", 3, ["*", ["get", "size"], 14]],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,0,0,0.4)",
        },
      });

      // Conflict Escalation's danger-icon treatment: a warning-triangle +
      // country-name label floating above the point, always visible (not
      // just on hover) — matching the reference design directly, distinct
      // from every other layer's plain colored dot below it.
      map.addLayer({
        id: "osiris-points-warning",
        type: "symbol",
        source: "osiris-points",
        filter: ["has", "escalationLevel"],
        layout: {
          "text-field": ["concat", "⚠ ", ["get", "title"]],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-offset": [0, -1.6],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": ["match", ["get", "escalationLevel"], "critical", "#ff3d3d", "elevated", "#ff9d4f", "#ff9d4f"],
          "text-halo-color": "#000000",
          "text-halo-width": 1.4,
        },
      });

      map.addSource("osiris-paths", { type: "geojson", data: toGeoJsonPaths([]) });
      map.addLayer({
        id: "osiris-paths-line",
        type: "line",
        source: "osiris-paths",
        paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.85 },
      });

      map.addSource("osiris-draw-area", { type: "geojson", data: toGeoJsonRing(null) });
      map.addLayer({
        id: "osiris-draw-area-fill",
        type: "fill",
        source: "osiris-draw-area",
        paint: { "fill-color": "#ffd23f", "fill-opacity": 0.25 },
      });
      map.addLayer({
        id: "osiris-draw-area-line",
        type: "line",
        source: "osiris-draw-area",
        paint: { "line-color": "#ffd23f", "line-width": 2 },
      });

      map.addSource("osiris-daynight", { type: "geojson", data: toGeoJsonRing(nightHemisphereRing(new Date())) });
      map.addLayer(
        {
          id: "osiris-daynight-fill",
          type: "fill",
          source: "osiris-daynight",
          paint: { "fill-color": "#000010", "fill-opacity": 0.45 },
          layout: { visibility: "none" },
        },
        "osiris-points-circle"
      );

      // 3D Buildings — OpenMapTiles' `building` layer (this style's own
      // source-layer, confirmed against the style JSON) carries an optional
      // render_height per OpenMapTiles' documented schema; where a tile
      // doesn't populate it, a flat fallback height still gives the same
      // "city block massing" effect OSIRIS's own "City detail" toggle goes
      // for, rather than claiming real per-building heights this free tile
      // source doesn't reliably carry everywhere.
      map.addLayer({
        id: "osiris-buildings-3d",
        type: "fill-extrusion",
        source: "carto",
        "source-layer": "building",
        minzoom: 14.5,
        paint: {
          "fill-extrusion-color": "#2a3550",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 15],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
        layout: { visibility: "none" },
      });

      map.addSource("osiris-terrain", { type: "raster-dem", tiles: [TERRAIN_TILE_URL], tileSize: 256, encoding: "terrarium", maxzoom: 15 });

      const POINT_LAYERS = ["osiris-points-circle", "osiris-points-warning"];

      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: POINT_LAYERS });
        if (hits.length > 0) return; // a point's own click handler below deals with this
        onClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
        popupRef.current?.remove();
      });

      for (const layerId of POINT_LAYERS) {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        // Deliberately NOT closing the popup here — it used to remove the
        // popup the instant the cursor left the marker, which meant moving
        // the mouse toward the popup itself (to read it or reach the "Open
        // source" link) closed it before you could. A popup now only closes
        // when you click elsewhere on the map, click its own close button,
        // or open a different point's popup (MapLibre's default
        // closeOnClick, still in effect) — the cursor reset is all that
        // belongs here.
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("click", layerId, (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          const props = f.properties as {
            title: string;
            layerKey: string;
            subtitle: string;
            time: string | null;
            url: string | null;
            escalationLevel: "elevated" | "critical" | null;
          };
          const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          popupRef.current?.remove();
          popupRef.current = new Popup({ closeButton: true, closeOnClick: true, className: "osiris-popup", maxWidth: "320px" })
            .setLngLat(coords)
            .setHTML(buildPopupHtml(props, coords))
            .addTo(map);
        });
      }

      readyRef.current = true;
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // Mounted once per Map3D instance — all live updates below go through
    // setData/setLayoutProperty on the same map instead of re-creating it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("osiris-points") as GeoJSONSource | undefined)?.setData(toGeoJsonPoints(points));
  }, [points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("osiris-paths") as GeoJSONSource | undefined)?.setData(toGeoJsonPaths(paths));
  }, [paths]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("osiris-draw-area") as GeoJSONSource | undefined)?.setData(toGeoJsonRing(drawAreaRing));
  }, [drawAreaRing]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setLayoutProperty("osiris-daynight-fill", "visibility", showDayNight ? "visible" : "none");
    if (!showDayNight) return;
    (map.getSource("osiris-daynight") as GeoJSONSource | undefined)?.setData(toGeoJsonRing(nightHemisphereRing(new Date())));
    // The terminator moves on the order of minutes, not frames — refreshing
    // every minute keeps it honest without redrawing constantly.
    const interval = setInterval(() => {
      (map.getSource("osiris-daynight") as GeoJSONSource | undefined)?.setData(toGeoJsonRing(nightHemisphereRing(new Date())));
    }, 60_000);
    return () => clearInterval(interval);
  }, [showDayNight]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setLayoutProperty("osiris-buildings-3d", "visibility", showBuildings ? "visible" : "none");
  }, [showBuildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (showTerrain) {
      map.setTerrain({ source: "osiris-terrain", exaggeration: 1.3 });
    } else {
      map.setTerrain(null);
    }
  }, [showTerrain]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

const LEVEL_LABEL: Record<"elevated" | "critical", string> = { elevated: "ELEVATED", critical: "CRITICAL" };

/** Builds the popup card's inner HTML — styling lives in Map3D.css (the
 *  `.osiris-popup` classes below), not inline, so it's one place to keep
 *  consistent and easy to re-theme. Escalation points (Conflict Escalation
 *  layer) get the fuller SEVERITY/COORDS layout from the reference design;
 *  every other layer keeps the simpler title/subtitle/time card it already
 *  had, just restyled onto a readable dark background. Either shape gets an
 *  "OPEN SOURCE" link whenever the point actually has one — previously
 *  dropped entirely, since Map3DPoint didn't even carry `url`. */
function buildPopupHtml(
  props: { title: string; layerKey: string; subtitle: string; time: string | null; url: string | null; escalationLevel: "elevated" | "critical" | null },
  coords: [number, number]
): string {
  const linkHtml = props.url
    ? `<a class="osiris-popup-link" href="${escapeHtml(props.url)}" target="_blank" rel="noopener noreferrer">[ OPEN SOURCE ↗ ]</a>`
    : "";

  if (props.escalationLevel) {
    const [lng, lat] = coords;
    return (
      `<div class="osiris-popup-card">` +
      `<div class="osiris-popup-title osiris-popup-title--${props.escalationLevel}">⚠ ${escapeHtml(props.title)}</div>` +
      `<div class="osiris-popup-desc">${escapeHtml(props.subtitle ?? "")}</div>` +
      `<div class="osiris-popup-grid">` +
      `<div><div class="osiris-popup-label">SEVERITY</div><div class="osiris-popup-value osiris-popup-value--${props.escalationLevel}">${LEVEL_LABEL[props.escalationLevel]}</div></div>` +
      `<div><div class="osiris-popup-label">COORDS</div><div class="osiris-popup-value">${lat.toFixed(3)}°, ${lng.toFixed(3)}°</div></div>` +
      `</div>` +
      linkHtml +
      `</div>`
    );
  }

  return (
    `<div class="osiris-popup-card">` +
    `<div class="osiris-popup-title">${escapeHtml(props.title)}</div>` +
    `<div class="osiris-popup-layer">${escapeHtml(props.layerKey)}</div>` +
    `<div class="osiris-popup-desc">${escapeHtml(props.subtitle ?? "")}</div>` +
    (props.time ? `<div class="osiris-popup-time">${new Date(props.time).toLocaleString()}</div>` : "") +
    linkHtml +
    `</div>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}
