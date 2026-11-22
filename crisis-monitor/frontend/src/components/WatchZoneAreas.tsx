import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import { GeoJSON, Popup, Tooltip, useMap } from "react-leaflet";
import { Popup as GlPopup, type ExpressionSpecification, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import type { MultiPolygon, Polygon } from "geojson";
import { api, type WatchZone } from "../api";
import { buildWatchZoneAreas, labelPoint, ZONE_STYLE } from "../watchZoneAreas";
import { firstDataLayer } from "./globeExtras";

/**
 * Watch zones drawn as areas (watchZoneAreas.ts) on both views: each zone filled and outlined in its colour (by
 * severity: active war red, high tension orange, elevated amber and dashed; or the colour an admin chose), named in
 * capitals, and opening its details on click. Admins can also, from that click: reshape the boundary (drag its
 * corners), redraw it from scratch, change its colour, or put it back to the default. Edits are kept on the server
 * and seen by everyone.
 */

export interface ZoneView {
  zones: WatchZone[];
  areas: Record<string, MultiPolygon>;
  colors: Record<string, string>;
  edited: Record<string, boolean>;
  reload: () => void;
}

const toMulti = (g: Polygon | MultiPolygon): MultiPolygon => (g.type === "Polygon" ? { type: "MultiPolygon", coordinates: [g.coordinates] } : g);

export function useWatchZoneAreas(on: boolean): ZoneView {
  const [zones, setZones] = useState<WatchZone[]>([]);
  const [built, setBuilt] = useState<Record<string, MultiPolygon>>({});
  const [overrides, setOverrides] = useState<Record<string, { geometry: Polygon | MultiPolygon | null; color: string | null }>>({});
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!on) return;
    let live = true;
    api
      .getWatchZones()
      .then(async (r) => {
        if (!live) return;
        setZones(r.zones);
        const b = await buildWatchZoneAreas(r.zones);
        if (live) setBuilt(b);
      })
      .catch(() => undefined);
    const t = window.setInterval(() => setTick((x) => x + 1), 10 * 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [on]);
  useEffect(() => {
    if (!on) return;
    let live = true;
    api
      .getWatchZoneOverrides()
      .then((r) => live && setOverrides(Object.fromEntries(r.overrides.map((o) => [o.id, { geometry: o.geometry, color: o.color }]))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [on, tick]);
  const areas = useMemo(() => {
    const out = { ...built };
    for (const [id, o] of Object.entries(overrides)) if (o.geometry) out[id] = toMulti(o.geometry);
    return out;
  }, [built, overrides]);
  const colors = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, overrides[z.id]?.color ?? ZONE_STYLE[z.severity].color])), [zones, overrides]);
  const edited = useMemo(() => Object.fromEntries(Object.entries(overrides).map(([id, o]) => [id, !!(o.geometry || o.color)])), [overrides]);
  return { zones: on ? zones : [], areas, colors, edited, reload };
}

/* ── Actions from a zone's details (both views send them the same way) ───────────────────────────────────────── */

export type ZoneAction = { id: string; action: "shape" | "redraw" | "reset" | "color"; color?: string };
/** Asks Live OSINT to act on a zone (it listens for "lens-zone-action"). */
export const zoneAction = (a: ZoneAction) => window.dispatchEvent(new CustomEvent<ZoneAction>("lens-zone-action", { detail: a }));

