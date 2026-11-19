import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Popup as GlPopup } from "maplibre-gl";
import { Marker, Polyline, Popup, Tooltip } from "react-leaflet";
import { divIcon } from "leaflet";
import { api, type Vehicle, type VehiclePoint } from "../api";

/**
 * Tracked vehicles on Live OSINT (positions from routes/tracking.ts): each vehicle as an arrow pointing its way,
 * in its colour, with its name, and its trail over the chosen hours. Live: the list refreshes every 10 seconds,
 * the trails every 30. A vehicle not heard from in 10 minutes is drawn grey ("last seen").
 */

const STALE_MS = 10 * 60_000;
export const isStale = (v: Vehicle) => !v.last || Date.now() - Date.parse(v.last.at) > STALE_MS;
const colorOf = (v: Vehicle) => (isStale(v) ? "#8a94a6" : v.color);

export function vehicleSummary(v: Vehicle): string {
  if (!v.last) return "No position yet";
  const m = Math.round((Date.now() - Date.parse(v.last.at)) / 60000);
  const when = m < 1 ? "now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  const parts = [isStale(v) ? `Last seen ${when}` : `Live, ${when}`];
  if (v.last.speedKmh !== null) parts.push(`${Math.round(v.last.speedKmh)} km/h`);
  if (v.last.ignition !== null) parts.push(v.last.ignition ? "engine on" : "engine off");
  if (v.last.battery !== null) parts.push(`battery ${Math.round(v.last.battery)}%`);
  if (v.speedLimitKmh && v.last.speedKmh !== null && v.last.speedKmh > v.speedLimitKmh && !isStale(v)) parts.push(`OVER ${v.speedLimitKmh} km/h LIMIT`);
  return parts.join(" · ");
}

