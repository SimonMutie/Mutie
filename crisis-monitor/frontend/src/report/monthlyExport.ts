import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, AlignmentType, Footer, Header, BorderStyle } from "docx";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { exportStampLine, stampCanvas } from "../exportGuard";
import { FONT_FILE, SIZE_PPT, SIZE_PT, THEMES, resolveStyle } from "../lib/reportTheme";
import type { RptTheme } from "../api";

/**
 * Exports for one page of a monthly report. Every format carries the same
 * text, table and chart for the page, its style, the theme and the Lens mark,
 * and each one has the stamp line the app puts on every export.
 */

export interface ExportPage {
  /** Section id, used for the file name. */
  id: string;
  /** "cover", "narrative", or a data section kind. */
  kind: string;
  title: string;
  /** Written text, one entry per paragraph. */
  paragraphs: string[];
  /** Plain figures for the page, shown as a table in Word and on the slide. */
  table?: { head: string[]; rows: (string | number)[][] };
  /** Headline numbers, shown as tiles on the slide. */
  kpis?: { label: string; value: string }[];
  kicker: string;
  theme: RptTheme;
  style?: { font?: "serif" | "sans" | "mono"; size?: "s" | "m" | "l" | "xl"; align?: "left" | "center" | "right" | "justify" };
  fileBase: string;
}

export interface Snapshot {
  png: string;
  width: number;
  height: number;
}

/** A PNG of the page as it is on screen, stamped the way every app image is. */
export async function snapshot(el: HTMLElement, theme: RptTheme): Promise<Snapshot> {
  const ignoreElements = (node: Element) => node.classList.contains("rpt-noprint");
  const canvas = stampCanvas(await html2canvas(el, { useCORS: true, allowTaint: false, logging: false, scale: 2, backgroundColor: THEMES[theme].paper, ignoreElements }));
  return { png: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}

const bytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
const alignDocx = (a: string) => (a === "center" ? AlignmentType.CENTER : a === "right" ? AlignmentType.RIGHT : a === "justify" ? AlignmentType.JUSTIFIED : AlignmentType.LEFT);

/* ── PDF: the page as it looks, one or more A4 sheets ───────── */

export function buildPdf(snap: Snapshot): Blob {
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const w = pageW - margin * 2;
  const h = (snap.height / snap.width) * w;
  const printable = pageH - margin * 2;
  // A long page runs across several sheets; each sheet shows the next slice.
  for (let y = 0; y < h; y += printable) {
    if (y > 0) pdf.addPage();
    pdf.addImage(snap.png, "PNG", margin, margin - y, w, h, undefined, "FAST");
  }
  return pdf.output("blob");
}

/* ── Word: editable text, a real table, and the chart ───────── */

export async function buildDocx(page: ExportPage, snap?: Snapshot, logo?: string): Promise<Blob> {
  const st = resolveStyle(page.style);
  const pal = THEMES[page.theme];
  const font = FONT_FILE[st.font];
  const body = SIZE_PT[st.size];
  const color = (hex: string) => hex.replace("#", "");
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
      children: [new TextRun({ text: page.kicker.toUpperCase(), font, size: 18, bold: true, color: color(pal.accent) })],
    }),
  );
  children.push(
    new Paragraph({
      alignment: alignDocx(st.align),
      spacing: { after: 200 },
      children: [new TextRun({ text: page.title, font, size: Math.round(body * 2.2), bold: true, color: color(pal.ink) })],
    }),
  );
  for (const p of page.paragraphs) {
    children.push(
      new Paragraph({
        alignment: alignDocx(st.align),
        spacing: { after: 160, line: 300 },
        children: [new TextRun({ text: p, font, size: body * 2, color: color(pal.ink) })],
      }),
    );
  }
  if (page.kpis?.length) {
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 120 },
        children: page.kpis.flatMap((k) => [
          new TextRun({ text: `${k.value}  `, font, size: body * 2 + 10, bold: true, color: color(pal.accent) }),
          new TextRun({ text: `${k.label}     `, font, size: body * 2, color: color(pal.muted) }),
        ]),
      }),
    );
  }
  if (page.table) {
    const head = new TableRow({
      tableHeader: true,
      children: page.table.head.map(
        (h) => new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, shading: { fill: color(pal.band) }, children: [new Paragraph({ children: [new TextRun({ text: h, font, bold: true, size: body * 2 - 4, color: color(pal.bandInk) })] })] }),
      ),
    });
    const rows = page.table.rows.map(
      (r) =>
        new TableRow({
          children: r.map(
            (c, i) =>
              new TableCell({
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT, children: [new TextRun({ text: String(c), font, size: body * 2 - 4, color: color(pal.ink) })] })],
              }),
          ),
        }),
    );
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...rows] }));
  }
  if (snap) {
    const width = 600;
    children.push(
      new Paragraph({
        spacing: { before: 240 },
        children: [new ImageRun({ type: "png", data: bytes(snap.png), transformation: { width, height: Math.round((width * snap.height) / snap.width) } })],
      }),
    );
  }

  const mark = logo ? new Paragraph({ children: [new ImageRun({ type: "png", data: bytes(logo), transformation: { width: 34, height: 34 } }), new TextRun({ text: "  Afrilens · The Lens", font, size: 18, bold: true, color: color(pal.ink) })] }) : new Paragraph({ children: [] });
  const doc = new Document({
    creator: "Afrilens Consulting",
    title: page.title,
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
        headers: { default: new Header({ children: [mark] }) },
        footers: {
          default: new Footer({
            children: [new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: color(pal.rule), space: 4 } }, children: [new TextRun({ text: exportStampLine(), font, size: 14, color: color(pal.faint) })] })],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}

