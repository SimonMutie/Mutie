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
  options?: { frameCount?: number; frameDelayMs?: number }
): Promise<Blob> {
  const frameCount = options?.frameCount ?? 24;
  const frameDelayMs = options?.frameDelayMs ?? 125; // 8fps

  return new Promise((resolve, reject) => {
    const gif = new GIF({ workers: 2, quality: 10, workerScript: gifWorkerUrl });

    gif.on("finished", (blob: Blob) => resolve(blob));
    gif.on("progress", (percent: number) => onProgress({ phase: "encoding", current: percent, total: 1 }));

    (async () => {
      try {
        for (let i = 0; i < frameCount; i++) {
          onProgress({ phase: "capturing", current: i + 1, total: frameCount });
          const canvas = await html2canvas(element, { useCORS: true, allowTaint: false, logging: false });
          gif.addFrame(canvas, { delay: frameDelayMs });
          // No wait needed after the very last frame — nothing left to let
          // the animation advance for.
          if (i < frameCount - 1) await new Promise((r) => setTimeout(r, frameDelayMs));
        }
        gif.render();
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Couldn't capture frames for the GIF."));
      }
    })();
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
