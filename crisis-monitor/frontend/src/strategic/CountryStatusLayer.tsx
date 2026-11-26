import { useEffect, useMemo, useRef, useState } from "react";
import L, { type Map as LeafletMap } from "leaflet";
import { Popup as GlPopup, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { numericToAlpha2 } from "i18n-iso-countries";
import { api, type CountryStatus, type CountryStatusRow, type CountryTrend } from "../api";
import { joinShapes } from "../boundaryLibrary";
import { UNDER } from "../components/globeExtras";
import { reloadCountryStatus, useCountryStatus, useStrategic } from "./store";
import { fillCountryDetail } from "./countryDetail";

/**
 * Country conflict status: each country in Africa and the Middle East shaded by its rating (active armed conflict,
 * by trend; at risk, high or low), with an arrow for the trend of active conflicts. Click a country for its rating,
 * its incidents of the last 30 days and the analyst's note; admins can change the rating there.
 */

export const STATUS_STYLE: { key: string; label: string; color: string; status: CountryStatus; trend?: CountryTrend }[] = [
  { key: "active-worsening", label: "Active conflict, worsening", color: "#c6dcf3", status: "active", trend: "worsening" },
  { key: "active-steady", label: "Active conflict, steady", color: "#93b8e1", status: "active", trend: "steady" },
  { key: "active-improving", label: "Active conflict, improving", color: "#6893cb", status: "active", trend: "improving" },
  { key: "risk-high", label: "At risk of armed conflict (high)", color: "#4a77b0", status: "risk-high" },
  { key: "risk-low", label: "At risk of armed conflict (low)", color: "#2d5283", status: "risk-low" },
];
export const TREND_STYLE: Record<CountryTrend, { arrow: string; label: string; color: string }> = {
  worsening: { arrow: "↓", label: "Worsening", color: "#ff7a59" },
  steady: { arrow: "→", label: "Steady", color: "#b8c4d4" },
  improving: { arrow: "↑", label: "Improving", color: "#5fd38d" },
};
const STATUS_LABEL: Record<CountryStatus, string> = { active: "Active armed conflict", "risk-high": "At risk of armed conflict (high)", "risk-low": "At risk of armed conflict (low)", none: "No armed conflict" };
const styleKey = (r: CountryStatusRow) => (r.status === "active" ? `active-${r.trend ?? "steady"}` : r.status);
const colorOf = (r: CountryStatusRow) => STATUS_STYLE.find((s) => s.key === styleKey(r))?.color ?? "transparent";

/* ── Country shapes (Natural Earth 1:50m; Somaliland drawn as part of Somalia, as everywhere in the Lens) ──── */

interface Shape {
  name: string;
  geometry: MultiPolygon;
  /** Where the trend arrow goes: the middle of the country's largest part. */
  label: [number, number];
}
let shapes: Promise<Map<string, Shape>> | null = null;
export function loadCountryShapes() {
  shapes ??= import("world-atlas/countries-50m.json").then(async (c) => {
    const topo = (c.default ?? c) as unknown as Topology;
    const fc = feature(topo, topo.objects.countries as GeometryCollection<{ name?: string }>) as unknown as GeoJSON.FeatureCollection<Polygon | MultiPolygon, { name?: string }>;
    const out = new Map<string, Shape>();
    let somaliland: Position[][][] = [];
    for (const f of fc.features) {
      if (!f.geometry) continue;
      const coords = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (f.properties?.name === "Somaliland") {
        somaliland = coords;
        continue;
      }
      const code = f.id != null ? numericToAlpha2(String(f.id).padStart(3, "0")) : undefined;
      if (!code) continue;
      const name = code === "EH" ? "Western Sahara" : (f.properties?.name ?? code);
      out.set(code, { name, geometry: { type: "MultiPolygon", coordinates: coords }, label: [0, 0] });
    }
    const so = out.get("SO");
    if (so && somaliland.length) so.geometry = (await joinShapes([...so.geometry.coordinates, ...somaliland])) ?? so.geometry;
    for (const s of out.values()) s.label = middleOf(s.geometry);
    return out;
  });
  return shapes;
}
/** The centroid of the largest part's outer ring, measured flat (indifferent to which way the rings wind). */
function middleOf(g: MultiPolygon): [number, number] {
  let best: [number, number] = [0, 0];
  let bestArea = -1;
  for (const poly of g.coordinates) {
    const ring = poly[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
      const k = x0 * y1 - x1 * y0;
      a += k;
      cx += (x0 + x1) * k;
      cy += (y0 + y1) * k;
    }
    if (Math.abs(a) > bestArea && a !== 0) {
      bestArea = Math.abs(a);
      best = [cx / (3 * a), cy / (3 * a)];
    }
  }
  return best;
}

function useShapes(active: boolean) {
  const [s, setS] = useState<Map<string, Shape> | null>(null);
  useEffect(() => {
    if (active && !s) void loadCountryShapes().then(setS);
  }, [active, s]);
  return s;
}

function collections(rows: CountryStatusRow[], shapes: Map<string, Shape>) {
  const fills: GeoJSON.Feature[] = [];
  const arrows: GeoJSON.Feature[] = [];
  for (const r of rows) {
    const s = shapes.get(r.code);
    if (!s || r.status === "none") continue;
    fills.push({ type: "Feature", properties: { code: r.code, color: colorOf(r) }, geometry: s.geometry });
    if (r.status === "active" && r.trend) arrows.push({ type: "Feature", properties: { code: r.code, trend: r.trend }, geometry: { type: "Point", coordinates: s.label } });
  }
  return { fills: { type: "FeatureCollection" as const, features: fills }, arrows: { type: "FeatureCollection" as const, features: arrows } };
}

/* ── Popup, with the admin's rating controls ─────────────────────────────────────────────────────────────────── */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function popupHtml(r: CountryStatusRow, name: string, canEdit: boolean): string {
  const t = r.trend ? TREND_STYLE[r.trend] : null;
  const chip = `<span style="display:inline-block;padding:1px 8px;border-radius:9px;font-size:10.5px;font-weight:800;letter-spacing:.05em;background:${colorOf(r)};color:#0b1220">${esc(STATUS_LABEL[r.status].toUpperCase())}</span>`;
  const trend = t
    ? `<div style="margin-top:6px;font-weight:700;color:${t.color}">${t.arrow} ${t.label}${r.trend !== r.trendAuto && r.trendAuto ? ` <span style="font-weight:400;opacity:.75">(set by an analyst; the data says ${TREND_STYLE[r.trendAuto].label.toLowerCase()})</span>` : ""}</div>`
    : "";
  const source =
    r.statusSource === "analyst"
      ? "Status set by an Afrilens analyst."
      : r.statusSource === "assessment"
        ? "Status from the Lens's latest assessment of the evidence."
        : `Status from the numbers${r.statusData !== r.baseline ? `, raised from the baseline rating (${STATUS_LABEL[r.baseline].toLowerCase()})` : ""}; a written assessment follows.`;
  const bottom = r.assessment?.bottomLine
    ? `<div style="margin-top:8px;padding:8px 10px;border-left:3px solid #d4af37;background:rgba(212,175,55,.08);border-radius:0 6px 6px 0;font-size:13px;line-height:1.45;font-weight:600">${esc(r.assessment.bottomLine)}</div>`
    : r.note
      ? `<div style="margin-top:6px">${esc(r.note)}</div>`
      : "";
  const counts = "";
  const note = bottom;
  const basis = `<div style="margin-top:6px;font-size:11px;color:#b9c7d8">${source}</div><div class="lens-cs-detail" data-code="${r.code}" style="font-size:12px"><div style="margin-top:9px;font-size:11px;color:#8fa3bf">Loading the assessment…</div></div>`;
  let edit = "";
  if (canEdit) {
    const sel = "background:rgba(127,127,127,.15);border:1px solid rgba(127,127,127,.4);border-radius:6px;padding:3px 5px;font-size:11.5px;color:inherit";
    const btn = "background:rgba(127,127,127,.18);border:1px solid rgba(127,127,127,.4);border-radius:6px;padding:3px 9px;font-size:11.5px;cursor:pointer;color:inherit";
    const opts = (vals: [string, string][], cur: string) => vals.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
    const send = (reset: boolean) =>
      `var b=this.closest('.lens-cs');window.dispatchEvent(new CustomEvent('lens-country-status',{detail:${reset ? `{code:'${r.code}',reset:true}` : `{code:'${r.code}',status:b.querySelector('[name=s]').value,trend:b.querySelector('[name=t]').value||null,note:b.querySelector('[name=n]').value||null}`}}))`;
    edit = `<details style="margin-top:9px;padding-top:7px;border-top:1px solid rgba(127,127,127,.3)"><summary style="cursor:pointer;font-size:11px;color:#b9c7d8">Set the rating yourself</summary><div class="lens-cs" style="margin-top:6px;display:flex;flex-direction:column;gap:5px">
      <select name="s" style="${sel}">${opts((Object.keys(STATUS_LABEL) as CountryStatus[]).map((k) => [k, STATUS_LABEL[k]]), r.status)}</select>
      <select name="t" style="${sel}">${opts([["", "Trend from the data"], ["worsening", "Worsening"], ["steady", "Steady"], ["improving", "Improving"]], r.trend !== r.trendAuto ? (r.trend ?? "") : "")}</select>
      <input name="n" value="${esc(r.note ?? "")}" placeholder="Note" maxlength="400" style="${sel}" />
      <div style="display:flex;gap:6px"><button style="${btn}" onclick="${esc(send(false))}">Save</button>${r.edited ? `<button style="${btn}" onclick="${esc(send(true))}">Hand back to the Lens</button>` : ""}</div>
    </div></details>`;
  }
  return `<div style="width:380px;max-width:100%;max-height:min(46vh, 520px);overflow:auto;padding-right:4px;font-size:12.5px;line-height:1.5"><div style="font-weight:800;font-size:15px;margin-bottom:5px">${esc(name)}</div>${chip}${trend}${counts}${note}${basis}${edit}</div>`;
}

/** Saves an admin's change from a popup, then reloads the ratings. */
function useRatingEdits(onDone: () => void) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ code: string; reset?: boolean; assess?: boolean; status?: CountryStatus; trend?: CountryTrend | null; note?: string | null }>).detail;
      if (d.assess) {
        // Rewrite the assessment now, then refresh the open popup in place.
        void api
          .assessCountry(d.code)
          .then(() => reloadCountryStatus())
          .then(() => fillCountryDetail(document, d.code, true))
          .catch((err: unknown) => window.alert(`Could not write the assessment: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }
      const call = d.reset ? api.resetCountryStatus(d.code) : api.putCountryStatus(d.code, { status: d.status, trend: d.trend ?? null, note: d.note ?? null });
      void call
        .then(() => reloadCountryStatus())
        .then(() => done.current())
        .catch((err: unknown) => window.alert(`Could not save the rating: ${err instanceof Error ? err.message : String(err)}`));
    };
    window.addEventListener("lens-country-status", h);
    return () => window.removeEventListener("lens-country-status", h);
  }, []);
}

/* ── Trend arrows as images (globe) and as small markers (flat map) ───────────────────────────────────────────── */

function arrowCanvas(trend: CountryTrend, px: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  const r = px / 2;
  g.fillStyle = "rgba(6,12,22,0.88)";
  g.strokeStyle = TREND_STYLE[trend].color;
  g.lineWidth = px * 0.07;
  g.beginPath();
  g.arc(r, r, r - g.lineWidth, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.translate(r, r);
  g.rotate(trend === "worsening" ? Math.PI / 2 : trend === "improving" ? -Math.PI / 2 : 0);
  g.fillStyle = TREND_STYLE[trend].color;
  const s = px * 0.26;
  g.beginPath();
  g.moveTo(s, 0);
  g.lineTo(0, -s * 0.85);
  g.lineTo(0, -s * 0.32);
  g.lineTo(-s, -s * 0.32);
  g.lineTo(-s, s * 0.32);
  g.lineTo(0, s * 0.32);
  g.lineTo(0, s * 0.85);
  g.closePath();
  g.fill();
  return c;
}
function ensureArrowImages(map: MapLibreMap) {
  for (const t of Object.keys(TREND_STYLE) as CountryTrend[]) {
    const id = `lens-trend-${t}`;
    if (map.hasImage(id)) continue;
    const c = arrowCanvas(t, 44);
    map.addImage(id, c.getContext("2d")!.getImageData(0, 0, 44, 44), { pixelRatio: 2 });
  }
}

/* ── Flat map ────────────────────────────────────────────────────────────────────────────────────────────────── */

export function useFlatCountryStatus(map: LeafletMap | null, canEdit: boolean) {
  const { status: on } = useStrategic();
  const rows = useCountryStatus(on);
  const shapes = useShapes(on);
  const popupRef = useRef<L.Popup | null>(null);
  useRatingEdits(() => popupRef.current?.remove());
  useEffect(() => {
    if (!map || !on || !rows || !shapes) return;
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const { fills, arrows } = collections(rows, shapes);
    if (!map.getPane("lens-country-status")) {
      const pane = map.createPane("lens-country-status");
      pane.style.zIndex = "350"; // above the tiles, beneath other layers and markers
    }
    const layer = L.geoJSON(fills, {
      pane: "lens-country-status",
      style: (f) => ({ color: "#0d1b2e", weight: 0.8, opacity: 0.9, fillColor: String(f?.properties?.color), fillOpacity: 0.62 }),
      onEachFeature: (f, lyr) =>
        lyr.on("click", (e: L.LeafletMouseEvent) => {
          const r = byCode.get(String(f.properties?.code));
          if (!r) return;
          popupRef.current = L.popup({ maxWidth: 410 }).setLatLng(e.latlng).setContent(popupHtml(r, shapes.get(r.code)?.name ?? r.code, canEdit)).openOn(map);
          void fillCountryDetail(popupRef.current.getElement(), r.code, canEdit);
        }),
    }).addTo(map);
    const marks = L.layerGroup(
      arrows.features.map((f) => {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const t = f.properties!.trend as CountryTrend;
        return L.marker([lat, lng], {
          pane: "lens-country-status",
          interactive: false,
          icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: `<img src="${arrowCanvas(t, 44).toDataURL()}" width="22" height="22" alt="${TREND_STYLE[t].label}" />` }),
        });
      })
    ).addTo(map);
    return () => {
      layer.remove();
      marks.remove();
    };
  }, [map, on, rows, shapes, canEdit]);
}

/* ── Globe ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** Beneath the incident circles and every other Lens data layer, above the basemap. */
function beforeCountry(map: MapLibreMap) {
  return (map.getStyle().layers ?? []).find((l) => l.id.startsWith("lens-") && !UNDER.some((p) => l.id.startsWith(p)) && !l.id.startsWith("lens-strat-cs"))?.id;
}
const SRC = "lens-strat-cs";
/** The first Lens data layer that is not part of the strategic picture. */
function aboveCircles(map: MapLibreMap) {
  return (map.getStyle().layers ?? []).find((l) => l.id.startsWith("lens-") && !UNDER.some((p) => l.id.startsWith(p)) && !l.id.startsWith("lens-strat-"))?.id;
}

export function GlobeCountryStatus({ map, canEdit }: { map: MapLibreMap | null; canEdit: boolean }) {
  const { status: on } = useStrategic();
  const rows = useCountryStatus(on);
  const shapes = useShapes(on);
  const data = useMemo(() => (on && rows && shapes ? collections(rows, shapes) : null), [on, rows, shapes]);
  const popup = useRef<GlPopup | null>(null);
  const ctx = useRef({ rows, shapes, canEdit });
  ctx.current = { rows, shapes, canEdit };
  useRatingEdits(() => popup.current?.remove());
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      const fills = data?.fills ?? empty;
      const arrows = data?.arrows ?? empty;
      const src = map.getSource(SRC) as GeoJSONSource | undefined;
      if (src) {
        src.setData(fills);
        (map.getSource(`${SRC}-arrows`) as GeoJSONSource | undefined)?.setData(arrows);
        return;
      }
      ensureArrowImages(map);
      const before = beforeCountry(map);
      map.addSource(SRC, { type: "geojson", data: fills });
      map.addSource(`${SRC}-arrows`, { type: "geojson", data: arrows });
      map.addLayer({ id: `${SRC}-fill`, type: "fill", source: SRC, paint: { "fill-color": ["get", "color"], "fill-opacity": 0.62 } }, before);
      map.addLayer({ id: `${SRC}-line`, type: "line", source: SRC, paint: { "line-color": "#0d1b2e", "line-width": 0.8, "line-opacity": 0.9 } }, before);
      // The arrows sit above the incident circles, so they stay visible, and beneath the other Lens layers.
      map.addLayer(
        { id: `${SRC}-arrow`, type: "symbol", source: `${SRC}-arrows`, layout: { "icon-image": ["concat", "lens-trend-", ["get", "trend"]], "icon-size": 1, "icon-allow-overlap": true, "icon-ignore-placement": true } },
        aboveCircles(map)
      );
      map.on("click", `${SRC}-fill`, (e: MapLayerMouseEvent) => {
        // Markers, circles and other layers above take their own clicks.
        const top = map.queryRenderedFeatures(e.point).find((f) => f.layer.id.startsWith("lens-") && !f.layer.id.startsWith(SRC) && !UNDER.some((p) => f.layer.id.startsWith(p)));
        if (top) return;
        const code = String(e.features?.[0]?.properties?.code ?? "");
        const { rows: rs, shapes: sh, canEdit: ce } = ctx.current;
        const r = rs?.find((x) => x.code === code);
        if (!r) return;
        popup.current?.remove();
        popup.current = new GlPopup({ maxWidth: "410px" }).setLngLat(e.lngLat).setHTML(popupHtml(r, sh?.get(code)?.name ?? code, ce)).addTo(map);
        void fillCountryDetail(popup.current.getElement(), code, ce);
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [map, data]);
  return null;
}
