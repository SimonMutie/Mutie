import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import { GeoJSON, Popup, Tooltip, useMap } from "react-leaflet";
import { Popup as GlPopup, type ExpressionSpecification, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import type { MultiPolygon, Polygon } from "geojson";
import { api, type WatchZone, type WatchZoneOverride } from "../api";
import { joinShapes } from "../boundaryLibrary";
import { buildWatchZoneAreas, labelPoint, ZONE_STYLE } from "../watchZoneAreas";
import { firstDataLayer } from "./globeExtras";
import { FILL_PATTERNS, ensureGlPatterns, glPatternImage, isFillPattern, leafletFill, patternPreviewSvg, type FillPattern } from "./fillPatterns";

/**
 * Watch zones drawn as areas (watchZoneAreas.ts) on both views: each zone filled and outlined in its colour (by
 * severity: active war red, high tension orange, elevated amber and dashed; or the colour an admin chose), named in
 * capitals, and opening its details on click. Admins can also, from that click: reshape the boundary (drag its
 * corners), redraw it from scratch, change its colour, or put it back to the default. Edits are kept on the server
 * and seen by everyone.
 *
 * A zone can also be made of areas from the boundary library (BoundaryLibrary.tsx): states, districts, whole
 * countries. Its area is then its own original area (unless dropped) joined with those, and each part can be dropped
 * again from the zone's details. Zones can be renamed, re-rated, retired (standing ones, restorable) or deleted
 * (ones made here).
 */

export interface ZoneView {
  zones: WatchZone[];
  areas: Record<string, MultiPolygon>;
  colors: Record<string, string>;
  /** Each zone's fill pattern, where one was chosen. */
  patterns: Record<string, FillPattern | undefined>;
  edited: Record<string, boolean>;
  /** Each zone's edits, as kept on the server (areas added, original area dropped…). */
  overrides: Record<string, WatchZoneOverride>;
  /** Each zone's own area before any added areas: the default or a reshaped one; none once dropped. */
  baseAreas: Record<string, MultiPolygon>;
  /** Standing zones taken off the map, which can be brought back. */
  retired: WatchZoneOverride[];
  reload: () => void;
}

const toMulti = (g: Polygon | MultiPolygon): MultiPolygon => (g.type === "Polygon" ? { type: "MultiPolygon", coordinates: [g.coordinates] } : g);

export function useWatchZoneAreas(on: boolean): ZoneView {
  const [zones, setZones] = useState<WatchZone[]>([]);
  const [built, setBuilt] = useState<Record<string, MultiPolygon>>({});
  const [overrides, setOverrides] = useState<Record<string, WatchZoneOverride>>({});
  const [areas, setAreas] = useState<Record<string, MultiPolygon>>({});
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 10 * 60_000);
    return () => window.clearInterval(t);
  }, [on]);
  useEffect(() => {
    if (!on) return;
    let live = true;
    // After an edit, ask past the server's few-minute cache so the change shows at once.
    api
      .getWatchZones(tick ? Date.now() : undefined)
      .then(async (r) => {
        if (!live) return;
        setZones(r.zones);
        const b = await buildWatchZoneAreas(r.zones);
        if (live) setBuilt(b);
      })
      .catch(() => undefined);
    api
      .getWatchZoneOverrides()
      .then((r) => live && setOverrides(Object.fromEntries(r.overrides.map((o) => [o.id, o]))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [on, tick]);
  const baseAreas = useMemo(() => {
    const out: Record<string, MultiPolygon> = {};
    for (const z of zones) {
      const o = overrides[z.id];
      if (o?.baseDropped) continue;
      const b = o?.geometry ? toMulti(o.geometry) : z.custom ? null : built[z.id];
      if (b) out[z.id] = b;
    }
    return out;
  }, [zones, built, overrides]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, MultiPolygon> = {};
      for (const z of zones) {
        const base = baseAreas[z.id];
        const units = overrides[z.id]?.unitsGeometry;
        const a = base && units ? ((await joinShapes([...base.coordinates, ...units.coordinates])) ?? base) : (units ?? base ?? (z.custom ? built[z.id] : undefined));
        if (a) out[z.id] = a;
      }
      if (live) setAreas(out);
    })();
    return () => {
      live = false;
    };
  }, [zones, baseAreas, overrides, built]);
  const colors = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, overrides[z.id]?.color ?? ZONE_STYLE[z.severity].color])), [zones, overrides]);
  const patterns = useMemo(() => Object.fromEntries(Object.entries(overrides).map(([id, o]) => [id, isFillPattern(o.pattern) ? o.pattern : undefined])), [overrides]);
  const edited = useMemo(() => Object.fromEntries(Object.entries(overrides).map(([id, o]) => [id, !!(o.geometry || o.color || o.pattern)])), [overrides]);
  const retired = useMemo(() => Object.values(overrides).filter((o) => o.retired), [overrides]);
  return { zones: on ? zones : [], areas, colors, patterns, edited, overrides, baseAreas, retired, reload };
}

