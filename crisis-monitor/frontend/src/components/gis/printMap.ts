import { toDecimal, toMgrs } from "../coords";
import { gridLabel, gridStep, gridValues, haversineKm, niceScale, representativeFraction, type LL } from "./gisMath";
import type { GisFeature } from "./exporters";

/** The map as it is on screen, for printing: an image of it, and the map's own projection to place the grid exactly. */
export interface PrintView {
  mode: "3d" | "flat";
  /** The map image (data URL), or null when none could be made (the flat map without the MapTiler key). */
  image: string | null;
  /** On-screen size in CSS pixels; project/unproject work in these. */
  width: number;
  height: number;
  project: (ll: LL) => { x: number; y: number } | null;
  unproject: (x: number, y: number) => LL | null;
  bearing: number;
  pitch: number;
  /** Features to draw over the image when it shows only the basemap (the flat map's static image). */
  overlay?: GisFeature[];
}

export interface PrintOptions {
  title: string;
  subtitle: string;
  notes: string;
  grid: boolean;
  legend: { label: string; color: string; count: number }[];
}

// A4 landscape at 210 dpi.
const W = 2480, H = 1754, MM_W = 297;
const INK = "#0d1726", MUTED = "#5b6b82", RULE = "#c9d2de";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function nairobiTime(d = new Date()): string {
  return `${d.toLocaleString("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} EAT`;
}

