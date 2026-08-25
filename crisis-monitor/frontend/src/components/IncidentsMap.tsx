import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Polyline, Polygon, Circle, GeoJSON as GeoJSONLayer, useMapEvents, useMap } from "react-leaflet";
import * as L from "leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import shp from "shpjs";
import buffer from "@turf/buffer";
import { lineString } from "@turf/helpers";
import "leaflet/dist/leaflet.css";
import { api, type IncidentFilters, type IncidentItem, type SavedRoute, type SavedShape } from "../api";

interface Props {
  /** Used as the initial dataset before the map's own category filters take
   *  over — keeps this component self-sufficient without needing the parent
   *  dashboard to change how it fetches/passes incidents. */
  incidents: IncidentItem[];
}

const BASEMAPS = {
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
type BasemapKey = keyof typeof BASEMAPS;

const ROUTE_COLORS = [
  "#0d9488", "#2f66f0", "#b3690b", "#d1352b", "#7c3aed", "#0891b2", "#65a30d", "#db2777",
  "#ea580c", "#0369a1", "#a21caf", "#4d7c0f", "#be123c", "#0f766e", "#7e22ce", "#ca8a04",
  "#1d4ed8", "#c2410c", "#166534", "#9d174d",
]; // 20 distinct auto-assigned colors before cycling repeats — full custom colors are also always available via the color picker

function severityColor(severity: string | null | undefined): string {
  const s = (severity ?? "").toLowerCase();
  if (/(critical|extreme|severe|high)/.test(s)) return "#d1352b";
  if (/(elevated|moderate|medium|med\b)/.test(s)) return "#b3690b";
  if (/(low|minor|minimal)/.test(s)) return "#17924f";
  return "#2f66f0";
}
function totalCasualties(i: IncidentItem): number {
  return (
    (i.civilian_death_child ?? 0) +
    (i.civilian_death_female ?? 0) +
    (i.civilian_death_male ?? 0) +
    (i.civilian_death_unknown ?? 0) +
    (i.civilian_injury_female ?? 0) +
    (i.civilian_injury_male ?? 0) +
    (i.civilian_injury_unknown ?? 0)
  );
}

// --- geometry helpers ---
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function kmPerDegLng(lat: number) {
  return 111.32 * Math.cos((lat * Math.PI) / 180);
}
function toXY(lat: number, lng: number, refLat: number) {
  return { x: lng * kmPerDegLng(refLat), y: lat * 111.32 };
}
function pointToSegmentDistKm(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}
function distanceToLineKm(lat: number, lng: number, line: [number, number][]): number {
  if (line.length === 0) return Infinity;
  const refLat = line[Math.floor(line.length / 2)][0];
  const p = toXY(lat, lng, refLat);
  const MAX_SEGMENTS = 400;
  const step = Math.max(1, Math.floor(line.length / MAX_SEGMENTS));
  let min = Infinity;
  for (let i = 0; i + step < line.length; i += step) {
    const a = toXY(line[i][0], line[i][1], refLat);
    const b = toXY(line[i + step][0], line[i + step][1], refLat);
    const d = pointToSegmentDistKm(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

async function fetchRoadRoute(points: [number, number][]): Promise<{ geometry: [number, number][]; distanceKm: number; durationMin: number }> {
  // OSRM's public demo server — free, no API key, but not meant for heavy/production
  // traffic. A production deployment would want a self-hosted OSRM instance or a
  // paid routing API (Mapbox/ORS/Google) instead.
  const coordStr = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`);
  if (!res.ok) throw new Error(`Routing service returned ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.[0]) throw new Error("No road route could be found through those points");
  const route = data.routes[0];
  const geometry: [number, number][] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
  return { geometry, distanceKm: route.distance / 1000, durationMin: route.duration / 60 };
}

function freehandRoute(points: [number, number][]): { geometry: [number, number][]; distanceKm: number } {
  let distanceKm = 0;
  for (let i = 0; i + 1 < points.length; i++) distanceKm += haversineKm(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
  return { geometry: points, distanceKm };
}

/** Real geodesic buffer polygon around a route line (a "corridor" of the given
 *  radius following every bend), for the faded radius overlay — not just a
 *  bounding shape, an actual buffered LineString via turf. Returns Leaflet-ready
 *  [lat,lng] ring(s); a route can produce multiple disjoint polygon rings if it
 *  self-intersects tightly, so this returns an array of rings. */
function routeBufferRings(geometry: [number, number][], radiusKm: number): [number, number][][] {
  if (geometry.length < 2 || radiusKm <= 0) return [];
  try {
    const line = lineString(geometry.map(([lat, lng]) => [lng, lat])); // turf wants [lng,lat]
    const buffered = buffer(line, radiusKm, { units: "kilometers" });
    if (!buffered) return [];
    const geom = buffered.geometry;
    if (geom.type === "Polygon") {
      return geom.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number]));
    }
    if (geom.type === "MultiPolygon") {
      return geom.coordinates.flatMap((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])));
    }
    return [];
  } catch {
    return []; // fails soft — buffer overlay just doesn't render rather than crashing the map
  }
}

