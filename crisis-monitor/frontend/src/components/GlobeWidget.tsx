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
  strokeWidth?: number;
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
  const [rotationLocked, setRotationLocked] = useState(false);

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
      controls.autoRotate = !rotationLocked;
      controls.autoRotateSpeed = 0.6;
      // Freezes the view exactly where it is — the trajectory/vehicle
      // animation below is driven by tick, entirely independent of camera
      // state, so it keeps moving either way.
      controls.enableRotate = !rotationLocked;
    }
  }, [features, rotationLocked]);

  useEffect(() => {
    if (!features) return;
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
    strokeWidth: r.strokeWidth ?? 2.2,
  }));

  // Every route gets a fixed arrowhead at its destination showing direction —
  // independent of whether it also has an animated vehicle travelling along it.
  const arrowheads = resolvedRoutes.map((r) => {
    const points = r.points.map(([lng, lat]) => [lat, lng] as [number, number]);
    const [lat1, lng1] = points[points.length - 2];
    const [lat2, lng2] = points[points.length - 1];
    return { kind: "arrow" as const, lat: lat2, lng: lng2, bearing: bearingBetween(lat1, lng1, lat2, lng2), color: r.resolvedColor };
  });

  const vehicleObjects = resolvedRoutes
    .filter((r) => r.vehicle && r.vehicle !== "none")
    .map((r, idx) => {
      // Each route completes its path in ~14s and loops — a fixed, readable
      // pace rather than one tied to the route's real-world length (a
      // transoceanic route would otherwise crawl compared to a short one).
      const progress = ((tick * 0.05 + idx * 1.7) % 14) / 14;
      const { lat, lng, bearingDeg } = interpolateAlongPath(r.points, progress);
      return { kind: "vehicle" as const, lat, lng, bearing: bearingDeg, vehicle: r.vehicle as Vehicle, color: r.resolvedColor };
    });

  const objects = [...arrowheads, ...vehicleObjects];

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%", borderRadius: 6, overflow: "hidden", position: "relative" }}>
      {!features || size.width === 0 ? (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-faint)" }}>
          Loading globe…
        </div>
      ) : (
        <>
          <button
            onClick={() => setRotationLocked((v) => !v)}
            onMouseDown={(e) => e.stopPropagation()}
            title={rotationLocked ? "Unlock — resume rotating" : "Lock — hold the globe at its current position"}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              zIndex: 10,
              width: 22,
              height: 22,
              lineHeight: "20px",
              padding: 0,
              fontSize: 11,
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.3)",
              background: rotationLocked ? "rgba(13,148,136,0.85)" : "rgba(0,0,0,0.45)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            {rotationLocked ? "🔒" : "🔓"}
          </button>
          <Globe
            ref={globeRef}
            width={size.width}
            height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-day.jpg"
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
          pathStroke={(d: object) => (d as { strokeWidth: number }).strokeWidth}
          pathDashLength={0.4}
          pathDashGap={0.15}
          pathDashAnimateTime={2500}
          pathTransitionDuration={0}
          objectsData={objects}
          objectLat={(d: object) => (d as { lat: number }).lat}
          objectLng={(d: object) => (d as { lng: number }).lng}
          objectAltitude={0.025}
          objectRotation={(d: object) => ({ y: (d as { bearing: number }).bearing })}
          objectThreeObject={(d: object) => vehicleMesh(d as { kind: "arrow" | "vehicle"; vehicle?: Vehicle; color: string })}
        />
        </>
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
/** Sizes here are deliberately large relative to three-globe's ~100-unit
 *  globe radius — the earlier version used sizes around 0.5-2 units, which
 *  is why they rendered as barely-visible dots rather than recognizable
 *  shapes. These are roughly 4-6x bigger and reshaped for a clearer
 *  silhouette at that scale, not just bigger versions of the same shapes. */