/* ── Actions from a zone's details (both views send them the same way) ───────────────────────────────────────── */

export type ZoneAction = {
  id: string;
  action: "shape" | "redraw" | "reset" | "color" | "pattern" | "severity" | "rename" | "retire" | "delete" | "restore" | "drop-base" | "restore-base" | "drop-unit" | "add-areas";
  color?: string;
  pattern?: FillPattern;
  severity?: WatchZone["severity"];
  /** The area to drop (drop-unit). */
  unit?: string;
};
/** Asks Live OSINT to act on a zone (it listens for "lens-zone-action"). */
export const zoneAction = (a: ZoneAction) => window.dispatchEvent(new CustomEvent<ZoneAction>("lens-zone-action", { detail: a }));

const SWATCHES = ["#ff3d3d", "#b91c1c", "#ff9500", "#ffd23f", "#a3e635", "#22c55e", "#14b8a6", "#38bdf8", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f5f5f4", "#94a3b8", "#0b1220"];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function detailsHtml(z: WatchZone, color: string, canEdit: boolean, edited: boolean, o?: WatchZoneOverride, hasBase = true): string {
  const st = ZONE_STYLE[z.severity];
  const units = o?.units ?? [];
  const latest = z.headlines[0];
  const act = (a: string, extra = "") => `window.dispatchEvent(new CustomEvent('lens-zone-action',{detail:{id:'${z.id}',action:'${a}'${extra}}}))`;
  const btn = "background:rgba(127,127,127,.15);border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:3px 8px;font-size:11.5px;cursor:pointer;margin:2px 4px 2px 0";
  const x = "background:none;border:none;color:#ff7a7a;cursor:pointer;font-size:11px;padding:0 0 0 6px";
  // The zone's parts: its own area, and each area added from the boundary library, each of which can be dropped.
  const parts = [
    ...(hasBase ? [`<div style="display:flex;justify-content:space-between;gap:6px"><span>${z.custom ? "Drawn boundary" : o?.geometry ? "Original area (reshaped)" : "Original area"}</span>${canEdit && units.length ? `<button style="${x}" onclick="${act("drop-base")}">Drop</button>` : ""}</div>`] : []),
    ...units.map((u) => `<div style="display:flex;justify-content:space-between;gap:6px"><span>${esc(u.name)} <span style="opacity:.6">${esc(u.iso)} ${esc(u.level)}</span></span>${canEdit ? `<button style="${x}" onclick="${act("drop-unit", `,unit:'${esc(u.key.replace(/'/g, ""))}'`)}">Drop</button>` : ""}</div>`),
  ];
  const partsHtml =
    units.length || (canEdit && !hasBase)
      ? `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(127,127,127,.3)"><div style="font-weight:700;font-size:11px;letter-spacing:.06em;margin-bottom:3px">AREAS IN THIS ZONE</div><div style="max-height:130px;overflow-y:auto">${parts.join("")}</div>${canEdit && !hasBase && !z.custom ? `<button style="${btn}" onclick="${act("restore-base")}">Bring back the original area</button>` : ""}</div>`
      : "";
  const sevBtn = (s: WatchZone["severity"]) => `<button style="${btn}${z.severity === s ? `;border-color:${ZONE_STYLE[s].color};color:${ZONE_STYLE[s].color};font-weight:700` : ""}" onclick="${act("severity", `,severity:'${s}'`)}">${ZONE_STYLE[s].label}</button>`;
  const tools = canEdit
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(127,127,127,.3)">
  <div style="font-weight:700;font-size:11px;letter-spacing:.06em;margin-bottom:4px">EDIT ZONE</div>
  <button style="${btn};font-weight:700" onclick="${act("add-areas")}">+ Add areas (states, districts…)</button>
  <div>${sevBtn("war")}${sevBtn("high")}${sevBtn("elevated")}</div>
  <button style="${btn}" onclick="${act("shape")}">Reshape boundary</button><button style="${btn}" onclick="${act("redraw")}">Redraw</button>${edited && !z.custom ? `<button style="${btn}" onclick="${act("reset")}">Reset to default</button>` : ""}<button style="${btn}" onclick="${act("rename")}">Rename</button>${z.custom ? `<button style="${btn};color:#ff7a7a" onclick="${act("delete")}">Delete zone</button>` : `<button style="${btn};color:#ff7a7a" onclick="${act("retire")}">Retire zone</button>`}
  <div style="display:flex;gap:4px;align-items:center;margin-top:6px;flex-wrap:wrap">${SWATCHES.map((c) => `<button title="${c}" onclick="${act("color", `,color:'${c}'`)}" style="width:18px;height:18px;border-radius:4px;border:${c === color ? "2px solid #fff" : "1px solid rgba(0,0,0,.4)"};background:${c};cursor:pointer;padding:0"></button>`).join("")}<input type="color" value="${color}" title="Any colour" onchange="window.dispatchEvent(new CustomEvent('lens-zone-action',{detail:{id:'${z.id}',action:'color',color:this.value}}))" style="width:24px;height:20px;padding:0;border:none;background:none;cursor:pointer"></div>
  <div style="display:flex;gap:4px;align-items:center;margin-top:6px;flex-wrap:wrap"><span style="font-size:11px;opacity:.75;margin-right:2px">Fill</span>${FILL_PATTERNS.map((p) => `<button title="${p.label}" onclick="${act("pattern", `,pattern:'${p.id}'`)}" style="padding:1px;border-radius:4px;border:${(o?.pattern ?? "solid") === p.id ? "2px solid #fff" : "1px solid rgba(127,127,127,.5)"};background:rgba(0,0,0,.35);cursor:pointer;line-height:0">${patternPreviewSvg(p.id, color, 18)}</button>`).join("")}</div>
</div>`
    : "";
  return `<div style="max-width:300px;font-size:12.5px;line-height:1.45">
  <div style="font-weight:800;letter-spacing:.04em;color:${color}">${esc(z.label)}</div>
  <div style="font-weight:600;margin-bottom:4px">${st.label}${edited ? ' <span style="font-weight:400;opacity:.65">(edited)</span>' : ""}</div>
  <div>${esc(z.description)}</div>
  <div style="margin-top:6px;opacity:.85">${z.headlineCount} recent report${z.headlineCount === 1 ? "" : "s"} · ${z.incidents.length} escalation incident${z.incidents.length === 1 ? "" : "s"} in the zone</div>
  ${latest ? `<div style="margin-top:6px">Latest: <a href="${esc(latest.url)}" target="_blank" rel="noreferrer">${esc(latest.title)}</a> <span style="opacity:.7">(${esc(latest.source)})</span></div>` : ""}
  <div style="margin-top:6px;font-size:11px;opacity:.65">Severity is an Afrilens editorial rating of the standing situation, not a live measurement.</div>${partsHtml}${tools}
</div>`;
}

/** Opens a zone's details at a spot (from an area's popup in the boundary library, which sits on top of zones). */
export const openZoneDetails = (id: string, lat: number, lng: number) => window.dispatchEvent(new CustomEvent("lens-zone-open", { detail: { id, lat, lng } }));
const shownMap = (el: HTMLElement) => getComputedStyle(el).visibility !== "hidden" && el.offsetParent !== null;

/** Close any open popup (the zone's details) without upsetting react-leaflet's own popup bookkeeping. */
function closePopups(map: L.Map) {
  window.setTimeout(() => {
    try {
      map.closePopup();
    } catch {
      /* already closed */
    }
  }, 0);
}

/* ── Flat map: areas, and reshaping or redrawing one ─────────────────────────────────────────────────────────── */

export function FlatWatchZones({ view, canEdit, editing, onEdited }: { view: ZoneView; canEdit: boolean; editing: { id: string; mode: "shape" | "redraw" } | null; onEdited: (g: MultiPolygon | null) => void }) {
  const map = useMap();

  const latest = useRef({ view, canEdit });
  latest.current = { view, canEdit };
  useEffect(() => {
    const open = (e: Event) => {
      const { id, lat, lng } = (e as CustomEvent<{ id: string; lat: number; lng: number }>).detail;
      const { view: v, canEdit: ce } = latest.current;
      const z = v.zones.find((x) => x.id === id);
      if (!z || !shownMap(map.getContainer())) return;
      L.popup({ maxWidth: 330 }).setLatLng([lat, lng]).setContent(detailsHtml(z, v.colors[z.id], ce, !!v.edited[z.id], v.overrides[z.id], !!v.baseAreas[z.id])).openOn(map);
    };
    window.addEventListener("lens-zone-open", open);
    return () => window.removeEventListener("lens-zone-open", open);
  }, [map]);

  // Reshape: an editable copy of the zone (one polygon per part) takes its place; drag its corners, then the floating
  // bar's Save/Cancel finish it ("lens-zone-edit-finish").
  useEffect(() => {
    if (!editing || editing.mode !== "shape") return;
    const area = view.areas[editing.id];
    if (!area) return;
    closePopups(map);
    const color = view.colors[editing.id] ?? "#ffffff";
    // Corners thinned to about one every 8 screen pixels at this zoom, so they can be grabbed; zoom in first for
    // finer detail. Tiny parts (islets smaller than a few pixels) are left out.
    const thin = (ring: number[][]) => {
      const pts = ring.slice(0, -1).map(([x, y]) => map.latLngToLayerPoint(L.latLng(y, x)));
      return L.LineUtil.simplify(pts, 4).map((pt) => map.layerPointToLatLng(pt));
    };
    const polys = area.coordinates.filter((poly) => thin(poly[0]).length >= 3).map((poly) => {
      const latlngs = poly.map(thin).filter((r) => r.length >= 3);
      const p = L.polygon(latlngs, { color, weight: 2, fillColor: color, fillOpacity: 0.2 }) as L.Polygon & { editing?: { enable(): void; disable(): void } };
      p.addTo(map);
      p.editing?.enable();
      return p;
    });
    const finish = (e: Event) => {
      const save = (e as CustomEvent<boolean>).detail;
      if (!save) return onEdited(null);
      const coords = polys.flatMap((p) => {
        const g = p.toGeoJSON().geometry as Polygon | MultiPolygon;
        return g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      });
      onEdited({ type: "MultiPolygon", coordinates: coords });
    };
    window.addEventListener("lens-zone-edit-finish", finish);
    return () => {
      window.removeEventListener("lens-zone-edit-finish", finish);
      polys.forEach((p) => {
        p.editing?.disable();
        p.remove();
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, editing?.mode]);

  // Redraw: click the new boundary point by point; click the first point to finish.
  useEffect(() => {
    if (!editing || editing.mode !== "redraw") return;
    closePopups(map);
    const handler = new (L as unknown as { Draw: { Polygon: new (m: L.Map, o: object) => { enable(): void; disable(): void } } }).Draw.Polygon(map, {
      allowIntersection: false,
      showArea: false,
      shapeOptions: { color: view.colors[editing.id] ?? "#ffffff", weight: 2, fillOpacity: 0.15 },
    });
    handler.enable();
    const created = (e: L.LeafletEvent) => {
      const g = ((e as unknown as { layer: L.Polygon }).layer.toGeoJSON().geometry) as Polygon;
      onEdited({ type: "MultiPolygon", coordinates: [g.coordinates] });
    };
    const finish = (e: Event) => {
      if (!(e as CustomEvent<boolean>).detail) {
        handler.disable();
        onEdited(null);
      }
    };
    map.on("draw:created", created);
    window.addEventListener("lens-zone-edit-finish", finish);
    return () => {
      map.off("draw:created", created);
      window.removeEventListener("lens-zone-edit-finish", finish);
      handler.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, editing?.mode]);

  return (
    <>
      {view.zones
        // The zone being edited is hidden here: its editable copy (or the new drawing) stands in for it.
        .filter((z) => view.areas[z.id] && editing?.id !== z.id)
        .map((z) => {
          const st = ZONE_STYLE[z.severity];
          const color = view.colors[z.id] ?? st.color;
          return (
            <GeoJSON
              key={`${z.id}:${color}:${view.patterns[z.id] ?? ""}:${JSON.stringify(view.areas[z.id].coordinates).length}:${z.headlineCount}`}
              data={{ type: "Feature", properties: {}, geometry: view.areas[z.id] } as never}
              style={{ color, weight: st.weight, dashArray: st.dash, opacity: 0.9, ...leafletFill(view.patterns[z.id], color, st.fill) }}
            >
              <Tooltip sticky>{`${z.label} · ${st.label}`}</Tooltip>
              <Popup maxWidth={330}>
                <div dangerouslySetInnerHTML={{ __html: detailsHtml(z, color, canEdit, !!view.edited[z.id], view.overrides[z.id], !!view.baseAreas[z.id]) }} />
              </Popup>
            </GeoJSON>
          );
        })}
    </>
  );
}

/** The bar shown while a zone is being reshaped or redrawn. */
export function ZoneEditBar({ label, mode }: { label: string; mode: "shape" | "redraw" }) {
  const send = (save: boolean) => window.dispatchEvent(new CustomEvent("lens-zone-edit-finish", { detail: save }));
  const btn = { border: "none", borderRadius: 6, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12 } as const;
  return (
    <div style={{ position: "absolute", top: 64, left: "50%", transform: "translateX(-50%)", zIndex: 700, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, background: "rgba(6,10,18,0.94)", border: "1px solid rgba(212,175,55,0.5)", color: "#e6edf7", fontSize: 12.5 }}>
      <span>
        <b>{label}</b>: {mode === "shape" ? "drag the corners; drag a middle handle to add one." : "click the new boundary point by point; click the first point to finish."}
      </span>
      {mode === "shape" && (
        <button onClick={() => send(true)} style={{ ...btn, background: "#d4af37", color: "#0b1220" }}>
          Save boundary
        </button>
      )}
      <button onClick={() => send(false)} style={{ ...btn, background: "rgba(255,255,255,0.1)", color: "#e6edf7" }}>
        Cancel
      </button>
    </div>
  );
}

/* ── Globe ───────────────────────────────────────────────────────────────────────────────────────────────────── */

export function GlobeWatchZones({ map, view, canEdit }: { map: MapLibreMap | null; view: ZoneView; canEdit: boolean }) {
  const ref = useRef({ view, canEdit });
  ref.current = { view, canEdit };
  const data = useMemo(() => {
    const shown = view.zones.filter((z) => view.areas[z.id]);
    return {
      areas: { type: "FeatureCollection" as const, features: shown.map((z) => {
        const pattern = view.patterns[z.id];
        const pat = glPatternImage(pattern, view.colors[z.id], ZONE_STYLE[z.severity].fill);
        // The plain fill stays (at no strength under a pattern or "outline only") so clicks inside still open the zone.
        return { type: "Feature" as const, properties: { id: z.id, severity: z.severity, color: view.colors[z.id], fo: pat || pattern === "outline" ? 0 : ZONE_STYLE[z.severity].fill, ...(pat ? { pat } : {}) }, geometry: view.areas[z.id] };
      }) },
      labels: { type: "FeatureCollection" as const, features: shown.map((z) => ({ type: "Feature" as const, properties: { id: z.id, label: z.label, color: view.colors[z.id] }, geometry: { type: "Point" as const, coordinates: labelPoint(z, view.areas[z.id]) } })) },
    };
  }, [view.zones, view.areas, view.colors, view.patterns]);
  const popupRef = useRef<GlPopup | null>(null);

  useEffect(() => {
    if (!map) return;
    ensureGlPatterns(map, data.areas);
    if (!map.getSource("lens-zones")) {
      const before = firstDataLayer(map);
      map.addSource("lens-zones", { type: "geojson", data: data.areas as never });
      map.addSource("lens-zone-labels", { type: "geojson", data: data.labels as never });
      const fill = ["coalesce", ["get", "fo"], 0.1] as unknown as ExpressionSpecification;
      map.addLayer({ id: "lens-control-zones-fill", type: "fill", source: "lens-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": fill } }, before);
      map.addLayer({ id: "lens-control-zones-pattern", type: "fill", source: "lens-zones", filter: ["has", "pat"], paint: { "fill-pattern": ["get", "pat"] } }, before);
      for (const sev of ["war", "high", "elevated"] as const) {
        const st = ZONE_STYLE[sev];
        map.addLayer(
          { id: `lens-control-zones-line-${sev}`, type: "line", source: "lens-zones", filter: ["==", ["get", "severity"], sev], paint: { "line-color": ["get", "color"], "line-width": st.weight, "line-opacity": 0.9, ...(st.glDash ? { "line-dasharray": st.glDash } : {}) } },
          before
        );
      }
      map.addLayer(
        {
          id: "lens-control-zones-label",
          type: "symbol",
          source: "lens-zone-labels",
          minzoom: 2.5,
          layout: { "text-field": ["get", "label"], "text-size": 11, "text-letter-spacing": 0.08, "text-font": ["Noto Sans Bold", "Open Sans Bold"], "text-allow-overlap": false },
          paint: { "text-color": ["get", "color"], "text-halo-color": "#05080f", "text-halo-width": 1.6 },
        },
        before
      );
      map.on("click", "lens-control-zones-fill", (e: MapLayerMouseEvent) => {
        // Markers on top take their own clicks first.
        const above = map.queryRenderedFeatures(e.point).find((f) => f.layer.id.startsWith("lens-") && !f.layer.id.startsWith("lens-control-") && !f.layer.id.startsWith("lens-basemap-") && f.layer.type !== "fill");
        if (above) return;
        // An area from the boundary library over the zone opens its own popup (with a link to the zone's details).
        if (map.getLayer("lens-control-bounds-fill") && map.queryRenderedFeatures(e.point, { layers: ["lens-control-bounds-fill"] }).length) return;
        const { view: v, canEdit: ce } = ref.current;
        const z = v.zones.find((x) => x.id === (e.features?.[0]?.properties?.id as string));
        if (!z) return;
        popupRef.current?.remove();
        popupRef.current = new GlPopup({ maxWidth: "330px" }).setLngLat(e.lngLat).setHTML(detailsHtml(z, v.colors[z.id], ce, !!v.edited[z.id], v.overrides[z.id], !!v.baseAreas[z.id])).addTo(map);
      });
      // An action from the popup closes it.
      window.addEventListener("lens-zone-action", () => popupRef.current?.remove());
      window.addEventListener("lens-zone-open", (ev) => {
        const { id, lat, lng } = (ev as CustomEvent<{ id: string; lat: number; lng: number }>).detail;
        const { view: v, canEdit: ce } = ref.current;
        const z = v.zones.find((x) => x.id === id);
        if (!z || !shownMap(map.getContainer())) return;
        popupRef.current?.remove();
        popupRef.current = new GlPopup({ maxWidth: "330px" }).setLngLat([lng, lat]).setHTML(detailsHtml(z, v.colors[z.id], ce, !!v.edited[z.id], v.overrides[z.id], !!v.baseAreas[z.id])).addTo(map);
      });
    } else {
      (map.getSource("lens-zones") as GeoJSONSource).setData(data.areas as never);
      (map.getSource("lens-zone-labels") as GeoJSONSource).setData(data.labels as never);
    }
  }, [map, data]);
  return null;
}
