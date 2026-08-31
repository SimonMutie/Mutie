import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { feature } from "topojson-client";
import { geoCentroid } from "d3-geo";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json?url";
import { LABEL_TYPE_META, labelIconSvg, type LabelType } from "./labelTypes";

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
  /** Free-standing labeled points — checkpoints, ports, chokepoints, or any
   *  of the other categories in LABEL_TYPE_META, worth marking directly on
   *  the globe. An unset/unrecognized type falls back to "other" rather
   *  than being dropped, so labels created before this categorization
   *  existed keep rendering exactly as they always did. */
  labels?: { location: string; text: string; color?: string; type?: LabelType }[];
  /** Whether labels render at all — defaults to true when omitted, so
   *  existing widgets that never had this field keep showing their labels
   *  exactly as before rather than suddenly going blank. */
  showLabels?: boolean;
}

/** This file is dynamically imported (see DashboardWidgetCard's React.lazy
 *  call) specifically so its heavy Three.js dependency chain only downloads
 *  when a globe widget is actually present on screen — everyone else's
 *  dashboard never pays for this weight. Shows the same by_country data as
 *  the flat choropleth widget by default, just projected onto a rotating 3D
 *  sphere — or manually-entered country values/routes instead, independent
 *  of any database or uploaded dataset. */
