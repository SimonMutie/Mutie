import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import { Popup as GlPopup } from "maplibre-gl";
import { Circle, Marker, Polyline, Popup, Tooltip } from "react-leaflet";
import { divIcon } from "leaflet";
import { api, type Vehicle, type VehiclePoint } from "../api";

/**
 * Tracked vehicles on Live OSINT (positions from routes/tracking.ts): each vehicle as a car seen from above, turned
 * the way it is heading,
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

/** The exact reported position, with how precise the phone said it was. */
export function vehiclePosition(v: Vehicle): string {
  if (!v.last) return "";
  const acc = v.last.accuracyM;
  return `${v.last.lat.toFixed(6)}, ${v.last.lng.toFixed(6)}${acc !== null ? ` · precise to ±${Math.round(acc)} m${acc > 60 ? " (rough: no satellite fix)" : ""}` : ""}`;
}

/** A circle of `radiusM` metres as a polygon (for the globe, which has no metre circles). */
export function circlePolygon(lat: number, lng: number, radiusM: number, steps = 72): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}
const ALERT_RED = "#ff3b3b";

/**
 * A car seen from above, nose up, in the vehicle's colour with a white outline: windscreen, roof, rear window,
 * headlights and tail lights. Rotated on the map to the way the car is heading (or last headed, when parked).
 * Drawn the same on both views.
 */
export function carSvg(color: string, w = 18, h = 32): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 36 64">
  <rect x="4" y="2" width="28" height="60" rx="11" fill="${color}" stroke="#ffffff" stroke-width="3"/>
  <path d="M9 19 L27 19 L24.5 28 L11.5 28 Z" fill="#0b1220" fill-opacity="0.85"/>
  <rect x="11" y="29" width="14" height="15" rx="2.5" fill="#ffffff" fill-opacity="0.18"/>
  <path d="M11.5 45 L24.5 45 L26 51 L10 51 Z" fill="#0b1220" fill-opacity="0.75"/>
  <rect x="8" y="5" width="6" height="3.2" rx="1.4" fill="#fff6c2"/>
  <rect x="22" y="5" width="6" height="3.2" rx="1.4" fill="#fff6c2"/>
  <rect x="8" y="56.5" width="6" height="2.8" rx="1.2" fill="#ff4d4d"/>
  <rect x="22" y="56.5" width="6" height="2.8" rx="1.2" fill="#ff4d4d"/>
