import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import L from "leaflet";
import { GeoJSON, useMap } from "react-leaflet";
import { Popup as GlPopup, type GeoJSONSource, type Map as MapLibreMap, type MapLayerMouseEvent } from "maplibre-gl";
import { Check, ChevronRight, Download, Eye, EyeOff, Layers, Plus, Search, Trash2, X } from "lucide-react";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { numericToAlpha3 } from "i18n-iso-countries";
import { api, type BoundaryCountry, type BoundaryLayer, type BoundaryUnit } from "../api";
import { boundaryCatalogue, boundaryLayer, downloadGeoJson, extentOf, joinShapes, levelName, unitKey, unitsGeometry, WORLD } from "../boundaryLibrary";
import { firstDataLayer } from "./globeExtras";
import type { ZoneAction, ZoneView } from "./WatchZoneAreas";

/**
 * The boundary library: administrative areas for any country (the country, its states or provinces, its districts,
 * and lower where published), plus every country in the world, to show as map layers in a click. Each area names
 * itself on hover; clicking one opens what can be done with it: download it, see the watch zones it falls in, and
 * (admins) make it part of a watch zone, or start a new zone from it. In "adding areas" mode, clicking areas adds them
 * to the chosen zone or drops them again, and the zone redraws itself at once.
 *
 * Every area drills down: a country to its states or provinces, a state to its districts, a district to its wards
 * (as deep as the country publishes), each next level shown only inside the area clicked.
 *
 * Data: geoBoundaries (CC BY 4.0), fetched by the server on first use and kept there; countries of the world from
 * Natural Earth (Somalia includes Somaliland, as everywhere in the Lens).
 */

export interface ShownLayer {
  key: string;
  iso: string;
  level: string;
  country: string;
  canonical: string;
  color: string;
  visible: boolean;
  /** Only the areas inside this one (an area's key), for a drilled-down level. */
  parent?: string;
}

/** Where drilling into an area leads: the next level down, inside it. */
export interface DrillTarget {
  iso: string;
  level: string;
  country: string;
  canonical: string;
  parent?: string;
  label: string;
}

export interface BoundaryLib {
  shown: ShownLayer[];
  data: Record<string, BoundaryLayer>;
  status: Record<string, string>;
  add: (l: Omit<ShownLayer, "key" | "color" | "visible">) => void;
  /** The next level down from an area (shown in layer `layerKey`), if the country has one. */
  drillTarget: (unit: string, name: string, layerKey: string) => DrillTarget | null;
  drill: (unit: string, name: string, layerKey: string) => void;
  update: (key: string, patch: Partial<ShownLayer>) => void;
  remove: (key: string) => void;
  /** The zone that clicking areas adds to (or drops from); none when just looking. */
  pickZone: string | null;
  setPickZone: (id: string | null) => void;
  /** Asks the map to show this extent (set by Live OSINT). */
  focus: { current: ((b: { minLat: number; maxLat: number; minLng: number; maxLng: number }) => void) | null };
}

const STORE = "lens-boundary-layers-v1";
const PALETTE = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#22d3ee", "#c084fc", "#e2e8f0"];

