import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { SavedShape, ShapeStyle } from "../api";
import { fmtArea, fmtLength, lineLengthM, ringAreaM2 } from "./geo";
import { markerHtml } from "./icons";
import { hasPattern, patternId, patternSvg, type PatternSpec } from "./patterns";
import { circleFeature, createShape, DEFAULT_ICON, DEFAULT_STYLE, placeIcon, saveGeometry, studio, useStudio, type Tool } from "./store";
import "./Studio.css";

type Pos = [number, number];
type Anyf = any; // Leaflet's private fields (_path, _container) are not in its types.

const DRAW_TOOLS: Tool[] = ["polygon", "rectangle", "circle", "line", "freehand", "icon"];
const r6 = (n: number) => Number(n.toFixed(6));
const toPos = (ll: L.LatLng): Pos => [r6(ll.lng), r6(ll.lat)];
const toLL = (p: number[]): L.LatLngTuple => [p[1], p[0]];

/** The style a shape is drawn with: defaults, then what was saved, then edits not yet saved. */
function effective(s: SavedShape, over?: Partial<ShapeStyle> & { name?: string }): ShapeStyle & { name: string } {
  const { name, ...st } = over ?? {};
  return { ...DEFAULT_STYLE, ...s.style, ...st, name: name ?? s.name };
}

function specOf(st: ShapeStyle): PatternSpec {
  return {
    key: (st.pattern as PatternSpec["key"]) ?? "solid",
    color: st.patternColor ?? st.color ?? "#38BDF8",
    size: st.patternSize ?? 10,
    weight: st.patternWeight ?? 1.6,
    bg: st.fillColor ?? st.color ?? "#38BDF8",
    bgOpacity: st.fillOpacity ?? 0.3,
  };
}

interface Entry {
  sig: string;
  layer: L.GeoJSON | L.Marker;
  shape: SavedShape;
}

