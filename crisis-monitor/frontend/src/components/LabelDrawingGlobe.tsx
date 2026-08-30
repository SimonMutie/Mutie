import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { feature } from "topojson-client";
import { geoCentroid } from "d3-geo";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json?url";
import { LABEL_TYPE_META, type LabelType } from "./labelTypes";

interface LabelEntry {
  location: string;
  text: string;
  color?: string;
  type?: LabelType;
}

interface Props {
  labels: LabelEntry[];
  onChange: (labels: LabelEntry[]) => void;
}

/** A "lat,lng" string formatted to a readable precision — matches the format
 *  resolveLocation (here and in GlobeWidget) already parses, so a point
 *  placed by clicking is immediately usable everywhere a typed location is. */
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

/** Click an existing label to select it (it turns white and grows), then
 *  click anywhere else on the globe to move that label there — the same
 *  "click source, click destination" model RouteDrawingGlobe uses, for the
 *  same reasons (a literal click-and-hold drag fights the globe's own
 *  rotation controls and has edge cases — mouse leaving the canvas
 *  mid-drag, touch devices — with no way to test live here). Click empty
 *  space with nothing selected to place a brand new label there instead,
 *  defaulting to type "other" and empty text — filled in via the list
 *  below this globe, not here, since typing on top of a rotating 3D scene
 *  is its own kind of awkward. */
export default function LabelDrawingGlobe({ labels, onChange }: Props) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
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

  const points = labels
    .map((l, idx) => {
      const resolved = resolveLocation(l.location, centroidByCountry);
      if (!resolved) return null;
      const meta = LABEL_TYPE_META[l.type ?? "other"];
      return { idx, lat: resolved[1], lng: resolved[0], color: l.color || meta.color, text: `${meta.symbol} ${l.text || meta.name}` };
    })
    .filter((p): p is { idx: number; lat: number; lng: number; color: string; text: string } => p !== null);

  function handlePointClick(point: object) {
    lastPointClickAt.current = Date.now();
    const idx = (point as { idx: number }).idx;
    setSelectedIdx((current) => (current === idx ? null : idx));
  }

  function handleGlobeClick(coords: { lat: number; lng: number }) {
    if (Date.now() - lastPointClickAt.current < 100) return; // same click as a point handler already handled
    if (selectedIdx !== null) {
      onChange(labels.map((l, i) => (i === selectedIdx ? { ...l, location: formatCoord(coords.lat, coords.lng) } : l)));
      setSelectedIdx(null);
    } else {
      onChange([...labels, { location: formatCoord(coords.lat, coords.lng), text: "", type: "other" }]);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
        {selectedIdx !== null
          ? `Point ${selectedIdx + 1} selected (white) — click anywhere on the globe to move it there.`
          : "Click an existing point to select it, or click empty space to place a new label there — fill in its type and text below."}
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
            labelsData={points}
            labelLat={(p: object) => (p as { lat: number }).lat}
            labelLng={(p: object) => (p as { lng: number }).lng}
            labelText={(p: object) => (p as { text: string }).text}
            labelColor={(p: object) => ((p as { idx: number }).idx === selectedIdx ? "#ffffff" : (p as { color: string }).color)}
            labelSize={(p: object) => ((p as { idx: number }).idx === selectedIdx ? 1.6 : 1.1)}
            labelDotRadius={(p: object) => ((p as { idx: number }).idx === selectedIdx ? 0.55 : 0.4)}
            labelIncludeDot
            labelAltitude={0.015}
            labelResolution={2}
            onLabelClick={handlePointClick}
          />
        )}
      </div>
    </div>
  );
}