export function useBoundaryLibrary(): BoundaryLib {
  const [shown, setShown] = useState<ShownLayer[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) ?? "[]") as ShownLayer[];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  });
  const [data, setData] = useState<Record<string, BoundaryLayer>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [pickZone, setPickZone] = useState<string | null>(null);
  const focus = useRef<BoundaryLib["focus"]["current"]>(null);
  const [catalogue, setCatalogue] = useState<BoundaryCountry[] | null>(null);
  useEffect(() => {
    boundaryCatalogue().then(setCatalogue, () => undefined);
  }, []);
  // A layer just added is gone to once its areas are in.
  const goTo = useRef<string | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(shown));
    } catch {
      /* private mode */
    }
  }, [shown]);
  // Each shown layer's areas, fetched once.
  useEffect(() => {
    for (const l of shown) {
      if (data[l.key] || status[l.key] === "loading") continue;
      setStatus((s) => ({ ...s, [l.key]: "loading" }));
      (l.parent ? areasInside(l.iso, l.level, l.parent) : boundaryLayer(l.iso, l.level)).then(
        (d) => {
          setData((x) => ({ ...x, [l.key]: d }));
          setStatus((s) => ({ ...s, [l.key]: d.features.length ? "" : "No areas of this level found inside it." }));
          if (goTo.current === l.key && d.features.length) {
            goTo.current = null;
            const e = extentOf({ type: "MultiPolygon", coordinates: d.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)) });
            if (e) focus.current?.(e);
          }
        },
        (e: Error) => setStatus((s) => ({ ...s, [l.key]: e.message || "Could not load" }))
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const [tick, setTick] = useState(0);
  const add = useCallback<BoundaryLib["add"]>((l) => {
    const key = `${l.iso}:${l.level}${l.parent ? `@${l.parent}` : ""}`;
    // Go to it once loaded (a whole-world layer stays where it is).
    if (l.iso !== WORLD) goTo.current = key;
    setShown((list) => (list.some((x) => x.key === key) ? list.map((x) => (x.key === key ? { ...x, visible: true } : x)) : [...list, { ...l, key, color: PALETTE[list.length % PALETTE.length], visible: true }]));
    setTick((t) => t + 1);
  }, []);
  // Already loaded: go there now.
  useEffect(() => {
    const k = goTo.current;
    const d = k ? data[k] : null;
    if (!k || !d || !d.features.length) return;
    goTo.current = null;
    const e = extentOf({ type: "MultiPolygon", coordinates: d.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)) });
    if (e) focus.current?.(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const drillTarget = useCallback<BoundaryLib["drillTarget"]>(
    (unit, name, layerKey) => {
      if (!catalogue) return null;
      const [iso, level, ...rest] = unit.split(":");
      const id = rest.join(":");
      const below = (c: BoundaryCountry, from: string) => c.levels.filter((l) => Number(l.level.slice(3)) > Number(from.slice(3))).sort((a, b) => a.level.localeCompare(b.level))[0];
      if (iso === WORLD) {
        // A country of the world: its first level down, from its own boundaries.
        const a3 = /^\d+$/.test(id) ? numericToAlpha3(id) : catalogue.find((c) => c.name.toLowerCase() === name.toLowerCase())?.iso;
        const c = a3 ? catalogue.find((x) => x.iso === a3) : undefined;
        const n = c && below(c, "ADM0");
        if (!c || !n) return null;
        const canonical = levelName(n.level, n.canonical);
        return { iso: c.iso, level: n.level, country: c.name, canonical, label: `${canonical} of ${c.name}` };
      }
      const c = catalogue.find((x) => x.iso === iso);
      const n = c && below(c, level);
      if (!c || !n) return null;
      const canonical = levelName(n.level, n.canonical);
      if (level === "ADM0") return { iso, level: n.level, country: c.name, canonical, label: `${canonical} of ${c.name}` };
      const from = shownRef.current.find((x) => x.key === layerKey);
      return { iso, level: n.level, country: `${from?.country ?? c.name} › ${name}`, canonical, parent: unit, label: `${canonical} in ${name}` };
    },
    [catalogue]
  );
  const drill = useCallback<BoundaryLib["drill"]>(
    (unit, name, layerKey) => {
      const t = drillTarget(unit, name, layerKey);
      if (t) add({ iso: t.iso, level: t.level, country: t.country, canonical: t.canonical, parent: t.parent });
    },
    [drillTarget, add]
  );
  useEffect(() => {
    const on = (e: Event) => {
      const a = (e as CustomEvent<UnitAction>).detail;
      if (a.action === "drill" && a.layerKey) drill(a.key, a.name ?? "", a.layerKey);
    };
    window.addEventListener("lens-unit-action", on);
    return () => window.removeEventListener("lens-unit-action", on);
  }, [drill]);
  const update = useCallback<BoundaryLib["update"]>((key, patch) => setShown((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x))), []);
  const remove = useCallback<BoundaryLib["remove"]>((key) => {
    setShown((list) => list.filter((x) => x.key !== key));
    setStatus((s) => ({ ...s, [key]: "" }));
  }, []);
  return { shown, data, status, add, drillTarget, drill, update, remove, pickZone, setPickZone, focus };
}

/* ── Drilling down: the areas of a level that lie inside one area of the level above ─────────────────────────── */

/** A point surely inside a shape: the middle of the widest stretch across its largest part, halfway up. */
function interiorPoint(g: Polygon | MultiPolygon): [number, number] | null {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let best: Position[][] | null = null;
  let bestSize = -1;
  for (const p of polys) {
    const xs = p[0].map((q) => q[0]), ys = p[0].map((q) => q[1]);
    const size = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (size > bestSize) {
      bestSize = size;
      best = p;
    }
  }
  if (!best) return null;
  const ys = best[0].map((q) => q[1]);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 + 1e-7;
  const xs: number[] = [];
  for (const ring of best)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
  xs.sort((a, b) => a - b);
  let w = -1, at: [number, number] | null = null;
  for (let i = 0; i + 1 < xs.length; i += 2)
    if (xs[i + 1] - xs[i] > w) {
      w = xs[i + 1] - xs[i];
      at = [(xs[i] + xs[i + 1]) / 2, y];
    }
  return at;
}

async function areasInside(iso: string, level: string, parent: string): Promise<BoundaryLayer> {
  const [piso, plevel, ...rest] = parent.split(":");
  const pid = rest.join(":");
  const [all, up] = await Promise.all([boundaryLayer(iso, level), boundaryLayer(piso, plevel)]);
  const pf = up.features.find((f) => f.properties.id === pid);
  if (!pf) return { ...all, features: [] };
  const area: MultiPolygon = pf.geometry.type === "Polygon" ? { type: "MultiPolygon", coordinates: [pf.geometry.coordinates] } : pf.geometry;
  const e = extentOf(area)!;
  return {
    ...all,
    features: all.features.filter((f) => {
      const p = interiorPoint(f.geometry);
      return !!p && p[0] >= e.minLng && p[0] <= e.maxLng && p[1] >= e.minLat && p[1] <= e.maxLat && inArea(p[0], p[1], area);
    }),
  };
}

/* ── What each area is in: zones it is part of (by choice) and zones it lies inside (by place) ─────────────────── */

interface Member {
  id: string;
  label: string;
  color: string;
}
function membership(view: ZoneView): Map<string, Member[]> {
  const m = new Map<string, Member[]>();
  for (const z of view.zones)
    for (const u of view.overrides[z.id]?.units ?? []) {
      const list = m.get(u.key) ?? [];
      list.push({ id: z.id, label: z.label, color: view.colors[z.id] });
      m.set(u.key, list);
    }
  return m;
}

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inArea = (lng: number, lat: number, a: MultiPolygon) => a.coordinates.some((poly) => inRing(lng, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lng, lat, h)));