export function StudioLayer({ shapes, active }: { shapes: SavedShape[]; active: boolean }) {
  const map = useMap();
  const st = useStudio();
  const entries = useRef(new Map<string, Entry>());
  const activeRef = useRef(active);
  activeRef.current = active;
  const toolRef = useRef<Tool>(st.tool);
  toolRef.current = st.tool;
  const rendererRef = useRef<L.SVG | null>(null);
  const finishRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});
  const shapeCount = useRef(0);
  shapeCount.current = shapes.length;

  if (!rendererRef.current) rendererRef.current = L.svg({ padding: 0.5 });
  const renderer = rendererRef.current;

  // ── Pattern definitions live inside the renderer's SVG ───────────────
  const defined = useRef(new Set<string>());
  function ensurePattern(spec: PatternSpec): string | null {
    const svg: SVGSVGElement | undefined = (renderer as Anyf)._container;
    if (!svg) return null;
    const id = patternId(spec);
    let defs = svg.querySelector("defs.studio-defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.setAttribute("class", "studio-defs");
      svg.insertBefore(defs, svg.firstChild);
      defined.current.clear();
    }
    if (!defined.current.has(id) || !svg.querySelector(`#${id}`)) {
      const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      holder.innerHTML = patternSvg(spec, id);
      const el = holder.firstElementChild;
      if (el) defs.appendChild(el);
      defined.current.add(id);
    }
    return id;
  }

  function paint(p: L.Path, style: ShapeStyle, selected: boolean) {
    const spec = specOf(style);
    const patterned = hasPattern(style.pattern);
    p.setStyle({
      color: style.color,
      weight: style.weight,
      opacity: style.strokeOpacity ?? 1,
      dashArray: style.dashArray ?? undefined,
      lineJoin: "round",
      fill: style.pattern !== "none",
      fillColor: style.fillColor ?? style.color,
      fillOpacity: patterned ? 1 : style.fillOpacity,
    });
    const el: SVGElement | undefined = (p as Anyf)._path;
    if (!el) return;
    if (patterned && p instanceof L.Polygon) {
      const id = ensurePattern(spec);
      if (id) el.setAttribute("fill", `url(#${id})`);
    }
    el.classList.toggle("studio-selected", selected);
  }

  function pinIcon(style: ShapeStyle, label: string, selected: boolean) {
    const size = style.iconSize ?? 38;
    return L.divIcon({
      className: "studio-icon",
      html: markerHtml({ icon: style.icon, color: style.iconColor, size, label: style.labelOn !== false ? style.label || label : "", selected }),
      iconSize: [size, size + 10],
      iconAnchor: [size / 2, size + 8],
    });
  }

  function apply(e: Entry, over: Partial<ShapeStyle> & { name?: string } | undefined, selected: boolean) {
    const eff = effective(e.shape, over);
    const label = eff.label || eff.name;
    if (e.layer instanceof L.Marker) {
      e.layer.setIcon(pinIcon(eff, eff.name, selected));
      e.layer.setZIndexOffset(selected ? 1000 : 0);
      if (selected && activeRef.current) e.layer.dragging?.enable();
      else e.layer.dragging?.disable();
      return;
    }
    e.layer.eachLayer((l) => {
      if (l instanceof L.Marker) {
        l.setIcon(pinIcon({ ...eff, icon: eff.icon ?? "pin" }, eff.name, selected));
      } else if (l instanceof L.Path) {
        paint(l, eff, selected);
        l.off("add.studio");
        l.on("add.studio", () => paint(l, eff, selected));
      }
    });
    e.layer.unbindTooltip();
    if (eff.labelOn && label) e.layer.bindTooltip(label, { permanent: true, direction: "center", className: "studio-label" });
    else e.layer.bindTooltip(eff.name, { sticky: true, direction: "top", className: "studio-label" });
  }

  function build(s: SavedShape): Entry | null {
    const g = s.geometry;
    const first = g.type === "Feature" ? g.geometry : null;
    const onClick = (ev: L.LeafletMouseEvent) => {
      if (!activeRef.current || toolRef.current !== "select") return;
      L.DomEvent.stopPropagation(ev);
      studio.select(s.id);
    };
    if (g.type === "Feature" && first?.type === "Point" && (s.style.icon || s.source === "icon")) {
      const m = L.marker(toLL(first.coordinates), { icon: pinIcon({ ...DEFAULT_ICON, ...s.style }, s.name, false), draggable: false, riseOnHover: true, bubblingMouseEvents: false });
      m.on("click", onClick);
      m.on("dragend", () => {
        const ll = m.getLatLng();
        void saveGeometry(s.id, { ...(g as GeoJSON.Feature), geometry: { type: "Point", coordinates: toPos(ll) } });
      });
      return { sig: "", layer: m, shape: s };
    }
    try {
      const layer = L.geoJSON(g, {
        renderer,
        pointToLayer: (_f, ll) => L.circleMarker(ll, { renderer, radius: 6 }),
        bubblingMouseEvents: false,
      } as L.GeoJSONOptions);
      layer.eachLayer((l) => l.on("click", onClick as L.LeafletEventHandlerFn));
      return { sig: "", layer, shape: s };
    } catch {
      return null;
    }
  }

  // ── Show the saved shapes ────────────────────────────────────────────
  useEffect(() => {
    const live = new Set<string>();
    for (const s of shapes) {
      if (!s.visible) continue;
      live.add(s.id);
      const sig = `${s.updated_at}|${s.visible}`;
      let e = entries.current.get(s.id);
      if (e && e.sig !== sig) {
        map.removeLayer(e.layer);
        entries.current.delete(s.id);
        e = undefined;
      }
      if (!e) {
        const made = build(s);
        if (!made) continue;
        made.sig = sig;
        entries.current.set(s.id, made);
        made.layer.addTo(map);
        e = made;
      }
      e.shape = s;
      apply(e, st.overrides[s.id], st.selectedId === s.id);
    }
    for (const [id, e] of entries.current) {
      if (!live.has(id)) {
        map.removeLayer(e.layer);
        entries.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, st.overrides, st.selectedId, active, map]);

  useEffect(
    () => () => {
      for (const e of entries.current.values()) map.removeLayer(e.layer);
      entries.current.clear();
    },
    [map]
  );

  // ── Fly to a shape ───────────────────────────────────────────────────
  useEffect(() => {
    if (!st.zoom) return;
    const e = entries.current.get(st.zoom.id);
    if (!e) return;
    if (e.layer instanceof L.Marker) map.flyTo(e.layer.getLatLng(), Math.max(map.getZoom(), 12));
    else {
      const b = e.layer.getBounds();
      if (b.isValid()) map.flyToBounds(b, { padding: [60, 60], maxZoom: 16 });
    }
  }, [st.zoom, map]);

  // The panel's Finish and Cancel buttons.
  useEffect(() => {
    if (!st.command) return;
    if (st.command.kind === "finish") finishRef.current();
    else cancelRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.command]);

  // ── Click on empty map clears the selection; files dropped on the map are imported ──
  useEffect(() => {
    if (!active) return;
    const onClick = () => {
      if (toolRef.current === "select") studio.select(null);
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
  }, [active, map]);

  // ── Drawing ──────────────────────────────────────────────────────────
  useEffect(() => {
    const tool = st.tool;
    if (!active || !DRAW_TOOLS.includes(tool)) return;
    const container = map.getContainer();
    container.classList.add("studio-drawing");
    map.doubleClickZoom.disable();
    const draft = studio.get().draft;
    const col = draft.color ?? "#38BDF8";
    const group = L.layerGroup().addTo(map);
    const tip = L.tooltip({ permanent: true, direction: "right", offset: [16, 0], className: "studio-measure", opacity: 1 });
    let tipOn = false;
    const showTip = (ll: L.LatLng, text: string) => {
      tip.setLatLng(ll).setContent(text);
      if (!tipOn) {
        tip.addTo(map);
        tipOn = true;
      }
    };
    const hideTip = () => {
      if (tipOn) {
        map.removeLayer(tip);
        tipOn = false;
      }
    };
    const dashed: L.PathOptions = { color: col, weight: 2.5, dashArray: "7 6", fillColor: draft.fillColor ?? col, fillOpacity: 0.18, interactive: false };

    let pts: L.LatLng[] = [];
    let anchor: L.LatLng | null = null; // rectangle corner / circle centre
    let freehand = false;
    let preview: L.Path | null = null;
    let ghost: L.Marker | null = null;
    let dots: L.CircleMarker[] = [];
    let lastClick = 0;

    const clear = () => {
      group.clearLayers();
      preview = null;
      dots = [];
      pts = [];
      anchor = null;
      freehand = false;
      hideTip();
    };
    const nameFor = (base: string) => `${base} ${shapeCount.current + 1}`;
    const done = async (feature: GeoJSON.Feature, base: string) => {
      clear();
      const row = await createShape(feature, { name: nameFor(base), style: { ...studio.get().draft }, source: "drawn" });
      if (row) studio.set({ tool: "select", selectedId: row.id });
    };

    const measureText = (list: L.LatLng[], closed: boolean): string => {
      const ring = list.map((p) => [p.lng, p.lat] as Pos);
      if (closed && ring.length >= 3) return `${fmtArea(ringAreaM2([...ring, ring[0]]))} · ${fmtLength(lineLengthM([...ring, ring[0]]))}`;
      return ring.length >= 2 ? fmtLength(lineLengthM(ring)) : "";
    };

    const redraw = (cursor?: L.LatLng) => {
      const path = cursor ? [...pts, cursor] : pts;
      if (preview) group.removeLayer(preview);
      preview = null;
      if (path.length >= 2) {
        const next: L.Path = tool === "line" || path.length < 3 ? L.polyline(path, dashed) : L.polygon(path, dashed);
        next.addTo(group);
        preview = next;
      }
      if (cursor) showTip(cursor, measureText(path, tool !== "line"));
    };

    const finishPath = () => {
      if (tool === "line" && pts.length >= 2) {
        void done({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts.map(toPos) } }, "Line");
      } else if (tool === "polygon" && pts.length >= 3) {
        const ring = pts.map(toPos);
        void done({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } }, "Area");
      }
    };

    finishRef.current = finishPath;
    cancelRef.current = clear;
    const onClick = (e: L.LeafletMouseEvent) => {
      if (tool === "icon") {
        void placeIcon(e.latlng.lng, e.latlng.lat);
        return;
      }
      if (tool === "polygon" || tool === "line") {
        const now = Date.now();
        // A double-click arrives as two clicks; the second is the finishing gesture, not a new vertex.
        if (pts.length && pts[pts.length - 1].distanceTo(e.latlng) < 1 && now - lastClick < 600) return;
        lastClick = now;
        if (tool === "polygon" && pts.length >= 3 && map.latLngToContainerPoint(pts[0]).distanceTo(e.containerPoint) < 12) {
          finishPath();
          return;
        }
        pts.push(e.latlng);
        const first = pts.length === 1 && tool === "polygon";
        const dot = L.circleMarker(e.latlng, { radius: first ? 7 : 4.5, color: first ? "#D4AF37" : "#0b1020", weight: 2, fillColor: first ? "#fff" : "#F0D060", fillOpacity: 1, interactive: false }).addTo(group);
        dots.push(dot);
        redraw(e.latlng);
      } else if (tool === "rectangle") {
        if (!anchor) {
          anchor = e.latlng;
        } else {
          const b = L.latLngBounds(anchor, e.latlng);
          const sw = b.getSouthWest(), ne = b.getNorthEast();
          if (sw.equals(ne)) return;
          const ring: Pos[] = [toPos(sw), toPos(L.latLng(sw.lat, ne.lng)), toPos(ne), toPos(L.latLng(ne.lat, sw.lng)), toPos(sw)];
          void done({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }, "Rectangle");
        }
      } else if (tool === "circle") {
        if (!anchor) {
          anchor = e.latlng;
        } else {
          const r = anchor.distanceTo(e.latlng);
          if (r < 1) return;
          void done(circleFeature(anchor.lng, anchor.lat, r), "Circle");
        }
      }
    };

    const onMove = (e: L.LeafletMouseEvent) => {
      if (tool === "icon") {
        const d = studio.get().iconDraft;
        if (!ghost) {
          ghost = L.marker(e.latlng, { interactive: false, opacity: 0.65, icon: L.divIcon({ className: "studio-icon", html: markerHtml({ icon: d.icon, color: d.iconColor, size: d.iconSize ?? 38 }), iconSize: [d.iconSize ?? 38, (d.iconSize ?? 38) + 10], iconAnchor: [(d.iconSize ?? 38) / 2, (d.iconSize ?? 38) + 8] }) }).addTo(group);
        }
        ghost.setLatLng(e.latlng);
        return;
      }
      if (tool === "polygon" || tool === "line") {
        if (pts.length) redraw(e.latlng);
      } else if (tool === "rectangle" && anchor) {
        if (preview) group.removeLayer(preview);
        const b = L.latLngBounds(anchor, e.latlng);
        preview = L.rectangle(b, dashed).addTo(group);
        const w = anchor.distanceTo(L.latLng(anchor.lat, e.latlng.lng));
        const h = anchor.distanceTo(L.latLng(e.latlng.lat, anchor.lng));
        showTip(e.latlng, `${fmtArea(w * h)} · ${fmtLength(2 * (w + h))}`);
      } else if (tool === "circle" && anchor) {
        if (preview) group.removeLayer(preview);
        const r = anchor.distanceTo(e.latlng);
        preview = L.circle(anchor, { ...dashed, radius: r }).addTo(group);
        showTip(e.latlng, `r ${fmtLength(r)} · ${fmtArea(Math.PI * r * r)}`);
      } else if (tool === "freehand" && freehand) {
        const last = pts[pts.length - 1];
        if (!last || map.latLngToContainerPoint(last).distanceTo(e.containerPoint) > 5) {
          pts.push(e.latlng);
          if (preview) group.removeLayer(preview);
          preview = L.polygon(pts, dashed).addTo(group);
          showTip(e.latlng, measureText(pts, true));
        }
      }
    };

    const onDown = (e: L.LeafletMouseEvent) => {
      if (tool !== "freehand") return;
      freehand = true;
      pts = [e.latlng];
    };
    const onUp = () => {
      if (tool !== "freehand" || !freehand) return;
      freehand = false;
      if (pts.length >= 4) {
        const ring = pts.map(toPos);
        void done({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } }, "Freehand area");
      } else clear();
    };
    const onDbl = () => finishPath();
    const onOut = () => {
      if (ghost) {
        group.removeLayer(ghost);
        ghost = null;
      }
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
          const d = dots.pop();
          if (d) group.removeLayer(d);
          redraw();
          if (!pts.length) hideTip();
        }
      }
    };

    if (tool === "freehand") map.dragging.disable();
    map.on("click", onClick);
    map.on("mousemove", onMove);
    map.on("mousedown", onDown);
    map.on("mouseup", onUp);
    map.on("dblclick", onDbl);
    map.on("mouseout", onOut);
    window.addEventListener("keydown", onKey);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("mousedown", onDown);
      map.off("mouseup", onUp);
      map.off("dblclick", onDbl);
      map.off("mouseout", onOut);
      window.removeEventListener("keydown", onKey);
      container.classList.remove("studio-drawing");
      map.doubleClickZoom.enable();
      map.dragging.enable();
      hideTip();
      map.removeLayer(group);
    };
    // The draft style is read when a tool starts; changing the tool restarts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.tool, active, map]);

  return <VertexEditor active={active} entries={entries} shapes={shapes} />;
}

