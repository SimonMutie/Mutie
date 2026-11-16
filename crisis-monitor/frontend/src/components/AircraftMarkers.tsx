import { useMemo, useState } from "react";
import { Marker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { divIcon, type DivIcon } from "leaflet";
import { planeSvg } from "./planeIcon";

export interface AircraftPoint {
  id: string;
  layerKey: string;
  lat: number;
  lng: number;
  color: string;
  title: string;
  subtitle: string;
  heading?: number;
}

/** Most plane markers drawn at once: only those in view are drawn, so panning stays smooth. */
const MAX_IN_VIEW = 1500;
const iconCache = new Map<string, DivIcon>();
function planeIcon(color: string, heading: number, selected: boolean): DivIcon {
  const h = Math.round(heading / 5) * 5;
  const key = `${color}:${h}:${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const size = selected ? 22 : 15;
    icon = divIcon({
      className: "",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      html: `<div style="width:${size}px;height:${size}px;transform:rotate(${h}deg);${selected ? "filter:drop-shadow(0 0 4px #ffd23f)" : ""}">${planeSvg(selected ? "#ffd23f" : color, size)}</div>`,
    });
    iconCache.set(key, icon);
  }
  return icon;
}

/** Aircraft on the flat map as small plane symbols turned to their heading. Click one to trace it. */
export function AircraftMarkers({ points, selectedId, onSelect }: { points: AircraftPoint[]; selectedId: string | null; onSelect: (id: string, title: string) => void }) {
  const map = useMap();
  const [bounds, setBounds] = useState(() => map.getBounds());
  useMapEvents({ moveend: () => setBounds(map.getBounds()), zoomend: () => setBounds(map.getBounds()) });
  const shown = useMemo(() => {
    const pad = bounds.pad(0.1);
    const inView = points.filter((p) => pad.contains([p.lat, p.lng]));
    return inView.length > MAX_IN_VIEW ? [...inView.filter((p) => p.id === selectedId), ...inView.filter((p) => p.id !== selectedId).slice(0, MAX_IN_VIEW)] : inView;
  }, [points, bounds, selectedId]);
  return (
    <>
      {shown.map((p) => (
        <Marker
          key={`${p.layerKey}:${p.id}`}
          position={[p.lat, p.lng]}
          icon={planeIcon(p.color, p.heading ?? 0, p.id === selectedId)}
          zIndexOffset={p.id === selectedId ? 1000 : 0}
          eventHandlers={{ click: () => onSelect(p.id, p.title) }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <div style={{ fontFamily: "monospace", fontSize: 12 }}>
              <b>{p.title}</b>
              <br />
              <span style={{ opacity: 0.7 }}>{p.layerKey}</span>
              <br />
              {p.subtitle}
              <br />
              <span style={{ opacity: 0.7 }}>Click to see its path and follow it</span>
            </div>
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}