function downloadRouteGeoJson(r: RouteSim) {
  const feature = {
    type: "Feature",
    properties: {
      name: r.name,
      mode: r.mode,
      distance_km: r.distanceKm,
      duration_min: r.durationMin,
    },
    geometry: {
      type: "LineString",
      coordinates: r.geometry.map(([lat, lng]) => [lng, lat]), // GeoJSON is [lng,lat]
    },
  };
  const blob = new Blob([JSON.stringify(feature, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${r.name.replace(/[^a-z0-9]+/gi, "_") || "route"}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

interface RouteSim {
  id: string;
  backendId: string | null; // null until saved
  name: string;
  mode: "road" | "freehand";
  waypoints: [number, number][];
  geometry: [number, number][];
  distanceKm: number | null;
  durationMin: number | null;
  color: string;
  visible: boolean;
  saving: boolean;
}

interface ShapeSim {
  id: string;
  backendId: string | null;
  name: string;
  source: "drawn" | "shapefile" | "geojson";
  geometry: GeoJSON.Feature | GeoJSON.FeatureCollection;
  color: string;
  fillOpacity: number;
  weight: number;
  visible: boolean;
  saving: boolean;
}

/** Wraps leaflet-draw's native drawing toolbar (polygon/rectangle/circle/polyline
 *  tools). Only mounted while shape-drawing is active. Each finished shape is
 *  captured as GeoJSON and handed off to React state — the raw Leaflet layer is
 *  then removed, since the shape gets rendered by our own state-driven layer
 *  below instead (keeps one source of truth for styling/visibility). This means
 *  there's no native re-editing of a shape's vertices after it's drawn — delete
 *  and redraw is the way to change one, which keeps things simple for now. */
function DrawControl({ active, color, onCreated }: { active: boolean; color: string; onCreated: (feature: GeoJSON.Feature) => void }) {
  const map = useMap();
  const controlRef = useRef<L.Control.Draw | null>(null);

  useEffect(() => {
    if (!active) return;

    const shapeOptions = { color, fillColor: color, fillOpacity: 0.3 };
    const control = new L.Control.Draw({
      position: "topright",
      draw: {
        polygon: { shapeOptions, showArea: true } as L.DrawOptions.PolygonOptions,
        rectangle: { shapeOptions } as L.DrawOptions.RectangleOptions,
        circle: { shapeOptions } as L.DrawOptions.CircleOptions,
        polyline: { shapeOptions: { color } } as L.DrawOptions.PolylineOptions,
        marker: false,
        circlemarker: false,
      },
    });
    map.addControl(control);
    controlRef.current = control;

    function handleCreated(e: L.DrawEvents.Created) {
      const layer = e.layer;
      let geojson: GeoJSON.Feature;
      if (layer instanceof L.Circle) {
        // Leaflet's Circle.toGeoJSON() only returns a bare Point — it does NOT
        // include the radius (verified directly against Leaflet's source; this
        // is a common wrong assumption). Build the Feature manually so the
        // radius survives, or every drawn circle would silently collapse to a
        // zero-size point.
        const center = layer.getLatLng();
        geojson = {
          type: "Feature",
          properties: { radius: layer.getRadius() },
          geometry: { type: "Point", coordinates: [center.lng, center.lat] },
        };
      } else {
        geojson = (layer as L.Layer & { toGeoJSON: () => GeoJSON.Feature }).toGeoJSON();
      }
      onCreated(geojson);
      map.removeLayer(layer); // rendered via React state instead, see comment above
    }
    map.on(L.Draw.Event.CREATED, handleCreated as L.LeafletEventHandlerFn);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated as L.LeafletEventHandlerFn);
      map.removeControl(control);
      controlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, color, map]);

  return null;
}

function ClickCapture({ active, onClick }: { active: boolean; onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      if (active) onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Pans/zooms the map to fit a route's geometry when it's isolated via "Search
 *  route for incidents" — without this the user would have to manually find
 *  the route after everything else disappears from view. */
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      map.fitBounds(positions, { padding: [40, 40] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions]);
  return null;
}

export default function IncidentsMap({ incidents: initialIncidents }: Props) {
  const [basemap, setBasemap] = useState<BasemapKey>("osm");

  // --- route drafting ---
  const [draftMode, setDraftMode] = useState<"road" | "freehand">("road");
  const [drafting, setDrafting] = useState(false);
  const [draftWaypoints, setDraftWaypoints] = useState<[number, number][]>([]);
  const [draftColor, setDraftColor] = useState(ROUTE_COLORS[0]);
  const [finishing, setFinishing] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  // --- saved/unsaved route simulations, all can coexist ---
  const [routes, setRoutes] = useState<RouteSim[]>([]);
  const colorIndex = useRef(0);

  // --- shape overlays: drawn or uploaded, all can coexist ---
  const [shapes, setShapes] = useState<ShapeSim[]>([]);
  const shapeColorIndex = useRef(0);
  const [drawingShape, setDrawingShape] = useState(false);
  const [drawColor, setDrawColor] = useState(ROUTE_COLORS[0]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // --- incident overlay filters ---
  const [incidents, setIncidents] = useState<IncidentItem[]>(initialIncidents);
  const [filterOptions, setFilterOptions] = useState<IncidentFilters | null>(null);
  const [filters, setFilters] = useState<{ sector?: string; actor?: string; tactic?: string; severity?: string; from?: string; to?: string }>({});
  const [bufferKm, setBufferKm] = useState(5);
  const [onlyNearRoute, setOnlyNearRoute] = useState(false);
  const [focusedRouteId, setFocusedRouteId] = useState<string | null>(null);

  useEffect(() => {
    api.getIncidentFilters().then(setFilterOptions).catch(() => {});
    api.getMapRoutes().then((saved) => {
      setRoutes(
        saved.map((r) => ({
          id: r.id,
          backendId: r.id,
          name: r.name,
          mode: r.mode,
          waypoints: r.waypoints,
          geometry: r.geometry,
          distanceKm: r.distance_km,
          durationMin: r.duration_min,
          color: r.color ?? ROUTE_COLORS[colorIndex.current++ % ROUTE_COLORS.length],
          visible: true,
          saving: false,
        }))
      );
    }).catch(() => {});
    api.getMapShapes().then((saved) => {
      setShapes(
        saved.map((s) => ({
          id: s.id,
          backendId: s.id,
          name: s.name,
          source: s.source,
          geometry: s.geometry,
          color: s.style.color ?? ROUTE_COLORS[shapeColorIndex.current++ % ROUTE_COLORS.length],
          fillOpacity: s.style.fillOpacity ?? 0.25,
          weight: s.style.weight ?? 2,
          visible: true,
          saving: false,
        }))
      );
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.getIncidents(filters).then(setIncidents).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const geoIncidents = useMemo(() => incidents.filter((i) => i.latitude != null && i.longitude != null), [incidents]);

  const initialCenter = useMemo((): LatLngExpression => {
    if (geoIncidents.length === 0) return [1, 20];
    const avgLat = geoIncidents.reduce((s, i) => s + i.latitude!, 0) / geoIncidents.length;
    const avgLng = geoIncidents.reduce((s, i) => s + i.longitude!, 0) / geoIncidents.length;
    return [avgLat, avgLng];
  }, [geoIncidents]);

  const focusedRoute = focusedRouteId ? routes.find((r) => r.id === focusedRouteId) ?? null : null;
  const visibleRoutes = focusedRoute ? [focusedRoute] : routes.filter((r) => r.visible);
  const nearRouteIds = useMemo(() => {
    if (visibleRoutes.length === 0) return null;
    const ids = new Set<string>();
    for (const i of geoIncidents) {
      for (const r of visibleRoutes) {
        if (distanceToLineKm(i.latitude!, i.longitude!, r.geometry) <= bufferKm) {
          ids.add(i.id);
          break;
        }
      }
    }
    return ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRoutes, bufferKm, geoIncidents]);

  function startDrafting() {
    setDrafting(true);
    setDraftWaypoints([]);
    setDraftError(null);
    setDraftColor(ROUTE_COLORS[colorIndex.current % ROUTE_COLORS.length]);
  }
  function cancelDrafting() {
    setDrafting(false);
    setDraftWaypoints([]);
    setDraftError(null);
  }
  function addDraftPoint(lat: number, lng: number) {
    setDraftWaypoints((pts) => [...pts, [lat, lng]]);
  }
  function undoDraftPoint() {
    setDraftWaypoints((pts) => pts.slice(0, -1));
  }

  async function finishRoute() {
    if (draftWaypoints.length < 2) return;
    setFinishing(true);
    setDraftError(null);
    try {
      const color = draftColor;
      colorIndex.current++; // still advance so the *next* new route's default differs
      let geometry: [number, number][];
      let distanceKm: number | null;
      let durationMin: number | null = null;

      if (draftMode === "road") {
        const result = await fetchRoadRoute(draftWaypoints);
        geometry = result.geometry;
        distanceKm = result.distanceKm;
        durationMin = result.durationMin;
      } else {
        const result = freehandRoute(draftWaypoints);
        geometry = result.geometry;
        distanceKm = result.distanceKm;
      }

      const sim: RouteSim = {
        id: crypto.randomUUID(),
        backendId: null,
        name: `Route ${routes.length + 1}`,
        mode: draftMode,
        waypoints: draftWaypoints,
        geometry,
        distanceKm,
        durationMin,
        color,
        visible: true,
        saving: false,
      };
      setRoutes((r) => [...r, sim]);
      setDrafting(false);
      setDraftWaypoints([]);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Couldn't build that route");
    } finally {
      setFinishing(false);
    }
  }

  async function saveRoute(id: string) {
    const sim = routes.find((r) => r.id === id);
    if (!sim) return;

    const name = window.prompt("Save this route as:", sim.name);
    if (name === null) return; // cancelled
    const trimmedName = name.trim() || sim.name;

    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, name: trimmedName, saving: true } : r)));
    try {
      const saved = await api.createMapRoute({
        name: trimmedName,
        mode: sim.mode,
        waypoints: sim.waypoints,
        geometry: sim.geometry,
        distance_km: sim.distanceKm,
        duration_min: sim.durationMin,
        color: sim.color,
      });
      setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, backendId: saved.id, saving: false } : r)));
    } catch {
      setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, saving: false } : r)));
    }
  }

  async function deleteRoute(id: string) {
    const sim = routes.find((r) => r.id === id);
    setRoutes((rs) => rs.filter((r) => r.id !== id));
    if (sim?.backendId) {
      await api.deleteMapRoute(sim.backendId).catch(() => {});
    }
  }

  function renameRoute(id: string, name: string) {
    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, name } : r)));
  }
  async function commitRename(id: string) {
    const sim = routes.find((r) => r.id === id);
    if (sim?.backendId) api.updateMapRoute(sim.backendId, { name: sim.name }).catch(() => {});
  }
  function toggleVisible(id: string) {
    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r)));
  }
  function setRouteColor(id: string, color: string) {
    setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, color } : r)));
    const sim = routes.find((r) => r.id === id);
    if (sim?.backendId) api.updateMapRoute(sim.backendId, { color }).catch(() => {});
  }
  function downloadAllRoutes() {
    const collection = {
      type: "FeatureCollection",
      features: routes.map((r) => ({
        type: "Feature",
        properties: { name: r.name, mode: r.mode, distance_km: r.distanceKm, duration_min: r.durationMin },
        geometry: { type: "LineString", coordinates: r.geometry.map(([lat, lng]) => [lng, lat]) },
      })),
    };
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "route_simulations.geojson";
    a.click();
    URL.revokeObjectURL(url);
  }

  function addDrawnShape(feature: GeoJSON.Feature) {
    const color = drawColor;
    shapeColorIndex.current++;
    const sim: ShapeSim = {
      id: crypto.randomUUID(),
      backendId: null,
      name: `Shape ${shapes.length + 1}`,
      source: "drawn",
      geometry: feature,
      color,
      fillOpacity: 0.25,
      weight: 2,
      visible: true,
      saving: false,
    };
    setShapes((s) => [...s, sim]);
  }

  async function handleShapeFileUpload(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      let geometry: GeoJSON.Feature | GeoJSON.FeatureCollection;
      let source: "shapefile" | "geojson";

      if (file.name.toLowerCase().endsWith(".zip")) {
        const buf = await file.arrayBuffer();
        const result = await shp(buf);
        geometry = Array.isArray(result) ? { type: "FeatureCollection", features: result.flatMap((fc) => fc.features) } : result;
        source = "shapefile";
      } else if (file.name.toLowerCase().endsWith(".geojson") || file.name.toLowerCase().endsWith(".json")) {
        const text = await file.text();
        geometry = JSON.parse(text);
        source = "geojson";
      } else {
        throw new Error("Unsupported file type — use a zipped shapefile (.zip) or a GeoJSON file (.geojson/.json)");
      }

      const color = ROUTE_COLORS[shapeColorIndex.current++ % ROUTE_COLORS.length];
      const sim: ShapeSim = {
        id: crypto.randomUUID(),
        backendId: null,
        name: file.name.replace(/\.(zip|geojson|json)$/i, ""),
        source,
        geometry,
        color,
        fillOpacity: 0.25,
        weight: 2,
        visible: true,
        saving: false,
      };
      setShapes((s) => [...s, sim]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't read that file");
    } finally {
      setUploading(false);
    }
  }

  function toggleShapeVisible(id: string) {
    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)));
  }
  function renameShape(id: string, name: string) {
    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  async function commitShapeRename(id: string) {
    const sim = shapes.find((s) => s.id === id);
    if (sim?.backendId) api.updateMapShape(sim.backendId, { name: sim.name }).catch(() => {});
  }
  function setShapeColor(id: string, color: string) {
    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, color } : s)));
    const sim = shapes.find((s) => s.id === id);
    if (sim?.backendId) api.updateMapShape(sim.backendId, { style: { color, fillColor: color } }).catch(() => {});
  }
  function setShapeOpacity(id: string, fillOpacity: number) {
    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, fillOpacity } : s)));
    const sim = shapes.find((s) => s.id === id);
    if (sim?.backendId) api.updateMapShape(sim.backendId, { style: { fillOpacity } }).catch(() => {});
  }

  async function saveShape(id: string) {
    const sim = shapes.find((s) => s.id === id);
    if (!sim) return;
    const name = window.prompt("Save this shape as:", sim.name);
    if (name === null) return;
    const trimmedName = name.trim() || sim.name;

    setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, name: trimmedName, saving: true } : s)));
    try {
      const saved = await api.createMapShape({
        name: trimmedName,
        source: sim.source,
        geometry: sim.geometry,
        style: { color: sim.color, fillColor: sim.color, fillOpacity: sim.fillOpacity, weight: sim.weight },
      });
      setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, backendId: saved.id, saving: false } : s)));
    } catch {
      setShapes((ss) => ss.map((s) => (s.id === id ? { ...s, saving: false } : s)));
    }
  }

  async function deleteShape(id: string) {
    const sim = shapes.find((s) => s.id === id);
    setShapes((ss) => ss.filter((s) => s.id !== id));
    if (sim?.backendId) await api.deleteMapShape(sim.backendId).catch(() => {});
  }

  function downloadShape(s: ShapeSim) {
    const blob = new Blob([JSON.stringify(s.geometry, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${s.name.replace(/[^a-z0-9]+/gi, "_") || "shape"}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 12,
          boxShadow: "0 4px 16px rgba(19,23,34,0.12)",
          width: 300,
          maxHeight: "calc(100% - 24px)",
          overflowY: "auto",
        }}
      >
        {/* basemap */}
        <div style={{ display: "flex", gap: 4 }}>
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
            <button key={k} onClick={() => setBasemap(k)} style={chipStyle(basemap === k)}>
              {BASEMAPS[k].label}
            </button>
          ))}
        </div>

        <div style={{ height: 1, background: "var(--border-soft)" }} />

        {/* route builder */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>ROUTE SIMULATION</div>
          {!drafting ? (
            <button onClick={startDrafting} style={primaryChipStyle}>
              + New route
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => setDraftMode("road")} style={chipStyle(draftMode === "road")}>
                  Follow roads
                </button>
                <button onClick={() => setDraftMode("freehand")} style={chipStyle(draftMode === "freehand")}>
                  Straight line
                </button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--text-muted)" }}>
                <input
                  type="color"
                  value={draftColor}
                  onChange={(e) => setDraftColor(e.target.value)}
                  style={largeColorInputStyle}
                  title="Pick any color"
                />
                Route color — click swatch for any color
              </label>
              <div style={hintStyle}>
                Click the map to add waypoints ({draftWaypoints.length} added){draftMode === "freehand" ? " — connects directly, ignores roads" : ""}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={undoDraftPoint} disabled={draftWaypoints.length === 0} style={secondaryChipStyle}>
                  Undo point
                </button>
                <button onClick={cancelDrafting} style={secondaryChipStyle}>
                  Cancel
                </button>
              </div>
              <button onClick={finishRoute} disabled={draftWaypoints.length < 2 || finishing} style={primaryChipStyle}>
                {finishing ? "Building route…" : `Finish route (${draftWaypoints.length} pts)`}
              </button>
              {draftError && <div style={{ ...hintStyle, color: "var(--critical)" }}>{draftError}</div>}
            </div>
          )}
        </div>

        {/* saved/unsaved route list */}
        {routes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="eyebrow">SIMULATIONS ({routes.length})</div>
              {routes.length > 1 && (
                <button onClick={downloadAllRoutes} style={{ ...secondaryChipStyle, flex: "none" }}>
                  Download all
                </button>
              )}
            </div>
            {routes.map((r) => (
              <div
                key={r.id}
                style={{
                  border: `1px solid ${focusedRouteId === r.id ? r.color : "var(--border-soft)"}`,
                  borderRadius: 6,
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  background: focusedRouteId === r.id ? "color-mix(in srgb, " + r.color + " 8%, transparent)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={r.visible} onChange={() => toggleVisible(r.id)} disabled={focusedRouteId !== null} />
                  <input
                    type="color"
                    value={r.color}
                    onChange={(e) => setRouteColor(r.id, e.target.value)}
                    title="Change route color — click for any color"
                    style={largeColorInputStyle}
                  />
                  <input
                    value={r.name}
                    onChange={(e) => renameRoute(r.id, e.target.value)}
                    onBlur={() => commitRename(r.id)}
                    style={{ flex: 1, fontSize: 12, border: "none", background: "transparent", color: "var(--text-primary)", minWidth: 0 }}
                  />
                </div>
                <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                  {r.mode === "road" ? "Road-following" : "Straight line"} · {r.waypoints.length} waypoints
                  {r.distanceKm != null ? ` · ${r.distanceKm.toFixed(1)} km` : ""}
                  {r.durationMin != null ? ` · ~${Math.round(r.durationMin)} min` : ""}
                </div>
                <button
                  onClick={() => setFocusedRouteId(focusedRouteId === r.id ? null : r.id)}
                  style={focusedRouteId === r.id ? primaryChipStyle : { ...primaryChipStyle, background: "var(--panel-raised)", borderColor: "var(--border)" }}
                >
                  {focusedRouteId === r.id ? "Showing this route only — click to exit" : "Search route for incidents"}
                </button>
                <div style={{ display: "flex", gap: 4 }}>
                  {r.backendId ? (
                    <span style={{ fontSize: 10.5, color: "var(--signal)" }}>Saved</span>
                  ) : (
                    <button onClick={() => saveRoute(r.id)} disabled={r.saving} style={secondaryChipStyle}>
                      {r.saving ? "Saving…" : "Save"}
                    </button>
                  )}
                  <button onClick={() => downloadRouteGeoJson(r)} style={secondaryChipStyle}>
                    Download
                  </button>
                  <button onClick={() => deleteRoute(r.id)} style={{ ...secondaryChipStyle, color: "var(--critical)" }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ height: 1, background: "var(--border-soft)" }} />

        {/* shape overlays: draw or upload */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>SHAPE OVERLAYS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button onClick={() => setDrawingShape((v) => !v)} style={drawingShape ? primaryChipStyle : { ...primaryChipStyle, background: "var(--panel-raised)", borderColor: "var(--border)" }}>
                {drawingShape ? "Drawing — click a tool top-right" : "Draw a shape"}
              </button>
              <input
                type="color"
                value={drawColor}
                onChange={(e) => setDrawColor(e.target.value)}
                title="Shape color — click for any color"
                style={largeColorInputStyle}
              />
            </div>
            {drawingShape && (
              <div style={hintStyle}>
                Use the polygon/rectangle/circle/line tools that appeared in the map's top-right corner. Toggle this off when you're done drawing.
              </div>
            )}

            <label style={secondaryChipStyle}>
              {uploading ? "Reading file…" : "Upload shapefile (.zip) or GeoJSON"}
              <input
                type="file"
                accept=".zip,.geojson,.json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleShapeFileUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
            {uploadError && <div style={{ ...hintStyle, color: "var(--critical)" }}>{uploadError}</div>}
          </div>

          {shapes.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              <div className="eyebrow">OVERLAYS ({shapes.length})</div>
              {shapes.map((s) => (
                <div key={s.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={s.visible} onChange={() => toggleShapeVisible(s.id)} />
                    <input
                      type="color"
                      value={s.color}
                      onChange={(e) => setShapeColor(s.id, e.target.value)}
                      title="Change color — click for any color"
                      style={largeColorInputStyle}
                    />
                    <input
                      value={s.name}
                      onChange={(e) => renameShape(s.id, e.target.value)}
                      onBlur={() => commitShapeRename(s.id)}
                      style={{ flex: 1, fontSize: 12, border: "none", background: "transparent", color: "var(--text-primary)", minWidth: 0 }}
                    />
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                    {s.source === "drawn" ? "Hand-drawn" : s.source === "shapefile" ? "Uploaded shapefile" : "Uploaded GeoJSON"}
                  </div>
                  <label style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                    Shading: {Math.round(s.fillOpacity * 100)}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(s.fillOpacity * 100)}
                      onChange={(e) => setShapeOpacity(s.id, Number(e.target.value) / 100)}
                      style={{ width: "100%" }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    {s.backendId ? (
                      <span style={{ fontSize: 10.5, color: "var(--signal)" }}>Saved</span>
                    ) : (
                      <button onClick={() => saveShape(s.id)} disabled={s.saving} style={secondaryChipStyle}>
                        {s.saving ? "Saving…" : "Save"}
                      </button>
                    )}
                    <button onClick={() => downloadShape(s)} style={secondaryChipStyle}>
                      Download
                    </button>
                    <button onClick={() => deleteShape(s.id)} style={{ ...secondaryChipStyle, color: "var(--critical)" }}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ height: 1, background: "var(--border-soft)" }} />

        {/* incident overlay filters */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="eyebrow">OVERLAY INCIDENTS</div>
          {focusedRoute && (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <span>
                Isolated to <strong style={{ color: focusedRoute.color }}>{focusedRoute.name}</strong>
              </span>
              <button onClick={() => setFocusedRouteId(null)} style={secondaryChipStyle}>
                Show all
              </button>
            </div>
          )}
          {filterOptions && (
            <>
              <FilterSelect label="Sector" value={filters.sector} options={filterOptions.sector} onChange={(v) => setFilters((f) => ({ ...f, sector: v }))} />
              <FilterSelect label="Actor" value={filters.actor} options={filterOptions.actor} onChange={(v) => setFilters((f) => ({ ...f, actor: v }))} />
              <FilterSelect label="Tactic" value={filters.tactic} options={filterOptions.tactic} onChange={(v) => setFilters((f) => ({ ...f, tactic: v }))} />
              <FilterSelect label="Severity" value={filters.severity} options={filterOptions.severity} onChange={(v) => setFilters((f) => ({ ...f, severity: v }))} />
            </>
          )}
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value || undefined }))}
              style={dateInputStyle}
            />
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value || undefined }))}
              style={dateInputStyle}
            />
          </div>
          {Object.values(filters).some(Boolean) && (
            <button onClick={() => setFilters({})} style={secondaryChipStyle}>
              Clear filters
            </button>
          )}
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {(onlyNearRoute || focusedRoute) && nearRouteIds ? nearRouteIds.size : geoIncidents.length} incidents shown
          </div>

          {visibleRoutes.length > 0 && (
            <>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Buffer: incidents within {bufferKm} km of {focusedRoute ? "this route" : "a visible route"}
                <input type="range" min={1} max={50} value={bufferKm} onChange={(e) => setBufferKm(Number(e.target.value))} style={{ width: "100%" }} />
              </label>
              {!focusedRoute && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
                  <input type="checkbox" checked={onlyNearRoute} onChange={(e) => setOnlyNearRoute(e.target.checked)} />
                  Only show incidents along the route
                </label>
              )}
              {nearRouteIds && (
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {nearRouteIds.size} incidents near {focusedRoute ? "this route" : "a visible route"}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <MapContainer center={initialCenter} zoom={geoIncidents.length ? 6 : 2} style={{ width: "100%", height: "100%" }} scrollWheelZoom>
        <TileLayer url={BASEMAPS[basemap].url} attribution={BASEMAPS[basemap].attribution} maxZoom={19} />
        <ClickCapture active={drafting} onClick={addDraftPoint} />
        {focusedRoute && <FitBounds positions={focusedRoute.geometry} />}
        <DrawControl active={drawingShape} color={drawColor} onCreated={addDrawnShape} />

        {/* shape overlays — Leaflet circles export as a Point + a radius property
            (GeoJSON has no native circle type), so those render via <Circle>
            with the real radius; everything else goes through the generic
            GeoJSON renderer. Keying on color/opacity forces a remount when
            restyled, since react-leaflet's GeoJSON layer doesn't otherwise
            pick up style prop changes after first render. */}
        {shapes
          .filter((s) => s.visible)
          .map((s) => {
            const feature = s.geometry.type === "Feature" ? s.geometry : null;
            const radius = feature?.properties?.radius;
            const isCircle = feature && feature.geometry.type === "Point" && typeof radius === "number";
            if (isCircle && feature) {
              const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
              return (
                <Circle
                  key={`${s.id}-${s.color}-${s.fillOpacity}`}
                  center={[lat, lng]}
                  radius={radius as number}
                  pathOptions={{ color: s.color, fillColor: s.color, fillOpacity: s.fillOpacity, weight: s.weight }}
                />
              );
            }
            return (
              <GeoJSONLayer
                key={`${s.id}-${s.color}-${s.fillOpacity}`}
                data={s.geometry}
                style={() => ({ color: s.color, fillColor: s.color, fillOpacity: s.fillOpacity, weight: s.weight })}
              />
            );
          })}

        {((onlyNearRoute || focusedRoute) && nearRouteIds ? geoIncidents.filter((i) => nearRouteIds.has(i.id)) : geoIncidents).map((i) => {
          const highlighted = !nearRouteIds || nearRouteIds.has(i.id);
          return (
            <CircleMarker
              key={i.id}
              center={[i.latitude!, i.longitude!]}
              radius={highlighted ? 6 : 4}
              pathOptions={{
                color: severityColor(i.severity),
                fillColor: severityColor(i.severity),
                fillOpacity: highlighted ? 0.85 : 0.2,
                opacity: highlighted ? 1 : 0.25,
                weight: 1,
              }}
            >
              <Popup>
                <div style={{ fontSize: 13, minWidth: 180 }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>
                    {[i.city, i.province].filter(Boolean).join(", ") || i.precise_location || "Unknown location"}
                  </div>
                  <div style={{ color: "#666", marginBottom: 4 }}>{i.occurred_date || ""}</div>
                  <div style={{ marginBottom: 4 }}>{[i.sector, i.tactic, i.actor].filter(Boolean).join(" · ")}</div>
                  {totalCasualties(i) > 0 && <div style={{ color: "#d1352b" }}>{totalCasualties(i)} civilian casualties</div>}
                  {i.details && <div style={{ marginTop: 4, color: "#444" }}>{i.details.slice(0, 200)}</div>}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* draft-in-progress waypoints + connecting line */}
        {drafting &&
          draftWaypoints.map((pt, idx) => (
            <CircleMarker key={idx} center={pt} radius={7} pathOptions={{ color: "#111", fillColor: "#fff", fillOpacity: 1, weight: 2 }}>
              <Popup>Point {idx + 1}</Popup>
            </CircleMarker>
          ))}
        {drafting && draftWaypoints.length > 1 && (
          <Polyline positions={draftWaypoints} pathOptions={{ color: "#111", weight: 2, opacity: 0.5, dashArray: "4 4" }} />
        )}

        {/* faded radius overlay — the actual "within X km of the route" corridor, not just marker dimming */}
        {visibleRoutes.map((r) =>
          routeBufferRings(r.geometry, bufferKm).map((ring, idx) => (
            <Polygon
              key={`${r.id}-buffer-${idx}`}
              positions={ring}
              pathOptions={{ color: r.color, weight: 0, fillColor: r.color, fillOpacity: 0.12 }}
            />
          ))
        )}

        {/* finished route simulations */}
        {visibleRoutes.map((r) => (
          <Polyline key={r.id} positions={r.geometry} pathOptions={{ color: r.color, weight: 4, opacity: 0.75 }} />
        ))}
        {visibleRoutes.map((r) =>
          r.waypoints.map((pt, idx) => (
            <CircleMarker key={`${r.id}-${idx}`} center={pt} radius={5} pathOptions={{ color: r.color, fillColor: "#fff", fillOpacity: 1, weight: 2 }}>
              <Popup>
                {r.name} — point {idx + 1}
              </Popup>
            </CircleMarker>
          ))
        )}
      </MapContainer>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value?: string; options: string[]; onChange: (v: string | undefined) => void }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={selectStyle}>
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 5,
    border: `1px solid ${active ? "var(--signal)" : "var(--border)"}`,
    background: active ? "var(--signal-dim)" : "transparent",
    color: "var(--text-primary)",
    cursor: "pointer",
    flex: 1,
  };
}
const primaryChipStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--signal)",
  background: "var(--signal-dim)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontWeight: 600,
};
const secondaryChipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  cursor: "pointer",
  flex: 1,
};
const hintStyle: React.CSSProperties = { fontSize: 11, color: "var(--text-muted)" };
const selectStyle: React.CSSProperties = {
  fontSize: 11.5,
  padding: "5px 8px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text-primary)",
  width: "100%",
};
const dateInputStyle: React.CSSProperties = { ...selectStyle, flex: 1 };
const colorInputStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  padding: 0,
  border: "1px solid var(--border)",
  borderRadius: 4,
  cursor: "pointer",
  flexShrink: 0,
};
const largeColorInputStyle: React.CSSProperties = { ...colorInputStyle, width: 30, height: 26 };