/* ── PowerPoint: one animated slide ─────────────────────────── */

const SLIDE_W = 13.333;

export async function buildPptx(page: ExportPage, opts: { snap?: Snapshot; logo?: string }): Promise<Blob> {
  const st = resolveStyle(page.style);
  const pal = THEMES[page.theme];
  const font = FONT_FILE[st.font];
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = page.title;
  pptx.company = "Afrilens Consulting";
  const slide = pptx.addSlide();
  slide.background = { color: pal.paper.replace("#", "") };
  const ink = pal.ink.replace("#", "");
  const muted = pal.muted.replace("#", "");
  const accent = pal.accent.replace("#", "");
  const animated: { name: string; kind: "sp" | "pic" | "graphicFrame" }[] = [];

  // The band the Lens mark sits in, on every slide, as on every page of the report.
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: SLIDE_W, h: 0.9, fill: { color: pal.band.replace("#", "") }, line: { type: "none" }, objectName: "band" });
  if (opts.logo) slide.addImage({ data: opts.logo, x: 0.45, y: 0.14, w: 0.62, h: 0.62, objectName: "logo" });
  slide.addText("Afrilens · The Lens", { x: 1.2, y: 0.22, w: 6, h: 0.46, fontFace: font, fontSize: 14, bold: true, color: pal.bandInk.replace("#", ""), objectName: "brand" });
  slide.addText(page.kicker, { x: 6.5, y: 0.22, w: 6.4, h: 0.46, fontFace: font, fontSize: 11, color: pal.bandInk.replace("#", ""), align: "right", objectName: "kicker" });

  slide.addText(page.title, {
    x: 0.6,
    y: 1.1,
    w: SLIDE_W - 1.2,
    h: 0.9,
    fontFace: font,
    fontSize: 30,
    bold: true,
    color: ink,
    align: st.align === "justify" ? "left" : st.align,
    objectName: "title",
  });
  animated.push({ name: "title", kind: "sp" });

  const hasChart = Boolean(opts.snap);
  const bodyW = hasChart ? 5.6 : SLIDE_W - 1.2;
  const pAlign = st.align === "justify" ? "left" : st.align;
  if (page.paragraphs.length) {
    slide.addText(
      page.paragraphs.map((p) => ({ text: p, options: { breakLine: true, paraSpaceAfter: 10 } })),
      { x: 0.6, y: 2.1, w: bodyW, h: 4.9, fontFace: font, fontSize: SIZE_PPT[st.size], color: ink, valign: "top", align: pAlign, objectName: "body" },
    );
    animated.push({ name: "body", kind: "sp" });
  }
  if (page.kpis?.length) {
    const top = page.paragraphs.length ? 2.1 : 2.1;
    const left = hasChart ? 6.5 : 0.6;
    const cols = Math.min(4, page.kpis.length);
    const tileW = (hasChart ? 6.2 : SLIDE_W - 1.2) / cols - 0.15;
    page.kpis.slice(0, 4).forEach((k, i) => {
      const x = left + i * (tileW + 0.15);
      slide.addShape(pptx.ShapeType.rect, { x, y: top, w: tileW, h: 1.4, fill: { color: pal.card.replace("#", "") }, line: { color: pal.rule.replace("#", ""), width: 0.75 }, objectName: `kpi-${i}` });
      slide.addText([{ text: k.value, options: { breakLine: true, fontSize: 30, bold: true, color: accent } }, { text: k.label, options: { fontSize: 11, color: muted } }], { x: x + 0.1, y: top + 0.15, w: tileW - 0.2, h: 1.1, fontFace: font, align: "center", objectName: `kpi-text-${i}` });
      animated.push({ name: `kpi-${i}`, kind: "sp" }, { name: `kpi-text-${i}`, kind: "sp" });
    });
  }
  if (opts.snap) {
    const maxW = 6.8;
    const maxH = 4.9;
    const ratio = opts.snap.height / opts.snap.width;
    let w = maxW;
    let h = w * ratio;
    if (h > maxH) {
      h = maxH;
      w = h / ratio;
    }
    slide.addImage({ data: opts.snap.png, x: SLIDE_W - 0.6 - w, y: 2.1, w, h, objectName: "chart" });
    animated.push({ name: "chart", kind: "pic" });
  }
  if (page.table && !hasChart) {
    const rows = [
      page.table.head.map((h) => ({ text: h, options: { bold: true, color: pal.bandInk.replace("#", ""), fill: { color: pal.band.replace("#", "") } } })),
      ...page.table.rows.map((r) => r.map((c) => ({ text: String(c), options: { color: ink } }))),
    ];
    slide.addTable(rows, { x: 0.6, y: 3.7, w: 6.5, fontFace: font, fontSize: 13, border: { type: "solid", pt: 0.5, color: pal.rule.replace("#", "") }, objectName: "table" });
    animated.push({ name: "table", kind: "graphicFrame" });
  }
  slide.addText(exportStampLine(), { x: 0.6, y: 7.05, w: SLIDE_W - 1.2, h: 0.3, fontFace: font, fontSize: 9, color: muted, objectName: "stamp" });

  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  return animate(blob, animated);
}

