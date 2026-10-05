import { api } from "./api";

/**
 * Getting a picture (a map, an infographic, a photo) from the author's
 * computer into an article.
 *
 * Images are kept in the platform's database, which holds at most about
 * 1.35 MB per image. Anything larger is made smaller here, in the browser,
 * before it is sent: scaled down if it is very large and saved as a JPEG,
 * stepping the quality and size down until it fits. A typical exported map
 * or infographic comes through looking the same; only very large,
 * detailed files lose a little sharpness.
 */

const UPLOAD_LIMIT_BYTES = 1_300_000;
const DIRECT_TYPES = /^image\/(png|jpeg|webp|gif)$/;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

function encode(img: HTMLImageElement, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images.");
  ctx.fillStyle = "#ffffff"; // JPEG has no transparency; transparent areas become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image could not be converted."))), "image/jpeg", quality));
}

/** The file as it should be uploaded: untouched when it already fits, a
 *  smaller JPEG otherwise. */
export async function prepareImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error(`“${file.name}” is not an image.`);
  if (DIRECT_TYPES.test(file.type) && file.size <= UPLOAD_LIMIT_BYTES) return file;
  if (file.type === "image/gif") throw new Error(`“${file.name}” is an animated image larger than ${(UPLOAD_LIMIT_BYTES / 1_000_000).toFixed(1)} MB, which cannot be shrunk automatically.`);

  const img = await loadImage(file);
  let maxSide = 2800;
  let quality = 0.9;
  for (let attempt = 0; attempt < 12; attempt++) {
    const blob = await encode(img, maxSide, quality);
    if (blob.size <= UPLOAD_LIMIT_BYTES) return blob;
    if (quality > 0.72) quality -= 0.06;
    else maxSide = Math.round(maxSide * 0.82);
  }
  throw new Error(`“${file.name}” is too large to store even after shrinking.`);
}

/** Uploads a picture and returns the address the article shows it from. */
export async function uploadImageFile(file: File): Promise<string> {
  return api.uploadSpotlightImage(await prepareImage(file));
}
