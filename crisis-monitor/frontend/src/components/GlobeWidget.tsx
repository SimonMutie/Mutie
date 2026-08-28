import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { feature } from "topojson-client";
import { geoCentroid } from "d3-geo";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json?url";

interface Props {
  series: { value: string; count: number }[];
  baseColor: string;
  /** Bypasses `series` entirely when present (even an empty array) — see
   *  DashboardWidget.manualCountryData. */
  manualData?: { country: string; value: number; color?: string }[];
  /** Arcs between two named locations — a country name (matched the same
   *  way as country shading) or a precise "lat,lng" pair, for a spot no
   *  country polygon covers (open water, for a shipping route). */
  routes?: { from: string; to: string; label?: string; color?: string }[];
}

/** This file is dynamically imported (see DashboardWidgetCard's React.lazy
 *  call) specifically so its heavy Three.js dependency chain only downloads
 *  when a globe widget is actually present on screen — everyone else's
 *  dashboard never pays for this weight. Shows the same by_country data as
 *  the flat choropleth widget by default, just projected onto a rotating 3D
 *  sphere — or manually-entered country values/arcs instead, independent of
 *  any database or uploaded dataset. */
export default function GlobeWidget({ series, baseColor, manualData, routes }: Props) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);

  const usingManualData = !!manualData;
  const countByCountry = usingManualData
    ? new Map(manualData!.map((d) => [d.country.trim().toLowerCase(), d.value]))
    : new Map(series.map((s) => [s.value.trim().toLowerCase(), s.count]));
  const colorByCountry = usingManualData ? new Map(manualData!.filter((d) => d.color).map((d) => [d.country.trim().toLowerCase(), d.color!])) : new Map<string, string>();
  const maxCount = Math.max(1, ...Array.from(countByCountry.values()));

  // <Globe> is a WebGL canvas, not a percentage-friendly SVG — it needs real
  // pixel width/height or it renders at some internal default size and gets
  // clipped by this card's own `overflow: hidden`, which is exactly what
  // "stuck in a corner" looks like: only whatever sliver of an
  // oversized/mispositioned globe happens to fall inside the visible corner.
  // Re-measuring on resize is what makes drag-resizing the widget card
  // itself (react-grid-layout) actually resize the globe to match, live.
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
  }, [features]);

  // Each country's centroid, computed once features load — lets a route
  // just name "Kenya" and "Somalia" rather than requiring exact coordinates,
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

  const arcs = (routes ?? [])
    .map((r) => {
      const start = resolveLocation(r.from, centroidByCountry);
      const end = resolveLocation(r.to, centroidByCountry);
      if (!start || !end) return null;
      return {
        startLat: start[1],
        startLng: start[0],
        endLat: end[1],
        endLng: end[0],
        label: r.label ?? `${r.from} → ${r.to}`,
        color: r.color || baseColor,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

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
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
          polygonsData={features}
          polygonCapColor={(f: object) => {
            const name = (f as GeoJSON.Feature).properties?.name as string | undefined;
            const key = name?.trim().toLowerCase();
            const count = key ? countByCountry.get(key) : undefined;
            if (!count) return "rgba(100,116,139,0.25)";
            const explicitColor = key ? colorByCountry.get(key) : undefined;
            if (explicitColor) return explicitColor;
            const intensity = Math.max(0.25, count / maxCount);
            return hexToRgba(baseColor, intensity);
          }}
          polygonSideColor={() => "rgba(0,0,0,0.15)"}
          polygonStrokeColor={() => "rgba(255,255,255,0.15)"}
          polygonAltitude={0.01}
          showAtmosphere
          atmosphereColor={baseColor}
          arcsData={arcs}
          arcStartLat={(d: object) => (d as { startLat: number }).startLat}
          arcStartLng={(d: object) => (d as { startLng: number }).startLng}
          arcEndLat={(d: object) => (d as { endLat: number }).endLat}
          arcEndLng={(d: object) => (d as { endLng: number }).endLng}
          arcColor={(d: object) => (d as { color: string }).color}
          arcLabel={(d: object) => (d as { label: string }).label}
          arcDashLength={0.4}
          arcDashGap={0.15}
          arcDashAnimateTime={2500}
          arcStroke={0.5}
          arcAltitudeAutoScale={0.3}
        />
      )}
    </div>
  );
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