/* ── An area's popup ─────────────────────────────────────────────────────────────────────────────────────────── */

export type UnitAction = { action: "add" | "remove" | "new" | "download" | "drill"; key: string; zoneId?: string; layerKey?: string; name?: string };
/** Text inside a quoted JavaScript string in an onclick (names like Murang'a). */
const js = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function unitHtml(key: string, name: string, place: string, at: { lat: number; lng: number }, view: ZoneView, members: Member[], canEdit: boolean, drill: { label: string; layerKey: string } | null): string {
  const send = (a: string, extra = "") => `window.dispatchEvent(new CustomEvent('lens-unit-action',{detail:{action:'${a}',key:'${esc(key)}'${extra}}}))`;
  const btn = "background:rgba(127,127,127,.15);border:1px solid rgba(127,127,127,.35);border-radius:6px;padding:3px 8px;font-size:11.5px;cursor:pointer;margin:2px 4px 2px 0";
  const inside = view.zones.filter((z) => view.areas[z.id] && inArea(at.lng, at.lat, view.areas[z.id]));
  const memberIds = new Set(members.map((m) => m.id));
  const choices = view.zones.filter((z) => !memberIds.has(z.id));
  return `<div style="max-width:290px;font-size:12.5px;line-height:1.45">
  <div style="font-weight:800">${esc(name)}</div>
  <div style="opacity:.75;margin-bottom:4px">${esc(place)}</div>
  ${drill ? `<button style="${btn};font-weight:700;background:rgba(56,189,248,.18);border-color:rgba(56,189,248,.5)" onclick="${send("drill", `,layerKey:'${esc(js(drill.layerKey))}',name:'${esc(js(name))}'`)}">Show ${esc(drill.label)} &rsaquo;</button>` : ""}
  ${members.map((m) => `<div style="display:flex;align-items:center;gap:6px;margin-top:2px"><span style="width:9px;height:9px;border-radius:2px;background:${m.color}"></span><span style="flex:1">Part of <b>${esc(m.label)}</b></span>${canEdit ? `<button style="${btn};color:#ff7a7a" onclick="${send("remove", `,zoneId:'${m.id}'`)}">Drop</button>` : ""}</div>`).join("")}
  ${inside.filter((z) => !memberIds.has(z.id)).map((z) => `<div style="margin-top:2px">Inside <b style="color:${view.colors[z.id]}">${esc(z.label)}</b></div>`).join("")}
  ${inside.length || members.length ? `<div>${[...new Map([...inside.map((z) => [z.id, z.label] as const), ...members.map((m) => [m.id, m.label] as const)]).entries()].map(([id, label]) => `<button style="${btn}" onclick="window.dispatchEvent(new CustomEvent('lens-zone-open',{detail:{id:'${id}',lat:${at.lat},lng:${at.lng}}}))">${esc(label)} details</button>`).join("")}</div>` : ""}
  ${
    canEdit
      ? `<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(127,127,127,.3)">
  <div style="font-weight:700;font-size:11px;letter-spacing:.06em;margin-bottom:4px">WATCH ZONES</div>
  ${choices.length ? `<div style="display:flex;gap:4px;align-items:center"><select style="flex:1;min-width:0;font-size:11.5px;padding:2px">${choices.map((z) => `<option value="${z.id}">${esc(z.label)}</option>`).join("")}</select><button style="${btn};font-weight:700" onclick="${send("add", ",zoneId:this.previousElementSibling.value")}">Make part of zone</button></div>` : ""}
  <button style="${btn}" onclick="${send("new")}">+ New watch zone from this area</button>
</div>`
      : ""
  }
  <div style="margin-top:6px"><button style="${btn}" onclick="${send("download")}">Download (GeoJSON)</button></div>
</div>`;
}

const placeOf = (layer: BoundaryLayer, shown: ShownLayer) => (layer.iso === WORLD ? "Country" : `${shown.canonical.replace(/ies$/, "y").replace(/s$/, "")} · ${shown.country}`);

/* ── Flat map ────────────────────────────────────────────────────────────────────────────────────────────────── */