export function useVehicles(on: boolean, hours: number) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [tracks, setTracks] = useState<Record<string, VehiclePoint[]>>({});
  const ids = vehicles.map((v) => v.id).join(",");
  useEffect(() => {
    if (!on) return;
    let live = true;
    const load = () => api.getVehicles().then((r) => live && setVehicles(r.vehicles)).catch(() => undefined);
    void load();
    const t = window.setInterval(load, 10_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [on]);
  useEffect(() => {
    if (!on || !ids) return;
    let live = true;
    const load = () =>
      Promise.all(ids.split(",").map((id) => api.getVehicleTrack(id, hours).then((r) => [id, r.points] as const).catch(() => [id, [] as VehiclePoint[]] as const))).then(
        (pairs) => live && setTracks(Object.fromEntries(pairs))
      );
    void load();
    const t = window.setInterval(load, 30_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [on, ids, hours]);
  return { vehicles: on ? vehicles : [], tracks: on ? tracks : {} };
}

/** The arrow in a vehicle's colour with a white edge, drawn at twice its size for sharp screens. */
function arrowImage(color: string): ImageData {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.beginPath();
  ctx.moveTo(s / 2, 6);
  ctx.lineTo(s - 12, s - 8);
  ctx.lineTo(s / 2, s - 20);
  ctx.lineTo(12, s - 8);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  return ctx.getImageData(0, 0, s, s);
}
const arrowName = (color: string) => `lens-vehicle-arrow-${color}`;

export function GlobeVehicles({ map, vehicles, tracks }: { map: MapLibreMap | null; vehicles: Vehicle[]; tracks: Record<string, VehiclePoint[]> }) {
  const popupRef = useRef<GlPopup | null>(null);
  const byId = useRef<Record<string, Vehicle>>({});
  byId.current = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  const data = useMemo(() => {
    const points = vehicles
      .filter((v) => v.last)
      .map((v) => ({ type: "Feature" as const, properties: { id: v.id, name: v.name, color: colorOf(v), heading: v.last!.heading ?? 0, moving: v.last!.heading !== null && (v.last!.speedKmh ?? 0) > 3 ? 1 : 0 }, geometry: { type: "Point" as const, coordinates: [v.last!.lng, v.last!.lat] } }));
    const lines = vehicles
      .filter((v) => (tracks[v.id]?.length ?? 0) > 1)
      .map((v) => ({ type: "Feature" as const, properties: { color: colorOf(v) }, geometry: { type: "LineString" as const, coordinates: tracks[v.id].map((p) => [p.lng, p.lat]) } }));
    return { points: { type: "FeatureCollection" as const, features: points }, lines: { type: "FeatureCollection" as const, features: lines } };
  }, [vehicles, tracks]);

  // Layers added once, on top of everything (vehicles are what you are watching).
  useEffect(() => {
    if (!map) return;
    for (const f of data.points.features) if (!map.hasImage(arrowName(f.properties.color))) map.addImage(arrowName(f.properties.color), arrowImage(f.properties.color), { pixelRatio: 2 });
    if (!map.getSource("lens-vehicles")) {
      map.addSource("lens-vehicle-trails", { type: "geojson", data: data.lines as never });
      map.addSource("lens-vehicles", { type: "geojson", data: data.points as never });
      map.addLayer({ id: "lens-vehicle-trails", type: "line", source: "lens-vehicle-trails", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.75 } });
      map.addLayer({ id: "lens-vehicles-dot", type: "circle", source: "lens-vehicles", filter: ["==", ["get", "moving"], 0], paint: { "circle-radius": 7, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      map.addLayer({
        id: "lens-vehicles-arrow",
        type: "symbol",
        source: "lens-vehicles",
        filter: ["==", ["get", "moving"], 1],
        layout: { "icon-image": ["concat", "lens-vehicle-arrow-", ["get", "color"]], "icon-size": 0.85, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
      });
      map.addLayer({
        id: "lens-vehicles-label",
        type: "symbol",
        source: "lens-vehicles",
        layout: { "text-field": ["get", "name"], "text-size": 11.5, "text-offset": [0, 1.5], "text-anchor": "top", "text-allow-overlap": true, "text-font": ["Noto Sans Bold", "Open Sans Bold"] },
        paint: { "text-color": "#ffffff", "text-halo-color": "#05080f", "text-halo-width": 1.5 },
      });
      const click = (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const v = id ? byId.current[id] : undefined;
        if (!v || !v.last) return;
        popupRef.current?.remove();
        popupRef.current = new GlPopup({ closeButton: true, offset: 14 }).setLngLat([v.last.lng, v.last.lat]).setHTML(`<b>${v.name.replace(/</g, "&lt;")}</b><br/>${vehicleSummary(v)}`).addTo(map);
      };
      for (const l of ["lens-vehicles-dot", "lens-vehicles-arrow"]) {
        map.on("click", l, click);
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
    } else {
      (map.getSource("lens-vehicles") as GeoJSONSource).setData(data.points as never);
      (map.getSource("lens-vehicle-trails") as GeoJSONSource).setData(data.lines as never);
    }
  }, [map, data]);
  return null;
}

const arrowSvg = (color: string, heading: number, moving: boolean) =>
  moving
    ? `<svg width="26" height="26" viewBox="0 0 64 64" style="transform:rotate(${heading}deg)"><path d="M32 6 L52 56 L32 44 L12 56 Z" fill="${color}" stroke="#fff" stroke-width="5" stroke-linejoin="round"/></svg>`
    : `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="${color}" stroke="#fff" stroke-width="2.5"/></svg>`;

export function FlatVehicles({ vehicles, tracks }: { vehicles: Vehicle[]; tracks: Record<string, VehiclePoint[]> }) {
  return (
    <>
      {vehicles.map((v) =>
        (tracks[v.id]?.length ?? 0) > 1 ? <Polyline key={`t-${v.id}`} positions={tracks[v.id].map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: colorOf(v), weight: 3, opacity: 0.75 }} interactive={false} /> : null
      )}
      {vehicles
        .filter((v) => v.last)
        .map((v) => {
          const moving = v.last!.heading !== null && (v.last!.speedKmh ?? 0) > 3;
          const size = moving ? 26 : 18;
          return (
            <Marker
              key={v.id}
              position={[v.last!.lat, v.last!.lng]}
              zIndexOffset={1000}
              icon={divIcon({ className: "lens-vehicle-icon", html: arrowSvg(colorOf(v), v.last!.heading ?? 0, moving), iconSize: [size, size], iconAnchor: [size / 2, size / 2] })}
            >
              <Tooltip permanent direction="bottom" offset={[0, 12]} className="lens-vehicle-label">
                {v.name}
              </Tooltip>
              <Popup>
                <b>{v.name}</b>
                <br />
                {vehicleSummary(v)}
              </Popup>
            </Marker>
          );
        })}
    </>
  );
}
