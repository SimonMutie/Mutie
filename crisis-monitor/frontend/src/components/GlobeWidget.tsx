import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { feature } from "topojson-client";
import { geoCentroid } from "d3-geo";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json?url";

type Vehicle = "plane" | "commercial-ship" | "warship" | "drone" | "none";

interface Route {
  waypoints: string[];
  label?: string;
  color?: string;
  vehicle?: Vehicle;
}

interface Props {
  series: { value: string; count: number }[];
  baseColor: string;
  /** Bypasses `series` entirely when present (even an empty array) — see
   *  DashboardWidget.manualCountryData. */
  manualData?: { country: string; value: number; color?: string }[];
  /** Bendable multi-waypoint paths, each optionally with an animated vehicle
   *  icon travelling along it. */
  routes?: Route[];
}

/** This file is dynamically imported (see DashboardWidgetCard's React.lazy
 *  call) specifically so its heavy Three.js dependency chain only downloads
 *  when a globe widget is actually present on screen — everyone else's
 *  dashboard never pays for this weight. Shows the same by_country data as
 *  the flat choropleth widget by default, just projected onto a rotating 3D
 *  sphere — or manually-entered country values/routes instead, independent
 *  of any database or uploaded dataset. */
export default function GlobeWidget({ series, baseColor, manualData, routes }: Props) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const [tick, setTick] = useState(0);

  const usingManualData = !!manualData;
  const countByCountry = usingManualData
    ? new Map(manualData!.map((d) => [d.country.trim().toLowerCase(), d.value]))
    : new Map(series.map((s) => [s.value.trim().toLowerCase(), s.count]));
  const colorByCountry = usingManualData ? new Map(manualData!.filter((d) => d.color).map((d) => [d.country.trim().toLowerCase(), d.color!])) : new Map<string, string>();
  const maxCount = Math.max(1, ...Array.from(countByCountry.values()));

  // <Globe> is a WebGL canvas, not a percentage-friendly SVG — it needs real
  // pixel width/height or it renders at some internal default size and gets
  // clipped by this card's own `overflow: hidden`. Re-measuring on resize is
  // what makes drag-resizing the widget card itself (react-grid-layout)
  // actually resize the globe to match, live.
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(worldTopology)
      .then((r) => r.json())
      .then((topo: Topology) => {
        if (cancelled) return;
        const collection = feature(topo, topo.objects.countries as GeometryCollection) as unknown as GeoJSON.FeatureCollection;
        setFeatures(collection.features);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!features) return;
    const controls = globeRef.current?.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.6;
    }
    // Default camera distance leaves a lot of empty space around the globe;
    // pulling it in fills the widget card properly. 0-ms transition — this
    // is the *initial* framing, not something that should visibly animate in.
    globeRef.current?.pointOfView?.({ altitude: 1.6 }, 0);
  }, [features]);

  // Drives every route's vehicle icon along its path — one shared clock
  // rather than a separate timer per route, so they all stay in sync with
  // each other's frame rate regardless of how many routes are on screen.
  useEffect(() => {
    if (!routes?.some((r) => r.vehicle && r.vehicle !== "none")) return;
    const interval = setInterval(() => setTick((t) => t + 1), 50);
    return () => clearInterval(interval);
  }, [routes]);

  // Each country's centroid, computed once features load — lets a route
  // waypoint just name "Kenya" rather than requiring exact coordinates,
  // while a literal "lat,lng" (resolveLocation below) still works for a
  // point no country polygon covers, like open water on a shipping route.
  const centroidByCountry = new Map<string, [number, number]>();
  if (features) {
    for (const f of features) {
      const name = f.properties?.name as string | undefined;
      if (!name) continue;
      centroidByCountry.set(name.trim().toLowerCase(), geoCentroid(f) as [number, number]);
    }
  }

  const resolvedRoutes = (routes ?? [])
    .map((r) => {
      const points = r.waypoints.map((w) => resolveLocation(w, centroidByCountry)).filter((p): p is [number, number] => p !== null);
      if (points.length < 2) return null; // fewer than 2 resolvable waypoints — nothing to draw a path between
      return { ...r, points, resolvedColor: r.color || baseColor };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const paths = resolvedRoutes.map((r) => ({
    // [lat, lng] tuples — react-globe.gl's own points, not raw [lng, lat]
    // geo-coordinate order, hence the swap from resolveLocation's [lng, lat].
    points: r.points.map(([lng, lat]) => [lat, lng] as [number, number]),
    color: r.resolvedColor,
    label: r.label ?? r.waypoints.join(" → "),
  }));

  const vehicleObjects = resolvedRoutes
    .filter((r) => r.vehicle && r.vehicle !== "none")
    .map((r, idx) => {
      // Each route completes its path in ~14s and loops — a fixed, readable
      // pace rather than one tied to the route's real-world length (a
      // transoceanic route would otherwise crawl compared to a short one).
      const progress = ((tick * 0.05 + idx * 1.7) % 14) / 14;
      const { lat, lng, bearingDeg } = interpolateAlongPath(r.points, progress);
      return { lat, lng, bearing: bearingDeg, vehicle: r.vehicle as Vehicle, color: r.resolvedColor };
    });

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%", borderRadius: 6, overflow: "hidden" }}>
      {!features || size.width === 0 ? (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-faint)" }}>
          Loading globe…
        </div>
      ) : (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
          polygonsData={features}
          polygonCapColor={(f: object) => {
            const name = (f as GeoJSON.Feature).properties?.name as string | undefined;
            const key = name?.trim().toLowerCase();
            const count = key ? countByCountry.get(key) : undefined;
            if (!count) return "rgba(255,255,255,0)";
            const explicitColor = key ? colorByCountry.get(key) : undefined;
            if (explicitColor) return explicitColor;
            const intensity = Math.max(0.25, count / maxCount);
            return hexToRgba(baseColor, intensity);
          }}
          polygonSideColor={() => "rgba(0,0,0,0.15)"}
          polygonStrokeColor={() => "rgba(255,255,255,0.15)"}
          polygonAltitude={0.006}
          showAtmosphere
          atmosphereColor={baseColor}
          pathsData={paths}
          pathPoints={(d: object) => (d as { points: [number, number][] }).points}
          pathPointLat={(p: unknown) => (p as [number, number])[0]}
          pathPointLng={(p: unknown) => (p as [number, number])[1]}
          pathColor={(d: object) => (d as { color: string }).color}
          pathLabel={(d: object) => (d as { label: string }).label}
          pathStroke={2.2}
          pathDashLength={0.4}
          pathDashGap={0.15}
          pathDashAnimateTime={2500}
          pathTransitionDuration={0}
          objectsData={vehicleObjects}
          objectLat={(d: object) => (d as { lat: number }).lat}
          objectLng={(d: object) => (d as { lng: number }).lng}
          objectAltitude={0.02}
          objectRotation={(d: object) => ({ y: (d as { bearing: number }).bearing })}
          objectThreeObject={(d: object) => vehicleMesh(d as { vehicle: Vehicle; color: string })}
        />
      )}
    </div>
  );
}