export function FlatBoundaryLayers({ lib, view, canEdit }: { lib: BoundaryLib; view: ZoneView; canEdit: boolean }) {
  const map = useMap();
  // Above the watch zones, so an area can be clicked where it lies inside one.
  useMemo(() => {
    if (!map.getPane("lens-bounds")) {
      const p = map.createPane("lens-bounds");
      p.style.zIndex = "405";
    }
  }, [map]);
  const members = useMemo(() => membership(view), [view]);
  const ctx = useRef({ lib, view, canEdit, members });
  ctx.current = { lib, view, canEdit, members };
  // An action from an area's popup closes it (its contents would be out of date).
  useEffect(() => {
    const close = () =>
      window.setTimeout(() => {
        try {
          map.closePopup();
        } catch {
          /* already closed */
        }
      }, 0);
    window.addEventListener("lens-unit-action", close);
    return () => {
      window.removeEventListener("lens-unit-action", close);
    };
  }, [map]);
  const memberSig = useMemo(() => [...members.entries()].map(([k, m]) => `${k}=${m.map((x) => x.color).join()}`).join("|"), [members]);
  return (
    <>
      {lib.shown
        .filter((l) => l.visible && lib.data[l.key])
        .map((l) => {
          const layer = lib.data[l.key];
          return (
            <GeoJSON
              key={`${l.key}:${l.color}:${memberSig.length}:${memberSig.slice(0, 64)}:${lib.pickZone ?? ""}`}
              pane="lens-bounds"
              data={layer as never}
              style={(f) => {
                const k = unitKey(layer.iso, layer.level, String(f?.properties?.id));
                const m = members.get(k);
                const target = lib.pickZone && m?.some((x) => x.id === lib.pickZone);
                return m
                  ? { color: m[0].color, weight: target ? 2.4 : 1.6, opacity: 0.95, fillColor: m[0].color, fillOpacity: target ? 0.28 : 0.12 }
                  : { color: l.color, weight: 1, opacity: 0.85, fillColor: l.color, fillOpacity: lib.pickZone ? 0.06 : 0.03 };
              }}
              onEachFeature={(f, lyr) => {
                const id = String(f.properties?.id);
                const name = String(f.properties?.name ?? "Area");
                lyr.bindTooltip(name, { sticky: true, className: "lens-bounds-tip" });
                lyr.on("click", (e: L.LeafletMouseEvent) => {
                  L.DomEvent.stopPropagation(e);
                  const c = ctx.current;
                  const key = unitKey(layer.iso, layer.level, id);
                  if (c.lib.pickZone && c.canEdit) {
                    const isIn = c.members.get(key)?.some((x) => x.id === c.lib.pickZone);
                    unitAction({ action: isIn ? "remove" : "add", key, zoneId: c.lib.pickZone });
                    return;
                  }
                  L.popup({ maxWidth: 310 })
                    .setLatLng(e.latlng)
                    .setContent(unitHtml(key, name, placeOf(layer, l), { lat: e.latlng.lat, lng: e.latlng.lng }, c.view, c.members.get(key) ?? [], c.canEdit, drillFor(c.lib, key, name, l.key)))
                    .openOn(map);
                });
              }}
            />
          );
        })}
    </>
  );
}

function drillFor(lib: BoundaryLib, key: string, name: string, layerKey: string) {
  const t = lib.drillTarget(key, name, layerKey);
  return t ? { label: t.label, layerKey } : null;
}

const unitAction = (a: UnitAction) => window.dispatchEvent(new CustomEvent<UnitAction>("lens-unit-action", { detail: a }));

/* ── Globe ───────────────────────────────────────────────────────────────────────────────────────────────────── */

