import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FloatingPanel } from "./FloatingPanel";
import L from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import { ImageOverlay, Marker, Polygon, Popup, useMap } from "react-leaflet";
import type { GeoJSONSource, Map as MapLibreMap, ExpressionSpecification } from "maplibre-gl";
import { Eye, EyeOff, Image as ImageIcon, Move, PenLine, Pencil, Plus, Trash2, X, Check, Shield } from "lucide-react";
import { api, type ControlArea, type ControlAreaInput, type ControlLayer, type ControlOverlay, type ControlStatus } from "../api";
import { firstDataLayer } from "./globeExtras";

/**
 * Territorial control maps on Live OSINT. Admins place an image (another organisation's map, a screenshot) on the map,
 * line it up, and trace the areas each armed group holds, contests or influences. Every group is a layer in its own
 * colour; the legend builds itself from the groups and the kinds of area drawn, and each group can be shown or hidden
 * from it. Areas show on both views; drawing happens on the flat map.
 */

/* ── Statuses and their look (the same on both views) ─────────────────────── */

export const STATUS: Record<ControlStatus, { label: string; hint: string; fill: number; weight: number; dash?: string; glDash?: number[] }> = {
  control: { label: "Control", hint: "Held and governed", fill: 0.38, weight: 2 },
  contested: { label: "Contested", hint: "Fighting for it", fill: 0.16, weight: 2.5, dash: "8 5", glDash: [3, 2] },
  influence: { label: "Influence", hint: "Presence or sway, not control", fill: 0.07, weight: 2, dash: "2 5", glDash: [0.6, 2.4] },
  claimed: { label: "Claimed", hint: "Claimed, not held", fill: 0, weight: 2, dash: "14 6", glDash: [5, 2] },
};
export const STATUS_KEYS = Object.keys(STATUS) as ControlStatus[];

/** Area on the Earth's surface in km² (spherical polygon area). */
function ringKm2(ring: number[][]): number {
  const R = 6371.0088;
  const rad = Math.PI / 180;
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    s += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
  }
  return Math.abs((s * R * R) / 2);
}
export function areaKm2(g: ControlArea["geometry"]): number {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.reduce((t, p) => t + ringKm2(p[0] as number[][]) - p.slice(1).reduce((h, r) => h + ringKm2(r as number[][]), 0), 0);
}
export const km2 = (n: number) => (n >= 1000 ? `${Math.round(n).toLocaleString()} km²` : n >= 10 ? `${Math.round(n)} km²` : `${n.toFixed(1)} km²`);

/* ── Data ─────────────────────────────────────────────────────────────────── */

export function useControlMaps(on: boolean) {
  const [layers, setLayers] = useState<ControlLayer[]>([]);
  const [areas, setAreas] = useState<ControlArea[]>([]);
  const [overlays, setOverlays] = useState<ControlOverlay[]>([]);
  const reload = useCallback(async () => {
    const [m, o] = await Promise.all([api.getControlMaps(), api.getControlOverlays()]);
    setLayers(m.layers);
    setAreas(m.areas);
    setOverlays(o.overlays);
  }, []);
  useEffect(() => {
    if (!on) return;
    void reload().catch(() => undefined);
    // Others may be drawing too: refresh every minute.
    const t = window.setInterval(() => void reload().catch(() => undefined), 60_000);
    return () => window.clearInterval(t);
  }, [on, reload]);
  return { layers, areas, overlays, setOverlays, reload };
}

/** Overlay images, fetched with the sign-in and kept as local addresses. */
export function useOverlayUrls(overlays: ControlOverlay[], shown: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const o of overlays) {
      const key = `${o.id}`;
      if (!shown.includes(o.id) || urls[key]) continue;
      api
        .controlOverlayImage(o.id)
        .then((u) => setUrls((m) => ({ ...m, [key]: u })))
        .catch(() => undefined);
    }
  }, [overlays, shown, urls]);
  return urls;
}

