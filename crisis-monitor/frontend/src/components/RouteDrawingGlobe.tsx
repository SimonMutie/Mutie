import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { feature } from "topojson-client";
import { geoCentroid } from "d3-geo";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json?url";

interface Props {
  waypoints: string[];
  color: string;
  onChange: (waypoints: string[]) => void;
}

/** A "lat,lng" string formatted to a readable precision — matches the format
 *  resolveLocation (here and in GlobeWidget) already parses, so a point
 *  placed by clicking is immediately usable everywhere a typed waypoint is. */
function formatCoord(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function resolveLocation(text: string, centroidByCountry: Map<string, [number, number]>): [number, number] | null {
  const trimmed = text.trim();
  const coordMatch = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
  }
  return centroidByCountry.get(trimmed.toLowerCase()) ?? null;
}

/** Click an existing point to select it (it turns white), then click
 *  anywhere else on the globe to move that point there — a deliberate
 *  "click source, click destination" model rather than a literal
 *  click-and-hold drag, which would need continuous mouse tracking that
 *  fights the globe's own rotation controls and has real edge cases (mouse
 *  leaving the canvas mid-drag, touch devices) I have no way to test live.
 *  Click empty space with nothing selected to add a new waypoint at the end
 *  of the path instead. */
export default function RouteDrawingGlobe({ waypoints, color, onChange }: Props) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // Guards against the possibility that clicking a rendered point *also*
  // fires the generic globe-click handler for the same click (behavior not
  // documented clearly enough to rely on either way without live testing) —
  // a point click sets this, and a globe click within the same tick is
  // treated as that same click rather than a second, separate one.
  const lastPointClickAt = useRef(0);

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
    if (controls) controls.autoRotate = false; // still while editing — easier to click precisely
  }, [features]);

  const centroidByCountry = new Map<string, [number, number]>();
  if (features) {
    for (const f of features) {
      const name = f.properties?.name as string | undefined;
      if (!name) continue;
      centroidByCountry.set(name.trim().toLowerCase(), geoCentroid(f) as [number, number]);
    }
  }

  const points = waypoints
    .map((w, idx) => {
      const resolved = resolveLocation(w, centroidByCountry);
      return resolved ? { idx, lat: resolved[1], lng: resolved[0] } : null;
    })
    .filter((p): p is { idx: number; lat: number; lng: number } => p !== null);

  function handlePointClick(point: object) {
    lastPointClickAt.current = Date.now();
    const idx = (point as { idx: number }).idx;
    setSelectedIdx((current) => (current === idx ? null : idx));
  }

  function handleGlobeClick(coords: { lat: number; lng: number }) {
    if (Date.now() - lastPointClickAt.current < 100) return; // same click as a point handler already handled
    if (selectedIdx !== null) {
      onChange(waypoints.map((w, i) => (i === selectedIdx ? formatCoord(coords.lat, coords.lng) : w)));
      setSelectedIdx(null);
    } else {
      onChange([...waypoints, formatCoord(coords.lat, coords.lng)]);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        {selectedIdx !== null
          ? `Point ${selectedIdx + 1} selected (white) — click anywhere on the globe to move it there.`
          : "Click an existing point to select it, or click empty space to add a new point at the end of the path."}
      </div>
      <div ref={containerRef} style={{ height: 220, width: "100%", borderRadius: 6, overflow: "hidden", background: "#0a0e14" }}>
        {!features || size.width === 0 ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-faint)" }}>
            Loading…
          </div>
        ) : (
          <Globe
            ref={globeRef}
            width={size.width}
            height={220}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-day.jpg"
            polygonsData={features}
            polygonCapColor={() => "rgba(255,255,255,0)"}
            polygonSideColor={() => "rgba(0,0,0,0.1)"}
            polygonStrokeColor={() => "rgba(255,255,255,0.2)"}
            polygonAltitude={0.006}
            onGlobeClick={handleGlobeClick}
            pointsData={points}
            pointLat={(p: object) => (p as { lat: number }).lat}
            pointLng={(p: object) => (p as { lng: number }).lng}
            pointColor={(p: object) => ((p as { idx: number }).idx === selectedIdx ? "#ffffff" : color)}
            pointRadius={(p: object) => ((p as { idx: number }).idx === selectedIdx ? 1.1 : 0.75)}
            pointAltitude={0.01}
            onPointClick={handlePointClick}
          />
        )}
      </div>
    </div>
  );
}
