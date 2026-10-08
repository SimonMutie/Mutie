import { useEffect, useRef } from "react";
import { Marker, type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import bbox from "@turf/bbox";
import type { SavedShape, ShapeStyle } from "../api";
import { circleRing, fmtArea, fmtLength, lineLengthM, ringAreaM2 } from "./geo";
import { markerHtml } from "./icons";
import { hasPattern, patternId, patternSvg, type PatternSpec } from "./patterns";
import { circleFeature, createShape, DEFAULT_ICON, DEFAULT_STYLE, placeIcon, saveGeometry, studio, useStudio, type Tool } from "./store";
import "./Studio.css";

/**
 * The Map Studio on the 3D globe (MapLibre). It draws the same shapes as the
 * flat map: patterns become tiled images, outlines are data-driven lines,
 * icons are HTML pins. The drawing tools and corner editing mirror StudioLayer.
 */

type Pos = [number, number];
const DRAW_TOOLS: Tool[] = ["polygon", "rectangle", "circle", "line", "freehand", "icon"];
const r6 = (n: number) => Number(n.toFixed(6));
const SRC = "studio-shapes";
const DRAFT = "studio-draft";
const DASH: Record<string, number[] | null> = { solid: null, dashed: [3, 2], dotted: [0.4, 2], dashdot: [4, 2, 0.4, 2] };
const dashKey = (d?: string | null) => (!d ? "solid" : d === "10 7" ? "dashed" : d === "2 6" ? "dotted" : "dashdot");
const STUDIO_LAYERS = ["studio-fill-solid", "studio-fill-pat", "studio-line-solid", "studio-line-dashed", "studio-line-dotted", "studio-line-dashdot", "studio-circle"];

function specOf(st: ShapeStyle): PatternSpec {
  return {
    key: (st.pattern as PatternSpec["key"]) ?? "solid",
    color: st.patternColor ?? st.color ?? "#38BDF8",
    size: Math.max(3, Math.round(st.patternSize ?? 10)),
    weight: st.patternWeight ?? 1.6,
    bg: st.fillColor ?? st.color ?? "#38BDF8",
    bgOpacity: st.fillOpacity ?? 0.3,
  };
}

function loadPattern(map: MapLibreMap, id: string, spec: PatternSpec) {
  const s = spec.size;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s * 2}" height="${s * 2}" viewBox="0 0 ${s} ${s}"><defs>${patternSvg(spec, id)}</defs><rect width="${s}" height="${s}" fill="url(#${id})"/></svg>`;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = s * 2;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, s * 2, s * 2);
    if (!map.hasImage(id)) map.addImage(id, ctx.getImageData(0, 0, s * 2, s * 2), { pixelRatio: 2 });
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const centre = (g: GeoJSON.Geometry | null): Pos | null => {
  if (!g) return null;
  const b = bbox(g);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
};

export function Studio3D({ map, shapes, active }: { map: MapLibreMap | null; shapes: SavedShape[]; active: boolean }) {
  const st = useStudio();
  const activeRef = useRef(active);
  activeRef.current = active;
  const toolRef = useRef<Tool>(st.tool);
  toolRef.current = st.tool;
  const shapeCount = useRef(0);
  shapeCount.current = shapes.length;
  const specs = useRef(new Map<string, PatternSpec>());
  const markers = useRef(new Map<string, { marker: Marker; sig: string; kind: "icon" | "label" }>());
  const live = useRef(new Map<string, GeoJSON.Geometry>()); // geometry being dragged, before it is saved
  const pushRef = useRef<() => void>(() => {});

  // ── Sources and layers ───────────────────────────────────────────────
  useEffect(() => {
    if (!map) return;
    const before = map.getLayer("osiris-points-circle") ? "osiris-points-circle" : undefined;
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    if (!map.getSource(SRC)) map.addSource(SRC, { type: "geojson", data: empty });
    if (!map.getSource(DRAFT)) map.addSource(DRAFT, { type: "geojson", data: empty });
    const add = (l: Parameters<MapLibreMap["addLayer"]>[0]) => {
      if (!map.getLayer(l.id)) map.addLayer(l, before);
    };
    add({ id: "studio-fill-solid", type: "fill", source: SRC, filter: ["all", ["==", ["geometry-type"], "Polygon"], ["!", ["has", "pat"]]], paint: { "fill-color": ["get", "fillColor"], "fill-opacity": ["get", "fillOpacity"] } });
    add({ id: "studio-fill-pat", type: "fill", source: SRC, filter: ["all", ["==", ["geometry-type"], "Polygon"], ["has", "pat"]], paint: { "fill-pattern": ["get", "pat"] } });
    for (const [k, arr] of Object.entries(DASH)) {
      add({
        id: `studio-line-${k}`, type: "line", source: SRC, filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "dash"], k]],
        layout: { "line-join": "round", "line-cap": arr ? "butt" : "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "weight"], "line-opacity": ["get", "strokeOpacity"], ...(arr ? { "line-dasharray": arr } : {}) },
      });
    }
    add({ id: "studio-sel", type: "line", source: SRC, filter: ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "_id"], ""]], paint: { "line-color": "#F0D060", "line-width": ["+", ["get", "weight"], 5], "line-opacity": 0.45, "line-blur": 2 } });
    add({ id: "studio-circle", type: "circle", source: SRC, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": ["get", "fillColor"], "circle-radius": 6, "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } });
    add({ id: "studio-draft-fill", type: "fill", source: DRAFT, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "fillColor"], "fill-opacity": 0.2 } });
    add({ id: "studio-draft-line", type: "line", source: DRAFT, filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-dasharray": [2, 1.5] } });
    add({ id: "studio-draft-pts", type: "circle", source: DRAFT, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": ["case", ["==", ["get", "first"], 1], "#ffffff", "#F0D060"], "circle-radius": ["case", ["==", ["get", "first"], 1], 7, 4.5], "circle-stroke-color": "#D4AF37", "circle-stroke-width": 2 } });

    const missing = (e: { id: string }) => {
      const spec = specs.current.get(e.id);
      if (spec) loadPattern(map, e.id, spec);
    };
    map.on("styleimagemissing", missing);
    return () => {
      map.off("styleimagemissing", missing);
      for (const m of markers.current.values()) m.marker.remove();
      markers.current.clear();
      try {
        for (const id of ["studio-draft-pts", "studio-draft-line", "studio-draft-fill", "studio-circle", "studio-sel", ...[...Object.keys(DASH)].map((k) => `studio-line-${k}`), "studio-fill-pat", "studio-fill-solid"]) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of [DRAFT, SRC]) if (map.getSource(id)) map.removeSource(id);
      } catch {
        /* the map is already gone */
      }
    };
  }, [map]);

  // ── Shapes onto the map ──────────────────────────────────────────────
  function push() {
    if (!map) return;
    const feats: GeoJSON.Feature[] = [];
    const wanted = new Set<string>();
    const overrides = studio.get().overrides;
    const selected = studio.get().selectedId;
    for (const s of shapes) {
      if (!s.visible) continue;
      const o = overrides[s.id] ?? {};
      const { name: nameOver, ...styleOver } = o;
      const eff: ShapeStyle = { ...DEFAULT_STYLE, ...s.style, ...styleOver };
      const name = nameOver ?? s.name;
      const raw = s.geometry.type === "FeatureCollection" ? s.geometry.features : [s.geometry];
      const patterned = hasPattern(eff.pattern);
      let pat: string | undefined;
      if (patterned) {
        const spec = specOf(eff);
        pat = patternId(spec);
        specs.current.set(pat, spec);
        if (!map.hasImage(pat)) loadPattern(map, pat, spec);
      }
      const props = {
        _id: s.id, color: eff.color ?? "#38BDF8", fillColor: eff.fillColor ?? eff.color ?? "#38BDF8", fillOpacity: eff.pattern === "none" ? 0 : eff.fillOpacity ?? 0.3,
        weight: eff.weight ?? 2.5, strokeOpacity: eff.strokeOpacity ?? 1, dash: dashKey(eff.dashArray), ...(pat ? { pat } : {}),
      };
      for (const f of raw) {
        const geom = live.current.get(s.id) ?? f.geometry;
        if (!geom) continue;
        const isIcon = geom.type === "Point" && (!!eff.icon || s.source === "icon");
        if (isIcon && raw.length === 1) {
          const key = `${s.id}`;
          wanted.add(key);
          const lng = (geom as GeoJSON.Point).coordinates[0], lat = (geom as GeoJSON.Point).coordinates[1];
          const size = eff.iconSize ?? 38;
          const html = markerHtml({ icon: eff.icon ?? "pin", color: eff.iconColor, size, label: eff.labelOn !== false ? eff.label || name : "", selected: selected === s.id });
          const sig = `${html}|${selected === s.id && activeRef.current}`;
          let m = markers.current.get(key);
          if (!m) {
            const el = document.createElement("div");
            el.className = "studio-icon";
            el.style.cursor = "pointer";
            el.addEventListener("click", (ev) => {
              if (activeRef.current && toolRef.current === "select") {
                ev.stopPropagation();
                studio.select(s.id);
              }
            });
            const marker = new Marker({ element: el, anchor: "bottom", draggable: false }).setLngLat([lng, lat]).addTo(map);
            marker.on("dragend", () => {
              const ll = marker.getLngLat();
              void saveGeometry(s.id, { type: "Feature", properties: (s.geometry as GeoJSON.Feature).properties ?? {}, geometry: { type: "Point", coordinates: [r6(ll.lng), r6(ll.lat)] } });
            });
            m = { marker, sig: "", kind: "icon" };
            markers.current.set(key, m);
          }
          if (m.sig !== sig) {
            m.marker.getElement().innerHTML = html;
            m.marker.setDraggable(selected === s.id && activeRef.current);
            m.sig = sig;
          }
          if (!m.marker.isDraggable?.() || selected !== s.id) m.marker.setLngLat([lng, lat]);
          continue;
        }
        feats.push({ type: "Feature", properties: props, geometry: geom });
      }
      // A label for areas and lines, sitting at the middle of the shape.
      if (eff.labelOn && !(raw.length === 1 && raw[0].geometry?.type === "Point" && (eff.icon || s.source === "icon"))) {
        const c = centre(live.current.get(s.id) ?? (raw[0]?.geometry ?? null));
        if (c) {
          const key = `${s.id}:label`;
          wanted.add(key);
          let m = markers.current.get(key);
          if (!m) {
            const el = document.createElement("div");
            el.className = "studio-poly-label";
            m = { marker: new Marker({ element: el }).setLngLat(c).addTo(map), sig: "", kind: "label" };
            markers.current.set(key, m);
          }
          const text = eff.label || name;
          if (m.sig !== text) {
            m.marker.getElement().textContent = text;
            m.sig = text;
          }
          m.marker.setLngLat(c);
        }
      }
    }
    for (const [k, m] of markers.current) {
      if (!wanted.has(k)) {
        m.marker.remove();
        markers.current.delete(k);
      }
    }
    (map.getSource(SRC) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: feats });
    if (map.getLayer("studio-sel")) map.setFilter("studio-sel", ["all", ["!=", ["geometry-type"], "Point"], ["==", ["get", "_id"], selected ?? ""]]);
  }
  pushRef.current = push;
  useEffect(() => {
    push();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, shapes, st.overrides, st.selectedId, active]);

  // ── Fly to a shape ───────────────────────────────────────────────────
  useEffect(() => {
    if (!map || !st.zoom) return;
    const s = shapes.find((x) => x.id === st.zoom!.id);
    if (!s) return;
    const b = bbox(s.geometry);
    if (b[0] === b[2] && b[1] === b[3]) map.flyTo({ center: [b[0], b[1]], zoom: Math.max(map.getZoom(), 9) });
    else map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 12, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.zoom]);

  // ── Selecting by click, and files dropped on the map ─────────────────
  useEffect(() => {
    if (!map || !active) return;
    const onClick = (e: MapMouseEvent) => {
      if (toolRef.current !== "select") return;
      const box: [[number, number], [number, number]] = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
      const layers = STUDIO_LAYERS.filter((l) => map.getLayer(l));
      const hit = map.queryRenderedFeatures(box, { layers })[0];
      studio.select((hit?.properties?._id as string | undefined) ?? null);
    };
    map.on("click", onClick);
    const el = map.getContainer();
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      studio.set({ dropped: Array.from(e.dataTransfer.files) });
    };
    el.addEventListener("dragover", over);
    el.addEventListener("drop", drop);
    return () => {
      map.off("click", onClick);
      el.removeEventListener("dragover", over);
      el.removeEventListener("drop", drop);
    };
  }, [map, active]);

  // ── Drawing ──────────────────────────────────────────────────────────
  useEffect(() => {
    const tool = st.tool;
    if (!map || !active || !DRAW_TOOLS.includes(tool)) return;
    const draft = studio.get().draft;
    const col = draft.color ?? "#38BDF8";
    const fillCol = draft.fillColor ?? col;
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";
    map.doubleClickZoom.disable();
    if (tool === "freehand") map.dragPan.disable();
    const tip = document.createElement("div");
    tip.className = "studio-tip3d";
    tip.style.display = "none";
    map.getContainer().appendChild(tip);
    const showTip = (e: MapMouseEvent, text: string) => {
      tip.textContent = text;
      tip.style.display = text ? "block" : "none";
      tip.style.left = `${e.point.x + 16}px`;
      tip.style.top = `${e.point.y + 8}px`;
    };

    let pts: Pos[] = [];
    let anchor: Pos | null = null;
    let freehand = false;
    let lastClick = 0;
    let ghost: Marker | null = null;

    const setDraft = (geoms: { g: GeoJSON.Geometry; first?: boolean }[]) =>
      (map.getSource(DRAFT) as GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection",
        features: geoms.map((x) => ({ type: "Feature", properties: { color: col, fillColor: fillCol, first: x.first ? 1 : 0 }, geometry: x.g })),
      });
    const clear = () => {
      pts = [];
      anchor = null;
      freehand = false;
      setDraft([]);
      tip.style.display = "none";
    };
    const done = async (feature: GeoJSON.Feature, base: string) => {
      clear();
      const row = await createShape(feature, { name: `${base} ${shapeCount.current + 1}`, style: { ...studio.get().draft }, source: "drawn" });
      if (row) studio.set({ tool: "select", selectedId: row.id });
    };
    const text = (list: Pos[], closed: boolean) => {
      if (closed && list.length >= 3) return `${fmtArea(ringAreaM2([...list, list[0]]))} · ${fmtLength(lineLengthM([...list, list[0]]))}`;
      return list.length >= 2 ? fmtLength(lineLengthM(list)) : "";
    };
    const redraw = (cursor?: Pos, e?: MapMouseEvent) => {
      const path = cursor ? [...pts, cursor] : pts;
      const g: { g: GeoJSON.Geometry; first?: boolean }[] = [];
      if (path.length >= 3 && tool !== "line") g.push({ g: { type: "Polygon", coordinates: [[...path, path[0]]] } });
      else if (path.length >= 2) g.push({ g: { type: "LineString", coordinates: path } });
      pts.forEach((p, i) => g.push({ g: { type: "Point", coordinates: p }, first: i === 0 && tool === "polygon" }));
      setDraft(g);
      if (e) showTip(e, text(path, tool !== "line"));
    };
    const finishPath = () => {
      if (tool === "line" && pts.length >= 2) void done({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } }, "Line");
      else if (tool === "polygon" && pts.length >= 3) void done({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } }, "Area");
    };
    const at = (e: MapMouseEvent): Pos => [r6(e.lngLat.lng), r6(e.lngLat.lat)];
    const dist = (a: Pos, b: Pos) => lineLengthM([a, b]);

    const onClick = (e: MapMouseEvent) => {
      const p = at(e);
      if (tool === "icon") {
        void placeIcon(p[0], p[1]);
        return;
      }
      if (tool === "polygon" || tool === "line") {
        const now = Date.now();
        if (pts.length && dist(pts[pts.length - 1], p) < 1 && now - lastClick < 600) return;
        lastClick = now;
        if (tool === "polygon" && pts.length >= 3) {
          const f = map.project(pts[0]);
          if (Math.hypot(f.x - e.point.x, f.y - e.point.y) < 12) return finishPath();
        }
        pts.push(p);
        redraw(p, e);
      } else if (tool === "rectangle") {
        if (!anchor) anchor = p;
        else {
          const [w, s, ea, n] = [Math.min(anchor[0], p[0]), Math.min(anchor[1], p[1]), Math.max(anchor[0], p[0]), Math.max(anchor[1], p[1])];
          if (w === ea || s === n) return;
          void done({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [ea, s], [ea, n], [w, n], [w, s]]] } }, "Rectangle");
        }
      } else if (tool === "circle") {
        if (!anchor) anchor = p;
        else {
          const r = dist(anchor, p);
          if (r < 1) return;
          void done(circleFeature(anchor[0], anchor[1], r), "Circle");
        }
      }
    };
    const onMove = (e: MapMouseEvent) => {
      const p = at(e);
      if (tool === "icon") {
        const d = studio.get().iconDraft;
        if (!ghost) {
          const el = document.createElement("div");
          el.className = "studio-icon";
          el.style.opacity = "0.65";
          el.style.pointerEvents = "none";
          el.innerHTML = markerHtml({ icon: d.icon, color: d.iconColor, size: d.iconSize ?? DEFAULT_ICON.iconSize ?? 38 });
          ghost = new Marker({ element: el, anchor: "bottom" }).setLngLat(p).addTo(map);
        }
        ghost.setLngLat(p);
        return;
      }
      if (tool === "polygon" || tool === "line") {
        if (pts.length) redraw(p, e);
      } else if (tool === "rectangle" && anchor) {
        const [w, s, ea, n] = [Math.min(anchor[0], p[0]), Math.min(anchor[1], p[1]), Math.max(anchor[0], p[0]), Math.max(anchor[1], p[1])];
        const ring: Pos[] = [[w, s], [ea, s], [ea, n], [w, n]];
        setDraft([{ g: { type: "Polygon", coordinates: [[...ring, ring[0]]] } }]);
        showTip(e, text(ring, true));
      } else if (tool === "circle" && anchor) {
        const r = dist(anchor, p);
        if (r > 0) setDraft([{ g: { type: "Polygon", coordinates: [circleRing(anchor[0], anchor[1], r)] } }]);
        showTip(e, `r ${fmtLength(r)} · ${fmtArea(Math.PI * r * r)}`);
      } else if (tool === "freehand" && freehand) {
        const last = pts[pts.length - 1];
        const lp = last ? map.project(last) : null;
        if (!lp || Math.hypot(lp.x - e.point.x, lp.y - e.point.y) > 5) {
          pts.push(p);
          if (pts.length >= 3) setDraft([{ g: { type: "Polygon", coordinates: [[...pts, pts[0]]] } }]);
          showTip(e, text(pts, true));
        }
      }
    };
    const onDown = (e: MapMouseEvent) => {
      if (tool !== "freehand") return;
      freehand = true;
      pts = [at(e)];
    };
    const onUp = () => {
      if (tool !== "freehand" || !freehand) return;
      freehand = false;
      if (pts.length >= 4) void done({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } }, "Freehand area");
      else clear();
    };
    const onDbl = (e: MapMouseEvent) => {
      e.preventDefault();
      finishPath();
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Enter") finishPath();
      else if (e.key === "Escape") {
        if (pts.length || anchor) clear();
        else studio.set({ tool: "select" });
      } else if (e.key === "Backspace" || (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey))) {
        if (pts.length) {
          e.preventDefault();
          pts.pop();
          redraw();
        }
      }
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    map.on("mousedown", onDown);
    map.on("mouseup", onUp);
    map.on("dblclick", onDbl);
    window.addEventListener("keydown", onKey);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("mousedown", onDown);
      map.off("mouseup", onUp);
      map.off("dblclick", onDbl);
      window.removeEventListener("keydown", onKey);
      canvas.style.cursor = "";
      map.doubleClickZoom.enable();
      map.dragPan.enable();
      ghost?.remove();
      tip.remove();
      setDraft([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.tool, active, map]);

  // ── Reshape the selected polygon or line ─────────────────────────────
  const selShape = active && st.tool === "select" && st.selectedId ? shapes.find((s) => s.id === st.selectedId) : undefined;
  const sig = selShape ? `${selShape.id}|${selShape.updated_at}` : "";
  useEffect(() => {
    if (!map || !selShape || selShape.geometry.type !== "Feature") return;
    const feature = selShape.geometry;
    const geom = feature.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "LineString")) return;
    const isPoly = geom.type === "Polygon";
    let rings: Pos[][] = isPoly ? (geom.coordinates as Pos[][]).map((r) => r.slice(0, -1) as Pos[]) : [geom.coordinates as Pos[]];
    const min = isPoly ? 3 : 2;
    if (rings.reduce((a, r) => a + r.length, 0) > 600) return;
    const handles: Marker[] = [];
    const id = selShape.id;
    const current = (): GeoJSON.Geometry => ({ type: geom.type, coordinates: isPoly ? rings.map((r) => [...r, r[0]]) : rings[0] } as GeoJSON.Geometry);
    const persist = () => void saveGeometry(id, { ...feature, geometry: current() });
    const show = () => {
      live.current.set(id, current());
      pushRef.current();
    };
    const clearHandles = () => {
      handles.forEach((h) => h.remove());
      handles.length = 0;
    };
    const el = (cls: string, size: number) => {
      const d = document.createElement("div");
      d.className = cls;
      d.style.width = d.style.height = `${size}px`;
      return d;
    };
    const render = () => {
      clearHandles();
      rings.forEach((ring, ri) => {
        ring.forEach((p, i) => {
          const m = new Marker({ element: el("studio-vh", 14), draggable: true }).setLngLat(p).addTo(map);
          m.on("drag", () => {
            const ll = m.getLngLat();
            ring[i] = [r6(ll.lng), r6(ll.lat)];
            show();
          });
          m.on("dragend", () => {
            persist();
            render();
          });
          const remove = () => {
            if (ring.length <= min) return;
            ring.splice(i, 1);
            show();
            persist();
            render();
          };
          m.getElement().addEventListener("dblclick", (ev) => (ev.stopPropagation(), remove()));
          m.getElement().addEventListener("contextmenu", (ev) => (ev.preventDefault(), remove()));
          handles.push(m);
        });
        const edges = isPoly ? ring.length : ring.length - 1;
        for (let i = 0; i < edges; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const mid: Pos = [r6((a[0] + b[0]) / 2), r6((a[1] + b[1]) / 2)];
          const e = el("studio-mh", 9);
          e.addEventListener("click", (ev) => {
            ev.stopPropagation();
            rings = rings.map((r, k) => (k === ri ? [...r.slice(0, i + 1), mid, ...r.slice(i + 1)] : r));
            show();
            persist();
            render();
          });
          handles.push(new Marker({ element: e }).setLngLat(mid).addTo(map));
        }
      });
    };
    render();
    return () => {
      clearHandles();
      live.current.delete(id);
      pushRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);

  return null;
}
