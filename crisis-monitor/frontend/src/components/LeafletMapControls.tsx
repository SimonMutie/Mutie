import { useEffect } from "react";
import { useMap } from "react-leaflet";
import MapNavPad from "./MapNavPad";

/** A north arrow. These maps never rotate, so it always points up; it sits bottom-left, clear of the zoom pad. */
export function MapCompass({ size = 46 }: { size?: number }) {
  return (
    <div
      className="lens-compass"
      title="North is up"
      style={{ position: "absolute", left: 10, bottom: 30, zIndex: 1000, width: size, height: size, borderRadius: "50%", background: "rgba(8,10,20,0.88)", border: "1px solid rgba(212,175,55,0.25)", boxShadow: "0 4px 18px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}
    >
      <svg width={size * 0.8} height={size * 0.8} viewBox="0 0 32 32" aria-label="Compass: north is up">
        <circle cx="16" cy="16" r="14" fill="none" stroke="#9B978E" strokeWidth="0.6" opacity="0.6" />
        <path d="M16 4 L20 16 L16 14 L12 16 Z" fill="#e34948" />
        <path d="M16 28 L12 16 L16 18 L20 16 Z" fill="#e8e6e0" opacity="0.75" />
        <text x="16" y="3.6" textAnchor="middle" fontSize="5.2" fontWeight="700" fill="#e8e6e0" dominantBaseline="hanging">N</text>
        <text x="30.2" y="17.6" textAnchor="end" fontSize="4" fill="#9B978E">E</text>
        <text x="16" y="31.4" textAnchor="middle" fontSize="4" fill="#9B978E">S</text>
        <text x="1.8" y="17.6" fontSize="4" fill="#9B978E">W</text>
      </svg>
    </div>
  );
}

/** What every map gets: the zoom and pan pad from the front map, plus a compass. Put it inside a MapContainer.
 *  `wheelOnClick` keeps the mouse wheel scrolling the page until the map is clicked, so a map inside a dashboard
 *  does not trap the scroll. */
export default function LeafletMapControls({ wheelOnClick = false, compass = true }: { wheelOnClick?: boolean; compass?: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!wheelOnClick) return;
    map.scrollWheelZoom.disable();
    const on = () => map.scrollWheelZoom.enable();
    const off = () => map.scrollWheelZoom.disable();
    map.on("click focus", on);
    map.on("mouseout blur", off);
    return () => {
      map.off("click focus", on);
      map.off("mouseout blur", off);
    };
  }, [map, wheelOnClick]);
  return (
    <>
      <MapNavPad onZoomIn={() => map.zoomIn()} onZoomOut={() => map.zoomOut()} onPan={(dx, dy) => map.panBy([dx, dy])} />
      {compass && <MapCompass />}
    </>
  );
}
