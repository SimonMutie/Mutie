import { FloatingPanel } from "./FloatingPanel";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import L, { type Map as LeafletMap } from "leaflet";
import { Popup as GlPopup, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import { AS_OF, LINE_STYLE, RISK_AREAS, RISK_LINES, RISK_POINTS, SOURCES, THREAT_SCALE, threatColor, threatLabel, type RiskLayer } from "../data/maritimeRisk";
import { firstDataLayer } from "./globeExtras";

/**
 * Maritime security layers (data/maritimeRisk.ts): "Red Sea & Gulf of Aden: Houthi threat" and "Piracy & maritime
 * crime". Each draws JMIC threat areas coloured by level, the Lloyd's market war-risk listed-area limits, the Gulf
 * of Aden transit lanes and standing events, with the source and date in every popup and a legend on the map.
 */

/* ── On/off, remembered in the browser and shared by the layer list and both maps ────────────────────────────── */

const KEY = "lens-maritime-risk";
type State = Record<RiskLayer, boolean>;
let state: State = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<State> | null;
    return { redsea: !!v?.redsea, piracy: !!v?.piracy };
  } catch {
    return { redsea: false, piracy: false };
  }
})();
const subs = new Set<() => void>();
export function toggleMaritimeRisk(layer: RiskLayer) {
  state = { ...state, [layer]: !state[layer] };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export function useMaritimeRisk(): State {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => state);
}
export const RISK_LAYER_LABEL: Record<RiskLayer, { label: string; hint: string }> = {
  redsea: { label: "Red Sea & Gulf of Aden: Houthi threat", hint: "JMIC threat areas, war-risk limits, transit lanes" },
  piracy: { label: "Piracy & maritime crime", hint: "Somali Basin, Gulf of Aden, Gulf of Guinea, Cabo Delgado" },
};

/* ── Features and popups ─────────────────────────────────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function sourceHtml(id: string, extra = "") {
  const s = SOURCES[id];
  return `<div style="margin-top:7px;padding-top:6px;border-top:1px solid rgba(127,127,127,.3);font-size:11px;opacity:.85">Source: <a href="${s.url}" target="_blank" rel="noreferrer">${esc(s.name)}</a>, ${esc(s.date)}${extra}</div>`;
}
const chip = (text: string, color: string) => `<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10.5px;font-weight:800;letter-spacing:.06em;background:${color};color:#0b1220">${esc(text.toUpperCase())}</span>`;

function popupHtml(kind: string, id: string): string {
  if (kind === "area") {
    const a = RISK_AREAS.find((x) => x.id === id)!;
    return `<div style="max-width:300px;font-size:12.5px;line-height:1.45"><div style="font-weight:800;margin-bottom:4px">${esc(a.name)}</div>${chip(`JMIC threat: ${threatLabel(a.level)}`, threatColor(a.level))}<div style="margin-top:6px">${esc(a.reason)}</div>${sourceHtml(a.source, ". Outline drawn by the Lens to the named waters; JMIC publishes no outlines.")}</div>`;
  }
  if (kind === "line") {
    const l = RISK_LINES.find((x) => x.id === id)!;
    return `<div style="max-width:300px;font-size:12.5px;line-height:1.45"><div style="font-weight:800;margin-bottom:4px;color:${LINE_STYLE[l.kind].color}">${esc(l.name)}</div><div>${esc(l.detail)}</div>${sourceHtml(l.source)}</div>`;
  }
  const p = RISK_POINTS.find((x) => x.id === id)!;
  return `<div style="max-width:300px;font-size:12.5px;line-height:1.45"><div style="font-weight:800;margin-bottom:4px">${esc(p.name)}</div><div>${esc(p.detail)}</div>${sourceHtml(p.source)}</div>`;
}

function collection(on: State): GeoJSON.FeatureCollection {
  const shown = (layers: RiskLayer[]) => layers.some((l) => on[l]);
  const features: GeoJSON.Feature[] = [
    // Lower threat first, so the stronger colour sits on top where areas meet.
    ...RISK_AREAS.filter((a) => shown(a.layer))
      .sort((a, b) => THREAT_SCALE.findIndex((s) => s.level === a.level) - THREAT_SCALE.findIndex((s) => s.level === b.level))
      .map((a) => ({ type: "Feature" as const, properties: { kind: "area", id: a.id, color: threatColor(a.level) }, geometry: { type: "Polygon" as const, coordinates: [a.ring] } })),
    ...RISK_LINES.filter((l) => shown(l.layer)).map((l) => ({
      type: "Feature" as const,
      properties: { kind: "line", id: l.id, color: LINE_STYLE[l.kind].color, dash: LINE_STYLE[l.kind].dash ? 1 : 0, closed: l.closed ? 1 : 0 },
      geometry: l.closed ? { type: "Polygon" as const, coordinates: [l.coords] } : { type: "LineString" as const, coordinates: l.coords },
    })),
    ...RISK_POINTS.filter((p) => shown(p.layer)).map((p) => ({ type: "Feature" as const, properties: { kind: "point", id: p.id, color: "#ff3d3d" }, geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] } })),
  ];
  return { type: "FeatureCollection", features };
}

/* ── Flat map ────────────────────────────────────────────────────────────────────────────────────────────────── */