// Top-down outlines, verified by rendering as flat 2D shapes and visually
// checking them before converting to 3D — recognizability comes almost
// entirely from the silhouette itself, which extrusion preserves exactly,
// so this closes most of the "can't render Three.js to check it" gap.
// Coordinates have "nose"/bow at +Y in this 2D design; SHAPE_SCALE and the
// rotation applied in extrudedSilhouette() below (both verified numerically,
// not hand-derived) bring it to a final on-globe size with the nose facing
// local +X, matching the arrowhead/plane cone's existing convention for how
// objectRotation's bearing then swings it to face the right compass direction.
const SHAPE_SCALE = 0.09;

const SHIP_OUTLINE: [number, number][] = [
  [0, 45], [5, 38], [9, 15], [9, -35], [7, -42], [-7, -42], [-9, -35], [-9, 15], [-5, 38],
];
const WARSHIP_OUTLINE: [number, number][] = [
  [0, 48], [4, 40], [7, 15], [6, -8], [9, -10], [9, -38], [7, -44], [-7, -44], [-9, -38], [-6, -8], [-7, 15], [-4, 40],
];
const PLANE_OUTLINE: [number, number][] = [
  [0, 45], [4, 20], [35, -5], [35, -12], [5, -2], [3, -20], [14, -32], [14, -38], [0, -32],
  [-14, -38], [-14, -32], [-3, -20], [-5, -2], [-35, -12], [-35, -5], [-4, 20],
];

/** Extrudes a flat top-down outline into a thin solid, then applies the
 *  numerically-verified rotation that lays it flat with its nose along
 *  local +X — see SHAPE_SCALE comment above. */
function extrudedSilhouette(outline: [number, number][], material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (const [x, y] of outline.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotateX(-Math.PI / 2);
  mesh.rotateY(-Math.PI / 2);
  mesh.scale.setScalar(SHAPE_SCALE);
  return mesh;
}

function vehicleMesh(d: { kind: "arrow" | "vehicle"; vehicle?: Vehicle; color: string }): THREE.Object3D {
  const material = new THREE.MeshBasicMaterial({ color: d.color });
  const group = new THREE.Group();

  if (d.kind === "arrow") {
    // A short, wide cone reads as a real arrowhead — deliberately distinct
    // from the plane's longer, thinner silhouette below.
    const head = new THREE.ConeGeometry(2.2, 3.2, 3);
    const mesh = new THREE.Mesh(head, material);
    mesh.rotation.z = -Math.PI / 2;
    group.add(mesh);
    return group;
  }

  if (d.vehicle === "plane") {
    group.add(extrudedSilhouette(PLANE_OUTLINE, material));
  } else if (d.vehicle === "drone") {
    // Hub + 4 arms + 4 rotor discs, an "X" viewed from above — box/cylinder
    // primitives already lie flat by default with no rotation trick needed,
    // unlike the extruded silhouettes above.
    const hub = new THREE.CylinderGeometry(0.9, 0.9, 0.4, 8);
    group.add(new THREE.Mesh(hub, material));
    const armGeo = new THREE.BoxGeometry(0.35, 0.3, 4.6);
    const rotorGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.25, 12);
    for (const angleDeg of [45, 135, 225, 315]) {
      const angle = (angleDeg * Math.PI) / 180;
      const arm = new THREE.Mesh(armGeo, material);
      arm.position.set((Math.cos(angle) * 4.6) / 2, 0, (Math.sin(angle) * 4.6) / 2);
      arm.rotation.y = angle;
      group.add(arm);
      const rotor = new THREE.Mesh(rotorGeo, material);
      rotor.position.set(Math.cos(angle) * 4.6, 0.1, Math.sin(angle) * 4.6);
      group.add(rotor);
    }
  } else if (d.vehicle === "warship") {
    group.add(extrudedSilhouette(WARSHIP_OUTLINE, material));
  } else {
    // commercial-ship — a plainer hull than the warship's angular one.
    group.add(extrudedSilhouette(SHIP_OUTLINE, material));
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
