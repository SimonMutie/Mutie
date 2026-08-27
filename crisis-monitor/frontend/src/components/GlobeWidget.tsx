import { useEffect, useRef, useState } from "react";
import Globe, { type GlobeMethods } from "react-globe.gl";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopology from "world-atlas/countries-110m.json?url";

interface Props {
  series: { value: string; count: number }[];
  baseColor: string;
}

/** This file is dynamically imported (see DashboardWidgetCard's React.lazy
 *  call) specifically so its heavy Three.js dependency chain only downloads
 *  when a globe widget is actually present on screen — everyone else's
 *  dashboard never pays for this weight. Shows the same by_country data as
 *  the flat choropleth widget, just projected onto a rotating 3D sphere. */
export default function GlobeWidget({ series, baseColor }: Props) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const [features, setFeatures] = useState<GeoJSON.Feature[] | null>(null);
  const countByCountry = new Map(series.map((s) => [s.value.trim().toLowerCase(), s.count]));
  const maxCount = Math.max(1, ...series.map((s) => s.count));

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

  if (!features) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--text-faint)" }}>
        Loading globe…
      </div>
    );
  }

  return (
    <div style={{ height: "100%", borderRadius: 6, overflow: "hidden" }}>
      <Globe
        ref={globeRef}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
        polygonsData={features}
        polygonCapColor={(f: object) => {
          const name = (f as GeoJSON.Feature).properties?.name as string | undefined;
          const count = name ? countByCountry.get(name.trim().toLowerCase()) : undefined;
          if (!count) return "rgba(100,116,139,0.25)";
          const intensity = Math.max(0.25, count / maxCount);
          return hexToRgba(baseColor, intensity);
        }}
        polygonSideColor={() => "rgba(0,0,0,0.15)"}
        polygonStrokeColor={() => "rgba(255,255,255,0.15)"}
        polygonAltitude={0.01}
        showAtmosphere
        atmosphereColor={baseColor}
      />
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
