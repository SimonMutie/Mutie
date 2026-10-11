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

export function resolveColours(cloneDoc: Document) {
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
