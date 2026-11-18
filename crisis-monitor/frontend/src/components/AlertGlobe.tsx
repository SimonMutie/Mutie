import { useEffect, useRef } from "react";
import { geoCircle, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { loadGlobeShapes } from "./globeData";

/**
 * The small pulsing globe on an alert pop-up (AlertPopups), in place of the eye: the Earth turned to face where the
 * alert is, Africa in gold, rings rippling out from the alert's location in its level's colour, waves leaving the
 * globe's edge and a turning dashed ring. `beat` changes on every note of the alarm, and each change sends a stronger
 * burst from the location; `still` stops the motion once the alarm is silenced.
 */
export default function AlertGlobe({ lat, lng, color, beat, still }: { lat: number | null; lng: number | null; color: string; beat: number; still: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const beatAt = useRef<number>(0);
  const lastBeat = useRef(beat);
  if (beat !== lastBeat.current) {
    lastBeat.current = beat;
    beatAt.current = performance.now();
  }
  const stillRef = useRef(still);
  stillRef.current = still;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Without a location, it faces the middle of Africa.
    const at: [number, number] = [lng ?? 20, lat ?? 4];
    const rgb = hexToRgb(color);
    const rgba = (a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    let shapes: { land: GeoPermissibleObjects; africa: GeoPermissibleObjects } | null = null;
    void loadGlobeShapes().then((g) => (shapes = g));
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const projection = geoOrthographic().clipAngle(90).precision(0.8);
    const path = geoPath(projection, ctx);
    const circle = geoCircle();
    const graticule = geoGraticule10();
    const t0 = performance.now();
    let stopped = false;
    let frozenT: number | null = null;

    const frame = (now: number) => {
      if (stopped) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = canvas.clientWidth;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
      }
      // Silenced: hold the last frame still rather than freezing mid-burst.
      if (stillRef.current || reduced) frozenT ??= (now - t0) / 1000;
      else frozenT = null;
      const t = frozenT ?? (now - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const c = size / 2;
      const r = size * 0.33;
      // Faces the alert's location, drifting a little either side of it.
      projection.scale(r).translate([c, c]).rotate([-at[0] + Math.sin(t * 0.35) * 8, -at[1] * 0.85, 0]);

      // Waves leaving the edge.
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.45 + i / 3) % 1;
        ctx.strokeStyle = rgba((1 - ph) * 0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(c, c, r * (1.04 + ph * 0.46), 0, Math.PI * 2);
        ctx.stroke();
      }
      // Atmosphere in the level's colour.
      const atm = ctx.createRadialGradient(c, c, r * 0.9, c, c, r * 1.3);
      atm.addColorStop(0, rgba(0.45));
      atm.addColorStop(1, rgba(0));
      ctx.fillStyle = atm;
      ctx.beginPath();
      ctx.arc(c, c, r * 1.3, 0, Math.PI * 2);
      ctx.fill();
      // Ocean, graticule, land and Africa.
      const ocean = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.05, c, c, r);
      ocean.addColorStop(0, "#16385e");
      ocean.addColorStop(1, "#040b17");
      ctx.fillStyle = ocean;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fill();
      ctx.strokeStyle = "rgba(120,170,255,0.12)";
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      path(graticule);
      ctx.stroke();
      if (shapes) {
        ctx.fillStyle = "#1a3757";
        ctx.beginPath();
        path(shapes.land);
        ctx.fill();
        ctx.fillStyle = "rgba(222,184,74,0.92)";
        ctx.beginPath();
        path(shapes.africa);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,226,140,0.8)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      // Ripples from the alert's location, and a strong burst on each alarm note.
      for (let k = 0; k < 3; k++) {
        const ph = (t * 0.7 + k / 3) % 1;
        ctx.strokeStyle = rgba((1 - ph) * 0.95);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        path(circle.center(at).radius(1 + ph * 16)());
        ctx.stroke();
      }
      const since = (now - beatAt.current) / 1000;
      if (beatAt.current && since < 0.9 && !stillRef.current) {
        const k = since / 0.9;
        ctx.strokeStyle = rgba((1 - k) * 1);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        path(circle.center(at).radius(2 + k * 30)());
        ctx.stroke();
      }
      const xy = projection(at);
      if (xy) {
        const g = ctx.createRadialGradient(xy[0], xy[1], 0, xy[0], xy[1], 7);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.35, rgba(1));
        g.addColorStop(1, rgba(0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], 7, 0, Math.PI * 2);
        ctx.fill();
      }
      // Shading and rim.
      const shade = ctx.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.2, c, c, r * 1.02);
      shade.addColorStop(0, "rgba(0,0,0,0)");
      shade.addColorStop(1, "rgba(2,6,14,0.65)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fill();
      ctx.strokeStyle = rgba(0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.stroke();
      // Turning dashed ring.
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(t * 0.6);
      ctx.setLineDash([10, 6, 2, 6]);
      ctx.strokeStyle = rgba(0.55);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.setLineDash([]);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => {
      stopped = true;
    };
  }, [lat, lng, color]);

  return <canvas ref={canvasRef} style={{ display: "block", width: "100%", aspectRatio: "1" }} />;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
