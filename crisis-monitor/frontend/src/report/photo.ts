import type { Block, Report } from "./model";

type Photo = Extract<Block, { t: "photo" }>;

const MAX = 480;

/** Scales an image down and re-encodes it as a JPEG data URL, so the saved report stays small and the Word export gets a known size. */
async function fit(blob: Blob): Promise<{ src: string; w: number; h: number }> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  return { src: canvas.toDataURL("image/jpeg", 0.86), w, h };
}

export const photoFromFile = (file: File) => fit(file);

/** Fetches the images the report points at (for example the Wikimedia Commons picture of a public figure). A failed fetch leaves the slot empty for the analyst to fill. */
export async function resolvePhotos(rep: Report): Promise<Report> {
  const todo = rep.sections.flatMap((s) => s.blocks).filter((b): b is Photo => b.t === "photo" && !b.src && !!b.url);
  if (!todo.length) return rep;
  const got = new Map<string, { src: string; w: number; h: number } | null>();
  await Promise.all(
    todo.map(async (b) => {
      try {
        const res = await fetch(b.url!);
        if (!res.ok) throw new Error(String(res.status));
        got.set(b.id, await fit(await res.blob()));
      } catch {
        got.set(b.id, null);
      }
    })
  );
  return { ...rep, sections: rep.sections.map((s) => ({ ...s, blocks: s.blocks.map((b) => (b.t === "photo" && got.get(b.id) ? { ...b, ...got.get(b.id)! } : b)) })) };
}

/** Display size in pixels for the report: a portrait is about 3.2 cm wide, a logo wider and shorter. */
export function photoSize(b: Photo): { w: number; h: number } {
  const w0 = b.w ?? 1, h0 = b.h ?? 1;
  const box = b.shape === "logo" ? { w: 150, h: 70 } : { w: 120, h: 150 };
  const k = Math.min(box.w / w0, box.h / h0);
  return { w: Math.round(w0 * k), h: Math.round(h0 * k) };
}
