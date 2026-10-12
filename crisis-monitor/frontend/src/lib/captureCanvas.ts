import html2canvas from "html2canvas";

/**
 * Every snapshot of the page (PDF, Word, slides, GIF) goes through here.
 *
 * html2canvas cannot parse modern colour functions. The report's stylesheet
 * uses color-mix() in many places, and the browser serialises those computed
 * values as color(srgb r g b / a), which html2canvas rejects and so fails the
 * whole capture. This rewrites each such value on the snapshot's own copy of
 * the page as an rgba() colour, which is what html2canvas then reads.
 */

const SRGB_COLOUR = /color\(\s*srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\s*\)/g;

export function toRgba(value: string): string {
  return value.replace(SRGB_COLOUR, (_m, r: string, g: string, b: string, a?: string) => {
    const ch = (x: string) => Math.round(Math.min(1, Math.max(0, Number(x))) * 255);
    return `rgba(${ch(r)}, ${ch(g)}, ${ch(b)}, ${a === undefined ? 1 : Number(a)})`;
  });
}

/** Colour functions html2canvas cannot read. The page can use any of them
 *  (oklab, oklch, lab, lch, hwb, color-mix), and the browser hands them back
 *  unchanged in computed styles. The browser itself knows what each one
 *  means, so a one-pixel canvas turns it into a plain rgba() value. */
const MODERN_COLOUR_FN = /\b(oklab|oklch|lab|lch|hwb|color-mix|color)\(/g;
let colourCtx: CanvasRenderingContext2D | null = null;

function plainRgba(expr: string): string {
  if (!colourCtx) colourCtx = document.createElement("canvas").getContext("2d");
  const ctx = colourCtx;
  if (!ctx) return "rgba(0, 0, 0, 0)";
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "rgba(0, 0, 0, 0)";
  ctx.fillStyle = expr; // an unreadable value leaves the transparent colour in place
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

/** Replaces every modern colour function in a CSS value with rgba(). */
export function toPlainColours(value: string): string {
  let out = "";
  let i = 0;
  MODERN_COLOUR_FN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MODERN_COLOUR_FN.exec(value))) {
    const start = m.index;
    let depth = 0;
    let end = -1;
    for (let k = start + m[0].length - 1; k < value.length; k++) {
      if (value[k] === "(") depth++;
      else if (value[k] === ")" && --depth === 0) {
        end = k;
        break;
      }
    }
    if (end < 0) break;
    out += value.slice(i, start) + plainRgba(value.slice(start, end + 1));
    i = end + 1;
    MODERN_COLOUR_FN.lastIndex = i;
  }
  return out + value.slice(i);
}

export function resolveColours(cloneDoc: Document) {
  const win = cloneDoc.defaultView;
  if (!win) return;
  cloneDoc.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const cs = win.getComputedStyle(el);
    for (let k = 0; k < cs.length; k++) {
      const prop = cs[k];
      const v = toRgba(cs.getPropertyValue(prop));
      if (/\b(oklab|oklch|lab|lch|hwb|color-mix|color)\(/.test(v)) el.style.setProperty(prop, toPlainColours(v));
      else if (v !== cs.getPropertyValue(prop)) el.style.setProperty(prop, v);
    }
  });
}

type Options = NonNullable<Parameters<typeof html2canvas>[1]>;

export function captureCanvas(el: HTMLElement, opts: Partial<Options> = {}): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    useCORS: true,
    allowTaint: false,
    logging: false,
    ...opts,
    onclone: (doc, clone) => {
      resolveColours(doc);
      opts.onclone?.(doc, clone);
    },
  });
}
