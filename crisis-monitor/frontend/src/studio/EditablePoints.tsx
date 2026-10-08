import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import "./Studio.css";

/** Points the user can drag: the corners of a measured line or area, and the start and end of a route. */
export interface EditPoint {
  id: string;
  lat: number;
  lng: number;
  color?: string;
  label?: string;
}

const dot = (color = "#F0D060", label?: string) => {
  const d = document.createElement("div");
  d.className = "studio-vh";
  d.style.borderColor = color;
  d.style.width = d.style.height = "18px";
  d.style.cursor = "grab";
  if (label) d.title = label;
  return d;
};

/** For the flat (Leaflet) map; render inside the MapContainer. */
export function EditablePoints({ items, onMove }: { items: EditPoint[]; onMove: (id: string, lat: number, lng: number) => void }) {
  const map = useMap();
  const key = JSON.stringify(items);
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    for (const it of items) {
      const icon = L.divIcon({ className: "", html: `<div class="studio-vh" style="border-color:${it.color ?? "#F0D060"};width:18px;height:18px" title="${it.label ?? "Drag to move"}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
      const m = L.marker([it.lat, it.lng], { icon, draggable: true, zIndexOffset: 900, bubblingMouseEvents: false }).addTo(group);
      m.on("dragend", () => {
        const ll = m.getLatLng();
        onMove(it.id, ll.lat, ll.lng);
      });
      m.on("click", (e) => L.DomEvent.stopPropagation(e));
    }
    return () => void map.removeLayer(group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/** For the 3D globe (MapLibre). */
export function EditablePoints3D({ map, items, onMove }: { map: MapLibreMap | null; items: EditPoint[]; onMove: (id: string, lat: number, lng: number) => void }) {
  const key = JSON.stringify(items);
  useEffect(() => {
    if (!map) return;
    const markers = items.map((it) => {
      const m = new Marker({ element: dot(it.color, it.label ?? "Drag to move"), draggable: true }).setLngLat([it.lng, it.lat]).addTo(map);
      m.on("dragend", () => {
        const ll = m.getLngLat();
        onMove(it.id, ll.lat, ll.lng);
      });
      m.getElement().addEventListener("click", (e) => e.stopPropagation());
      return m;
    });
    return () => markers.forEach((m) => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}