/** Lays out the print sheet on a canvas. */
export async function composePrint(view: PrintView, opt: PrintOptions): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Map frame: left part of the sheet, the map image fitted into it at its own aspect.
  const mx = 130, my = 70, maxW = Math.round(W * 0.7) - mx, maxH = H - my - 110;
  const s = Math.min(maxW / view.width, maxH / view.height);
  const fw = Math.round(view.width * s), fh = Math.round(view.height * s);
  const fx = mx, fy = my + Math.round((maxH - fh) / 2);
  const toFrame = (p: { x: number; y: number }) => ({ x: fx + p.x * s, y: fy + p.y * s });

  ctx.save();
  ctx.beginPath();
  ctx.rect(fx, fy, fw, fh);
  ctx.clip();
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(fx, fy, fw, fh);
  if (view.image) {
    try {
      const img = await loadImage(view.image);
      ctx.drawImage(img, fx, fy, fw, fh);
    } catch { /* leave the frame dark */ }
  }
  // Points over a basemap-only image.
  for (const f of view.overlay ?? []) {
    const p = view.project(f);
    if (!p || p.x < 0 || p.y < 0 || p.x > view.width || p.y > view.height) continue;
    const q = toFrame(p);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = f.color ?? "#ff9d4f";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#0b1220";
    ctx.stroke();
  }

  // Extent from the frame's corners and edge midpoints.
  const samples = [[0, 0], [view.width, 0], [0, view.height], [view.width, view.height], [view.width / 2, 0], [view.width / 2, view.height], [0, view.height / 2], [view.width, view.height / 2]]
    .map(([x, y]) => view.unproject(x, y))
    .filter((p): p is LL => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const lats = samples.map((p) => p.lat), lngs = samples.map((p) => p.lng);
  const ext = samples.length >= 4 ? { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) } : null;
  const spanLng = ext ? ext.maxLng - ext.minLng : 360;
  const gridDrawn = opt.grid && !!ext && spanLng < 60 && ext.maxLat - ext.minLat < 60;
  const labels: { x: number; y: number; text: string; side: "bottom" | "left" }[] = [];
  if (gridDrawn && ext) {
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([10, 8]);
    const lngStep = gridStep(spanLng), latStep = gridStep(ext.maxLat - ext.minLat);
    const trace = (pts: LL[]) => {
      ctx.beginPath();
      let started = false;
      const inFrame: { x: number; y: number }[] = [];
      for (const ll of pts) {
        const p = view.project(ll);
        if (!p) { started = false; continue; }
        const q = toFrame(p);
        if (started) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
        started = true;
        if (q.x >= fx && q.x <= fx + fw && q.y >= fy && q.y <= fy + fh) inFrame.push(q);
      }
      ctx.stroke();
      return inFrame;
    };
    const steps = 48;
    for (const lng of gridValues(ext.minLng, ext.maxLng, lngStep)) {
      const pts = Array.from({ length: steps + 1 }, (_, i) => ({ lng, lat: ext.minLat + ((ext.maxLat - ext.minLat) * i) / steps }));
      const inFrame = trace(pts);
      if (inFrame.length) { const b = inFrame.reduce((a, c) => (c.y > a.y ? c : a)); labels.push({ x: b.x, y: fy + fh, text: gridLabel(lng, "lng"), side: "bottom" }); }
    }
    for (const lat of gridValues(ext.minLat, ext.maxLat, latStep)) {
      const pts = Array.from({ length: steps + 1 }, (_, i) => ({ lat, lng: ext.minLng + ((ext.maxLng - ext.minLng) * i) / steps }));
      const inFrame = trace(pts);
      if (inFrame.length) { const l = inFrame.reduce((a, c) => (c.x < a.x ? c : a)); labels.push({ x: fx, y: l.y, text: gridLabel(lat, "lat"), side: "left" }); }
    }
    ctx.setLineDash([]);
  }
  ctx.restore();

  // Frame border and grid labels outside it.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(fx, fy, fw, fh);
  ctx.fillStyle = INK;
  ctx.font = "500 22px 'Inter', 'Segoe UI', Arial, sans-serif";
  for (const l of labels) {
    if (l.side === "bottom") {
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillRect(l.x - 1, fy + fh, 2, 12);
      ctx.fillText(l.text, l.x, fy + fh + 16);
    } else {
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      ctx.fillRect(fx - 12, l.y - 1, 12, 2);
      ctx.fillText(l.text, fx - 18, l.y);
    }
  }

  // Scale: metres per screen pixel at the centre, measured on the map itself (true for flat and globe alike).
  const c = view.unproject(view.width / 2, view.height / 2);
  const c2 = view.unproject(view.width / 2 + 100, view.height / 2);
  const mPerCss = c && c2 ? (haversineKm(c, c2) * 1000) / 100 : 0;
  const mPerFrame = mPerCss / s;
  const rf = mPerFrame ? representativeFraction(mPerFrame * fw, (fw / W) * MM_W) : 0;

  // Sidebar.
  const sx = fx + fw + 60, sw = W - sx - 70;
  let y = my;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = INK;
  ctx.font = "700 54px 'Inter', 'Segoe UI', Arial, sans-serif";
  for (const line of wrap(ctx, opt.title || "Situation map", sw)) { ctx.fillText(line, sx, y); y += 64; }
  if (opt.subtitle) {
    ctx.fillStyle = MUTED;
    ctx.font = "400 30px 'Inter', 'Segoe UI', Arial, sans-serif";
    for (const line of wrap(ctx, opt.subtitle, sw)) { ctx.fillText(line, sx, y); y += 38; }
  }
  y += 10;
  ctx.fillStyle = MUTED;
  ctx.font = "500 24px 'Inter', 'Segoe UI', Arial, sans-serif";
  ctx.fillText(nairobiTime(), sx, y);
  y += 46;
  const rule = () => { ctx.fillStyle = RULE; ctx.fillRect(sx, y, sw, 2); y += 22; };
  rule();

  // North arrow, turned by the map's bearing.
  const nx = sx + sw - 60, ny = y + 60;
  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate((-view.bearing * Math.PI) / 180);
  ctx.beginPath(); ctx.moveTo(0, -52); ctx.lineTo(20, 26); ctx.lineTo(0, 12); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -52); ctx.lineTo(-20, 26); ctx.lineTo(0, 12); ctx.closePath(); ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = "700 26px 'Inter', 'Segoe UI', Arial, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("N", 0, -56);
  ctx.restore();

  // Scale bar.
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  if (mPerFrame > 0) {
    const nice = niceScale(mPerFrame * Math.min(sw - 170, fw * 0.3));
    const len = nice.metres / mPerFrame;
    const by = y + 34;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? "#ffffff" : INK;
      ctx.fillRect(sx + (len / 4) * i, by, len / 4, 14);
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.strokeRect(sx, by, len, 14);
    ctx.fillStyle = INK; ctx.font = "500 22px 'Inter', 'Segoe UI', Arial, sans-serif";
    ctx.fillText("0", sx - 6, by + 22);
    ctx.textAlign = "right"; ctx.fillText(nice.label, sx + len + 6, by + 22); ctx.textAlign = "left";
    ctx.fillStyle = MUTED; ctx.font = "400 22px 'Inter', 'Segoe UI', Arial, sans-serif";
    ctx.fillText(rf ? `Scale about 1:${rf.toLocaleString("en-GB")} at the centre` : "", sx, by + 56);
    if (view.pitch > 5 || view.mode === "3d") ctx.fillText(view.pitch > 5 ? "Tilted view: true at the centre only" : "Globe view: true at the centre", sx, by + 84);
  }
  y += 150;
  rule();

  // Legend.
  if (opt.legend.length) {
    ctx.fillStyle = INK; ctx.font = "700 26px 'Inter', 'Segoe UI', Arial, sans-serif";
    ctx.fillText("Legend", sx, y); y += 40;
    ctx.font = "400 23px 'Inter', 'Segoe UI', Arial, sans-serif";
    const shown = opt.legend.slice(0, 16);
    for (const item of shown) {
      ctx.beginPath(); ctx.arc(sx + 11, y + 13, 10, 0, Math.PI * 2); ctx.fillStyle = item.color; ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = INK;
      const text = `${item.label}${item.count ? ` (${item.count})` : ""}`;
      ctx.fillText(wrap(ctx, text, sw - 40)[0], sx + 34, y);
      y += 34;
    }
    if (opt.legend.length > shown.length) { ctx.fillStyle = MUTED; ctx.fillText(`and ${opt.legend.length - shown.length} more layers`, sx + 34, y); y += 34; }
    y += 8;
    rule();
  }

  // Notes.
  if (opt.notes.trim()) {
    ctx.fillStyle = INK; ctx.font = "400 23px 'Inter', 'Segoe UI', Arial, sans-serif";
    for (const line of wrap(ctx, opt.notes.trim(), sw).slice(0, 8)) { ctx.fillText(line, sx, y); y += 31; }
    y += 8;
    rule();
  }

  // Map details, at the foot of the sidebar.
  const details = [
    c ? `Centre ${toDecimal(c.lat, c.lng)}` : "",
    c && toMgrs(c.lat, c.lng) ? `MGRS ${toMgrs(c.lat, c.lng)}` : "",
    "Datum WGS 84 (EPSG:4326)",
    view.mode === "3d" ? "Shown on a globe (perspective)" : "Projection Web Mercator (EPSG:3857)",
    gridDrawn ? "Grid: geographic, in degrees" : opt.grid ? "Grid left out at this extent" : "",
    "Basemap © MapTiler © OpenStreetMap contributors",
  ].filter(Boolean);
  ctx.fillStyle = MUTED; ctx.font = "400 21px 'Inter', 'Segoe UI', Arial, sans-serif";
  let dy = Math.max(y, H - 110 - details.length * 29 - 60);
  for (const d of details) { ctx.fillText(d, sx, dy); dy += 29; }
  ctx.fillStyle = INK; ctx.font = "700 24px 'Inter', 'Segoe UI', Arial, sans-serif";
  ctx.fillText("The Lens · Afrilens Consulting", sx, dy + 18);

  // Footer under the map.
  ctx.fillStyle = MUTED; ctx.font = "400 20px 'Inter', 'Segoe UI', Arial, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText("Positions are as reported and coded by The Lens; check the precision shown for each incident before relying on a location.", fx, H - 34);
  return canvas;
}

/** Saves the sheet as a PNG or an A4 PDF. */
export async function savePrint(canvas: HTMLCanvasElement, format: "png" | "pdf", name: string) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const base = `${name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lens-map"}-${stamp}`;
  if (format === "png") {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${base}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 297, 210);
  pdf.save(`${base}.pdf`);
}
