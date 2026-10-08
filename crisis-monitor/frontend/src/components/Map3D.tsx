import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import MapNavPad from "./MapNavPad";
import { Map as MapLibreMap, Popup, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./Map3D.css";
import { liveuamapLink, openLiveuamap } from "../liveuamap";
import { api, type EscalationIncident } from "../api";
import { HEATMAP_GRADIENTS, type HeatmapStyle } from "./HeatmapLayer";
import { pinSvg } from "./actorTheme";
import EscalationHoverCard from "./EscalationHoverCard";

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
  /** Uploaded incidents only: who was involved and what happened. */
  actor?: string;
  details?: string;
  /** Conflict Escalation only — draws a warning-triangle label above the
   *  point instead of just the plain colored dot every other layer gets,
   *  colored by level. Undefined on every other layer. */
  escalationLevel?: "elevated" | "critical";
  /** Conflict Escalation only — fetches the full evidence/source-link list
   *  for this country when its popup opens. Undefined on every other layer. */
  countryCode?: string;
  /** Conflict Escalation only — how many source links the evidence endpoint
   *  has for this country's current window. Undefined on every other layer. */
  evidenceCount?: number;
  /** Conflict Escalation only — the full incident record. Not copied into
   *  the MapLibre feature (its properties must be flat); looked up by id
   *  when the marker is clicked. */
  incident?: EscalationIncident;
}

export interface Map3DPath {
  points: [number, number][]; // [lat, lng]
  label: string;
  color?: string;
  /** Line thickness in px (default 2). */
  width?: number;
}

/** Approximate territory-change circle — see the backend's
 *  /territory-changes route for exactly what this represents (a
 *  fixed-radius circle around one reported point, not a verified control
 *  boundary). `ring` is already a closed [lat,lng] polygon ring from the
 *  backend, not computed client-side. */
export interface Map3DTerritoryChange {
  id: string;
  ring: [number, number][]; // [lat, lng], closed
  title: string;
  detail: string;
  time: string | null;
  url: string | null;
}

interface Map3DProps {
  points: Map3DPoint[];
  /** When given, the view frames the points once each time this changes
   *  (and never again until it does, so it does not fight the viewer's own
   *  zooming). Used where the map shows one set of items in a panel — the
   *  query dashboard — rather than the whole Live OSINT picture. */
  fitKey?: string;
  paths: Map3DPath[];
  territoryChanges: Map3DTerritoryChange[];
  /** A closed [lat,lng] ring for the in-progress area-drawing shape, or null. */
  drawAreaRing: [number, number][] | null;
  onMapClick?: (lat: number, lng: number) => void;
  /** Hands the loaded map to whatever draws on top of it (the Map Studio), and null when it is torn down. */
  onMapReady?: (map: MapLibreMap | null) => void;
  /** [lat, lng, weight] points to draw as a heatmap, or null for none. */
  heatPoints?: [number, number, number][] | null;
  heatStyle?: HeatmapStyle;
  /** Fired whenever a point or territory-change shape is clicked (the
   *  feature's full detail, to be rendered by the caller — see
   *  Map3DDetailPanel below), or with null when the selection should clear
   *  (clicking empty map space, or a different mode taking over). Replaces
   *  the old on-map MapLibre Popup: the detail now collapses into a docked
   *  left-side panel the caller renders, per Simon's direction — a floating
   *  bubble anchored to the clicked point could cover nearby markers and
   *  got clipped at the map's edges, where a fixed side panel never does. */
  onFeatureSelect?: (feature: Map3DSelectedFeature | null) => void;
  showDayNight: boolean;
  showBuildings: boolean;
  showTerrain: boolean;
}

/** Everything the detail panel (Map3DDetailPanel) needs to render a
 *  selected feature — carried out of Map3D via onFeatureSelect instead of
 *  being turned into an HTML string for a MapLibre Popup. "territory" is
 *  an approximate territory-change circle; "point" covers every other
 *  layer, including Conflict Escalation's own richer fields (optional,
 *  undefined on every other layer's points). */
export type Map3DSelectedFeature =
  | { kind: "territory"; id: string; title: string; detail: string; time: string | null; url: string | null }
  | {
      kind: "point";
      id: string;
      title: string;
      layerKey: string;
      subtitle: string;
      time: string | null;
      url: string | null;
      actor?: string;
      details?: string;
      lat: number;
      lng: number;
      escalationLevel?: "elevated" | "critical";
      countryCode?: string;
      evidenceCount?: number;
      incident?: EscalationIncident;
    };

