import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import * as L from "leaflet";
import "leaflet.heat";

/** A preset gradient (stop -> color) handed to leaflet.heat, plus a label for
 *  the picker UI. leaflet.heat's own default gradient already runs
 *  blue→cyan→lime→yellow→red as intensity rises, so "Classic" below just
 *  names that default rather than reinventing it; the others give real,
 *  distinctly different looks while every one of them still ends on red at
 *  the top of the scale, per Simon's "red where intensity is more" ask. */
export const HEATMAP_GRADIENTS: Record<string, { label: string; stops: Record<number, string> }> = {
  classic: { label: "Classic (blue → red)", stops: { 0.4: "#2563eb", 0.6: "#22d3ee", 0.75: "#a3e635", 0.9: "#f59e0b", 1.0: "#dc2626" } },
  redOnly: { label: "Amber → Red (subtle low end)", stops: { 0.2: "#fde68a", 0.5: "#f59e0b", 0.75: "#ef4444", 1.0: "#991b1b" } },
  mono: { label: "Monochrome red", stops: { 0.2: "#fecaca", 0.5: "#f87171", 0.75: "#dc2626", 1.0: "#7f1d1d" } },
  violet: { label: "Violet → Red", stops: { 0.3: "#a78bfa", 0.6: "#ec4899", 0.85: "#f97316", 1.0: "#dc2626" } },
};
export type HeatmapGradientKey = keyof typeof HEATMAP_GRADIENTS;

export interface HeatmapStyle {
  /** Px radius of each point's heat contribution — bigger blends points
   *  together into broader hotspots; smaller keeps clusters tighter. */
  radius: number;
  /** Edge softness of each point — higher blurs hotspot boundaries. */
  blur: number;
  /** leaflet.heat normalizes displayed intensity against this value (not
   *  literally the highest point in the data) — lower it to make hotspots
   *  redden faster/with fewer points stacked; raise it to require more
   *  density before red appears. This is the actual "color intensity" dial:
   *  it changes how much counts as "high", not just a cosmetic opacity. */
  max: number;
  gradient: HeatmapGradientKey;
}
export const DEFAULT_HEATMAP_STYLE: HeatmapStyle = { radius: 22, blur: 18, max: 3, gradient: "classic" };

/** Canvas-based heat-density layer, an alternative to plotting individual pins
 *  — useful once there are enough incidents that markers start overlapping and
 *  density becomes the more readable signal. `weighted` (passed in via the
 *  caller's own point weights) uses each incident's total casualties as
 *  intensity (so severe clusters stand out more); off, every incident counts
 *  equally (pure geographic density). `style` exposes the knobs Simon asked
 *  for — adjustable color intensity (via `max`), plus radius/blur/gradient —
 *  rather than the previous fixed radius/blur with no way to change how
 *  quickly a hotspot reads as red.
 *
 *  Deliberately its own file, not part of IncidentsMap.tsx — DashboardWidgetCard.tsx
 *  imports only this one component (for the dashboard's own "map" widget type),
 *  and importing it from IncidentsMap.tsx directly would pull in that file's
 *  entire set of top-level imports (leaflet-draw, shpjs, xlsx, html2canvas,
 *  react-leaflet-cluster) into DashboardWidgetCard's own bundle chunk — code
 *  the dashboard never actually uses, and exactly the kind of unnecessary
 *  shared-chunk bloat the app's route-level code-splitting was built to avoid. */
export function HeatmapLayer({ points, style }: { points: [number, number, number][]; style?: Partial<HeatmapStyle> }) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);
  const resolved: HeatmapStyle = { ...DEFAULT_HEATMAP_STYLE, ...style };

  useEffect(() => {
    const layer = L.heatLayer(points, {
      radius: resolved.radius,
      blur: resolved.blur,
      maxZoom: 12,
      minOpacity: 0.35,
      max: resolved.max,
      gradient: HEATMAP_GRADIENTS[resolved.gradient].stops,
    });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, resolved.radius, resolved.blur, resolved.max, resolved.gradient]);

  useEffect(() => {
    layerRef.current?.setLatLngs(points);
  }, [points]);

  return null;
}