export function useFlatMaritimeRisk(map: LeafletMap | null) {
  const on = useMaritimeRisk();
  useEffect(() => {
    if (!map || (!on.redsea && !on.piracy)) return;
    const layer = L.geoJSON(collection(on), {
      style: (f) => {
        const p = f?.properties ?? {};
        if (p.kind === "area") return { color: p.color, weight: 1.4, opacity: 0.9, fillColor: p.color, fillOpacity: 0.22 };
        return { color: p.color, weight: p.closed ? 1.2 : 2, opacity: 0.95, dashArray: p.dash ? "6 5" : undefined, fillColor: p.color, fillOpacity: p.closed ? 0.25 : 0 };
      },
      pointToLayer: (_f, ll) => L.circleMarker(ll, { radius: 7, color: "#ffffff", weight: 2, fillColor: "#ff3d3d", fillOpacity: 1 }),
      onEachFeature: (f, lyr) => lyr.bindPopup(popupHtml(String(f.properties?.kind), String(f.properties?.id)), { maxWidth: 320 }),
    }).addTo(map);
    // Beneath markers, above the basemap.
    layer.eachLayer((l) => (l as L.Path).bringToBack?.());
    return () => { layer.remove(); };
  }, [map, on]);
}

/* ── Globe ───────────────────────────────────────────────────────────────────────────────────────────────────── */

const SRC = "lens-mrisk";
export function GlobeMaritimeRisk({ map }: { map: MapLibreMap | null }) {
  const on = useMaritimeRisk();
  const data = useMemo(() => collection(on), [on]);
  const popup = useRef<GlPopup | null>(null);
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const src = map.getSource(SRC) as GeoJSONSource | undefined;
      if (src) { src.setData(data); return; }
      const before = firstDataLayer(map);
      map.addSource(SRC, { type: "geojson", data });
      map.addLayer({ id: `${SRC}-fill`, type: "fill", source: SRC, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["==", ["get", "kind"], "area"], 0.22, 0.25] } }, before);
      map.addLayer({ id: `${SRC}-line`, type: "line", source: SRC, filter: ["all", ["!=", ["geometry-type"], "Point"], ["!=", ["get", "dash"], 1]], paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "kind"], "area"], 1.4, 1.6], "line-opacity": 0.9 } }, before);
      map.addLayer({ id: `${SRC}-dash`, type: "line", source: SRC, filter: ["==", ["get", "dash"], 1], paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2.5] } }, before);
      map.addLayer({ id: `${SRC}-pt`, type: "circle", source: SRC, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
      const click = (e: MapLayerMouseEvent) => {
        // Markers and other layers above take their own clicks.
        const top = map.queryRenderedFeatures(e.point).find((f) => f.layer.id.startsWith("lens-") && !f.layer.id.startsWith(SRC) && !f.layer.id.startsWith("lens-control-") && !f.layer.id.startsWith("lens-basemap-") && f.layer.type !== "fill");
        if (top) return;
        const f = e.features?.[0];
        if (!f) return;
        popup.current?.remove();
        popup.current = new GlPopup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(popupHtml(String(f.properties?.kind), String(f.properties?.id))).addTo(map);
      };
      for (const id of [`${SRC}-fill`, `${SRC}-dash`, `${SRC}-pt`]) {
        map.on("click", id, click);
        map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [map, data]);
  return null;
}

/* ── Legend ──────────────────────────────────────────────────────────────────────────────────────────────────── */

export function MaritimeRiskLegend() {
  const on = useMaritimeRisk();
  if (!on.redsea && !on.piracy) return null;
  const used = new Set(RISK_AREAS.filter((a) => a.layer.some((l) => on[l])).map((a) => a.level));
  const lines = new Set(RISK_LINES.filter((l) => l.layer.some((x) => on[x])).map((l) => l.kind));
  return (
    <FloatingPanel id="maritime-legend" title="Maritime security" width={290} initial={{ right: "calc(var(--lens-pad-right, 12px) + 12px)", bottom: 46 }}>
    <div style={{ padding: "8px 12px 10px", fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>JMIC threat level</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
        {THREAT_SCALE.map((s) => (
          <div key={s.level} style={{ display: "grid", gridTemplateColumns: "14px 72px 1fr", alignItems: "center", columnGap: 7, opacity: used.has(s.level) ? 1 : 0.4 }}>
            <span style={{ width: 14, height: 10, borderRadius: 2, background: s.color, opacity: 0.85 }} />
            <span style={{ fontWeight: 700 }}>{s.label}</span>
            <span style={{ color: "#8fa3bf", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.meaning}>{s.meaning}</span>
          </div>
        ))}
      </div>
      {[...lines].map((k) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={LINE_STYLE[k].color} strokeWidth="2" strokeDasharray={LINE_STYLE[k].dash ? "4 3" : undefined} /></svg>
          <span>{LINE_STYLE[k].label}</span>
        </div>
      ))}
      {on.piracy && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: "#ff3d3d", border: "2px solid #fff", margin: "0 6px 0 4px" }} />
          <span>Hijacked ship still held</span>
        </div>
      )}
      <div style={{ marginTop: 7, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.1)", color: "#8fa3bf", fontSize: 10.5 }}>
        Sources:{" "}
        {Object.values(SOURCES).map((s, i) => (
          <span key={s.id}>
            {i > 0 && "; "}
            <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "#9fd8ff" }}>{s.name}</a> ({s.date})
          </span>
        ))}
        . Area outlines are approximate. Checked {AS_OF}.
      </div>
    </div>
    </FloatingPanel>
  );
}
