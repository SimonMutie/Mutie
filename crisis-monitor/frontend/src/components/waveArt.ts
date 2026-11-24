/**
 * The escalation wave, drawn the same on both map views, beneath the escalation's marker: a soft glow and three rings
 * rolling outward one after
 * another, each slowing as it spreads, thinning and fading, with a faint shockwave glow behind it. Coloured and
 * sized by the escalation's level. The 3D globe draws it on a canvas (an animated map image); the flat map uses the
 * CSS version in ConflictWaves.css, built from the same numbers.
 */

export type WaveLevel = "critical" | "elevated" | "watch";

export const WAVE_LOOK: Record<WaveLevel, { color: string; rgb: string; radius: number; period: number }> = {
  critical: { color: "#ff3b4a", rgb: "255, 59, 74", radius: 28, period: 2600 },
  elevated: { color: "#ff8a3d", rgb: "255, 138, 61", radius: 22, period: 2900 },
  watch: { color: "#f5c542", rgb: "245, 197, 66", radius: 16, period: 3200 },
};
export const WAVE_RINGS = 3;

/** Smooth start-fast, end-slow. */
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

/** One frame of a wave, centred at (cx, cy), at time `t` (0 to 1 through its cycle), in canvas pixels. */
export function drawWave(ctx: CanvasRenderingContext2D, cx: number, cy: number, level: WaveLevel, t: number, scale = 1) {
  const { rgb, radius } = WAVE_LOOK[level];
  const R = radius * scale;
  // Rings start just outside the marker drawn on top (the warning triangle is about 20 px across).
  const core = Math.max(7 * scale, R * 0.26);
  for (let i = 0; i < WAVE_RINGS; i++) {
    const p = (t + i / WAVE_RINGS) % 1;
    const r = core + (R - core) * easeOut(p);
    const fade = Math.pow(1 - p, 1.6);
    // The shockwave glow: a soft disc that thins towards its edge.
    const g = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb}, 0)`);
    g.addColorStop(1, `rgba(${rgb}, ${0.28 * fade})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // The ring itself, thinning as it spreads.
    ctx.strokeStyle = `rgba(${rgb}, ${0.95 * fade})`;
    ctx.lineWidth = (0.6 + 1.9 * (1 - p)) * scale;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // A soft glow at the centre, behind the escalation's own marker (the warning triangle marks the spot: no dot here).
  const halo = ctx.createRadialGradient(cx, cy, core * 0.6, cx, cy, core * 2.2);
  halo.addColorStop(0, `rgba(${rgb}, 0.22)`);
  halo.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, core * 2.2, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The wave as an animated MapLibre image: it redraws itself each frame while `isActive()` (the globe on screen), and
 * holds still for people who ask for reduced motion.
 */
export function waveImage(level: WaveLevel, isActive: () => boolean, repaint: () => void) {
  const dpr = 2;
  const css = Math.ceil(WAVE_LOOK[level].radius * 2 + 8);
  const size = css * dpr;
  const reduce = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const start = performance.now();
  let ctx: CanvasRenderingContext2D | null = null;
  const img = {
    width: size,
    height: size,
    data: new Uint8ClampedArray(size * size * 4),
    onAdd() {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      ctx = c.getContext("2d", { willReadFrequently: true });
    },
    render() {
      if (!ctx) return false;
      if (!isActive() && img.data.some((v) => v !== 0)) return false;
      const t = reduce ? 0.3 : ((performance.now() - start) % WAVE_LOOK[level].period) / WAVE_LOOK[level].period;
      ctx.clearRect(0, 0, size, size);
      drawWave(ctx, size / 2, size / 2, level, t, dpr);
      img.data = ctx.getImageData(0, 0, size, size).data;
      if (!reduce) repaint();
      return true;
    },
  };
  return img;
}

/**
 * The flat map's waves: each is a small <canvas class="lens-wave" data-level="…"> in a map marker, and one shared
 * animation loop draws every one on the page with drawWave, so they look exactly like the globe's. The loop runs
 * only while such canvases exist, skips hidden ones, and draws a still frame for reduced motion.
 */
export function waveCanvasHtml(level: WaveLevel): string {
  const css = Math.ceil(WAVE_LOOK[level].radius * 2 + 8);
  return `<canvas class="lens-wave" data-level="${level}" width="${css * 2}" height="${css * 2}" style="position:absolute;left:${-css / 2}px;top:${-css / 2}px;width:${css}px;height:${css}px;pointer-events:none"></canvas>`;
}

let looping = false;
const loopStart = typeof performance !== "undefined" ? performance.now() : 0;
function drawAll(now: number) {
  const canvases = document.querySelectorAll<HTMLCanvasElement>("canvas.lens-wave");
  const reduce = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  canvases.forEach((c) => {
    if (!c.offsetParent && c.getClientRects().length === 0) return; // hidden (the other view on screen)
    const level = (c.dataset.level as WaveLevel) ?? "critical";
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const t = reduce ? 0.3 : ((now - loopStart) % WAVE_LOOK[level].period) / WAVE_LOOK[level].period;
    ctx.clearRect(0, 0, c.width, c.height);
    drawWave(ctx, c.width / 2, c.height / 2, level, t, 2);
  });
  if (canvases.length && !reduce) requestAnimationFrame(drawAll);
  else looping = false;
}
/** Starts the shared loop (call whenever wave markers are shown; it stops by itself when none are left). */
export function animateWaveCanvases() {
  if (looping || typeof window === "undefined") return;
  looping = true;
  requestAnimationFrame(drawAll);
}
