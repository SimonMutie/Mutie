import { useEffect } from "react";
import { useMap } from "react-leaflet";
import * as L from "leaflet";
import { pinSvg } from "./actorTheme";

export interface FastPoint {
  latitude: number;
  longitude: number;
  color: string;
  /** Built only when the pointer rests on a pin, so tens of thousands of points cost nothing until looked at. */
  tip: () => string;
}

const sprites = new Map<string, HTMLImageElement>();
/** One small picture of the teardrop pin per colour, made once and stamped for every incident of that colour. */
function sprite(color: string, w: number, onReady: () => void): HTMLImageElement {
  const key = `${color}|${w}`;
  let img = sprites.get(key);
  if (!img) {
    img = new Image();
    // Drawn at twice the size so it stays sharp on high-density screens.
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(pinSvg(color, w * 2));
    sprites.set(key, img);
  }
  if (!img.complete) img.addEventListener("load", onReady, { once: true });
  return img;
}

/** Incident pins — the same teardrop markers as every other map — drawn on one canvas, so tens of thousands stay quick
 *  to pan and zoom (a page element per pin is not). Hover a pin for its details. */
export function FastMarkers({ points, width = 15 }: { points: FastPoint[]; width?: number }) {
  const map = useMap();
  useEffect(() => {
    const height = Math.round(width * (32 / 24));
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:450";
    map.getContainer().appendChild(canvas);
    // Northern pins are drawn first, so the ones to the south overlap them the way pins stand on a real map.
    const order = points.map((p, i) => i).sort((a, b) => points[b].latitude - points[a].latitude);
    let shown: { i: number; x: number; y: number }[] = [];
    let raf = 0;

    const draw = () => {
      raf = 0;
      const size = map.getSize();
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== size.x * ratio || canvas.height !== size.y * ratio) {
        canvas.width = size.x * ratio;
        canvas.height = size.y * ratio;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      const bounds = map.getBounds().pad(0.05);
      shown = [];
      for (const i of order) {
        const p = points[i];
        if (!bounds.contains([p.latitude, p.longitude])) continue;
        const pt = map.latLngToContainerPoint([p.latitude, p.longitude]);
        const img = sprite(p.color, width, schedule);
        if (img.complete && img.naturalWidth) ctx.drawImage(img, pt.x - width / 2, pt.y - height, width, height);
        shown.push({ i, x: pt.x, y: pt.y });
      }
    };
    function schedule() {
      if (!raf) raf = requestAnimationFrame(draw);
    }

    let tip: L.Tooltip | null = null;
    let tipFor = -1;
    const onMove = (e: L.LeafletMouseEvent) => {
      const { x, y } = e.containerPoint;
      let hit = -1;
      for (let k = shown.length - 1; k >= 0; k--) {
        const s = shown[k];
        if (x >= s.x - width / 2 && x <= s.x + width / 2 && y >= s.y - height && y <= s.y) {
          hit = s.i;
          break;
        }
      }
      map.getContainer().style.cursor = hit >= 0 ? "pointer" : "";
      if (hit === tipFor) return;
      tipFor = hit;
      if (tip) {
        map.removeLayer(tip);
        tip = null;
      }
      if (hit >= 0) {
        const p = points[hit];
        tip = L.tooltip({ direction: "top", offset: [0, -height], opacity: 0.95 }).setLatLng([p.latitude, p.longitude]).setContent(p.tip());
        tip.addTo(map);
      }
    };
    const onOut = () => {
      tipFor = -1;
      if (tip) map.removeLayer(tip);
      tip = null;
    };

    map.on("move zoom viewreset resize moveend zoomend", schedule);
    map.on("mousemove", onMove);
    map.on("mouseout", onOut);
    schedule();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      map.off("move zoom viewreset resize moveend zoomend", schedule);
      map.off("mousemove", onMove);
      map.off("mouseout", onOut);
      if (tip) map.removeLayer(tip);
      map.getContainer().style.cursor = "";
      canvas.remove();
    };
  }, [map, points, width]);
  return null;
}
