import { useEffect, useMemo, useRef } from "react";
import L, { type Map as LeafletMap } from "leaflet";
import { Popup as GlPopup, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import type { IncidentHistoryPoint } from "../api";
import { UNDER } from "../components/globeExtras";
import { useIncidentHistory, useStrategic } from "./store";
import { kindOf } from "./IncidentCircles";

/**
 * Maritime chokepoints: the straits and canals that trade through Africa and the Middle East depends on, as
 * labelled triangles. Each popup says why it matters and lists the Lens's incidents within 300 km in the last
 * 90 days.
 */

export interface Chokepoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  note: string;
}

export const CHOKEPOINTS: Chokepoint[] = [
  { id: "bab-el-mandeb", name: "Bab el-Mandeb Strait", lat: 12.6, lng: 43.35, note: "Southern gate of the Red Sea between Yemen and Djibouti, on the Europe–Asia route through Suez. Houthi missile, drone and boat attacks have pushed much shipping round the Cape." },
  { id: "suez", name: "Suez Canal", lat: 30.6, lng: 32.34, note: "Egypt's canal between the Mediterranean and the Red Sea; its traffic and revenue fall whenever the Red Sea is unsafe." },
  { id: "hormuz", name: "Strait of Hormuz", lat: 26.55, lng: 56.4, note: "Exit of the Gulf between Iran and Oman, carrying much of the world's seaborne oil and Qatar's gas. Exposed to Iranian seizures, harassment and any Iran–Israel or Iran–US conflict." },
  { id: "gibraltar", name: "Strait of Gibraltar", lat: 35.95, lng: -5.6, note: "Entrance to the Mediterranean between Morocco and Spain; migration and smuggling route as well as a trade artery." },
  { id: "bosporus", name: "Bosporus Strait", lat: 41.12, lng: 29.06, note: "Turkish Straits link to the Black Sea: Black Sea grain and oil exports, and naval passage governed by the Montreux Convention." },
  { id: "sicily", name: "Strait of Sicily", lat: 37.2, lng: 11.6, note: "Narrows between Tunisia and Sicily on the central Mediterranean migration route from Libya and Tunisia." },
  { id: "mozambique", name: "Mozambique Channel", lat: -16.5, lng: 41.8, note: "Between Mozambique and Madagascar, used more since ships began avoiding the Red Sea; Cabo Delgado insurgency and LNG projects on its western shore." },
  { id: "cape", name: "Cape of Good Hope", lat: -34.36, lng: 18.47, note: "The way round Africa that ships take when the Red Sea is closed to them, adding one to two weeks to Asia–Europe voyages." },
  { id: "malacca", name: "Malacca Strait", lat: 2.5, lng: 101.3, note: "Asia's main sea lane, the far end of the Gulf's oil and gas trade to East Asia." },
];

const NEAR_KM = 300;
const DAYS = 90;
function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function popupHtml(c: Chokepoint, history: IncidentHistoryPoint[] | null): string {
  let near = "";
  if (history) {
    const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
    const hits = history.filter((p) => p.date >= since && km([c.lat, c.lng], [p.lat, p.lon]) <= NEAR_KM);
    const t = hits.filter((p) => kindOf(p) === "terror").length;
    const h = hits.filter((p) => kindOf(p) === "hybrid").length;
    near = `<div style="margin-top:7px;padding-top:6px;border-top:1px solid rgba(127,127,127,.3)"><b>${hits.length}</b> incident${hits.length === 1 ? "" : "s"} within ${NEAR_KM} km in the last ${DAYS} days${t || h ? ` (${[t ? `${t} terrorism` : "", h ? `${h} hybrid warfare` : ""].filter(Boolean).join(", ")})` : ""}.${hits
      .slice(0, 3)
      .map((p) => `<div style="margin-top:3px;font-size:11.5px;opacity:.85">${esc(p.date)}: ${esc(p.headline)}</div>`)
      .join("")}</div>`;
  }
  return `<div style="max-width:300px;font-size:12.5px;line-height:1.45"><div style="font-weight:800;margin-bottom:4px">${esc(c.name)}</div><div>${esc(c.note)}</div>${near}</div>`;
}