/** CARTO's free, keyless vector basemap CDN — distinct from the raster
 *  Maps API tiles (cartocdn.com/.../dark_all) that started requiring a key
 *  partway through 2026 (see mapConstants.ts). This is the exact style URL
 *  OSIRIS's own OsirisMap.tsx uses. */
const CARTO_DARK_MATTER_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** AWS Open Data's public-domain Terrarium-encoded elevation tiles
 *  (registry.opendata.aws/terrain-tiles) — free, keyless, the same source
 *  MapLibre's own official terrain examples use. */
const TERRAIN_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/**
 * Conflict Escalation's danger marker: a real triangle-and-exclamation-mark
 * icon, not the "⚠" text glyph the layer used before. The text glyph
 * rendered through MapLibre's text-field, which means it's drawn from
 * whatever Unicode warning-sign glyph the browser's/OS's font falls back
 * to — inconsistent in weight and shape across platforms, and on some
 * fonts closer to a thin outline than a solid "danger" symbol. Drawing it
 * once on a <canvas> and registering it as a map image (icon-image) makes
 * it a crisp, identical symbol everywhere, the same way a real pin icon
 * would be shipped as an asset rather than relying on a text character.
 */
function buildWarningIconImageData(fillColor: string): ImageData {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Triangle body.
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.06);
  ctx.lineTo(size * 0.96, size * 0.92);
  ctx.lineTo(size * 0.04, size * 0.92);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Exclamation mark: a stem + a dot, drawn as shapes rather than a text
  // glyph so it stays crisp and centered regardless of font availability.
  ctx.fillStyle = "#0b0b0b";
  const stemWidth = size * 0.09;
  ctx.fillRect(size / 2 - stemWidth / 2, size * 0.32, stemWidth, size * 0.28);
  ctx.beginPath();
  ctx.arc(size / 2, size * 0.74, stemWidth * 0.75, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
}

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
        // Deliberately omitted (not set to null) on every layer except
        // Conflict Escalation: the warning-label symbol layer below filters
        // on ["has", "escalationLevel"], which checks whether the property
        // KEY is present at all — a `null` value still counts as present.
        // Setting it unconditionally made every single layer's points (every
        // earthquake, every GDELT event, every aircraft...) sprout a
        // permanent floating title label across the whole map.
        ...(p.actor ? { actor: p.actor } : {}),
        ...(p.details ? { details: p.details } : {}),
        ...(p.escalationLevel ? { escalationLevel: p.escalationLevel } : {}),
        ...(p.countryCode ? { countryCode: p.countryCode } : {}),
        ...(p.evidenceCount != null ? { evidenceCount: p.evidenceCount } : {}),
      },
    })),
  };
}

function toGeoJsonTerritoryChanges(items: Map3DTerritoryChange[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: items.map((t) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [t.ring.map(([lat, lng]) => [lng, lat])] },
      properties: { id: t.id, title: t.title, detail: t.detail, time: t.time, url: t.url },
    })),
  };
}

function toGeoJsonPaths(paths: Map3DPath[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: paths.map((p) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: p.points.map(([lat, lng]) => [lng, lat]) },
      properties: { label: p.label, color: p.color ?? "#3fd0ff", width: p.width ?? 2 },
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

function heatColorRamp(gradient: string): unknown[] {
  const stops = Object.entries((HEATMAP_GRADIENTS[gradient] ?? HEATMAP_GRADIENTS.redFade).stops)
    .map(([k, c]) => [Number(k), c] as [number, string])
    .sort((a, b) => a[0] - b[0]);
  const ramp: unknown[] = ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)"];
  let last = 0;
  for (const [k, c] of stops) {
    const at = Math.max(k, last + 0.01);
    ramp.push(Math.min(at, 1), c);
    last = at;
    if (at >= 1) break;
  }
  return ramp;
}

export function heatPaint(style: HeatmapStyle | undefined) {
  const st = style ?? { radius: 25, blur: 20, max: 1.5, gradient: "redFade", fade: 0.05 };
  const scale = 1.5 / Math.max(0.2, st.max);
  return {
    "heatmap-weight": ["get", "w"],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.5 * scale, 9, 2 * scale],
    "heatmap-color": heatColorRamp(st.gradient),
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, st.radius * 0.5, 9, st.radius * 2.2],
    "heatmap-opacity": 0.88,
  };
}

function toGeoJsonHeat(points: [number, number, number][] | null | undefined): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: (points ?? []).map(([lat, lng, w]) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { w } })),
  };
}