export function GlobeBoundaryLayers({ map, lib, view, canEdit }: { map: MapLibreMap | null; lib: BoundaryLib; view: ZoneView; canEdit: boolean }) {
  const members = useMemo(() => membership(view), [view]);
  const ctx = useRef({ lib, view, canEdit, members });
  ctx.current = { lib, view, canEdit, members };
  const data = useMemo(() => {
    const features = lib.shown
      .filter((l) => l.visible && lib.data[l.key])
      .flatMap((l) => {
        const layer = lib.data[l.key];
        return layer.features.map((f) => {
          const key = unitKey(layer.iso, layer.level, f.properties.id);
          const m = members.get(key);
          const target = !!(lib.pickZone && m?.some((x) => x.id === lib.pickZone));
          return { type: "Feature" as const, properties: { key, layer: l.key, name: f.properties.name, color: m ? m[0].color : l.color, fill: m ? (target ? 0.28 : 0.12) : lib.pickZone ? 0.06 : 0.03, width: m ? (target ? 2.4 : 1.6) : 1 }, geometry: f.geometry };
        });
      });
    return { type: "FeatureCollection" as const, features };
  }, [lib.shown, lib.data, lib.pickZone, members]);
  const popup = useRef<GlPopup | null>(null);
  useEffect(() => {
    if (!map) return;
    if (!map.getSource("lens-bounds")) {
      const before = firstDataLayer(map);
      map.addSource("lens-bounds", { type: "geojson", data: data as never });
      map.addLayer({ id: "lens-control-bounds-fill", type: "fill", source: "lens-bounds", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } }, before);
      map.addLayer({ id: "lens-control-bounds-line", type: "line", source: "lens-bounds", paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": 0.9 } }, before);
      map.addLayer(
        {
          id: "lens-control-bounds-label",
          type: "symbol",
          source: "lens-bounds",
          minzoom: 5,
          layout: { "text-field": ["get", "name"], "text-size": 10.5, "text-font": ["Noto Sans Regular", "Open Sans Regular"], "text-allow-overlap": false },
          paint: { "text-color": "#e6edf7", "text-halo-color": "#05080f", "text-halo-width": 1.3 },
        },
        before
      );
      map.on("mouseenter", "lens-control-bounds-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "lens-control-bounds-fill", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "lens-control-bounds-fill", (e: MapLayerMouseEvent) => {
        // Markers on top take their own clicks first.
        const above = map.queryRenderedFeatures(e.point).find((f) => f.layer.id.startsWith("lens-") && !f.layer.id.startsWith("lens-control-") && !f.layer.id.startsWith("lens-basemap-") && f.layer.type !== "fill");
        if (above) return;
        const key = e.features?.[0]?.properties?.key as string | undefined;
        if (!key) return;
        const c = ctx.current;
        if (c.lib.pickZone && c.canEdit) {
          const isIn = c.members.get(key)?.some((x) => x.id === c.lib.pickZone);
          unitAction({ action: isIn ? "remove" : "add", key, zoneId: c.lib.pickZone });
          return;
        }
        const lk = e.features?.[0]?.properties?.layer as string | undefined;
        const l = c.lib.shown.find((x) => x.key === lk);
        const layer = lk ? c.lib.data[lk] : undefined;
        if (!l || !layer) return;
        const nm = String(e.features?.[0]?.properties?.name ?? "Area");
        popup.current?.remove();
        popup.current = new GlPopup({ maxWidth: "310px" })
          .setLngLat(e.lngLat)
          .setHTML(unitHtml(key, nm, placeOf(layer, l), { lat: e.lngLat.lat, lng: e.lngLat.lng }, c.view, c.members.get(key) ?? [], c.canEdit, drillFor(c.lib, key, nm, l.key)))
          .addTo(map);
      });
      for (const ev of ["lens-unit-action", "lens-zone-open"]) window.addEventListener(ev, () => popup.current?.remove());
    } else (map.getSource("lens-bounds") as GeoJSONSource).setData(data as never);
  }, [map, data]);
  return null;
}

/* ── The panel ───────────────────────────────────────────────────────────────────────────────────────────────── */

