import { exportAllowed, stampCanvas } from "./exportGuard";
import GIF from "gif.js";
import gifWorkerUrl from "gif.js/dist/gif.worker.js?url";
import html2canvas from "html2canvas";

export interface GifCaptureProgress {
  phase: "capturing" | "encoding";
  /** For "capturing": which frame number is currently being captured. For
   *  "encoding": a 0-1 fraction from gif.js's own "progress" event. */
  current: number;
  total: number;
}

/** Captures a DOM element as an animated GIF: records a series of frames
 *  via html2canvas at regular intervals, then encodes them into a GIF via
 *  gif.js, which does the actual (slow) LZW compression work in a
 *  background Web Worker so the page doesn't freeze while encoding.
 *
 *  The riskiest part of this — whether gif.js's separate worker script
 *  file actually bundles correctly through this project's specific Vite
 *  setup — was verified empirically before writing this: a real
 *  `dist/assets/gif.worker-[hash].js` file was confirmed to appear in an
 *  actual production build, not assumed to work from documentation alone.
 *
 *  frameCount/frameDelayMs default to ~3 seconds at 8fps (24 frames) —
 *  long enough to show at least one full cycle of a 1-second animation
 *  (like the map's marching-ants route effect), short enough that both
 *  the capture time (html2canvas run repeatedly, which is itself not
 *  fast) and the resulting file size stay reasonable rather than growing
 *  unboundedly with more/longer frames. */
export function captureElementAsGif(
  element: HTMLElement,
  onProgress: (progress: GifCaptureProgress) => void,
  options?: { frameCount?: number; frameDelayMs?: number; ignore?: (el: Element) => boolean }
): Promise<Blob> {
  const frameCount = options?.frameCount ?? 24;
  const frameDelayMs = options?.frameDelayMs ?? 125; // 8fps
  // Frames are real snapshots, but html2canvas is too slow to catch the
  // page's CSS transitions mid-flight: by the time it renders, they have
  // finished and every frame is identical. So the transitions are paused
  // and each frame is taken at its own point in time instead.

  return new Promise((resolve, reject) => {
    const gif = new GIF({ workers: 2, quality: 10, workerScript: gifWorkerUrl });

    gif.on("finished", (blob: Blob) => resolve(blob));
    gif.on("progress", (percent: number) => onProgress({ phase: "encoding", current: percent, total: 1 }));

    (async () => {
      let anims: Animation[] = [];
      try {
        // Let transitions started by the page's own mount/in-view logic appear.
        await new Promise((r) => setTimeout(r, 180));
        anims = sampleAnimations(element);
        for (let i = 0; i < frameCount; i++) {
          onProgress({ phase: "capturing", current: i + 1, total: frameCount });
          const at = i * frameDelayMs;
          anims.forEach((a) => (a.currentTime = at));
          const canvas = stampCanvas(
            await html2canvas(element, {
              useCORS: true,
              allowTaint: false,
              logging: false,
              ignoreElements: options?.ignore,
              onclone: (doc) => resolveCloneColours(doc),
            }),
          );
          gif.addFrame(canvas, { delay: frameDelayMs });
        }
        anims.forEach((a) => a.play());
        gif.render();
      } catch (err) {
        anims.forEach((a) => a.play());
        reject(err instanceof Error ? err : new Error("Couldn't capture frames for the GIF."));
      }
    })();
  });
}

/** html2canvas cannot parse modern colour functions. The report's stylesheet
 *  uses color-mix() in many places, and the browser serialises those computed
 *  values as color(srgb r g b / a), which html2canvas rejects, failing the
 *  whole capture. This rewrites each such value on the snapshot's own copy of
 *  the page as an rgba() colour, which is what html2canvas then reads. */
const SRGB_COLOUR = /color\(\s*srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\s*\)/g;

function toRgba(value: string): string {
  return value.replace(SRGB_COLOUR, (_m, r: string, g: string, b: string, a?: string) => {
    const ch = (x: string) => Math.round(Math.min(1, Math.max(0, Number(x))) * 255);
    return `rgba(${ch(r)}, ${ch(g)}, ${ch(b)}, ${a === undefined ? 1 : Number(a)})`;
  });
}

function resolveCloneColours(cloneDoc: Document) {
  const win = cloneDoc.defaultView;
  if (!win) return;
  cloneDoc.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const cs = win.getComputedStyle(el);
    for (let k = 0; k < cs.length; k++) {
      const prop = cs[k];
      const v = cs.getPropertyValue(prop);
      if (v.includes("color(")) el.style.setProperty(prop, toRgba(v));
    }
  });
}

/** Pauses every CSS transition and animation inside the element and returns
 *  them, so the recorder can seek each one to the frame's time. */
function sampleAnimations(element: HTMLElement): Animation[] {
  const found = element.getAnimations({ subtree: true });
  found.forEach((a) => a.pause());
  return found;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