export default function Map3D({ points, fitKey, paths, territoryChanges, drawAreaRing, onMapClick, onMapReady, heatPoints, heatStyle, onFeatureSelect, showDayNight, showBuildings, showTerrain }: Map3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const onClickRef = useRef(onMapClick);
  onClickRef.current = onMapClick;
  const heatRef = useRef({ points: heatPoints, style: heatStyle });
  heatRef.current = { points: heatPoints, style: heatStyle };
  const onReadyRef = useRef(onMapReady);
  onReadyRef.current = onMapReady;
  const onFeatureSelectRef = useRef(onFeatureSelect);
  onFeatureSelectRef.current = onFeatureSelect;
  // The click handler is registered once, at map load; this keeps the
  // current points reachable from it so a clicked escalation marker can be
  // matched back to its full incident record.
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const hoverCleanupRef = useRef<(() => void) | null>(null);

  // Framing the points (see `fitKey`).
  const fitKeyRef = useRef(fitKey);
  fitKeyRef.current = fitKey;
  const fittedRef = useRef<string | null>(null);
  const fitRef = useRef(() => {});
  fitRef.current = () => {
    const map = mapRef.current;
    const key = fitKeyRef.current;
    const pts = pointsRef.current;
    if (!map || !readyRef.current || !key || fittedRef.current === key || pts.length === 0) return;
    fittedRef.current = key;
    const lats = pts.map((p) => p.lat);
    const lngs = pts.map((p) => p.lng);
    const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    if (north - south < 0.05 && east - west < 0.05) map.jumpTo({ center: [west, south], zoom: 5 });
    else
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 70, maxZoom: 5.5, duration: 0 }
      );
  };

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

    map.on("load", () => {
      map.setProjection({ type: "globe" });
      // Without an explicit sky, the globe's rim has no atmosphere glow and
      // the void beyond it is just the page's own black background — the
      // sphere itself can visually disappear into that black backdrop.
      // These are the same blue tones the old three-globe atmosphere used.
      map.setSky({ "sky-color": "#000308", "horizon-color": "#1a2a4d", "horizon-fog-blend": 0.6, "atmosphere-blend": 0.4 });

      map.addImage("warning-icon-critical", buildWarningIconImageData("#ff3d3d"), { pixelRatio: 2 });
      map.addImage("warning-icon-elevated", buildWarningIconImageData("#ff9d4f"), { pixelRatio: 2 });

      // The points already in hand, not an empty set: data that arrived
      // before the style finished loading would otherwise stay undrawn
      // until the next time it changed.
      map.addSource("osiris-heat", { type: "geojson", data: toGeoJsonHeat(heatRef.current.points) });
      map.addLayer({ id: "osiris-heat-layer", type: "heatmap", source: "osiris-heat", paint: heatPaint(heatRef.current.style) as never });
      map.addSource("osiris-points", { type: "geojson", data: toGeoJsonPoints(pointsRef.current) });
      map.addLayer({
        id: "osiris-points-circle",
        type: "circle",
        source: "osiris-points",
        // Conflict Escalation points get the dedicated warning-icon layer
        // below instead — excluded here so a country isn't marked with both
        // a plain dot AND the triangle icon stacked on top of each other.
        filter: ["all", ["!", ["has", "escalationLevel"]], ["!=", ["get", "layerKey"], "My Incidents"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["+", 3, ["*", ["get", "size"], 14]],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,0,0,0.4)",
        },
      });

      // The user's uploaded incidents: teardrop pins in the actor theme colours. One image per colour,
      // drawn on demand (see the styleimagemissing handler below).
      map.addLayer({
        id: "osiris-incident-pins",
        type: "symbol",
        source: "osiris-points",
        filter: ["==", ["get", "layerKey"], "My Incidents"],
        layout: {
          "icon-image": ["concat", "incident-pin-", ["get", "color"]],
          "icon-anchor": "bottom",
          "icon-size": 0.4,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });
      map.on("styleimagemissing", (e) => {
        if (!e.id.startsWith("incident-pin-") || map.hasImage(e.id)) return;
        const svg = pinSvg(e.id.slice("incident-pin-".length), 28);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = 56;
          c.height = 75;
          c.getContext("2d")?.drawImage(img, 0, 0, 56, 75);
          if (!map.hasImage(e.id)) map.addImage(e.id, c.getContext("2d")!.getImageData(0, 0, 56, 75), { pixelRatio: 2 });
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });

      // Conflict Escalation's danger-icon treatment: a real triangle-and-
      // exclamation-mark icon (registered above via addImage) planted at
      // the country's centroid, sized and colored by severity — distinct
      // from every other layer's plain colored dot.
      map.addLayer({
        id: "osiris-points-warning-icon",
        type: "symbol",
        source: "osiris-points",
        filter: ["has", "escalationLevel"],
        layout: {
          "icon-image": ["match", ["get", "escalationLevel"], "critical", "warning-icon-critical", "elevated", "warning-icon-elevated", "warning-icon-elevated"],
          "icon-size": ["match", ["get", "escalationLevel"], "critical", 0.6, "elevated", 0.48, 0.48],
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      // Deliberately NO permanent place-name text label on the danger icon
      // (removed per Simon's "remove the red pop up names of the places" —
      // a bold, always-on, halo'd red label floating over every flagged
      // country was also visually dominating/obscuring the smaller
      // news-aggregation dots from other layers at the same cluster of
      // points, reading as if the danger marker had "replaced" them even
      // though every other layer's own features are still in the shared
      // GeoJSON source untouched (see toGeoJsonPoints below). The full
      // place name/country and its detail are still in the click detail
      // panel (Map3DDetailPanel) — this just stops it from being a
      // permanent, space-consuming map fixture. Only the icon
      // (osiris-points-warning-icon above) stays always-visible now.

      // Approximate territory-change circles ("can this automatically plot a
      // polygon of what changed") — dashed amber outline + light fill so it
      // reads as a reported-area marker, not a crisp/precise boundary.
      map.addSource("osiris-territory-changes", { type: "geojson", data: toGeoJsonTerritoryChanges([]) });
      map.addLayer({
        id: "osiris-territory-changes-fill",
        type: "fill",
        source: "osiris-territory-changes",
        paint: { "fill-color": "#ff9d4f", "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: "osiris-territory-changes-line",
        type: "line",
        source: "osiris-territory-changes",
        paint: { "line-color": "#ff9d4f", "line-width": 1.5, "line-opacity": 0.75, "line-dasharray": [2, 2] },
      });

      map.addSource("osiris-paths", { type: "geojson", data: toGeoJsonPaths([]) });
      map.addLayer({
        id: "osiris-paths-line",
        type: "line",
        source: "osiris-paths",
        paint: { "line-color": ["get", "color"], "line-width": ["coalesce", ["get", "width"], 2], "line-opacity": 0.9 },
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

      const POINT_LAYERS = ["osiris-points-circle", "osiris-incident-pins", "osiris-points-warning-icon"];
      const TERRITORY_LAYER = "osiris-territory-changes-fill";

      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: [...POINT_LAYERS, TERRITORY_LAYER] });
        if (hits.length > 0) return; // a point's/territory-circle's own click handler below deals with this
        onClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
        onFeatureSelectRef.current?.(null);
      });

      map.on("mouseenter", TERRITORY_LAYER, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", TERRITORY_LAYER, () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", TERRITORY_LAYER, (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as { id: string; title: string; detail: string; time: string | null; url: string | null };
        onFeatureSelectRef.current?.({ kind: "territory", id: props.id, title: props.title, detail: props.detail ?? "", time: props.time, url: props.url });
      });

      // Hover card for escalation markers: resting the pointer on a danger
      // marker shows what is being reported there, with links that can be
      // clicked. It is anchored to the marker (not the cursor) and stays
      // open while the pointer is on the marker or on the card itself, so
      // the pointer can travel from one to the other to reach a link.
      const hoverNode = document.createElement("div");
      const hoverRoot = createRoot(hoverNode);
      const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 30, maxWidth: "none", className: "osiris-hover-popup" }).setDOMContent(hoverNode);
      let hoverId: string | null = null;
      let hoverTimer: number | undefined;
      const hideHover = () => {
        window.clearTimeout(hoverTimer);
        hoverId = null;
        hoverPopup.remove();
      };
      const hideHoverSoon = () => {
        window.clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(hideHover, 350);
      };
      hoverNode.addEventListener("mouseenter", () => window.clearTimeout(hoverTimer));
      hoverNode.addEventListener("mouseleave", hideHoverSoon);
      hoverCleanupRef.current = () => {
        hideHover();
        // Not during React's own commit: unmounting a root from inside one is refused.
        window.setTimeout(() => hoverRoot.unmount(), 0);
      };

      // Hovering a pin shows the incident's date, place, type and details.
      const incidentHover = new Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: [0, -22], maxWidth: "260px", className: "osiris-hover-popup" });
      const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
      map.on("mousemove", "osiris-incident-pins", (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const p = f.properties as { title?: string; subtitle?: string; time?: string; actor?: string; details?: string };
        const d = p.details ? (p.details.length > 150 ? `${p.details.slice(0, 150)}…` : p.details) : "";
        incidentHover
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<div style="font:12px/1.4 system-ui,sans-serif;color:#e8e6e0;max-width:240px"><div style="font-weight:700">${esc(p.title)}</div>` +
              `<div style="opacity:.7">${esc(p.time ? formatIncidentDate(p.time) : "Date not recorded")}</div>` +
              `<div style="color:#F0D060">${esc(p.subtitle || "Type not recorded")}${p.actor ? ` <span style="color:#9B978E">· ${esc(p.actor)}</span>` : ""}</div>` +
              (d ? `<div style="margin-top:3px">${esc(d)}</div>` : "") +
              `<div style="margin-top:3px;opacity:.5;font-size:10.5px">Click for full details</div></div>`
          )
          .addTo(map);
      });
      map.on("mouseleave", "osiris-incident-pins", () => incidentHover.remove());

      for (const layerId of POINT_LAYERS) {
        map.on("mousemove", layerId, (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          const props = f.properties as { id: string; escalationLevel?: string };
          if (!props.escalationLevel) return;
          window.clearTimeout(hoverTimer);
          if (hoverId === props.id) return;
          const incident = pointsRef.current.find((p) => p.id === props.id)?.incident;
          if (!incident) return;
          hoverId = props.id;
          hoverRoot.render(<EscalationHoverCard incident={incident} clickHint="CLICK THE MARKER FOR THE CRITERIA AND EVIDENCE" />);
          hoverPopup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).addTo(map);
        });
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
          hideHoverSoon();
        });
        map.on("click", layerId, (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point") return;
          hideHover(); // the full card opens in the side panel
          const props = f.properties as {
            id: string;
            title: string;
            layerKey: string;
            subtitle: string;
            time: string | null;
            url: string | null;
            escalationLevel: "elevated" | "critical" | null;
            countryCode?: string;
            evidenceCount?: number;
            actor?: string;
            details?: string;
          };
          const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          const incident = props.escalationLevel ? pointsRef.current.find((p) => p.id === props.id)?.incident : undefined;
          // An escalation marker also opens Liveuamap's own map of that
          // country, at the marker's position, in a new tab (asked for by
          // Mutua). The incident card below still opens here as before, so
          // the evidence behind the flag is not lost by following the link.
          if (props.escalationLevel) openLiveuamap(liveuamapLink(incident?.countryCode ?? props.countryCode, lat, lng, incident?.geoPrecision));
          // Evidence fetching (Conflict Escalation's "SOURCES" list) now
          // happens inside Map3DDetailPanel itself, keyed off countryCode —
          // this just hands over the feature's own fields.
          onFeatureSelectRef.current?.({
            kind: "point",
            id: props.id,
            title: props.title,
            layerKey: props.layerKey,
            subtitle: props.subtitle ?? "",
            time: props.time,
            url: props.url,
            actor: props.actor,
            details: props.details,
            lat,
            lng,
            escalationLevel: props.escalationLevel ?? undefined,
            countryCode: props.countryCode,
            evidenceCount: props.evidenceCount,
            incident,
          });
        });
      }

      readyRef.current = true;
      fitRef.current();
      onReadyRef.current?.(map);
    });

    return () => {
      readyRef.current = false;
      onReadyRef.current?.(null);
      hoverCleanupRef.current?.();
      map.remove();
      mapRef.current = null;
    };
    // Mounted once per Map3D instance — all live updates below go through
    // setData/setLayoutProperty on the same map instead of re-creating it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heatKey = JSON.stringify([heatStyle?.gradient, heatStyle?.radius, heatStyle?.max]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("osiris-heat") as GeoJSONSource | undefined)?.setData(toGeoJsonHeat(heatPoints));
  }, [heatPoints]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("osiris-heat-layer")) return;
    const p = heatPaint(heatStyle) as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) map.setPaintProperty("osiris-heat-layer", k as never, v as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("osiris-points") as GeoJSONSource | undefined)?.setData(toGeoJsonPoints(points));
    fitRef.current();
  }, [points]);

  useEffect(() => {
    fitRef.current();
  }, [fitKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("osiris-paths") as GeoJSONSource | undefined)?.setData(toGeoJsonPaths(paths));
  }, [paths]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("osiris-territory-changes") as GeoJSONSource | undefined)?.setData(toGeoJsonTerritoryChanges(territoryChanges));
  }, [territoryChanges]);

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

  return (
    <>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <MapNavPad
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onPan={(dx, dy) => mapRef.current?.panBy([dx, dy])}
      />
    </>
  );
}

const LEVEL_LABEL: Record<"elevated" | "critical", string> = { elevated: "ELEVATED", critical: "CRITICAL" };

/**
 * The clicked feature's detail, docked to the left side of the map instead
 * of floating as a MapLibre Popup anchored to the clicked point — a
 * floating bubble could sit on top of nearby markers and got clipped at the
 * map's own edges (a point near the right edge would push its popup half
 * off-screen); a fixed side panel never does either. Renders nothing when
 * `feature` is null. Conflict Escalation's evidence/"SOURCES" list — up to
 * 100+ links — is fetched here (not in Map3D's click handler) once a
 * country's point is selected, the same lazy load the old popup did, just
 * driven by a real useEffect/useState now instead of patching the popup's
 * DOM node after the fact.
 */
export function Map3DDetailPanel({ feature, onClose }: { feature: Map3DSelectedFeature | null; onClose: () => void }) {
  const incident = feature?.kind === "point" ? feature.incident : undefined;
  // The country-level evidence fetch below only runs against a backend that
  // predates incidents (no `incident` on the feature).
  const countryCode = feature?.kind === "point" && !incident ? feature.countryCode : undefined;
  const [evidence, setEvidence] = useState<EscalationEvidenceItemLike[] | null>(null);
  const [evidenceError, setEvidenceError] = useState(false);

  useEffect(() => {
    setEvidence(null);
    setEvidenceError(false);
    if (!countryCode) return;
    let cancelled = false;
    api
      .getConflictEscalationEvidence(countryCode)
      .then((res) => {
        if (cancelled) return;
        setEvidence(res.items);
      })
      .catch(() => {
        if (cancelled) return;
        setEvidenceError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  if (!feature) return null;

  const title = feature.title;
  const url = feature.url;

  return (
    <div className="osiris-detail-panel">
      <button className="osiris-detail-panel-close" onClick={onClose} aria-label="Close">
        ×
      </button>

      {feature.kind === "territory" ? (
        <div className="osiris-popup-card">
          <div className="osiris-popup-title osiris-popup-title--elevated">◇ {title}</div>
          <div className="osiris-popup-layer">TERRITORY CHANGE (APPROXIMATE)</div>
          <div className="osiris-popup-desc">{feature.detail}</div>
          {feature.time && <div className="osiris-popup-time">{new Date(feature.time).toLocaleString()}</div>}
          {url && (
            <a className="osiris-popup-link" href={url} target="_blank" rel="noopener noreferrer">
              [ OPEN SOURCE ↗ ]
            </a>
          )}
        </div>
      ) : incident ? (
        <EscalationIncidentCard incident={incident} />
      ) : feature.escalationLevel ? (
        <div className="osiris-popup-card osiris-popup-card--escalation">
          <div className={`osiris-popup-title osiris-popup-title--${feature.escalationLevel}`}>⚠ {title}</div>
          {/* Fallback card, shown only against a backend that predates
           *  incidents (no `incident` on the feature). */}
          <div className="osiris-popup-desc">{feature.subtitle}</div>
          <div className="osiris-popup-grid">
            <div>
              <div className="osiris-popup-label">SEVERITY</div>
              <div className={`osiris-popup-value osiris-popup-value--${feature.escalationLevel}`}>{LEVEL_LABEL[feature.escalationLevel]}</div>
            </div>
            <div>
              <div className="osiris-popup-label">COORDS</div>
              <div className="osiris-popup-value">
                {feature.lat.toFixed(3)}°, {feature.lng.toFixed(3)}°
              </div>
            </div>
          </div>
          {url && (
            <a className="osiris-popup-link" href={url} target="_blank" rel="noopener noreferrer">
              [ OPEN SOURCE ↗ ]
            </a>
          )}
          {countryCode && (
            <>
              <div className="osiris-popup-evidence-header">SOURCES{feature.evidenceCount ? ` (${feature.evidenceCount})` : ""}</div>
              <div className="osiris-popup-evidence-list">
                {evidenceError ? (
                  <div className="osiris-popup-evidence-empty">Sources failed to load.</div>
                ) : evidence === null ? (
                  <div className="osiris-popup-evidence-empty">Loading sources…</div>
                ) : evidence.length === 0 ? (
                  <div className="osiris-popup-evidence-empty">No individual source links captured for this window.</div>
                ) : (
                  evidence.map((item, i) => {
                    // Africa Wire and GDELT-article items both carry a real
                    // article title (the "combine their reachable links of
                    // all articles pulled with the specified indicators"
                    // link type) — plain GDELT bulk events only ever have a
                    // place name, no article title, so fall back to that.
                    const isArticle = item.source === "africa-wire" || item.source === "gdelt-article" || item.source === "article";
                    const label = isArticle ? item.title || "Untitled report" : item.placeName || "Unknown location";
                    const tagText = item.source === "africa-wire" ? "Africa Wire" : item.source === "gdelt-article" ? "GDELT" : "";
                    return (
                      <div key={i}>
                        <a className="osiris-popup-evidence-link" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                          {i + 1}. {label}
                          {tagText && <span className="osiris-popup-evidence-tag">{tagText}</span>}
                        </a>
                        {item.deepRead && (
                          <div className="osiris-popup-evidence-rationale">
                            {item.deepRead.actors.length > 0 && <strong>{item.deepRead.actors.join(", ")}: </strong>}
                            {item.deepRead.rationale}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="osiris-popup-card">
          <div className="osiris-popup-title">{title}</div>
          <div className="osiris-popup-layer">{feature.layerKey}</div>
          {feature.layerKey === "My Incidents" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, lineHeight: 1.45 }}>
              <div><span style={{ opacity: 0.6 }}>Date </span>{feature.time ? formatIncidentDate(feature.time) : "Not recorded"}</div>
              <div><span style={{ opacity: 0.6 }}>Type </span>{feature.subtitle || "Not recorded"}</div>
              {feature.actor && <div><span style={{ opacity: 0.6 }}>Actor </span>{feature.actor}</div>}
              <div style={{ marginTop: 4 }}>
                <span style={{ opacity: 0.6 }}>Details </span>
                {feature.details || "No details recorded."}
              </div>
            </div>
          ) : (
            <>
              <div className="osiris-popup-desc">{feature.subtitle}</div>
              {feature.time && <div className="osiris-popup-time">{new Date(feature.time).toLocaleString()}</div>}
            </>
          )}
          {url && (
            <a className="osiris-popup-link" href={url} target="_blank" rel="noopener noreferrer">
              [ OPEN SOURCE ↗ ]
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** A date for an incident: date-only values stay date-only (no invented midnight time). */
function formatIncidentDate(t: string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : d.toLocaleString();
}

const PRECISION_NOTE: Record<EscalationIncident["geoPrecision"], string> = {
  place: "Located at the place named in the reporting.",
  approximate: "Approximate position for the place named in the reporting.",
  region: "Region-level: the reporting names no locatable place, so the marker sits on the region.",
  country: "Country-level only: the reporting names no place, so the marker sits on the country centre.",
};

/** Renders analyst text with its inline citations ("[2]") turned into links
 *  to the numbered source they refer to. */
function CitedText({ text, incident }: { text: string; incident: EscalationIncident }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        const src = m ? incident.sources.find((s) => s.n === Number(m[1])) : undefined;
        if (!src) return <span key={i}>{part}</span>;
        return (
          <a key={i} className="osiris-incident-cite" href={src.url} target="_blank" rel="noopener noreferrer" title={src.title ?? src.domain}>
            {part}
          </a>
        );
      })}
    </>
  );
}

/** "5 Oct, 14:20" — when a source was published, to the minute: only reports from the last 24 hours count. */
const publishedAt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const shortDate = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");

/** The detail card for one flagged escalation incident: what happened and
 *  what it means (analyst text, cited), then exactly why it is flagged —
 *  the criteria met, each indicator with the quote that establishes it,
 *  and the sources. */
function EscalationIncidentCard({ incident }: { incident: EscalationIncident }) {
  const where = incident.locationLabel ? `${incident.locationLabel}, ${incident.countryName}` : incident.countryName;
  const dates = incident.firstEventDate && incident.lastEventDate && incident.firstEventDate !== incident.lastEventDate
    ? `${shortDate(incident.firstEventDate)} – ${shortDate(incident.lastEventDate)}`
    : shortDate(incident.lastEventDate);
  const liveuamap = liveuamapLink(incident.countryCode, incident.lat, incident.lon, incident.geoPrecision);
  return (
    <div className="osiris-popup-card osiris-popup-card--escalation osiris-incident">
      <div className={`osiris-popup-title osiris-popup-title--${incident.level}`}>⚠ {incident.headline}</div>
      <div className="osiris-popup-layer">{where}</div>
      <div className={`osiris-incident-precision osiris-incident-precision--${incident.geoPrecision}`}>{PRECISION_NOTE[incident.geoPrecision]}</div>
      {incident.preliminary && <div className="osiris-incident-preliminary">PRELIMINARY · FROM HEADLINES · NOT YET READ IN FULL</div>}
      <a className="osiris-popup-link" href={liveuamap.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 8 }}>
        [ OPEN {liveuamap.mapName.toUpperCase()} ON LIVEUAMAP ↗ ]
      </a>

      <div className="osiris-popup-grid osiris-incident-grid">
        <div>
          <div className="osiris-popup-label">SEVERITY</div>
          <div className={`osiris-popup-value osiris-popup-value--${incident.level}`}>{LEVEL_LABEL[incident.level]}</div>
        </div>
        <div>
          <div className="osiris-popup-label">EVENT DATE · LAST 24 H</div>
          <div className="osiris-popup-value">{dates}</div>
        </div>
        <div>
          <div className="osiris-popup-label">SOURCES</div>
          <div className="osiris-popup-value">{incident.sources.length}</div>
        </div>
        <div>
          <div className="osiris-popup-label">REPORTED DEATHS</div>
          <div className="osiris-popup-value">{incident.fatalitiesMax ?? "none stated"}</div>
        </div>
      </div>

      <div className="osiris-incident-heading">{incident.preliminary ? "WHAT IS BEING REPORTED" : "WHAT HAPPENED"}</div>
      <div className="osiris-popup-desc">
        <CitedText text={incident.summary} incident={incident} />
      </div>
      {incident.assessment && (
        <>
          <div className="osiris-incident-heading">{incident.preliminary ? "JUDGEMENT" : "ASSESSMENT"}</div>
          <div className="osiris-popup-desc">
            <CitedText text={incident.assessment} incident={incident} />
          </div>
        </>
      )}
      {incident.outlook && (
        <>
          <div className="osiris-incident-heading">WATCH FOR</div>
          <div className="osiris-popup-desc">
            <CitedText text={incident.outlook} incident={incident} />
          </div>
        </>
      )}
      {incident.caveats && <div className="osiris-incident-caveat">{incident.caveats}</div>}

      <div className="osiris-incident-heading">WHY THIS IS FLAGGED — CRITERIA MET</div>
      <ul className="osiris-incident-list">
        {incident.criteriaMet.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>

      <div className="osiris-incident-heading">INDICATORS AND THE TEXT BEHIND THEM</div>
      {incident.indicators.map((ind) => (
        <div key={ind.id} className="osiris-incident-indicator">
          <div className={`osiris-incident-indicator-label osiris-incident-indicator-label--${ind.tier}`}>{ind.label}</div>
          {ind.evidence.map((ev, i) => {
            const src = incident.sources.find((s) => s.n === ev.source);
            return (
              <div key={i} className="osiris-incident-quote">
                “{ev.quote}”{" "}
                {src && (
                  <a className="osiris-incident-cite" href={src.url} target="_blank" rel="noopener noreferrer" title={src.title ?? src.domain}>
                    [{src.n}] {src.domain}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {incident.actors.length > 0 && (
        <>
          <div className="osiris-incident-heading">ACTORS NAMED</div>
          <div className="osiris-popup-desc">{incident.actors.join(" · ")}</div>
        </>
      )}

      <div className="osiris-incident-heading">SOURCES ({incident.sources.length})</div>
      <div className="osiris-incident-sources">
        {incident.sources.map((s) => (
          <a key={s.n} className="osiris-incident-source" href={s.url} target="_blank" rel="noopener noreferrer">
            [{s.n}] {s.title || s.domain}
            <span className="osiris-incident-source-meta">
              {s.domain} · {publishedAt(s.publishedAt)}
              {s.textBasis === "feed_summary" ? " · summary only" : s.textBasis === "headline" ? " · headline only" : ""}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Narrowed shape of api.ts's EscalationEvidenceItem — declared locally so
 *  this file doesn't need a type-only import just for these few fields. */
interface EscalationEvidenceItemLike {
  placeName: string;
  sourceUrl: string;
  source?: "gdelt" | "africa-wire" | "gdelt-article" | "article";
  title?: string;
  /** An LLM's own reading of this specific item (backend's lib/deepRead.ts)
   *  — "every escalation gives a list of information that have warranted
   *  the coding": shown as a short rationale line under the link itself,
   *  rather than leaving that reasoning only in the API response. Absent
   *  when this item wasn't deep-read yet (see deepRead.ts's own doc
   *  comment on when that happens). */
  deepRead?: { confidence: "high" | "medium" | "low"; actors: string[]; locationName: string | null; rationale: string };
}