/** Adds a fade-in for each shape on the slide, one after another, when it opens. */
async function animate(blob: Blob, shapes: { name: string; kind: "sp" | "pic" | "graphicFrame" }[]): Promise<Blob> {
  const zip = await JSZip.loadAsync(blob);
  const path = "ppt/slides/slide1.xml";
  const raw = await zip.file(path)?.async("string");
  if (!raw) return blob;
  // pptxgenjs can give a table the same shape id as an earlier shape; PowerPoint would repair the file. Renumber the repeats.
  const seen = new Set<string>();
  let top = Math.max(0, ...[...raw.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => Number(m[1])));
  const xml = raw.replace(/<p:cNvPr id="(\d+)"/g, (whole, id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      return whole;
    }
    top += 1;
    return `<p:cNvPr id="${top}"`;
  });
  const ids = shapes
    .map((s) => {
      const m = new RegExp(`<p:cNvPr id="(\\d+)" name="${s.name}"`).exec(xml);
      return m ? { id: m[1], kind: s.kind } : null;
    })
    .filter((x): x is { id: string; kind: "sp" | "pic" | "graphicFrame" } => x !== null);
  if (!ids.length) return blob;
  let n = 5; // ids 1-4 belong to the timing root, sequence and group
  const effects = ids
    .map((s, i) => {
      const a = n++;
      const b = n++;
      const c = n++;
      return `<p:par><p:cTn id="${a}" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="afterEffect"><p:stCondLst><p:cond delay="${i * 650}"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="${b}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${s.id}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${c}" dur="600"/><p:tgtEl><p:spTgt spid="${s.id}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
    })
    .join("");
  const build = ids.filter((s) => s.kind === "sp").map((s) => `<p:bldP spid="${s.id}" grpId="0"/>`).join("");
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${build ? `<p:bldLst>${build}</p:bldLst>` : ""}</p:timing>`;
  const next = xml.replace("</p:sld>", `${timing}</p:sld>`);
  zip.file(path, next);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

/** Saves a blob under a name. */
export function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