/** A picture shrunk to fit the database (longest side 2400 px, JPEG or PNG under ~1.7 MB), with its aspect ratio. */
export async function prepareImage(file: File): Promise<{ dataUrl: string; aspect: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    for (;;) {
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const png = file.type === "image/png" ? c.toDataURL("image/png") : "";
      const dataUrl = png && png.length < 1_700_000 ? png : c.toDataURL("image/jpeg", 0.85);
      if (dataUrl.length < 1_700_000 || scale < 0.2) return { dataUrl, aspect: img.naturalWidth / img.naturalHeight };
      scale *= 0.75;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toLatLngs = (g: ControlArea["geometry"]): L.LatLngExpression[][][] =>
  (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])));

function layerToGeometry(layer: L.Polygon): ControlArea["geometry"] {
  const gj = layer.toGeoJSON().geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  return gj;
}

/* ── Flat map: areas, images, drawing, editing ────────────────────────────── */

export interface FlatControlProps {
  layers: ControlLayer[];
  areas: ControlArea[];
  hidden: string[];
  overlays: ControlOverlay[];
  overlayUrls: Record<string, string>;
  shownOverlays: string[];
  /** While lining up an image: its bounds being moved. */
  adjusting: { id: string; bounds: [[number, number], [number, number]] } | null;
  onAdjust: (bounds: [[number, number], [number, number]]) => void;
  drawing: boolean;
  onDrawn: (g: ControlArea["geometry"]) => void;
  onDrawCancel: () => void;
  editingId: string | null;
  onEditDone: (g: ControlArea["geometry"] | null) => void;
  canEdit: boolean;
  onAreaAction: (action: "shape" | "details" | "delete", area: ControlArea) => void;
}

