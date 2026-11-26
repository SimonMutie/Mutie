import { useEffect, useMemo, useRef } from "react";
import L, { type Map as LeafletMap } from "leaflet";
import { Popup as GlPopup, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import type { IncidentHistoryPoint } from "../api";
import { UNDER } from "../components/globeExtras";
import { inPeriod, useIncidentHistory, usePeriod, useStrategic } from "./store";

/**
 * Incident circles: the Lens's escalation incidents since January 2025 (active or not), grouped into circles that
 * grow with the number of incidents and split apart as you zoom in. Terrorist attacks are grey, hybrid warfare
 * (sabotage, jamming, cyberattacks, influence operations, drone incursions, cable damage) green, other conflict
 * incidents light. The timeline narrows them to a period.
 */

export const CIRCLE_STYLE = {
  other: { label: "Conflict incidents", fill: "#e3ecf7", stroke: "#ffffff", opacity: 0.5 },
  terror: { label: "Terrorist attacks", fill: "#6f7884", stroke: "#e3ecf7", opacity: 0.85 },
  hybrid: { label: "Hybrid warfare", fill: "#3ddc84", stroke: "#b8f5d0", opacity: 0.55 },
} as const;
type Kind = keyof typeof CIRCLE_STYLE;
export const KINDS: Kind[] = ["other", "hybrid", "terror"];
/** Terrorism first, then hybrid warfare, then other conflict incidents. */
export const kindOf = (p: IncidentHistoryPoint): Kind => (p.terror ? "terror" : p.hybrid ? "hybrid" : "other");
export const HYBRID_LABEL: Record<NonNullable<IncidentHistoryPoint["hybrid"]>, string> = {
  sabotage: "Sabotage",
  jamming: "GPS jamming or spoofing",
  cyber: "Cyberattack",
  influence: "Influence or disinformation operation",
  drones: "Drone incursion",
  cables: "Subsea cable damage",
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const LEVEL: Record<IncidentHistoryPoint["level"], string> = { watch: "Watch", elevated: "Elevated", critical: "Critical" };
function popupHtml(p: IncidentHistoryPoint): string {
  const where = [p.place, p.country].filter(Boolean).join(", ");
  const fromFeed = p.id.startsWith("hybrid:");
  const facts = [p.date, fromFeed ? null : LEVEL[p.level], p.terror ? "Terrorist attack" : null, p.hybrid ? `Hybrid warfare: ${HYBRID_LABEL[p.hybrid].toLowerCase()}` : null, p.deaths ? `up to ${p.deaths} killed` : null].filter(Boolean).join(" · ");
  const src = p.link ? `<div style="margin-top:5px;font-size:11px"><a href="${esc(p.link)}" target="_blank" rel="noreferrer">${esc(p.source || "Source")}</a></div>` : "";
  return `<div style="max-width:300px;font-size:12.5px;line-height:1.45"><div style="font-weight:800;margin-bottom:4px">${esc(p.headline)}</div>${where ? `<div>${esc(where)}</div>` : ""}<div style="margin-top:4px;opacity:.8">${esc(facts)}</div>${src}</div>`;
}

/** The incidents in the period, split by kind. */
function useShown(): { items: IncidentHistoryPoint[]; byId: Map<string, IncidentHistoryPoint> } | null {
  const { circles: on } = useStrategic();
  const all = useIncidentHistory(on);
  const period = usePeriod();
  return useMemo(() => {
    if (!on || !all) return null;
    const items = all.filter((p) => inPeriod(period, p.date));
    return { items, byId: new Map(items.map((p) => [p.id, p])) };
  }, [on, all, period]);
}

const radiusFor = (n: number) => (n <= 1 ? 6 : Math.min(48, 7 + Math.sqrt(n) * 4.2));

/* ── Flat map: incidents grouped on a 56-pixel grid, regrouped as the map moves ─────────────────────────────── */

export function useFlatIncidentCircles(map: LeafletMap | null) {
  const shown = useShown();
  useEffect(() => {
    if (!map || !shown) return;
    if (!map.getPane("lens-incident-circles")) map.createPane("lens-incident-circles").style.zIndex = "420";
    const group = L.layerGroup().addTo(map);
    const draw = () => {
      group.clearLayers();
      const cell = 56;
      const size = map.getSize();
      for (const kind of KINDS) {
        const st = CIRCLE_STYLE[kind];
        const cells = new Map<string, { n: number; x: number; y: number; lat: number; lng: number; one: IncidentHistoryPoint }>();
        for (const p of shown.items) {
          if (kindOf(p) !== kind) continue;
          const pt = map.latLngToContainerPoint([p.lat, p.lon]);
          if (pt.x < -cell || pt.y < -cell || pt.x > size.x + cell || pt.y > size.y + cell) continue;
          const key = `${Math.floor(pt.x / cell)}:${Math.floor(pt.y / cell)}`;
          const c = cells.get(key);
          if (c) {
            c.n++;
            c.x += pt.x;
            c.y += pt.y;
          } else cells.set(key, { n: 1, x: pt.x, y: pt.y, lat: p.lat, lng: p.lon, one: p });
        }
        for (const c of cells.values()) {
          const ll = c.n === 1 ? L.latLng(c.lat, c.lng) : map.containerPointToLatLng([c.x / c.n, c.y / c.n]);
          const r = radiusFor(c.n);
          const html = `<div style="width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${st.fill};opacity:${st.opacity};border:1.5px solid ${st.stroke};display:flex;align-items:center;justify-content:center;font:700 11px Inter,system-ui,sans-serif;color:#0b1220">${c.n > 1 ? c.n : ""}</div>`;
          const m = L.marker(ll, { pane: "lens-incident-circles", icon: L.divIcon({ className: "", html, iconSize: [r * 2, r * 2], iconAnchor: [r, r] }) });
          if (c.n === 1) m.bindPopup(popupHtml(c.one), { maxWidth: 320 });
          else m.on("click", () => map.setView(ll, Math.min(map.getZoom() + 2, 12)));
          m.bindTooltip(c.n === 1 ? esc(c.one.headline) : `${c.n} ${st.label.toLowerCase()}`, { direction: "top" });
          group.addLayer(m);
        }
      }
    };
    draw();
    map.on("zoomend moveend", draw);
    return () => {
      map.off("zoomend moveend", draw);
      group.remove();
    };
  }, [map, shown]);
}

/* ── Globe: MapLibre's own clustering, one source per kind ───────────────────────────────────────────────────── */

/** Above the country status shading, beneath every other Lens data layer (so markers stay clickable). */
function beforeCircles(map: MapLibreMap) {
  // Beneath the country status trend arrows, when they are there.
  if (map.getLayer("lens-strat-cs-arrow")) return "lens-strat-cs-arrow";
  return (map.getStyle().layers ?? []).find((l) => l.id.startsWith("lens-") && !UNDER.some((p) => l.id.startsWith(p)) && !l.id.startsWith("lens-strat-"))?.id;
}

export function GlobeIncidentCircles({ map }: { map: MapLibreMap | null }) {
  const shown = useShown();
  const byId = useRef<Map<string, IncidentHistoryPoint>>(new Map());
  byId.current = shown?.byId ?? new Map();
  const popup = useRef<GlPopup | null>(null);
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      for (const kind of KINDS) {
        const id = `lens-strat-ic-${kind}`;
        const data: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: (shown?.items ?? []).filter((p) => kindOf(p) === kind).map((p) => ({ type: "Feature", properties: { id: p.id }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })),
        };
        const src = map.getSource(id) as GeoJSONSource | undefined;
        if (src) {
          src.setData(data);
          continue;
        }
        const st = CIRCLE_STYLE[kind];
        const before = beforeCircles(map);
        map.addSource(id, { type: "geojson", data, cluster: true, clusterRadius: 42, clusterMaxZoom: 10 });
        map.addLayer(
          {
            id: `${id}-c`,
            type: "circle",
            source: id,
            paint: {
              "circle-radius": ["case", ["has", "point_count"], ["min", 48, ["+", 7, ["*", 4.2, ["sqrt", ["get", "point_count"]]]]], 6],
              "circle-color": st.fill,
              "circle-opacity": st.opacity,
              "circle-stroke-color": st.stroke,
              "circle-stroke-width": 1.5,
              "circle-stroke-opacity": 0.95,
            },
          },
          before
        );
        map.addLayer(
          {
            id: `${id}-n`,
            type: "symbol",
            source: id,
            filter: ["has", "point_count"],
            layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11, "text-font": ["Noto Sans Bold", "Open Sans Bold"], "text-allow-overlap": true },
            paint: { "text-color": "#0b1220" },
          },
          before
        );
        map.on("click", `${id}-c`, (e: MapLayerMouseEvent) => {
          // Only the topmost circle answers, and nothing when a scenario, chokepoint or marker lies on top.
          const top = map.queryRenderedFeatures(e.point).find((x) => x.layer.type !== "symbol" || !x.layer.id.startsWith("lens-strat-ic-"));
          if (top?.layer.id !== `${id}-c`) return;
          const f = e.features?.[0];
          if (!f) return;
          const cluster = f.properties?.cluster_id;
          if (cluster != null) {
            void (map.getSource(id) as GeoJSONSource)
              .getClusterExpansionZoom(Number(cluster))
              .then((z) => map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: Math.min(z, 12) }));
            return;
          }
          const p = byId.current.get(String(f.properties?.id));
          if (!p) return;
          popup.current?.remove();
          popup.current = new GlPopup({ maxWidth: "320px" }).setLngLat([p.lon, p.lat]).setHTML(popupHtml(p)).addTo(map);
        });
        map.on("mouseenter", `${id}-c`, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", `${id}-c`, () => (map.getCanvas().style.cursor = ""));
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [map, shown]);
  return null;
}
