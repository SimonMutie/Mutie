import { LineRuleType, AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, InternalHyperlink, Bookmark, LevelFormat, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TabStopType, TextRun, VerticalAlign, WidthType, type ParagraphChild } from "docx";
import { EMPTY, isEmpty, shownRows, toneOf, type Block, type Report, type Tone } from "./model";
import { COLORS, FONT, pieces, TONE } from "./theme";

const W = 9866; // content width in DXA on A4 with 18 mm side margins
const SZ = { body: 21, cell: 18, head: 16 };

const border = (color: string, size = 4) => ({ style: BorderStyle.SINGLE, size, color });
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const hair = { top: border(COLORS.rule), bottom: border(COLORS.rule), left: border(COLORS.rule), right: border(COLORS.rule) };

function runs(text: string, o: { bold?: boolean; italics?: boolean; color?: string; size?: number; font?: string } = {}): ParagraphChild[] {
  return pieces(text).map((p) =>
    p.url
      ? new ExternalHyperlink({ link: p.url, children: [new TextRun({ text: p.text, color: COLORS.blue, underline: {}, size: o.size ?? SZ.body, font: FONT.body })] })
      : new TextRun({ text: p.text, bold: o.bold, italics: o.italics, color: o.color ?? COLORS.text, size: o.size ?? SZ.body, font: o.font ?? FONT.body })
  );
}

const muted = (size = SZ.body) => new TextRun({ text: EMPTY, italics: true, color: "98A2B3", size, font: FONT.body });

function para(text: string, o: { size?: number; after?: number; before?: number; bold?: boolean; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; italics?: boolean } = {}): Paragraph[] {
  const lines = (text || "").split("\n");
  return lines.map(
    (line, i) =>
      new Paragraph({
        spacing: { after: i === lines.length - 1 ? (o.after ?? 100) : 40, before: i === 0 ? (o.before ?? 0) : 0, line: 264 },
        alignment: o.align,
        children: isEmpty(line) && lines.length === 1 ? [muted(o.size)] : runs(line, { bold: o.bold, size: o.size, color: o.color, italics: o.italics }),
      })
  );
}

function colWidths(rel: number[]): number[] {
  const total = rel.reduce((a, b) => a + b, 0);
  const w = rel.map((r) => Math.floor((r / total) * W));
  w[w.length - 1] += W - w.reduce((a, b) => a + b, 0);
  return w;
}

function pill(value: string, width: number, shade?: string, keep = false, neutral = false): TableCell {
  const tone = neutral ? "none" : toneOf(value);
  const t = TONE[tone];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: hair,
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, fill: isEmpty(value) ? (shade ?? "FFFFFF") : t.bg, color: "auto" },
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [new Paragraph({ keepNext: keep, alignment: AlignmentType.CENTER, children: isEmpty(value) ? [new TextRun({ text: "–", color: "98A2B3", size: SZ.cell, font: FONT.body })] : [new TextRun({ text: value, bold: true, color: t.fg, size: SZ.cell - 1, font: FONT.body })] })],
  });
}

function textCell(text: string, width: number, o: { shade?: string; bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; top?: boolean; keep?: boolean } = {}): TableCell {
  const lines = (text || "").split("\n");
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: o.top ? { ...hair, top: border(COLORS.navy, 8) } : hair,
    verticalAlign: VerticalAlign.TOP,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: o.shade, color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: lines.map(
      (line, i) =>
        new Paragraph({
          keepNext: o.keep,
          alignment: o.align,
          spacing: { after: i === lines.length - 1 ? 0 : 40, line: 250 },
          children: isEmpty(line) && lines.length === 1 ? [new TextRun({ text: "–", color: "98A2B3", size: SZ.cell, font: FONT.body })] : runs(line, { size: SZ.cell, bold: o.bold }),
        })
    ),
  });
}