/** Simple, bold, distinguishable primitive shapes rather than detailed
 *  models — same design principle as the 2D tactic icons built earlier for
 *  the incidents map (a recognizable silhouette at a glance matters more
 *  than realism at this scale), and avoids needing any licensed 3D assets.
 *  Unlike those, this can't be visually proofed the same way before
 *  shipping — SVG could be rendered and inspected directly; a Three.js
 *  scene can't be in this environment, so the shapes are deliberately kept
 *  simple to minimize how much could look wrong sight-unseen. */
function vehicleMesh(d: { vehicle: Vehicle; color: string }): THREE.Object3D {
  const material = new THREE.MeshBasicMaterial({ color: d.color });
  const group = new THREE.Group();

  if (d.vehicle === "plane") {
    const body = new THREE.ConeGeometry(0.5, 2, 8);
    const mesh = new THREE.Mesh(body, material);
    mesh.rotation.z = -Math.PI / 2; // point along +X, matching bearing 0 = north after objectRotation
    group.add(mesh);
  } else if (d.vehicle === "drone") {
    const body = new THREE.OctahedronGeometry(0.7);
    group.add(new THREE.Mesh(body, material));
  } else if (d.vehicle === "warship") {
    const hull = new THREE.BoxGeometry(2.4, 0.5, 0.8);
    const hullMesh = new THREE.Mesh(hull, material);
    group.add(hullMesh);
    const tower = new THREE.BoxGeometry(0.6, 0.5, 0.5);
    const towerMesh = new THREE.Mesh(tower, material);
    towerMesh.position.set(0.3, 0.5, 0);
    group.add(towerMesh);
  } else {
    // commercial-ship
    const hull = new THREE.BoxGeometry(2.4, 0.4, 0.9);
    group.add(new THREE.Mesh(hull, material));
  }

  return group;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance in km — used only to weight how far along a
 *  multi-segment path a given progress fraction has travelled, not
 *  displayed anywhere, so approximate is fine. */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Where a vehicle sits along a multi-waypoint path at a given progress
 *  (0-1, looping). Interpolates linearly within whichever segment the
 *  progress falls into — a reasonable visual approximation for a moving
 *  icon rather than true geodesic slerp, which would be overkill for
 *  anything but the longest routes. */
function interpolateAlongPath(waypoints: [number, number][], progress: number): { lat: number; lng: number; bearingDeg: number } {
  // waypoints are [lng, lat] (resolveLocation's order) — flip once here so
  // the rest of this function reads naturally as (lat, lng).
  const points = waypoints.map(([lng, lat]) => [lat, lng] as [number, number]);
  const segDistances: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = haversineDistance(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]);
    segDistances.push(d);
    total += d;
  }
  if (total === 0) return { lat: points[0][0], lng: points[0][1], bearingDeg: 0 };

  const target = progress * total;
  let segIdx = 0;
  let cum = 0;
  for (; segIdx < segDistances.length; segIdx++) {
    if (cum + segDistances[segIdx] >= target) break;
    cum += segDistances[segIdx];
  }
  segIdx = Math.min(segIdx, segDistances.length - 1);
  const segProgress = segDistances[segIdx] > 0 ? (target - cum) / segDistances[segIdx] : 0;
  const [lat1, lng1] = points[segIdx];
  const [lat2, lng2] = points[segIdx + 1];
  return {
    lat: lat1 + (lat2 - lat1) * segProgress,
    lng: lng1 + (lng2 - lng1) * segProgress,
    bearingDeg: bearingBetween(lat1, lng1, lat2, lng2),
  };
}

function resolveLocation(text: string, centroidByCountry: Map<string, [number, number]>): [number, number] | null {
  const trimmed = text.trim();
  // A literal "lat,lng" pair — for a point no country polygon covers, like
  // open water on a shipping route.
  const coordMatch = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
  }
  return centroidByCountry.get(trimmed.toLowerCase()) ?? null;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
