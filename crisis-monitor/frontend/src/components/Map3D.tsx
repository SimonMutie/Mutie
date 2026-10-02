import { useEffect, useRef } from "react";
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./Map3D.css";
import { api } from "../api";

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
  /** Conflict Escalation only — fetches the full evidence/source-link list
   *  for this country when its popup opens. Undefined on every other layer. */
  countryCode?: string;
  /** Conflict Escalation only — how many source links the evidence endpoint
   *  has for this country's current window. Undefined on every other layer. */
  evidenceCount?: number;
}

export interface Map3DPath {
  points: [number, number][]; // [lat, lng]
  label: string;
  color?: string;
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
  paths: Map3DPath[];
  territoryChanges: Map3DTerritoryChange[];
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

export default function Map3D({ points, paths, territoryChanges, drawAreaRing, onMapClick, showDayNight, showBuildings, showTerrain }: Map3DProps) {
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

      map.addImage("warning-icon-critical", buildWarningIconImageData("#ff3d3d"), { pixelRatio: 2 });
      map.addImage("warning-icon-elevated", buildWarningIconImageData("#ff9d4f"), { pixelRatio: 2 });

      map.addSource("osiris-points", { type: "geojson", data: toGeoJsonPoints([]) });
      map.addLayer({
        id: "osiris-points-circle",
        type: "circle",
        source: "osiris-points",
        // Conflict Escalation points get the dedicated warning-icon layer
        // below instead — excluded here so a country isn't marked with both
        // a plain dot AND the triangle icon stacked on top of each other.
        filter: ["!", ["has", "escalationLevel"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["+", 3, ["*", ["get", "size"], 14]],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(0,0,0,0.4)",
        },
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

      // Country-name label floating above the icon, always visible (not
      // just on hover) — matching the reference design.
      map.addLayer({
        id: "osiris-points-warning",
        type: "symbol",
        source: "osiris-points",
        filter: ["has", "escalationLevel"],
        layout: {
          "text-field": ["get", "title"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 12,
          "text-offset": [0, -2.9],
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

      const POINT_LAYERS = ["osiris-points-circle", "osiris-points-warning-icon", "osiris-points-warning"];
      const TERRITORY_LAYER = "osiris-territory-changes-fill";

      map.on("click", (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: [...POINT_LAYERS, TERRITORY_LAYER] });
        if (hits.length > 0) return; // a point's/territory-circle's own click handler below deals with this
        onClickRef.current?.(e.lngLat.lat, e.lngLat.lng);
        popupRef.current?.remove();
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
        const props = f.properties as { title: string; detail: string; time: string | null; url: string | null };
        popupRef.current?.remove();
        const popup = new Popup({ closeButton: true, closeOnClick: true, className: "osiris-popup", maxWidth: "300px" })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="osiris-popup-card">` +
              `<div class="osiris-popup-title osiris-popup-title--elevated">◇ ${escapeHtml(props.title)}</div>` +
              `<div class="osiris-popup-layer">TERRITORY CHANGE (APPROXIMATE)</div>` +
              `<div class="osiris-popup-desc">${escapeHtml(props.detail ?? "")}</div>` +
              (props.time ? `<div class="osiris-popup-time">${new Date(props.time).toLocaleString()}</div>` : "") +
              (props.url
                ? `<a class="osiris-popup-link" href="${escapeHtml(props.url)}" target="_blank" rel="noopener noreferrer">[ OPEN SOURCE ↗ ]</a>`
                : "") +
            `</div>`
          )
          .addTo(map);
        popupRef.current = popup;
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
            countryCode?: string;
            evidenceCount?: number;
          };
          const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          popupRef.current?.remove();
          const popup = new Popup({ closeButton: true, closeOnClick: true, className: "osiris-popup", maxWidth: props.escalationLevel ? "360px" : "320px" })
            .setLngLat(coords)
            .setHTML(buildPopupHtml(props, coords))
            .addTo(map);
          popupRef.current = popup;

          // Conflict Escalation: fetch every contributing report's source
          // link ("can you give all links to them") and fill them into the
          // placeholder the popup HTML already reserved a slot for, rather
          // than trying to cram potentially 100+ links into the initial
          // synchronous popup HTML.
          if (props.escalationLevel && props.countryCode) {
            const countryCode = props.countryCode;
            api
              .getConflictEscalationEvidence(countryCode)
              .then((res) => {
                // The popup may have been closed or replaced by the time this
                // resolves — only touch the DOM if it's still the live one.
                if (popupRef.current !== popup) return;
                const container = popup.getElement()?.querySelector(`[data-evidence-for="${countryCode}"]`);
                if (!container) return;
                if (res.items.length === 0) {
                  container.innerHTML = `<div class="osiris-popup-evidence-empty">No individual source links captured for this window.</div>`;
                  return;
                }
                container.innerHTML = res.items
                  .map((item, i) => {
                    // Africa Wire and GDELT-article items both carry a
                    // real article title (the "combine their reachable
                    // links of all articles pulled with the specified
                    // indicators" link type) — plain GDELT bulk events
                    // only ever have a place name, no article title, so
                    // fall back to that for those.
                    const isArticle = item.source === "africa-wire" || item.source === "gdelt-article";
                    const label = isArticle ? item.title || "Untitled report" : item.placeName || "Unknown location";
                    const tagText = item.source === "africa-wire" ? "Africa Wire" : item.source === "gdelt-article" ? "GDELT" : "";
                    const tag = tagText ? `<span class="osiris-popup-evidence-tag">${tagText}</span>` : "";
                    return (
                      `<a class="osiris-popup-evidence-link" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">` +
                      `${i + 1}. ${escapeHtml(label)}${tag}</a>`
                    );
                  })
                  .join("");
              })
              .catch(() => {
                if (popupRef.current !== popup) return;
                const container = popup.getElement()?.querySelector(`[data-evidence-for="${countryCode}"]`);
                if (container) container.innerHTML = `<div class="osiris-popup-evidence-empty">Sources failed to load.</div>`;
              });
          }
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
  props: {
    title: string;
    layerKey: string;
    subtitle: string;
    time: string | null;
    url: string | null;
    escalationLevel: "elevated" | "critical" | null;
    countryCode?: string;
    evidenceCount?: number;
  },
  coords: [number, number]
): string {
  const linkHtml = props.url
    ? `<a class="osiris-popup-link" href="${escapeHtml(props.url)}" target="_blank" rel="noopener noreferrer">[ OPEN SOURCE ↗ ]</a>`
    : "";

  if (props.escalationLevel) {
    const [lng, lat] = coords;
    // `subtitle` here is the 2-3 sentence AI ("what changed") brief when the
    // backend produced one this tick, falling back to the mechanical
    // numbers sentence otherwise — see countryEscalation.ts's ai_summary.
    // The evidence list below is filled in asynchronously after this popup
    // mounts (see the click handler) since fetching 100+ links can't block
    // the popup's initial synchronous HTML.
    const evidenceSection = props.countryCode
      ? `<div class="osiris-popup-evidence-header">SOURCES${props.evidenceCount ? ` (${props.evidenceCount})` : ""}</div>` +
        `<div class="osiris-popup-evidence-list" data-evidence-for="${escapeHtml(props.countryCode)}">Loading sources…</div>`
      : "";
    return (
      `<div class="osiris-popup-card osiris-popup-card--escalation">` +
      `<div class="osiris-popup-title osiris-popup-title--${props.escalationLevel}">⚠ ${escapeHtml(props.title)}</div>` +
      `<div class="osiris-popup-desc">${escapeHtml(props.subtitle ?? "")}</div>` +
      `<div class="osiris-popup-grid">` +
      `<div><div class="osiris-popup-label">SEVERITY</div><div class="osiris-popup-value osiris-popup-value--${props.escalationLevel}">${LEVEL_LABEL[props.escalationLevel]}</div></div>` +
      `<div><div class="osiris-popup-label">COORDS</div><div class="osiris-popup-value">${lat.toFixed(3)}°, ${lng.toFixed(3)}°</div></div>` +
      `</div>` +
      linkHtml +
      evidenceSection +
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
