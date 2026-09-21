-import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import * as L from "leaflet";
import "leaflet.heat";

/** Canvas-based heat-density layer, an alternative to plotting individual pins
 *  — useful once there are enough incidents that markers start overlapping and
 *  density becomes the more readable signal. `weighted` uses each incident's
 *  total casualties as intensity (so severe clusters stand out more); off,
 *  every incident counts equally (pure geographic density).
 *
 *  Deliberately its own file, not part of IncidentsMap.tsx — DashboardWidgetCard.tsx
 *  imports only this one component (for the dashboard's own "map" widget type),
 *  and importing it from IncidentsMap.tsx directly would pull in that file's
 *  entire set of top-level imports (leaflet-draw, shpjs, xlsx, html2canvas,
 *  react-leaflet-cluster) into DashboardWidgetCard's own bundle chunk — code
 *  the dashboard never actually uses, and exactly the kind of unnecessary
 *  shared-chunk bloat the app's route-level code-splitting was built to avoid. */
export function HeatmapLayer({ points }: { points: [number, number, number][] }) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    const layer = L.heatLayer(points, { radius: 22, blur: 18, maxZoom: 12, minOpacity: 0.35 });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      map.removeLayer(layer);
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    layerRef.current?.setLatLngs(points);
  }, [points]);

  return null;
}
