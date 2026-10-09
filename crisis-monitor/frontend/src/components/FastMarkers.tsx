import { useEffect } from "react";
import { useMap } from "react-leaflet";
import * as L from "leaflet";

export interface FastPoint {
  latitude: number;
  longitude: number;
  color: string;
  /** Built only when the pointer rests on the dot, so tens of thousands of points cost nothing until looked at. */
  tip: () => string;
}

/** Incident dots drawn on one canvas, so thousands of them stay quick to pan and zoom (a DOM pin per incident is not). */
export function FastMarkers({ points, radius = 4.5 }: { points: FastPoint[]; radius?: number }) {
  const map = useMap();
  useEffect(() => {
    const renderer = L.canvas({ padding: 0.4 });
    const group = L.layerGroup();
    for (const p of points) {
      const m = L.circleMarker([p.latitude, p.longitude], { renderer, radius, color: "#ffffff", weight: 1.2, fillColor: p.color, fillOpacity: 0.9 });
      m.bindTooltip(() => p.tip(), { direction: "top", offset: [0, -3], opacity: 0.95 });
      group.addLayer(m);
    }
    group.addTo(map);
    return () => {
      map.removeLayer(group);
    };
  }, [map, points, radius]);
  return null;
}