const handleIcon = (cursor: string) =>
  L.divIcon({ className: "lens-overlay-handle", html: `<div style="width:14px;height:14px;background:#fff;border:2px solid #0b1220;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,.6);cursor:${cursor}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });

export function FlatControlLayers(p: FlatControlProps) {
  const map = useMap();
  const byLayer = useMemo(() => Object.fromEntries(p.layers.map((l) => [l.id, l])), [p.layers]);
  const polyRefs = useRef<Record<string, L.Polygon | null>>({});

  // Drawing: leaflet-draw's polygon tool, started from the panel; click the first point (or double-click) to finish.
  useEffect(() => {
    if (!p.drawing) return;
    const handler = new (L as unknown as { Draw: { Polygon: new (m: L.Map, o: object) => { enable(): void; disable(): void } } }).Draw.Polygon(map, {
      allowIntersection: false,
      // leaflet-draw's live area read-out throws in this build ("type is not defined") and drops the click: off.
      showArea: false,
      shapeOptions: { color: "#ffffff", weight: 2, fillOpacity: 0.15 },
    });
    handler.enable();
    const created = (e: L.LeafletEvent) => {
      const layer = (e as unknown as { layer: L.Polygon }).layer;
      p.onDrawn(layerToGeometry(layer));
    };
    const stopped = () => p.onDrawCancel();
    map.on("draw:created", created);
    map.on("draw:drawstop", stopped);
    return () => {
      map.off("draw:created", created);
      map.off("draw:drawstop", stopped);
      handler.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.drawing, map]);

  // Reshaping an area: drag its corners, then Save or Cancel in the bar the panel shows.
  useEffect(() => {
    if (!p.editingId) return;
    const layer = polyRefs.current[p.editingId] as (L.Polygon & { editing?: { enable(): void; disable(): void } }) | null;
    layer?.editing?.enable();
    const finish = (e: Event) => {
      const save = (e as CustomEvent<boolean>).detail;
      layer?.editing?.disable();
      p.onEditDone(save && layer ? layerToGeometry(layer) : null);
    };
    window.addEventListener("lens-control-edit-finish", finish);
    return () => {
      window.removeEventListener("lens-control-edit-finish", finish);
      layer?.editing?.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.editingId]);

  const a = p.adjusting;
  return (
    <>
      {p.overlays
        .filter((o) => p.shownOverlays.includes(o.id) && p.overlayUrls[o.id])
        .map((o) => {
          const b: [[number, number], [number, number]] = a && a.id === o.id ? a.bounds : [[o.south, o.west], [o.north, o.east]];
          return <ImageOverlay key={o.id} url={p.overlayUrls[o.id]} bounds={b} opacity={o.opacity} zIndex={250} interactive={false} />;
        })}
      {a && (
        <>
          <Marker position={[a.bounds[1][0], a.bounds[0][1]]} draggable icon={handleIcon("nwse-resize")} eventHandlers={{ drag: (e) => { const ll = (e.target as L.Marker).getLatLng(); p.onAdjust([[a.bounds[0][0], ll.lng], [ll.lat, a.bounds[1][1]]]); } }} />
          <Marker position={[a.bounds[0][0], a.bounds[1][1]]} draggable icon={handleIcon("nwse-resize")} eventHandlers={{ drag: (e) => { const ll = (e.target as L.Marker).getLatLng(); p.onAdjust([[ll.lat, a.bounds[0][1]], [a.bounds[1][0], ll.lng]]); } }} />
          <Marker
            position={[(a.bounds[0][0] + a.bounds[1][0]) / 2, (a.bounds[0][1] + a.bounds[1][1]) / 2]}
            draggable
            icon={L.divIcon({ className: "lens-overlay-handle", html: `<div style="width:26px;height:26px;border-radius:13px;background:#d4af37;border:2px solid #0b1220;display:flex;align-items:center;justify-content:center;color:#0b1220;font-weight:900;cursor:move">✥</div>`, iconSize: [26, 26], iconAnchor: [13, 13] })}
            eventHandlers={{
              drag: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                const h = (a.bounds[1][0] - a.bounds[0][0]) / 2, w = (a.bounds[1][1] - a.bounds[0][1]) / 2;
                p.onAdjust([[ll.lat - h, ll.lng - w], [ll.lat + h, ll.lng + w]]);
              },
            }}
          />
        </>
      )}
      {p.areas
        .filter((ar) => byLayer[ar.layerId] && !p.hidden.includes(ar.layerId))
        .map((ar) => {
          const l = byLayer[ar.layerId];
          const st = STATUS[ar.status] ?? STATUS.control;
          return (
            <Polygon
              key={`${ar.id}:${ar.updatedAt}`}
              ref={(r) => {
                polyRefs.current[ar.id] = r;
              }}
              positions={toLatLngs(ar.geometry)}
              pathOptions={{ color: l.color, weight: st.weight, dashArray: st.dash, fillColor: l.color, fillOpacity: st.fill }}
            >
              <Popup>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, minWidth: 190 }}>
                  <div style={{ fontWeight: 700, color: l.color }}>{l.name}</div>
                  <div>
                    {st.label}
                    {ar.label ? ` · ${ar.label}` : ""}
                  </div>
                  <div style={{ opacity: 0.75 }}>
                    {km2(areaKm2(ar.geometry))}
                    {ar.asOf ? ` · as of ${ar.asOf}` : ""}
                  </div>
                  {ar.notes && <div style={{ marginTop: 4 }}>{ar.notes}</div>}
                  {p.canEdit && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button onClick={() => p.onAreaAction("shape", ar)}>Reshape</button>
                      <button onClick={() => p.onAreaAction("details", ar)}>Details</button>
                      <button onClick={() => p.onAreaAction("delete", ar)}>Delete</button>
                    </div>
                  )}
                </div>
              </Popup>
            </Polygon>
          );
        })}
    </>
  );
}

/* ── Globe: the same areas and images ─────────────────────────────────────── */

export function GlobeControlLayers({ map, layers, areas, hidden, overlays, overlayUrls, shownOverlays }: { map: MapLibreMap | null; layers: ControlLayer[]; areas: ControlArea[]; hidden: string[]; overlays: ControlOverlay[]; overlayUrls: Record<string, string>; shownOverlays: string[] }) {
  const data = useMemo(() => {
    const byLayer = Object.fromEntries(layers.map((l) => [l.id, l]));
    return {
      type: "FeatureCollection" as const,
      features: areas
        .filter((a) => byLayer[a.layerId] && !hidden.includes(a.layerId))
        .map((a) => ({ type: "Feature" as const, properties: { color: byLayer[a.layerId].color, status: a.status, name: a.label || byLayer[a.layerId].name }, geometry: a.geometry })),
    };
  }, [layers, areas, hidden]);

  useEffect(() => {
    if (!map) return;
    if (!map.getSource("lens-control-areas")) {
      const before = firstDataLayer(map);
      map.addSource("lens-control-areas", { type: "geojson", data: data as never });
      const fill = ["match", ["get", "status"], ...STATUS_KEYS.flatMap((k) => [k, STATUS[k].fill]), 0.3] as unknown as ExpressionSpecification;
      map.addLayer({ id: "lens-control-fill", type: "fill", source: "lens-control-areas", paint: { "fill-color": ["get", "color"], "fill-opacity": fill } }, before);
      for (const k of STATUS_KEYS) {
        map.addLayer(
          { id: `lens-control-line-${k}`, type: "line", source: "lens-control-areas", filter: ["==", ["get", "status"], k], paint: { "line-color": ["get", "color"], "line-width": STATUS[k].weight, ...(STATUS[k].glDash ? { "line-dasharray": STATUS[k].glDash } : {}) } },
          before
        );
      }
      map.addLayer(
        { id: "lens-control-label", type: "symbol", source: "lens-control-areas", minzoom: 5, layout: { "text-field": ["get", "name"], "text-size": 11, "text-font": ["Noto Sans Bold", "Open Sans Bold"] }, paint: { "text-color": "#ffffff", "text-halo-color": "#05080f", "text-halo-width": 1.4 } },
        before
      );
    } else (map.getSource("lens-control-areas") as GeoJSONSource).setData(data as never);
  }, [map, data]);

  // Images: one image source each, beneath the areas.
  useEffect(() => {
    if (!map) return;
    for (const o of overlays) {
      const id = `lens-control-image-${o.id}`;
      const show = shownOverlays.includes(o.id) && !!overlayUrls[o.id];
      const coords: [[number, number], [number, number], [number, number], [number, number]] = [[o.west, o.north], [o.east, o.north], [o.east, o.south], [o.west, o.south]];
      if (show && !map.getSource(id)) {
        map.addSource(id, { type: "image", url: overlayUrls[o.id], coordinates: coords });
        map.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": o.opacity } }, map.getLayer("lens-control-fill") ? "lens-control-fill" : firstDataLayer(map));
      } else if (map.getSource(id)) {
        (map.getSource(id) as unknown as { setCoordinates: (c: typeof coords) => void }).setCoordinates(coords);
        map.setPaintProperty(id, "raster-opacity", o.opacity);
        map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
      }
    }
  }, [map, overlays, overlayUrls, shownOverlays]);
  return null;
}

/* ── The legend, built from what is drawn ─────────────────────────────────── */

export function ControlLegend({ layers, areas, hidden, onToggle, style }: { layers: ControlLayer[]; areas: ControlArea[]; hidden: string[]; onToggle: (id: string) => void; style?: CSSProperties }) {
  const [open, setOpen] = useState(true);
  const rows = layers
    .map((l) => {
      const mine = areas.filter((a) => a.layerId === l.id);
      return { l, count: mine.length, km: mine.filter((a) => a.status === "control").reduce((t, a) => t + areaKm2(a.geometry), 0) };
    })
    .filter((r) => r.count > 0);
  if (!rows.length) return null;
  const used = STATUS_KEYS.filter((k) => areas.some((a) => a.status === k && !hidden.includes(a.layerId)));
  const latest = areas.map((a) => a.asOf).filter(Boolean).sort().pop();
  return (
    <FloatingPanel id="control-legend" title="Territorial control" width={230} zIndex={450} initial={{ right: 12, bottom: 44, ...style }}>
    <div style={{ fontSize: 11.5 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", color: "inherit", padding: "8px 10px", cursor: "pointer", fontFamily: "inherit" }}>
        <span style={{ fontSize: 10.5, letterSpacing: "0.14em", fontWeight: 800 }}>TERRITORIAL CONTROL</span>
        <span style={{ opacity: 0.7 }}>{open ? "–" : "+"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 10px 9px" }}>
          {latest && <div style={{ fontSize: 10, opacity: 0.65, marginBottom: 6 }}>As of {latest}</div>}
          {rows.map(({ l, km }) => {
            const off = hidden.includes(l.id);
            return (
              <button key={l.id} onClick={() => onToggle(l.id)} title={off ? "Show" : "Hide"} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", color: "inherit", padding: "3px 0", cursor: "pointer", textAlign: "left", fontFamily: "inherit", opacity: off ? 0.45 : 1 }}>
                <span style={{ width: 16, height: 11, borderRadius: 2, background: l.color, opacity: 0.85, border: `1.5px solid ${l.color}`, flex: "none" }} />
                <span style={{ flex: 1, fontWeight: 600 }}>{l.name}</span>
                {km > 0 && <span style={{ opacity: 0.6, fontSize: 10 }}>{km2(km)}</span>}
                {off ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            );
          })}
          {used.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", marginTop: 6, paddingTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 8px" }}>
              {used.map((k) => (
                <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }} title={STATUS[k].hint}>
                  <svg width="22" height="12">
                    <rect x="1" y="1" width="20" height="10" rx="2" fill="#cbd5e1" fillOpacity={STATUS[k].fill} stroke="#cbd5e1" strokeWidth={1.6} strokeDasharray={STATUS[k].dash} />
                  </svg>
                  {STATUS[k].label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </FloatingPanel>
  );
}

/* ── The panel (opened from the left rail) ────────────────────────────────── */

const field: CSSProperties = { width: "100%", background: "rgba(255,255,255,0.06)", color: "#e6edf7", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 6, padding: "5px 7px", fontFamily: "inherit", fontSize: 12, boxSizing: "border-box" };
const small: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.08)", color: "#e6edf7", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, padding: "4px 8px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" };
const gold: CSSProperties = { ...small, background: "rgba(212,175,55,0.2)", borderColor: "rgba(212,175,55,0.5)", color: "#f3d77a", fontWeight: 700 };
const PALETTE = ["#d97706", "#dc2626", "#16a34a", "#2563eb", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#f59e0b", "#64748b"];

export interface ControlPanelProps {
  canEdit: boolean;
  data: ReturnType<typeof useControlMaps>;
  hidden: string[];
  onToggleLayer: (id: string) => void;
  legendOnMap: boolean;
  onLegendOnMap: (on: boolean) => void;
  shownOverlays: string[];
  onShownOverlays: (ids: string[]) => void;
  drawing: boolean;
  onDraw: (on: boolean) => void;
  pending: ControlArea["geometry"] | null;
  onPendingDone: () => void;
  editingDetails: ControlArea | null;
  onEditingDetailsDone: () => void;
  editingShapeId: string | null;
  adjusting: { id: string; bounds: [[number, number], [number, number]] } | null;
  onAdjusting: (a: { id: string; bounds: [[number, number], [number, number]] } | null) => void;
  /** The bounds the map shows now (a new image is placed to fill them). */
  viewBounds: () => [[number, number], [number, number]] | null;
  onClose: () => void;
}

function AreaForm({ layers, initial, onSave, onCancel, onNewLayer }: { layers: ControlLayer[]; initial: Partial<ControlAreaInput>; onSave: (v: Omit<ControlAreaInput, "geometry">) => Promise<void>; onCancel: () => void; onNewLayer: (name: string, color: string) => Promise<ControlLayer> }) {
  const [layerId, setLayerId] = useState(initial.layerId ?? layers[0]?.id ?? "__new");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[layers.length % PALETTE.length]);
  const [status, setStatus] = useState<ControlStatus>(initial.status ?? "control");
  const [label, setLabel] = useState(initial.label ?? "");
  const [asOf, setAsOf] = useState(initial.asOf ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      let id = layerId;
      if (id === "__new") {
        if (!newName.trim()) throw new Error("Name the group.");
        id = (await onNewLayer(newName.trim(), newColor)).id;
      }
      await onSave({ layerId: id, status, label: label.trim() || null, asOf: asOf || null, notes: notes.trim() || null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 9, borderRadius: 8, background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.35)" }}>
      <label>
        Armed group
        <select value={layerId} onChange={(e) => setLayerId(e.target.value)} style={field}>
          {layers.map((l) => (
            <option key={l.id} value={l.id} style={{ background: "#0b1220" }}>
              {l.name}
            </option>
          ))}
          <option value="__new" style={{ background: "#0b1220" }}>
            + New group…
          </option>
        </select>
      </label>
      {layerId === "__new" && (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Group name (e.g. RSF)" style={field} autoFocus />
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} style={{ width: 36, padding: 0, border: "none", background: "none" }} aria-label="Group colour" />
        </div>
      )}
      <label>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value as ControlStatus)} style={field}>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k} style={{ background: "#0b1220" }}>
              {STATUS[k].label}: {STATUS[k].hint}
            </option>
          ))}
        </select>
      </label>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name of the area (optional)" style={field} />
      <label>
        As of
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={field} />
      </label>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes or source (optional)" rows={2} style={{ ...field, resize: "vertical" }} />
      {err && <div style={{ color: "#f87171" }}>{err}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => void save()} disabled={busy} style={gold}>
          <Check size={12} /> Save
        </button>
        <button onClick={onCancel} disabled={busy} style={small}>
          Discard
        </button>
      </div>
    </div>
  );
}

export function ControlMapsPanel(p: ControlPanelProps) {
  const { layers, areas, overlays, reload, setOverlays } = p.data;
  const [editLayer, setEditLayer] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const newLayer = async (name: string, color: string) => {
    const r = await api.addControlLayer({ name, color });
    await reload();
    return r.layer;
  };
  const upload = async (file: File) => {
    setUploading(true);
    setMsg("");
    try {
      const { dataUrl, aspect } = await prepareImage(file);
      const view = p.viewBounds();
      if (!view) throw new Error("Open the map first.");
      // Placed in the middle of the view, keeping the picture's shape (on the map's scale at that latitude).
      const [[s, w], [n, e]] = view;
      const midLat = (s + n) / 2, midLng = (w + e) / 2;
      const cos = Math.cos((midLat * Math.PI) / 180);
      let hh = (n - s) * 0.4, hw = (hh * aspect) / cos;
      if (hw > (e - w) * 0.4) {
        hw = (e - w) * 0.4;
        hh = hw * cos / aspect;
      }
      const r = await api.addControlOverlay({ name: file.name.replace(/\.[a-z]+$/i, ""), image: dataUrl, north: midLat + hh, south: midLat - hh, east: midLng + hw, west: midLng - hw, opacity: 0.6 });
      setOverlays((o) => [...o, r.overlay]);
      p.onShownOverlays([...p.shownOverlays, r.overlay.id]);
      p.onAdjusting({ id: r.overlay.id, bounds: [[r.overlay.south, r.overlay.west], [r.overlay.north, r.overlay.east]] });
      setMsg("Placed. Drag its corners and middle until it lines up with the map, then Save position.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add the image.");
    } finally {
      setUploading(false);
    }
  };
  const setOpacity = (o: ControlOverlay, v: number) => {
    setOverlays((list) => list.map((x) => (x.id === o.id ? { ...x, opacity: v } : x)));
    window.clearTimeout((setOpacity as unknown as { t?: number }).t);
    (setOpacity as unknown as { t?: number }).t = window.setTimeout(() => void api.updateControlOverlay(o.id, { opacity: v }).catch(() => undefined), 500);
  };
  const savePosition = async () => {
    if (!p.adjusting) return;
    const [[s, w], [n, e]] = p.adjusting.bounds;
    const r = await api.updateControlOverlay(p.adjusting.id, { south: Math.min(s, n), north: Math.max(s, n), west: Math.min(w, e), east: Math.max(w, e) });
    setOverlays((list) => list.map((x) => (x.id === r.overlay.id ? r.overlay : x)));
    p.onAdjusting(null);
    setMsg("Position saved.");
  };
  const section = (t: string) => <div style={{ fontSize: 10.5, letterSpacing: "0.14em", fontWeight: 800, margin: "12px 0 6px", color: "#e6edf7" }}>{t}</div>;

  return (
    <div style={{ position: "absolute", left: 64, top: 70, zIndex: 640, width: 320, maxHeight: "calc(100% - 140px)", overflowY: "auto", background: "rgba(6,10,18,0.94)", border: "1px solid rgba(212,175,55,0.3)", borderRadius: 12, padding: "12px 14px", color: "#cbd5e1", fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Shield size={16} color="#d4af37" />
        <span style={{ flex: 1, fontSize: 12, letterSpacing: "0.14em", fontWeight: 800, color: "#e6edf7" }}>TERRITORIAL CONTROL</span>
        <button onClick={p.onClose} style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer" }} aria-label="Close">
          <X size={15} />
        </button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <input type="checkbox" checked={p.legendOnMap} onChange={(e) => p.onLegendOnMap(e.target.checked)} /> Show the legend on the map
      </label>

      {section("ARMED GROUPS")}
      {layers.length === 0 && <div style={{ opacity: 0.7 }}>No groups yet. Draw an area and name its group: the legend builds itself.</div>}
      {layers.map((l) => {
        const n = areas.filter((a) => a.layerId === l.id).length;
        const off = p.hidden.includes(l.id);
        return (
          <div key={l.id} style={{ marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <button onClick={() => p.onToggleLayer(l.id)} style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", padding: 0, display: "flex" }} title={off ? "Show" : "Hide"}>
                {off ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <span style={{ width: 14, height: 10, borderRadius: 2, background: l.color, flex: "none" }} />
              <span style={{ flex: 1, color: "#e6edf7", fontWeight: 600, opacity: off ? 0.5 : 1 }}>{l.name}</span>
              <span style={{ opacity: 0.6 }}>
                {n} area{n === 1 ? "" : "s"}
              </span>
              {p.canEdit && (
                <button onClick={() => setEditLayer(editLayer === l.id ? null : l.id)} style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", padding: 0 }} title="Edit group">
                  <Pencil size={12} />
                </button>
              )}
            </div>
            {editLayer === l.id && (
              <LayerEditor
                layer={l}
                onDone={() => {
                  setEditLayer(null);
                  void reload();
                }}
              />
            )}
          </div>
        );
      })}
      {p.canEdit && (
        <div style={{ marginTop: 8 }}>
          {p.pending ? (
            <AreaForm
              layers={layers}
              initial={{}}
              onNewLayer={newLayer}
              onCancel={p.onPendingDone}
              onSave={async (v) => {
                await api.addControlArea({ ...v, geometry: p.pending! });
                await reload();
                p.onPendingDone();
                setMsg("Area saved.");
              }}
            />
          ) : p.editingDetails ? (
            <AreaForm
              layers={layers}
              initial={p.editingDetails}
              onNewLayer={newLayer}
              onCancel={p.onEditingDetailsDone}
              onSave={async (v) => {
                await api.updateControlArea(p.editingDetails!.id, v);
                await reload();
                p.onEditingDetailsDone();
              }}
            />
          ) : p.editingShapeId ? (
            <div style={{ padding: 9, borderRadius: 8, background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.35)" }}>
              Drag the corners on the map; drag a middle handle to add a corner.
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button style={gold} onClick={() => window.dispatchEvent(new CustomEvent("lens-control-edit-finish", { detail: true }))}>
                  <Check size={12} /> Save shape
                </button>
                <button style={small} onClick={() => window.dispatchEvent(new CustomEvent("lens-control-edit-finish", { detail: false }))}>
                  Cancel
                </button>
              </div>
            </div>
          ) : p.drawing ? (
            <div style={{ padding: 9, borderRadius: 8, background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.35)", lineHeight: 1.5 }}>
              Click around the area on the map, point by point. Click the first point to close it. Esc cancels.
              <div style={{ marginTop: 6 }}>
                <button style={small} onClick={() => p.onDraw(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button style={gold} onClick={() => p.onDraw(true)}>
              <PenLine size={13} /> Draw an area
            </button>
          )}
        </div>
      )}

      {section("IMAGES TO TRACE OVER")}
      {overlays.length === 0 && <div style={{ opacity: 0.7, marginBottom: 6 }}>Add a map image (PNG or JPG) to place over the map and trace.</div>}
      {overlays.map((o) => {
        const shown = p.shownOverlays.includes(o.id);
        const adj = p.adjusting?.id === o.id;
        return (
          <div key={o.id} style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <button onClick={() => p.onShownOverlays(shown ? p.shownOverlays.filter((x) => x !== o.id) : [...p.shownOverlays, o.id])} style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", padding: 0, display: "flex" }} title={shown ? "Hide" : "Show"}>
                {shown ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <ImageIcon size={13} />
              <span style={{ flex: 1, color: "#e6edf7" }}>{o.name}</span>
              {p.canEdit && (
                <>
                  <button style={adj ? gold : small} onClick={() => (adj ? void savePosition() : (p.onShownOverlays(shown ? p.shownOverlays : [...p.shownOverlays, o.id]), p.onAdjusting({ id: o.id, bounds: [[o.south, o.west], [o.north, o.east]] })))} title="Line it up">
                    {adj ? <Check size={12} /> : <Move size={12} />} {adj ? "Save position" : "Position"}
                  </button>
                  <button
                    style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", padding: 0 }}
                    title="Remove image"
                    onClick={() => {
                      if (!window.confirm(`Remove the image "${o.name}"? Areas drawn from it stay.`)) return;
                      void api.deleteControlOverlay(o.id).then(() => setOverlays((l) => l.filter((x) => x.id !== o.id)));
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
            {shown && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, paddingLeft: 21 }}>
                See-through
                <input type="range" min={0.1} max={1} step={0.05} value={o.opacity} onChange={(e) => setOpacity(o, Number(e.target.value))} disabled={!p.canEdit} style={{ flex: 1, accentColor: "#d4af37" }} />
              </label>
            )}
            {adj && (
              <div style={{ paddingLeft: 21, marginTop: 4, opacity: 0.8, lineHeight: 1.45 }}>
                Drag the gold handle to move it and the white corners to stretch it, until two known places (a town, a river bend) sit on the same places on the map.{" "}
                <button style={small} onClick={() => p.onAdjusting(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
      {p.canEdit && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <button style={small} disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Plus size={12} /> {uploading ? "Adding…" : "Add an image"}
          </button>
        </>
      )}
      {msg && <div style={{ marginTop: 8, color: "#86efac" }}>{msg}</div>}
    </div>
  );
}

function LayerEditor({ layer, onDone }: { layer: ControlLayer; onDone: () => void }) {
  const [name, setName] = useState(layer.name);
  const [color, setColor] = useState(layer.color);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "5px 0 5px 21px" }}>
      <input value={name} onChange={(e) => setName(e.target.value)} style={field} />
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 32, padding: 0, border: "none", background: "none" }} aria-label="Colour" />
      <button style={small} onClick={() => void api.updateControlLayer(layer.id, { name: name.trim() || layer.name, color }).then(onDone)}>
        <Check size={12} />
      </button>
      <button
        style={small}
        title="Delete the group and its areas"
        onClick={() => {
          if (window.confirm(`Delete ${layer.name} and all its areas?`)) void api.deleteControlLayer(layer.id).then(onDone);
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