const SWATCHES = ["#ff3d3d", "#ff9500", "#ffd23f", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ec4899", "#94a3b8"];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function detailsHtml(z: WatchZone, color: string, canEdit: boolean, edited: boolean): string {
  const st = ZONE_STYLE[z.severity];
  const latest = z.headlines[0];
  const act = (a: string, extra = "") => `window.dispatchEvent(new CustomEvent('lens-zone-action',{detail:{id:'${z.id}',action:'${a}'${extra}}}))`;
  const btn = "background:rgba(127,127,127,.15);border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:3px 8px;font-size:11.5px;cursor:pointer;margin:2px 4px 2px 0";
  const tools = canEdit
    ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(127,127,127,.3)">
  <div style="font-weight:700;font-size:11px;letter-spacing:.06em;margin-bottom:4px">EDIT ZONE</div>
  <button style="${btn}" onclick="${act("shape")}">Reshape boundary</button><button style="${btn}" onclick="${act("redraw")}">Redraw</button>${edited ? `<button style="${btn}" onclick="${act("reset")}">Reset to default</button>` : ""}
  <div style="display:flex;gap:4px;align-items:center;margin-top:6px;flex-wrap:wrap">${SWATCHES.map((c) => `<button title="${c}" onclick="${act("color", `,color:'${c}'`)}" style="width:18px;height:18px;border-radius:4px;border:${c === color ? "2px solid #fff" : "1px solid rgba(0,0,0,.4)"};background:${c};cursor:pointer;padding:0"></button>`).join("")}<input type="color" value="${color}" title="Any colour" onchange="window.dispatchEvent(new CustomEvent('lens-zone-action',{detail:{id:'${z.id}',action:'color',color:this.value}}))" style="width:24px;height:20px;padding:0;border:none;background:none;cursor:pointer"></div>
</div>`
    : "";
  return `<div style="max-width:300px;font-size:12.5px;line-height:1.45">
  <div style="font-weight:800;letter-spacing:.04em;color:${color}">${esc(z.label)}</div>
  <div style="font-weight:600;margin-bottom:4px">${st.label}${edited ? ' <span style="font-weight:400;opacity:.65">(edited)</span>' : ""}</div>
  <div>${esc(z.description)}</div>
  <div style="margin-top:6px;opacity:.85">${z.headlineCount} recent report${z.headlineCount === 1 ? "" : "s"} · ${z.incidents.length} escalation incident${z.incidents.length === 1 ? "" : "s"} in the zone</div>
  ${latest ? `<div style="margin-top:6px">Latest: <a href="${esc(latest.url)}" target="_blank" rel="noreferrer">${esc(latest.title)}</a> <span style="opacity:.7">(${esc(latest.source)})</span></div>` : ""}
  <div style="margin-top:6px;font-size:11px;opacity:.65">Severity is an Afrilens editorial rating of the standing situation, not a live measurement.</div>${tools}
</div>`;
}

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
              key={`${z.id}:${color}:${JSON.stringify(view.areas[z.id].coordinates).length}:${z.headlineCount}`}
              data={{ type: "Feature", properties: {}, geometry: view.areas[z.id] } as never}
              style={{ color, weight: st.weight, dashArray: st.dash, opacity: 0.9, fillColor: color, fillOpacity: st.fill }}
            >
              <Tooltip sticky>{`${z.label} · ${st.label}`}</Tooltip>
              <Popup maxWidth={330}>
                <div dangerouslySetInnerHTML={{ __html: detailsHtml(z, color, canEdit, !!view.edited[z.id]) }} />
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
      areas: { type: "FeatureCollection" as const, features: shown.map((z) => ({ type: "Feature" as const, properties: { id: z.id, severity: z.severity, color: view.colors[z.id] }, geometry: view.areas[z.id] })) },
      labels: { type: "FeatureCollection" as const, features: shown.map((z) => ({ type: "Feature" as const, properties: { id: z.id, label: z.label, color: view.colors[z.id] }, geometry: { type: "Point" as const, coordinates: labelPoint(z, view.areas[z.id]) } })) },
    };
  }, [view.zones, view.areas, view.colors]);
  const popupRef = useRef<GlPopup | null>(null);

  useEffect(() => {
    if (!map) return;
    if (!map.getSource("lens-zones")) {
      const before = firstDataLayer(map);
      map.addSource("lens-zones", { type: "geojson", data: data.areas as never });
      map.addSource("lens-zone-labels", { type: "geojson", data: data.labels as never });
      const fill = ["match", ["get", "severity"], "war", ZONE_STYLE.war.fill, "high", ZONE_STYLE.high.fill, ZONE_STYLE.elevated.fill] as unknown as ExpressionSpecification;
      map.addLayer({ id: "lens-control-zones-fill", type: "fill", source: "lens-zones", paint: { "fill-color": ["get", "color"], "fill-opacity": fill } }, before);
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
        const { view: v, canEdit: ce } = ref.current;
        const z = v.zones.find((x) => x.id === (e.features?.[0]?.properties?.id as string));
        if (!z) return;
        popupRef.current?.remove();
        popupRef.current = new GlPopup({ maxWidth: "330px" }).setLngLat(e.lngLat).setHTML(detailsHtml(z, v.colors[z.id], ce, !!v.edited[z.id])).addTo(map);
      });
      // An action from the popup closes it.
      window.addEventListener("lens-zone-action", () => popupRef.current?.remove());
    } else {
      (map.getSource("lens-zones") as GeoJSONSource).setData(data.areas as never);
      (map.getSource("lens-zone-labels") as GeoJSONSource).setData(data.labels as never);
    }
  }, [map, data]);
  return null;
}