function headCell(text: string, width: number, align?: (typeof AlignmentType)[keyof typeof AlignmentType]): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: { top: border(COLORS.navy), bottom: border(COLORS.navy), left: border(COLORS.navy), right: border(COLORS.navy) },
    verticalAlign: VerticalAlign.CENTER,
    shading: { type: ShadingType.CLEAR, fill: COLORS.navy, color: "auto" },
    margins: { top: 70, bottom: 70, left: 90, right: 90 },
    children: [new Paragraph({ keepNext: true, alignment: align, children: [new TextRun({ text: text.toUpperCase(), bold: true, color: COLORS.white, size: SZ.head, font: FONT.body, characterSpacing: 10 })] })],
  });
}

function table(widths: number[], head: TableRow | null, body: TableRow[]): Table {
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: head ? [head, ...body] : body });
}

const spacer = (after = 120) => new Paragraph({ spacing: { after }, children: [] });

function callout(title: string, text: string, tone: Tone): Table {
  const t = TONE[tone];
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: W, type: WidthType.DXA },
            borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 24, color: tone === "none" ? COLORS.blue : t.edge } },
            shading: { type: ShadingType.CLEAR, fill: tone === "none" ? COLORS.tint : t.bg, color: "auto" },
            margins: { top: 100, bottom: 100, left: 160, right: 140 },
            children: [
              new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: title.toUpperCase(), bold: true, size: SZ.head, color: tone === "none" ? COLORS.navy : t.fg, font: FONT.body, characterSpacing: 10 })] }),
              ...para(text, { size: 19, after: 0 }),
            ],
          }),
        ],
      }),
    ],
  });
}

function blockToDocx(b: Block): (Paragraph | Table)[] {
  switch (b.t) {
    case "h":
      return [new Paragraph({ keepNext: true, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: b.text, bold: true, size: 25, color: COLORS.blue, font: FONT.head })] })];
    case "para":
      return [...(b.label ? [new Paragraph({ keepNext: true, spacing: { after: 40 }, children: [new TextRun({ text: b.label, bold: true, size: SZ.body, color: COLORS.navy, font: FONT.body })] })] : []), ...para(b.text, { after: 120 })];
    case "bullets": {
      const items = b.items.filter((x) => !isEmpty(x));
      if (!items.length) return [...para("", { after: 120 })];
      return items.map((x, i) => new Paragraph({ numbering: { reference: b.ordered ? "num" : "bul", level: 0, instance: b.ordered ? hashInst(b.id) : undefined }, spacing: { after: 70, line: 264 }, children: runs(x) }));
    }
    case "kv": {
      const widths = colWidths([30, 70]);
      return [
        table(
          widths,
          new TableRow({ tableHeader: true, cantSplit: true, children: [headCell(b.head[0], widths[0]), headCell(b.head[1], widths[1])] }),
          b.rows.map((r, i) => new TableRow({ cantSplit: true, children: [textCell(r[0], widths[0], { shade: COLORS.tint, bold: true, keep: i < b.rows.length - 1 && b.rows.length <= 10 }), textCell(r[1], widths[1], { keep: i < b.rows.length - 1 && b.rows.length <= 10 })] }))
        ),
        spacer(),
      ];
    }
    case "table": {
      const widths = colWidths(b.cols.map((c) => c.w));
      const rows = shownRows(b);
      const head = new TableRow({ tableHeader: true, cantSplit: true, children: b.cols.map((c, i) => headCell(c.h, widths[i], c.kind === "num" ? AlignmentType.RIGHT : undefined)) });
      const keepAll = rows.length <= 9;
      const body = rows.map((r, ri) => {
        const last = !!b.boldLast && ri === rows.length - 1;
        const shade = last ? COLORS.tint : ri % 2 ? COLORS.zebra : undefined;
        const keep = keepAll && ri < rows.length - 1;
        return new TableRow({
          cantSplit: true,
          children: b.cols.map((c, ci) => {
            const v = r[ci] ?? "";
            if (c.kind === "choice" || c.kind === "auto") return pill(v, widths[ci], shade, keep, !!c.neutral);
            return textCell(v, widths[ci], { shade, bold: last, align: c.kind === "num" ? AlignmentType.RIGHT : undefined, top: last, keep });
          }),
        });
      });
      if (!body.length) return [table(widths, head, [new TableRow({ children: [textCell("None", widths[0]), ...widths.slice(1).map((w) => textCell("", w))] })]), spacer()];
      return [table(widths, head, body), ...(b.note ? para(b.note, { size: 17, color: COLORS.muted, italics: true, before: 60 }) : []), spacer()];
    }
    case "checks": {
      const half = Math.ceil(b.items.length / 2);
      const left = b.items.slice(0, half);
      const right = b.items.slice(half);
      const widths = colWidths([50, 50]);
      const cell = (it: { label: string; on: boolean } | undefined, w: number) =>
        new TableCell({
          width: { size: w, type: WidthType.DXA },
          borders: { top: none, left: none, right: none, bottom: border("E4E8EF") },
          margins: { top: 50, bottom: 50, left: 60, right: 60 },
          shading: it?.on ? { type: ShadingType.CLEAR, fill: COLORS.tint, color: "auto" } : undefined,
          children: [new Paragraph({ children: it ? [new TextRun({ text: it.on ? "☒  " : "☐  ", font: FONT.symbol, size: 20, color: it.on ? COLORS.navy : "98A2B3" }), new TextRun({ text: it.label, size: SZ.cell + 1, bold: it.on, font: FONT.body, color: COLORS.text })] : [] })],
        });
      return [
        new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows: left.map((l, i) => new TableRow({ cantSplit: true, children: [cell(l, widths[0]), cell(right[i], widths[1])] })) }),
        ...(b.note ? para(b.note, { size: 17, color: COLORS.muted, italics: true, before: 60 }) : []),
        spacer(),
      ];
    }
    case "choice": {
      const widths = colWidths([30, 70]);
      return [
        table(widths, null, [
          new TableRow({
            cantSplit: true,
            children: [
              textCell(b.label, widths[0], { shade: COLORS.tint, bold: true }),
              new TableCell({
                width: { size: widths[1], type: WidthType.DXA },
                borders: hair,
                margins: { top: 70, bottom: 70, left: 100, right: 100 },
                children: b.options.map((o) => new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: o === b.value ? "☒  " : "☐  ", font: FONT.symbol, size: 20, color: o === b.value ? COLORS.navy : "98A2B3" }), new TextRun({ text: o, bold: o === b.value, size: SZ.cell + 1, font: FONT.body, color: o === b.value ? COLORS.navy : COLORS.text })] })),
              }),
            ],
          }),
        ]),
        ...(b.note ? para(b.note, { size: 17, color: COLORS.muted, italics: true, before: 60 }) : []),
        spacer(),
      ];
    }
    case "callout":
      return [callout(b.title, b.text, b.tone ?? "none"), spacer()];
  }
}