const small: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.08)", color: "#e6edf7", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, padding: "4px 8px", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" };
const gold: CSSProperties = { ...small, background: "rgba(212,175,55,0.2)", borderColor: "rgba(212,175,55,0.5)", color: "#f3d77a", fontWeight: 700 };
const icon: CSSProperties = { background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", padding: 0, display: "flex" };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", fontSize: 12, padding: "6px 8px 6px 26px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "#e6edf7", fontFamily: "inherit", outline: "none" };

export function BoundaryLibraryPanel({ lib, view, canEdit, onClose }: { lib: BoundaryLib; view: ZoneView; canEdit: boolean; onClose: () => void }) {
  const [countries, setCountries] = useState<BoundaryCountry[] | null>(null);
  const [catErr, setCatErr] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<BoundaryCountry | null>(null);
  const [openLayer, setOpenLayer] = useState<string | null>(null);
  const [uq, setUq] = useState("");
  useEffect(() => {
    boundaryCatalogue().then(setCountries, (e: Error) => setCatErr(e.message || "Could not load the list of countries."));
  }, []);
  const matches = useMemo(() => {
    if (!countries) return [];
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return countries.filter((c) => c.name.toLowerCase().includes(t) || c.iso.toLowerCase() === t).slice(0, 8);
  }, [countries, q]);
  const members = useMemo(() => membership(view), [view]);
  const section = (t: string) => <div style={{ fontSize: 10.5, letterSpacing: "0.14em", fontWeight: 800, margin: "12px 0 6px", color: "#e6edf7" }}>{t}</div>;
  const target = view.zones.find((z) => z.id === lib.pickZone);

  return (
    <div style={{ position: "absolute", left: 64, top: 70, zIndex: 640, width: 330, maxHeight: "calc(100% - 140px)", overflowY: "auto", background: "rgba(6,10,18,0.94)", border: "1px solid rgba(212,175,55,0.3)", borderRadius: 12, padding: "12px 14px", color: "#cbd5e1", fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Layers size={16} color="#d4af37" />
        <span style={{ flex: 1, fontSize: 12, letterSpacing: "0.14em", fontWeight: 800, color: "#e6edf7" }}>BOUNDARY LIBRARY</span>
        <button onClick={onClose} style={icon} aria-label="Close">
          <X size={15} />
        </button>
      </div>

      {canEdit && (
        <div style={{ marginTop: 10, padding: 9, borderRadius: 8, background: lib.pickZone ? "rgba(212,175,55,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${lib.pickZone ? "rgba(212,175,55,0.45)" : "rgba(255,255,255,0.1)"}`, lineHeight: 1.45 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 700, color: "#e6edf7" }}>Add areas to</span>
            <select value={lib.pickZone ?? ""} onChange={(e) => lib.setPickZone(e.target.value || null)} style={{ flex: 1, minWidth: 0, fontSize: 11.5, padding: "3px 4px", borderRadius: 5, background: "#0b1220", color: "#e6edf7", border: "1px solid rgba(255,255,255,0.2)" }}>
              <option value="">(choose a watch zone)</option>
              {view.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
            {lib.pickZone && (
              <button style={gold} onClick={() => lib.setPickZone(null)}>
                <Check size={12} /> Done
              </button>
            )}
          </div>
          <div style={{ marginTop: 5, fontSize: 11, opacity: 0.85 }}>
            {target ? (
              <>
                Click areas on the map to add them to <b style={{ color: view.colors[target.id] }}>{target.label}</b>; click one again to drop it. The zone redraws itself, and its news matching picks up the area names.
              </>
            ) : (
              <>Choose a zone, show a layer below, then click areas on the map. Or click any area to start a new zone from it.</>
            )}
          </div>
        </div>
      )}

      {section("ADD A LAYER")}
      <div style={{ position: "relative" }}>
        <Search size={13} style={{ position: "absolute", left: 8, top: 8, opacity: 0.6 }} />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPicked(null);
          }}
          placeholder={countries ? `Search ${countries.length} countries…` : catErr ? "Country list unavailable" : "Loading countries…"}
          style={input}
        />
      </div>
      {catErr && <div style={{ color: "#ff9a9a", marginTop: 4 }}>{catErr}</div>}
      {!picked && matches.length > 0 && (
        <div style={{ marginTop: 4, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 7, overflow: "hidden" }}>
          {matches.map((c) => (
            <button key={c.iso} onClick={() => setPicked(c)} style={{ ...small, display: "flex", width: "100%", borderRadius: 0, border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "transparent", justifyContent: "space-between" }}>
              <span>{c.name}</span>
              <span style={{ opacity: 0.55 }}>{c.iso}</span>
            </button>
          ))}
        </div>
      )}
      {picked && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: "#e6edf7", fontWeight: 700, marginBottom: 4 }}>{picked.name}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {picked.levels.map((lv) => {
              const on = lib.shown.some((x) => x.key === `${picked.iso}:${lv.level}`);
              return (
                <button key={lv.level} style={on ? gold : small} onClick={() => lib.add({ iso: picked.iso, level: lv.level, country: picked.name, canonical: levelName(lv.level, lv.canonical) })} title={`${lv.level}: ${lv.units} area${lv.units === 1 ? "" : "s"}`}>
                  {on ? <Check size={11} /> : <Plus size={11} />} {levelName(lv.level, lv.level === "ADM0" ? "Country" : lv.canonical)} <span style={{ opacity: 0.6 }}>{lv.units}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <button style={lib.shown.some((x) => x.iso === WORLD) ? gold : small} onClick={() => lib.add({ iso: WORLD, level: "ADM0", country: "World", canonical: "Countries" })}>
          <Plus size={11} /> All countries of the world
        </button>
      </div>

      {section("ON THE MAP")}
      {lib.shown.length === 0 && <div style={{ opacity: 0.7 }}>Nothing yet. Search a country and pick a level: country, states or provinces, districts, or lower.</div>}
      {lib.shown.map((l) => {
        const layer = lib.data[l.key];
        const st = lib.status[l.key];
        const open = openLayer === l.key;
        const t = uq.trim().toLowerCase();
        const units = open && layer ? layer.features.filter((f) => !t || f.properties.name.toLowerCase().includes(t)).slice(0, 200) : [];
        return (
          <div key={l.key} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <button onClick={() => lib.update(l.key, { visible: !l.visible })} style={icon} title={l.visible ? "Hide" : "Show"}>
                {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <input type="color" value={l.color} onChange={(e) => lib.update(l.key, { color: e.target.value })} title="Colour" style={{ width: 18, height: 16, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
              <button onClick={() => setOpenLayer(open ? null : l.key)} style={{ ...icon, flex: 1, textAlign: "left", color: "#e6edf7", fontWeight: 600, opacity: l.visible ? 1 : 0.5, fontSize: 12, display: "block" }} title="List its areas">
                {l.country} · {l.canonical} {layer && <span style={{ opacity: 0.55, fontWeight: 400 }}>({layer.features.length})</span>}
              </button>
              {layer && (
                <button onClick={() => downloadGeoJson(`${l.country}-${l.canonical}`, layer)} style={icon} title="Download (GeoJSON)">
                  <Download size={13} />
                </button>
              )}
              <button onClick={() => lib.remove(l.key)} style={icon} title="Remove from the map">
                <Trash2 size={13} />
              </button>
            </div>
            {st === "loading" && <div style={{ opacity: 0.7, marginLeft: 21 }}>Loading… (the first time a level is opened it is fetched and kept, which can take a few seconds)</div>}
            {st && st !== "loading" && <div style={{ color: "#ff9a9a", marginLeft: 21 }}>{st}</div>}
            {open && layer && (
              <div style={{ margin: "5px 0 0 21px" }}>
                <input value={uq} onChange={(e) => setUq(e.target.value)} placeholder="Find an area…" style={{ ...input, padding: "4px 7px" }} />
                <div style={{ maxHeight: 190, overflowY: "auto", marginTop: 4 }}>
                  {units.map((f) => {
                    const key = unitKey(layer.iso, layer.level, f.properties.id);
                    const m = members.get(key);
                    const inTarget = !!(lib.pickZone && m?.some((x) => x.id === lib.pickZone));
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                        {canEdit && lib.pickZone && <input type="checkbox" checked={inTarget} onChange={() => unitAction({ action: inTarget ? "remove" : "add", key, zoneId: lib.pickZone! })} title={inTarget ? "Drop from the zone" : "Add to the zone"} />}
                        <button
                          style={{ ...icon, flex: 1, textAlign: "left", color: "#e6edf7", fontSize: 11.5, display: "block" }}
                          onClick={() => {
                            const e = extentOf(f.geometry.type === "Polygon" ? { type: "MultiPolygon", coordinates: [f.geometry.coordinates] } : f.geometry);
                            if (e) lib.focus.current?.(e);
                          }}
                          title="Go to it"
                        >
                          {f.properties.name}
                        </button>
                        {m && <span style={{ width: 8, height: 8, borderRadius: 2, background: m[0].color }} title={`Part of ${m.map((x) => x.label).join(", ")}`} />}
                        {(() => {
                          const t = lib.drillTarget(key, f.properties.name, l.key);
                          return t ? (
                            <button style={icon} onClick={() => lib.drill(key, f.properties.name, l.key)} title={`Show ${t.label}`}>
                              <ChevronRight size={14} />
                            </button>
                          ) : null;
                        })()}
                      </div>
                    );
                  })}
                  {units.length === 200 && <div style={{ opacity: 0.6 }}>Showing the first 200; search to narrow.</div>}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {canEdit && view.retired.length > 0 && (
        <>
          {section("RETIRED WATCH ZONES")}
          {view.retired.map((o) => (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ flex: 1 }}>{o.label ?? o.id}</span>
              <button style={small} onClick={() => window.dispatchEvent(new CustomEvent<ZoneAction>("lens-zone-action", { detail: { id: o.id, action: "restore" } }))}>
                Bring back
              </button>
            </div>
          ))}
        </>
      )}

      <div style={{ marginTop: 12, fontSize: 10.5, opacity: 0.6, lineHeight: 1.4 }}>Boundaries: geoBoundaries (CC BY 4.0). Countries of the world: Natural Earth. Boundaries are shown for reference and imply no position on any dispute.</div>
    </div>
  );
}

/* ── Doing it: areas into zones and out again, new zones, and the zone edits that are not about drawing ────────── */

/** Coordinates to 3 decimals (about 100 m), repeated points dropped, for a compact zone. */
function compact(g: MultiPolygon | null): MultiPolygon | null {
  if (!g) return null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const coordinates = g.coordinates
    .map((poly) =>
      poly
        .map((ring) => {
          const out: Position[] = [];
          for (const [x, y] of ring) {
            const p = [r(x), r(y)];
            const last = out[out.length - 1];
            if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
          }
          return out;
        })
        .filter((ring) => ring.length >= 4)
    )
    .filter((poly) => poly.length > 0);
  return coordinates.length ? { type: "MultiPolygon", coordinates } : null;
}

/** An area, from whichever shown layer of its level holds it (the whole level, or a drilled-down part). */
function findArea(lib: BoundaryLib, iso: string, level: string, id: string) {
  for (const d of Object.values(lib.data)) {
    if (d.iso !== iso || d.level !== level) continue;
    const f = d.features.find((x) => x.properties.id === id);
    if (f) return f;
  }
  return null;
}

function unitFrom(key: string, lib: BoundaryLib): BoundaryUnit | null {
  const [iso, level, ...rest] = key.split(":");
  const id = rest.join(":");
  const f = findArea(lib, iso, level, id);
  if (!f) return null;
  // The plain name: it also becomes one of the zone's news search terms.
  return { key, iso, level, id, name: f.properties.name };
}

export function useZoneComposer({ view, lib, isAdmin, say, openLibrary }: { view: ZoneView; lib: BoundaryLib; isAdmin: boolean; say: (m: string) => void; openLibrary: () => void }) {
  const ref = useRef({ view, lib });
  ref.current = { view, lib };
  useEffect(() => {
    const fail = (e: unknown) => say(e instanceof Error ? e.message : "That did not work.");
    const done = (m: string) => {
      ref.current.view.reload();
      say(m);
    };

    /** Sets a zone's added areas, redrawing it from them (and its original area, unless dropped). */
    const setUnits = async (zoneId: string, units: BoundaryUnit[]) => {
      const { view: v } = ref.current;
      const z = v.zones.find((x) => x.id === zoneId);
      if (!z) return;
      const base = v.baseAreas[zoneId];
      if (!units.length && !base) {
        if (z.custom) {
          if (window.confirm(`That was the last area in ${z.label}. Delete the zone?`)) await api.deleteWatchZone(zoneId).then(() => done("Zone deleted."), fail);
          return;
        }
        if (!window.confirm(`That was the last area in ${z.label}. Bring back its original area?`)) return;
        await api.setWatchZoneOverride(zoneId, { units: [], unitsGeometry: null, baseDropped: false, bounds: null }).then(() => done("Original area back."), fail);
        return;
      }
      say("Redrawing the zone…");
      const ug = compact(await unitsGeometry(units));
      const whole = base && ug ? await joinShapes([...base.coordinates, ...ug.coordinates]) : (ug ?? base);
      await api.setWatchZoneOverride(zoneId, { units, unitsGeometry: ug, bounds: extentOf(whole ?? null) }).then(() => done(`${z.label}: ${units.length} added area${units.length === 1 ? "" : "s"}.`), fail);
    };

    const onUnit = (e: Event) => {
      const a = (e as CustomEvent<UnitAction>).detail;
      const { view: v, lib: l } = ref.current;
      const unit = unitFrom(a.key, l);
      if (!unit) return;
      if (a.action === "download") {
        const f = findArea(l, unit.iso, unit.level, unit.id);
        if (f) downloadGeoJson(unit.name, { type: "FeatureCollection", features: [f] });
        return;
      }
      if (!isAdmin) return;
      if (a.action === "add" && a.zoneId) {
        const cur = v.overrides[a.zoneId]?.units ?? [];
        if (!cur.some((u) => u.key === unit.key)) void setUnits(a.zoneId, [...cur, unit]).catch(fail);
      } else if (a.action === "remove" && a.zoneId) {
        void setUnits(a.zoneId, (v.overrides[a.zoneId]?.units ?? []).filter((u) => u.key !== unit.key)).catch(fail);
      } else if (a.action === "new") {
        const label = window.prompt("Name of the new watch zone", unit.name.toUpperCase());
        if (!label?.trim()) return;
        void (async () => {
          say("Making the zone…");
          const ug = compact(await unitsGeometry([unit]));
          const bounds = extentOf(ug);
          if (!ug || !bounds) throw new Error("Could not read that area's shape.");
          const r = await api.createWatchZone({ label: label.trim(), severity: "elevated", units: [unit], unitsGeometry: ug, bounds });
          ref.current.lib.setPickZone(r.id);
          openLibrary();
          done(`${label.trim().toUpperCase()} made. Click more areas to add them, then Done.`);
        })().catch(fail);
      }
    };

    const onZone = (e: Event) => {
      const a = (e as CustomEvent<ZoneAction>).detail;
      const { view: v } = ref.current;
      const z = v.zones.find((x) => x.id === a.id);
      const o = v.overrides[a.id];
      const label = z?.label ?? o?.label ?? "Zone";
      const set = (edit: Parameters<typeof api.setWatchZoneOverride>[1], msg: string) => void api.setWatchZoneOverride(a.id, edit).then(() => done(msg), fail);
      switch (a.action) {
        case "add-areas":
          ref.current.lib.setPickZone(a.id);
          openLibrary();
          say(`Show a layer (states, districts…) and click areas to add them to ${label}.`);
          break;
        case "severity":
          if (a.severity) set({ severity: a.severity }, `${label}: rating changed.`);
          break;
        case "rename": {
          const name = window.prompt("New name for the zone", label);
          if (name?.trim() && name.trim() !== label) set({ label: name.trim() }, "Zone renamed.");
          break;
        }
        case "retire":
          if (window.confirm(`Take ${label} off the map? It can be brought back from the Boundary library.`)) set({ retired: true }, `${label} retired.`);
          break;
        case "restore":
          set({ retired: false }, `${label} is back.`);
          break;
        case "delete":
          if (window.confirm(`Delete ${label}? This cannot be undone.`)) void api.deleteWatchZone(a.id).then(() => done("Zone deleted."), fail);
          break;
        case "drop-base": {
          const ug = o?.unitsGeometry ?? null;
          if (!ug) return say("Add an area first: a zone needs at least one area.");
          if (window.confirm(`Drop ${label}'s original area, keeping only the areas added to it?`)) set({ baseDropped: true, bounds: extentOf(ug) }, "Original area dropped.");
          break;
        }
        case "restore-base":
          set({ baseDropped: false, bounds: null }, "Original area back.");
          break;
        case "drop-unit":
          if (a.unit) void setUnits(a.id, (o?.units ?? []).filter((u) => u.key !== a.unit)).catch(fail);
          break;
      }
    };
    window.addEventListener("lens-unit-action", onUnit);
    if (isAdmin) window.addEventListener("lens-zone-action", onZone);
    return () => {
      window.removeEventListener("lens-unit-action", onUnit);
      window.removeEventListener("lens-zone-action", onZone);
    };
  }, [isAdmin, say, openLibrary]);
}