function triangle(px: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f3f7fc";
  g.strokeStyle = "#0b1626";
  g.lineWidth = px * 0.08;
  g.beginPath();
  g.moveTo(px / 2, px * 0.12);
  g.lineTo(px * 0.9, px * 0.86);
  g.lineTo(px * 0.1, px * 0.86);
  g.closePath();
  g.fill();
  g.stroke();
  return c;
}

const data: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: CHOKEPOINTS.map((c) => ({ type: "Feature", properties: { id: c.id, name: c.name }, geometry: { type: "Point", coordinates: [c.lng, c.lat] } })),
};

export function useFlatChokepoints(map: LeafletMap | null) {
  const { chokepoints: on } = useStrategic();
  const history = useIncidentHistory(on);
  useEffect(() => {
    if (!map || !on) return;
    const img = triangle(36).toDataURL();
    const group = L.layerGroup(
      CHOKEPOINTS.map((c) =>
        L.marker([c.lat, c.lng], {
          icon: L.divIcon({
            className: "",
            iconSize: [18, 18],
            iconAnchor: [9, 9],
            html: `<div style="position:relative"><img src="${img}" width="18" height="18" alt="" /><span style="position:absolute;left:22px;top:0;white-space:nowrap;font:700 11.5px Inter,system-ui,sans-serif;color:#f3f7fc;text-shadow:0 0 3px #05080f,0 0 3px #05080f">${esc(c.name)}</span></div>`,
          }),
        }).bindPopup(() => popupHtml(c, history), { maxWidth: 320 })
      )
    ).addTo(map);
    return () => {
      group.remove();
    };
  }, [map, on, history]);
}

const SRC = "lens-chokepoints";
export function GlobeChokepoints({ map }: { map: MapLibreMap | null }) {
  const { chokepoints: on } = useStrategic();
  const history = useIncidentHistory(on);
  const hist = useRef(history);
  hist.current = history;
  const popup = useRef<GlPopup | null>(null);
  const shown = useMemo(() => (on ? data : { type: "FeatureCollection" as const, features: [] }), [on]);
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const src = map.getSource(SRC) as GeoJSONSource | undefined;
      if (src) {
        src.setData(shown);
        return;
      }
      if (!map.hasImage("lens-chokepoint")) {
        const c = triangle(40);
        map.addImage("lens-chokepoint", c.getContext("2d")!.getImageData(0, 0, 40, 40), { pixelRatio: 2 });
      }
      const before = (map.getStyle().layers ?? []).find((l) => l.id.startsWith("lens-") && !UNDER.some((p) => l.id.startsWith(p)) && !l.id.startsWith("lens-strat-") && !l.id.startsWith(SRC))?.id;
      map.addSource(SRC, { type: "geojson", data: shown });
      map.addLayer(
        {
          id: `${SRC}-sym`,
          type: "symbol",
          source: SRC,
          layout: {
            "icon-image": "lens-chokepoint",
            "icon-allow-overlap": true,
            "text-field": ["get", "name"],
            "text-font": ["Noto Sans Bold", "Open Sans Bold"],
            "text-size": 11.5,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-optional": true,
          },
          paint: { "text-color": "#f3f7fc", "text-halo-color": "#05080f", "text-halo-width": 1.4 },
        },
        before
      );
      map.on("click", `${SRC}-sym`, (e: MapLayerMouseEvent) => {
        // Only when nothing else (a scenario, a marker) lies on top.
        if (map.queryRenderedFeatures(e.point)[0]?.layer.id !== `${SRC}-sym`) return;
        const c = CHOKEPOINTS.find((x) => x.id === e.features?.[0]?.properties?.id);
        if (!c) return;
        popup.current?.remove();
        popup.current = new GlPopup({ maxWidth: "320px" }).setLngLat([c.lng, c.lat]).setHTML(popupHtml(c, hist.current)).addTo(map);
      });
      map.on("mouseenter", `${SRC}-sym`, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", `${SRC}-sym`, () => (map.getCanvas().style.cursor = ""));
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [map, shown]);
  return null;
}