export default function GlobeWidget({ series, baseColor, manualData, routes, labels, showLabels = true }: Props) {
  /** Hard cap on how many labels can ever be live on screen at once — each
   *  one is a real DOM element (see htmlElement below), continuously
   *  re-positioned as the globe rotates, so an unbounded count from a
   *  bulk-uploaded dataset with thousands of rows could genuinely freeze
   *  the tab. 250 is a generous amount to actually look at on a globe at
   *  once regardless of performance — most would overlap into
   *  unreadability well before that anyway. */
  const MAX_RENDERED_LABELS = 250;
  /** Past this many labels, the flash-between-icon-and-name effect turns
   *  off automatically and every label just shows icon+name together,
   *  statically. It's a nice touch for a handful of labels; at hundreds,
   *  it both looks visually chaotic (everything flickering in near-unison)
   *  and forces every visible label's DOM content to be rebuilt on every
   *  flash cycle, purely to drive an effect that's stopped being legible
   *  at that scale anyway. */
  const FLASH_DISABLE_THRESHOLD = 50;

  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const [tick, setTick] = useState(0);
  const [rotationLocked, setRotationLocked] = useState(false);
  // Starts from the persisted, admin-configured default (the showLabels
  // prop), but toggleable live from here by any viewer within their own
  // session — the same relationship the rotation lock above has with its
  // own on-globe button, a session-local override rather than a change to
  // the saved setting itself.
  const [labelsVisible, setLabelsVisible] = useState(showLabels);
  useEffect(() => {
    setLabelsVisible(showLabels);
  }, [showLabels]);

  const usingManualData = !!manualData;
  // String(...) before .trim() throughout below — series comes from a
  // dataset query (see valueMapKeyFor/breakdownKeyFor), where the
  // declared {value: string} type is TypeScript's own assumption, not a
  // runtime guarantee: json_extract returns whatever type was actually
  // stored in that row, so a numeric column picked as the location field
  // (by mistake, or because the dataset just has one) hands back an
  // actual number here, not a string. Calling .trim() on that directly
  // crashes the whole widget instead of just not matching a country.
  const countByCountry = usingManualData
    ? new Map(manualData!.map((d) => [String(d.country).trim().toLowerCase(), d.value]))
    : new Map(series.map((s) => [String(s.value).trim().toLowerCase(), s.count]));
  const colorByCountry = usingManualData
    ? new Map(manualData!.filter((d) => d.color).map((d) => [String(d.country).trim().toLowerCase(), d.color!]))
    : new Map<string, string>();
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

  // Drives labels alternating between showing just their icon and showing
  // the icon with its name — deliberately a much slower, separate clock
  // from the vehicle animation above (50ms there would make text
  // unreadable, flickering far too fast to actually read). Only runs when
  // there's something to flash at all, and skips entirely past
  // FLASH_DISABLE_THRESHOLD — no point running a timer that forces a
  // hundreds-strong label set to rebuild its DOM content every 1.8s for an
  // effect that's already switched off at that scale.
  const [labelFlashOn, setLabelFlashOn] = useState(true);
  useEffect(() => {
    if (!labelsVisible || !labels?.length || labels.length > FLASH_DISABLE_THRESHOLD) return;
    const interval = setInterval(() => setLabelFlashOn((v) => !v), 1800);
    return () => clearInterval(interval);
  }, [showLabels, labelsVisible, labels?.length]);

  // Each country's centroid, computed once features load — lets a route
  // waypoint just name "Kenya" rather than requiring exact coordinates,
  // while a literal "lat,lng" (resolveLocation below) still works for a
  // point no country polygon covers, like open water on a shipping route.
  // Memoized on features specifically (not recomputed on every render) —
  // this used to rebuild the whole map from scratch on every single
  // render, including every 50ms vehicle-animation tick, for no reason:
  // features only actually changes once, when the topology first loads.
  const centroidByCountry = useMemo(() => {
    const map = new Map<string, [number, number]>();
    if (features) {
      for (const f of features) {
        const name = f.properties?.name as string | undefined;
        if (!name) continue;
        map.set(name.trim().toLowerCase(), geoCentroid(f) as [number, number]);
      }
    }
    return map;
  }, [features]);

  // Route waypoint resolution itself doesn't depend on the animation tick
  // at all — only vehicleObjects below does. Memoizing this separately
  // means resolving country names to coordinates for potentially many
  // routes/waypoints doesn't repeat 20 times a second just because a
  // vehicle somewhere is animating.
  const resolvedRoutes = useMemo(
    () =>
      (routes ?? [])
        .map((r) => {
          const points = r.waypoints.map((w) => resolveLocation(w, centroidByCountry)).filter((p): p is [number, number] => p !== null);
          if (points.length < 2) return null; // fewer than 2 resolvable waypoints — nothing to draw a path between
          return { ...r, points, resolvedColor: r.color || baseColor };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    [routes, baseColor, centroidByCountry]
  );

  const paths = useMemo(
    () =>
      resolvedRoutes.map((r) => ({
        // [lat, lng] tuples — react-globe.gl's own points, not raw [lng, lat]
        // geo-coordinate order, hence the swap from resolveLocation's [lng, lat].
        points: r.points.map(([lng, lat]) => [lat, lng] as [number, number]),
        color: r.resolvedColor,
        label: r.label ?? r.waypoints.join(" → "),
        strokeWidth: r.strokeWidth ?? 2.2,
      })),
    [resolvedRoutes]
  );

  // Every route gets a fixed arrowhead at its destination showing direction —
  // independent of whether it also has an animated vehicle travelling along it.
  const arrowheads = useMemo(
    () =>
      resolvedRoutes.map((r) => {
        const points = r.points.map(([lng, lat]) => [lat, lng] as [number, number]);
        const [lat1, lng1] = points[points.length - 2];
        const [lat2, lng2] = points[points.length - 1];
        return { kind: "arrow" as const, lat: lat2, lng: lng2, bearing: bearingBetween(lat1, lng1, lat2, lng2), color: r.resolvedColor };
      }),
    [resolvedRoutes]
  );

  // This one genuinely does need tick in its deps — the animated position
  // along each route is the entire point of it recomputing every frame.
  const vehicleObjects = useMemo(
    () =>
      resolvedRoutes
        .filter((r) => r.vehicle && r.vehicle !== "none")
        .map((r, idx) => {
          // Each route completes its path in ~14s and loops — a fixed,
          // readable pace rather than one tied to the route's real-world
          // length (a transoceanic route would otherwise crawl compared
          // to a short one).
          const progress = ((tick * 0.05 + idx * 1.7) % 14) / 14;
          const { lat, lng, bearingDeg } = interpolateAlongPath(r.points, progress);
          return { kind: "vehicle" as const, lat, lng, bearing: bearingDeg, vehicle: r.vehicle as Vehicle, color: r.resolvedColor };
        }),
    [resolvedRoutes, tick]
  );

  const objects = useMemo(() => [...arrowheads, ...vehicleObjects], [arrowheads, vehicleObjects]);

  // Memoized on the actual inputs that determine the result — not on tick,
  // so this doesn't repeat 20 times a second for no reason the way it used
  // to. This was the actual cause of large label sets freezing the page:
  // every label was a brand-new object on every single render, which very
  // plausibly defeated react-globe.gl's own ability to tell "this label is
  // unchanged" from "this is a new label", forcing it to rebuild every
  // label's DOM element continuously rather than just repositioning them.
  const resolvedLabels = useMemo(() => {
    if (!labelsVisible) return [];
    const resolved = (labels ?? [])
      .map((l) => {
        const point = resolveLocation(l.location, centroidByCountry);
        if (!point) return null;
        const type = l.type ?? "other";
        return { lat: point[1], lng: point[0], text: l.text || LABEL_TYPE_META[type].name, type, color: l.color };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
    return resolved.length > MAX_RENDERED_LABELS ? resolved.slice(0, MAX_RENDERED_LABELS) : resolved;
  }, [labels, labelsVisible, centroidByCountry]);

  const labelCountExceedsCap = (labels?.length ?? 0) > MAX_RENDERED_LABELS;
  const flashEnabled = resolvedLabels.length <= FLASH_DISABLE_THRESHOLD;

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
          {!!labels?.length && (
            <button
              onClick={() => setLabelsVisible((v) => !v)}
              onMouseDown={(e) => e.stopPropagation()}
              title={labelsVisible ? "Hide labels" : "Show labels"}
              style={{
                position: "absolute",
                top: 32,
                right: 6,
                zIndex: 10,
                width: 22,
                height: 22,
                lineHeight: "20px",
                padding: 0,
                fontSize: 11,
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.3)",
                background: labelsVisible ? "rgba(13,148,136,0.85)" : "rgba(0,0,0,0.45)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {labelsVisible ? "🏷" : "🚫"}
            </button>
          )}
          {labelCountExceedsCap && labelsVisible && (
            <div
              title={`This globe has ${labels?.length ?? 0} labels; only the first ${MAX_RENDERED_LABELS} are shown to keep the page responsive.`}
              style={{
                position: "absolute",
                top: 58,
                right: 6,
                zIndex: 10,
                fontSize: 9.5,
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(0,0,0,0.6)",
                color: "#fbbf24",
                border: "1px solid rgba(251,191,36,0.4)",
                whiteSpace: "nowrap",
              }}
            >
              Showing {MAX_RENDERED_LABELS} of {labels?.length}
            </div>
          )}
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
          // The type definitions for this library declare "objectFacesSurfaces"
          // (plural), but the actual shipped implementation only reads
          // "objectFacesSurface" (singular) — confirmed directly in
          // node_modules/three-globe's source, not assumed from the types.
          // Using the name the types expect would silently do nothing at
          // runtime, so this is spread in via a cast rather than passed as a
          // normal prop. Without it, each object's wrapper never aligns to
          // the globe's local surface at that point, which was the actual
          // cause of vehicles facing inconsistent directions — their "flat"
          // orientation was fixed to a single global direction instead of
          // being tangent to the sphere wherever they currently are.
          {...({ objectFacesSurface: true } as Record<string, unknown>)}
          objectRotation={(d: object) => ({ z: (d as { bearing: number }).bearing })}
          objectThreeObject={(d: object) => vehicleMesh(d as { kind: "arrow" | "vehicle"; vehicle?: Vehicle; color: string })}
          htmlElementsData={resolvedLabels}
          htmlLat={(d: object) => (d as { lat: number }).lat}
          htmlLng={(d: object) => (d as { lng: number }).lng}
          htmlAltitude={0.015}
          htmlElement={(d: object) => {
            const item = d as { text: string; type: LabelType; color?: string };
            const el = document.createElement("div");
            el.style.cssText = "display:flex;flex-direction:column;align-items:center;pointer-events:none;transform:translate(-50%,-100%);";

            // Trusted markup — labelIconSvg is built entirely from this
            // codebase's own fixed shape definitions, never from user input,
            // so innerHTML here carries no injection risk.
            const iconWrap = document.createElement("div");
            iconWrap.innerHTML = labelIconSvg(item.type, 22, item.color);
            el.appendChild(iconWrap);

            // The name, by contrast, is whatever an admin typed into this
            // label's text field — textContent (not innerHTML) so it's
            // always rendered as plain text, never interpreted as markup.
            // Shows statically (no flashing) once past FLASH_DISABLE_THRESHOLD
            // — flashEnabled being false means the animation is off, not
            // that the name itself should disappear.
            if (!flashEnabled || labelFlashOn) {
              const nameEl = document.createElement("div");
              nameEl.textContent = item.text;
              nameEl.style.cssText =
                "font-size:10px;color:#fff;background:rgba(0,0,0,0.65);padding:1px 5px;border-radius:3px;margin-top:2px;white-space:nowrap;font-family:sans-serif;";
              el.appendChild(nameEl);
            }
            return el;
          }}
          htmlTransitionDuration={300}
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
//
// Orientation: traced through three-globe's actual source (not just its
// docs) to confirm the real convention, since an earlier version of this
// file got it wrong (some vehicles faced backward/sideways depending on
// where they were on the globe). With objectFacesSurface set (below), each
// object's wrapper aligns so LOCAL +Z is "up" (away from the globe centre)
// and LOCAL +Y is "north" — verified numerically from the library's own
// polar2Cartesian math, not assumed. THREE.ExtrudeGeometry already produces
// a shape lying flat in the XY plane with its extrusion depth along +Z, and
// these outlines already have their "nose" at design +Y — so the correct
// orientation needs no extra rotation at all; a previous version rotated
// these unnecessarily (for a different, incorrect axis assumption), which
// was the actual bug. objectRotation then rotates around Z (the real "up"
// axis here, not Y) to swing the nose from north to the current bearing.
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

/** Extrudes a flat top-down outline into a thin solid. No rotation needed —
 *  see the orientation note above; the shape's native orientation already
 *  matches what's required. */
function extrudedSilhouette(outline: [number, number][], material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (const [x, y] of outline.slice(1)) shape.lineTo(x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(SHAPE_SCALE);
  return mesh;
}

function vehicleMesh(d: { kind: "arrow" | "vehicle"; vehicle?: Vehicle; color: string }): THREE.Object3D {
  const material = new THREE.MeshBasicMaterial({ color: d.color });
  const group = new THREE.Group();

  if (d.kind === "arrow") {
    // ConeGeometry already points its tip along +Y by default — which, per
    // the orientation note above, already means "north". No rotation needed.
    const head = new THREE.ConeGeometry(2.2, 3.2, 3);
    group.add(new THREE.Mesh(head, material));
    return group;
  }

  if (d.vehicle === "plane") {
    group.add(extrudedSilhouette(PLANE_OUTLINE, material));
  } else if (d.vehicle === "drone") {
    // Hub + 4 arms + 4 rotor discs, an "X" viewed from above — built flat in
    // the XY plane (Z as the small vertical offset) to match the corrected
    // convention. CylinderGeometry's axis is Y by default, so each cylinder
    // is rotated 90° around X to stand its flat face against Z instead —
    // the same axis-remap the ship/plane shapes get for free from
    // ExtrudeGeometry's own default orientation.
    const hub = new THREE.CylinderGeometry(0.9, 0.9, 0.4, 8);
    const hubMesh = new THREE.Mesh(hub, material);
    hubMesh.rotation.x = Math.PI / 2;
    group.add(hubMesh);
    const armGeo = new THREE.BoxGeometry(0.35, 4.6, 0.3);
    const rotorGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.25, 12);
    for (const angleDeg of [45, 135, 225, 315]) {
      const angle = (angleDeg * Math.PI) / 180;
      const arm = new THREE.Mesh(armGeo, material);
      arm.position.set((Math.cos(angle) * 4.6) / 2, (Math.sin(angle) * 4.6) / 2, 0);
      arm.rotation.z = angle - Math.PI / 2;
      group.add(arm);
      const rotor = new THREE.Mesh(rotorGeo, material);
      rotor.position.set(Math.cos(angle) * 4.6, Math.sin(angle) * 4.6, 0.1);
      rotor.rotation.x = Math.PI / 2;
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
  // Same defensive coercion as countByCountry above — text is typed as
  // string, but a caller passing a value straight from a bulk CSV upload
  // or dataset column can't actually guarantee that at runtime.
  const trimmed = String(text).trim();
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