// ── Reshape the selected polygon or line by dragging its corners ─────────

function VertexEditor({ active, entries, shapes }: { active: boolean; entries: React.MutableRefObject<Map<string, Entry>>; shapes: SavedShape[] }) {
  const map = useMap();
  const st = useStudio();
  const shape = active && st.tool === "select" && st.selectedId ? shapes.find((x) => x.id === st.selectedId) : undefined;
  const sig = shape ? `${shape.id}|${shape.updated_at}` : "";

  useEffect(() => {
    if (!shape || shape.geometry.type !== "Feature") return;
    const feature = shape.geometry;
    const geom = feature.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "LineString")) return;
    const isPoly = geom.type === "Polygon";
    // Open rings (no repeated closing point) are easier to edit.
    let rings: Pos[][] = isPoly ? (geom.coordinates as Pos[][]).map((r) => r.slice(0, -1) as Pos[]) : [geom.coordinates as Pos[]];
    const min = isPoly ? 3 : 2;
    if (rings.reduce((a, r) => a + r.length, 0) > 600) return;

    const group = L.layerGroup().addTo(map);
    // Found when needed: this effect can run before the parent has created the layer.
    const findTarget = (): L.Polyline | undefined => {
      const entry = entries.current.get(shape.id);
      let found: L.Polyline | undefined;
      if (entry && !(entry.layer instanceof L.Marker)) entry.layer.eachLayer((l) => { if (!found && l instanceof L.Polyline) found = l; });
      return found;
    };

    const shown = () => rings.map((r) => r.map(toLL));
    const persist = () => {
      const coords = isPoly ? rings.map((r) => [...r, r[0]]) : rings[0];
      void saveGeometry(shape.id, { ...feature, geometry: { type: geom.type, coordinates: coords } as GeoJSON.Geometry });
    };
    const vIcon = L.divIcon({ className: "", html: '<div class="studio-vh"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
    const mIcon = L.divIcon({ className: "", html: '<div class="studio-mh"></div>', iconSize: [9, 9], iconAnchor: [4.5, 4.5] });

    const render = () => {
      group.clearLayers();
      rings.forEach((ring, ri) => {
        ring.forEach((p, i) => {
          const m = L.marker(toLL(p), { icon: vIcon, draggable: true, zIndexOffset: 900, bubblingMouseEvents: false }).addTo(group);
          m.on("drag", () => {
            ring[i] = toPos(m.getLatLng());
            findTarget()?.setLatLngs(isPoly ? (shown() as L.LatLngTuple[][]) : (shown()[0] as L.LatLngTuple[]));
          });
          m.on("dragend", () => {
            persist();
            render();
          });
          const remove = () => {
            if (ring.length <= min) return;
            ring.splice(i, 1);
            findTarget()?.setLatLngs(isPoly ? (shown() as L.LatLngTuple[][]) : (shown()[0] as L.LatLngTuple[]));
            persist();
            render();
          };
          m.on("dblclick", remove);
          m.on("contextmenu", remove);
        });
        const edges = isPoly ? ring.length : ring.length - 1;
        for (let i = 0; i < edges; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const mid: Pos = [r6((a[0] + b[0]) / 2), r6((a[1] + b[1]) / 2)];
          const m = L.marker(toLL(mid), { icon: mIcon, zIndexOffset: 800, bubblingMouseEvents: false }).addTo(group);
          m.on("click", () => {
            rings = rings.map((r, k) => (k === ri ? [...r.slice(0, i + 1), mid, ...r.slice(i + 1)] : r));
            persist();
            render();
          });
        }
      });
    };
    render();
    return () => {
      map.removeLayer(group);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, map]);

  return null;
}