</svg>`;
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

/** The car image for the globe, drawn at twice its size for sharp screens. */
function carImage(color: string): Promise<HTMLImageElement> {
  const img = new Image(36, 64);
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(carSvg(color, 36, 64))}`;
  return img.decode().then(() => img);
}
const carName = (color: string) => `lens-vehicle-car-${color}`;

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
    // Rings: each safe zone (dashed outline), how precise the latest fix is (faint disc), and a red ring on a vehicle
    // breaking a rule.
    const rings = vehicles.flatMap((v) => {
      const out: { type: "Feature"; properties: { kind: string; color: string }; geometry: { type: "Polygon"; coordinates: [number, number][][] } }[] = [];
      if (v.zone) out.push({ type: "Feature", properties: { kind: "zone", color: v.color }, geometry: { type: "Polygon", coordinates: [circlePolygon(v.zone.lat, v.zone.lng, v.zone.radiusM)] } });
      if (v.last && v.last.accuracyM && v.last.accuracyM > 10) out.push({ type: "Feature", properties: { kind: "accuracy", color: colorOf(v) }, geometry: { type: "Polygon", coordinates: [circlePolygon(v.last.lat, v.last.lng, v.last.accuracyM)] } });
      return out;
    });
    const alerting = vehicles.filter((v) => v.alerting && v.last).map((v) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [v.last!.lng, v.last!.lat] } }));
    return {
      points: { type: "FeatureCollection" as const, features: points },
      lines: { type: "FeatureCollection" as const, features: lines },
      rings: { type: "FeatureCollection" as const, features: rings },
      alerting: { type: "FeatureCollection" as const, features: alerting },
    };
  }, [vehicles, tracks]);

  // Layers added once, on top of everything (vehicles are what you are watching).
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const colors = [...new Set(data.points.features.map((f) => f.properties.color))].filter((c) => !map.hasImage(carName(c)));
    void Promise.all(colors.map((c) => carImage(c).then((img) => [c, img] as const))).then((imgs) => {
      if (cancelled) return;
      for (const [c, img] of imgs) if (!map.hasImage(carName(c))) map.addImage(carName(c), img, { pixelRatio: 2 });
      draw();
    });
    return () => {
      cancelled = true;
    };
    function draw() {
    if (!map) return;
    if (!map.getSource("lens-vehicles")) {
      map.addSource("lens-vehicle-rings", { type: "geojson", data: data.rings as never });
      map.addSource("lens-vehicle-alerting", { type: "geojson", data: data.alerting as never });
      map.addSource("lens-vehicle-trails", { type: "geojson", data: data.lines as never });
      map.addLayer({ id: "lens-vehicle-accuracy", type: "fill", source: "lens-vehicle-rings", filter: ["==", ["get", "kind"], "accuracy"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16, "fill-outline-color": ["get", "color"] } });
      map.addLayer({ id: "lens-vehicle-zone", type: "line", source: "lens-vehicle-rings", filter: ["==", ["get", "kind"], "zone"], paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.9 } });
      map.addLayer({ id: "lens-vehicle-alert-ring", type: "circle", source: "lens-vehicle-alerting", paint: { "circle-radius": 22, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ALERT_RED, "circle-stroke-width": 3 } });
      map.addSource("lens-vehicles", { type: "geojson", data: data.points as never });
      map.addLayer({ id: "lens-vehicle-trails", type: "line", source: "lens-vehicle-trails", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.75 } });
      map.addLayer({
        id: "lens-vehicles-car",
        type: "symbol",
        source: "lens-vehicles",
        layout: { "icon-image": ["concat", "lens-vehicle-car-", ["get", "color"]], "icon-size": 1, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
      });
      map.addLayer({
        id: "lens-vehicles-label",
        type: "symbol",
        source: "lens-vehicles",
        layout: { "text-field": ["get", "name"], "text-size": 11.5, "text-offset": [0, 1.9], "text-anchor": "top", "text-allow-overlap": true, "text-font": ["Noto Sans Bold", "Open Sans Bold"] },
        paint: { "text-color": "#ffffff", "text-halo-color": "#05080f", "text-halo-width": 1.5 },
      });
      const click = (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        const v = id ? byId.current[id] : undefined;
        if (!v || !v.last) return;
        popupRef.current?.remove();
        popupRef.current = new GlPopup({ closeButton: true, offset: 14 }).setLngLat([v.last.lng, v.last.lat]).setHTML(`<b>${v.name.replace(/</g, "&lt;")}</b><br/>${vehicleSummary(v)}<br/><span style="opacity:.75">${vehiclePosition(v)}</span>`).addTo(map);
      };
      for (const l of ["lens-vehicles-car"]) {
        map.on("click", l, click);
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
    } else {
      (map.getSource("lens-vehicles") as GeoJSONSource).setData(data.points as never);
      (map.getSource("lens-vehicle-trails") as GeoJSONSource).setData(data.lines as never);
      (map.getSource("lens-vehicle-rings") as GeoJSONSource).setData(data.rings as never);
      (map.getSource("lens-vehicle-alerting") as GeoJSONSource).setData(data.alerting as never);
    }
    }
  }, [map, data]);
  // The red ring on a vehicle breaking a rule pulses.
  const anyAlert = data.alerting.features.length > 0;
  useEffect(() => {
    if (!map || !anyAlert) return;
    let raf = 0;
    const tick = (t: number) => {
      const k = (t % 1400) / 1400;
      if (map.getLayer("lens-vehicle-alert-ring")) {
        map.setPaintProperty("lens-vehicle-alert-ring", "circle-radius", 16 + 18 * k);
        map.setPaintProperty("lens-vehicle-alert-ring", "circle-stroke-opacity", 1 - k);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [map, anyAlert]);
  return null;
}

const carHtml = (color: string, heading: number) => `<div style="transform:rotate(${heading}deg);width:18px;height:32px">${carSvg(color)}</div>`;

export function FlatVehicles({ vehicles, tracks }: { vehicles: Vehicle[]; tracks: Record<string, VehiclePoint[]> }) {
  return (
    <>
      {vehicles.map((v) =>
        (tracks[v.id]?.length ?? 0) > 1 ? <Polyline key={`t-${v.id}`} positions={tracks[v.id].map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: colorOf(v), weight: 3, opacity: 0.75 }} interactive={false} /> : null
      )}
      {vehicles.map((v) =>
        v.zone ? <Circle key={`z-${v.id}`} center={[v.zone.lat, v.zone.lng]} radius={v.zone.radiusM} pathOptions={{ color: v.color, weight: 2, dashArray: "6 4", fill: false }} interactive={false} /> : null
      )}
      {vehicles.map((v) =>
        v.last && v.last.accuracyM && v.last.accuracyM > 10 ? <Circle key={`a-${v.id}`} center={[v.last.lat, v.last.lng]} radius={v.last.accuracyM} pathOptions={{ color: colorOf(v), weight: 1, opacity: 0.6, fillColor: colorOf(v), fillOpacity: 0.16 }} interactive={false} /> : null
      )}
      {vehicles
        .filter((v) => v.last)
        .map((v) => {
          return (
            <Marker
              key={v.id}
              position={[v.last!.lat, v.last!.lng]}
              zIndexOffset={1000}
              icon={divIcon({ className: `lens-vehicle-icon${v.alerting ? " lens-vehicle-alerting" : ""}`, html: carHtml(colorOf(v), v.last!.heading ?? 0), iconSize: [18, 32], iconAnchor: [9, 16] })}
            >
              <Tooltip permanent direction="bottom" offset={[0, 16]} className="lens-vehicle-label">
                {v.name}
              </Tooltip>
              <Popup>
                <b>{v.name}</b>
                <br />
                {vehicleSummary(v)}
                <br />
                <span style={{ opacity: 0.75 }}>{vehiclePosition(v)}</span>
              </Popup>
            </Marker>
          );
        })}
    </>
  );
}
