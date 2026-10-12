import { exportAllowed } from "../exportGuard";
import { logoPng } from "../lib/brandLogo";
import { revealEverything, settleForCapture } from "../lib/motion";
import { captureElementAsGif, downloadBlob, type GifCaptureProgress } from "../gifCapture";
import { buildDocx, buildPdf, buildPptx, buildTextPdf, save, snapshot, type ExportPage, type Snapshot } from "./monthlyExport";
import type { RptTheme } from "../api";

/**
 * Downloads for any on-screen element: a live-page section, a dashboard widget.
 * The element is read the same way a monthly report page is. Its text and first
 * table become the written content, and a picture of it is the figure, so the
 * Word, PDF and PowerPoint files match what the reader sees, with the same stamp
 * and Lens mark as every other export.
 */

export type ElementFormat = "pdf" | "docx" | "pptx";

export interface ElementMeta {
  /** File name without extension. */
  fileBase: string;
  title: string;
  kicker: string;
  theme?: RptTheme;
}

/** Controls, menus and hidden helpers are not part of the content. */
const SKIP = "button, select, input, textarea, [role=menu], [role=tablist], [role=radiogroup], .rpt-noprint, .el-sec-toggle";
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Paragraphs and list items in reading order, outside tables and controls. */
export function readableText(el: HTMLElement): string[] {
  const out: string[] = [];
  el.querySelectorAll<HTMLElement>("p, li").forEach((n) => {
    if (n.closest(SKIP) || n.closest("table")) return;
    const t = clean(n.textContent);
    if (t && out[out.length - 1] !== t) out.push(t);
  });
  return out;
}

/** The first data table in the element, as a head and rows of plain figures. */
export function firstTable(el: HTMLElement): ExportPage["table"] {
  const table = [...el.querySelectorAll<HTMLTableElement>("table")].find((t) => !t.closest(SKIP));
  if (!table) return undefined;
  const headCells = [...table.querySelectorAll("thead th")];
  const bodyRows = [...table.querySelectorAll("tbody tr")];
  const rows = (bodyRows.length ? bodyRows : [...table.querySelectorAll("tr")].slice(1)).slice(0, 40);
  const head = headCells.length ? headCells.map((c) => clean(c.textContent)) : [...(table.querySelector("tr")?.querySelectorAll("th,td") ?? [])].map((c) => clean(c.textContent));
  const data = rows.map((r) => [...r.querySelectorAll("th,td")].map((c) => clean(c.textContent)));
  if (!head.length || !data.length) return undefined;
  return { head, rows: data };
}

function pageFor(el: HTMLElement, meta: ElementMeta): ExportPage {
  return {
    id: meta.fileBase,
    kind: "section",
    title: meta.title,
    paragraphs: readableText(el),
    table: firstTable(el),
    kicker: meta.kicker,
    theme: meta.theme ?? "lens",
    fileBase: meta.fileBase,
  };
}

/**
 * Downloads the element as a PDF, Word document or animated PowerPoint.
 * If the picture of the element cannot be made, the file is still written from
 * its text and table, and the returned note says the picture was left out.
 */
export async function exportElement(el: HTMLElement, fmt: ElementFormat, meta: ElementMeta): Promise<string | null> {
  if (!exportAllowed()) return null;
  const theme = meta.theme ?? "lens";
  revealEverything();
  await settleForCapture(el);
  const page = pageFor(el, meta);
  let snap: Snapshot | undefined;
  let note: string | null = null;
  try {
    snap = await snapshot(el, theme);
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 160) : "unknown error";
    console.error(`[element download] picture failed for ${meta.fileBase}:`, err);
    note = `The picture could not be made (${why}), so this file has the text and table only.`;
  }
  if (fmt === "pdf") {
    save(snap ? buildPdf(snap) : buildTextPdf(page), `${meta.fileBase}.pdf`);
    return note;
  }
  const logo = await logoPng(theme).catch(() => undefined);
  if (fmt === "docx") save(await buildDocx(page, snap, logo), `${meta.fileBase}.docx`);
  else save(await buildPptx(page, { snap, logo }), `${meta.fileBase}.pptx`);
  return note;
}

/** Records the element as an animated GIF, playing its motion from the start. */
export async function exportElementGif(el: HTMLElement, fileBase: string, onProgress?: (p: GifCaptureProgress) => void): Promise<void> {
  if (!exportAllowed()) return;
  revealEverything();
  await settleForCapture(el);
  const blob = await captureElementAsGif(el, onProgress ?? (() => {}), {
    frameCount: 24,
    frameDelayMs: 150,
    ignore: (n) => n.classList.contains("rpt-noprint") || n.matches("button, .el-sec-toggle"),
  });
  downloadBlob(blob, `${fileBase}.gif`);
}