let inst = 0;
const instMap = new Map<string, number>();
const hashInst = (id: string) => {
  if (!instMap.has(id)) instMap.set(id, ++inst);
  return instMap.get(id)!;
};

function cover(rep: Report): (Paragraph | Table)[] {
  const m = rep.meta;
  const band = new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: W, type: WidthType.DXA },
            borders: { top: none, bottom: { style: BorderStyle.SINGLE, size: 36, color: COLORS.blue }, left: none, right: none },
            shading: { type: ShadingType.CLEAR, fill: COLORS.navy, color: "auto" },
            margins: { top: 700, bottom: 700, left: 420, right: 420 },
            children: [
              new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: m.purpose.toUpperCase(), color: "9CC3E6", size: 20, bold: true, font: FONT.body, characterSpacing: 40 })] }),
              new Paragraph({ spacing: { after: 200, line: 300, lineRule: LineRuleType.AUTO }, children: [new TextRun({ text: m.target, color: COLORS.white, size: 56, bold: true, font: FONT.head })] }),
              new Paragraph({ children: [new TextRun({ text: m.transaction, color: "DCE8F5", size: 24, font: FONT.body })] }),
            ],
          }),
        ],
      }),
    ],
  });
  const widths = colWidths([30, 70]);
  const rows: [string, string][] = [[m.purpose.startsWith("Individual") ? "Subject" : "Target / transaction", `${m.target}${m.transaction ? ` · ${m.transaction}` : ""}`], ["Prepared for", m.preparedFor], ["Prepared by", m.preparedBy], ["Date", m.date], ["Version", m.versionLabel], ["Confidentiality", m.confidentiality]];
  return [
    spacer(900),
    band,
    spacer(360),
    table(
      widths,
      new TableRow({ tableHeader: true, children: [headCell("Field", widths[0]), headCell("Detail", widths[1])] }),
      rows.map((r) => new TableRow({ cantSplit: true, children: [textCell(r[0], widths[0], { shade: COLORS.tint, bold: true }), textCell(r[1], widths[1])] }))
    ),
    spacer(280),
    callout("Document control", "This report supports a structured diligence decision. Findings marked Not provided or Not assessed depend on information not yet received. Material conclusions are supported by the evidence cited and the screening audit trail in the appendices.", "none"),
  ];
}

export async function reportToDocx(rep: Report): Promise<Blob> {
  inst = 0;
  instMap.clear();
  const m = rep.meta;
  const body: (Paragraph | Table)[] = [];
  body.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 160 }, children: [new TextRun({ text: "Contents", bold: true, size: 36, color: COLORS.navy, font: FONT.head })] }));
  body.push(
    ...rep.sections.map((s) => new Paragraph({ spacing: { after: 70 }, tabStops: [{ type: TabStopType.LEFT, position: 600 }], children: [new InternalHyperlink({ anchor: `sec${s.no}`, children: [new TextRun({ text: `${s.no}\t${s.title}`, color: COLORS.navy, size: 22, font: FONT.body })] })] }))
  );
  rep.sections.forEach((s, idx) => {
    body.push(
      new Paragraph({
        pageBreakBefore: idx === 0 || s.no === "18" || s.no === "22" || s.no === "5" || s.no === "A",
        keepNext: true,
        spacing: { before: idx === 0 ? 0 : 360, after: 60 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: COLORS.blue, space: 4 } },
        children: [new Bookmark({ id: `sec${s.no}`, children: [new TextRun({ text: `${s.no}.  ${s.title}`, bold: true, size: 34, color: COLORS.navy, font: FONT.head })] })],
      })
    );
    if (s.origin !== "analyst") body.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: s.origin === "screening" ? "Prepared from public-source screening" : "Partly pre-filled from public-source screening", size: 16, italics: true, color: COLORS.muted, font: FONT.body })] }));
    for (const b of s.blocks) body.push(...blockToDocx(b));
  });
  body.push(callout("Confidentiality notice", "This report contains confidential information prepared solely for the intended recipient and purpose. It should not be distributed, reproduced or relied upon by third parties without appropriate authorisation.", "none"));

  const header = new Header({
    children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.rule, space: 4 } }, children: [new TextRun({ text: `${m.target}  ·  ${m.purpose}`, size: 16, color: COLORS.muted, font: FONT.body }), new TextRun({ text: `\t${m.confidentiality.toUpperCase()}`, size: 16, bold: true, color: COLORS.navy, font: FONT.body, characterSpacing: 10 })] })],
  });
  const footer = new Footer({
    children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: W }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.rule, space: 4 } }, children: [new TextRun({ text: `Afrilens Consulting  ·  ${m.date}  ·  ${m.versionLabel}`, size: 16, color: COLORS.muted, font: FONT.body }), new TextRun({ children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16, color: COLORS.muted, font: FONT.body })] })],
  });

  const numbering = {
    config: [
      { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 260 } }, run: { color: COLORS.blue, font: FONT.body } } }] },
      { reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 320 } }, run: { color: COLORS.navy, bold: true, font: FONT.body } } }] },
    ],
  };

  const page = { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1100, left: 1020, right: 1020, header: 560, footer: 480 } };
  const doc = new Document({
    creator: "Afrilens Consulting",
    title: `${m.purpose}: ${m.target}`,
    description: "Commercial due diligence report",
    styles: { default: { document: { run: { font: FONT.body, size: SZ.body, color: COLORS.text } } } },
    numbering,
    sections: [
      { properties: { page: { ...page, margin: { ...page.margin, top: 900 } } }, children: cover(rep) },
      { properties: { page }, headers: { default: header }, footers: { default: footer }, children: body },
    ],
  });
  return Packer.toBlob(doc);
}
