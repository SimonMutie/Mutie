import { EMPTY, isEmpty, shownRows, toneOf, type Block, type Report, type Tone } from "./model";
import { COLORS, FONT, pieces, TONE } from "./theme";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function rich(text: string): string {
  return pieces(text)
    .map((p) => (p.url ? `<a href="${esc(p.url)}">${esc(p.text)}</a>` : esc(p.text).replace(/\n/g, "<br>")))
    .join("");
}
const val = (v: string) => (isEmpty(v) ? `<span class="nil">–</span>` : rich(v));
const toneCss = (t: Tone) => `color:#${TONE[t].fg};background:#${TONE[t].bg}`;

function pill(v: string, neutral = false): string {
  if (isEmpty(v)) return `<span class="nil">–</span>`;
  return `<span class="pill" style="${toneCss(neutral ? "none" : toneOf(v))}">${esc(v)}</span>`;
}

function block(b: Block): string {
  switch (b.t) {
    case "h":
      return `<h3>${esc(b.text)}</h3>`;
    case "para":
      return `${b.label ? `<div class="lead">${esc(b.label)}</div>` : ""}<p>${isEmpty(b.text) ? `<span class="muted">${EMPTY}</span>` : rich(b.text)}</p>`;
    case "bullets": {
      const items = b.items.filter((x) => !isEmpty(x));
      if (!items.length) return `<p><span class="muted">${EMPTY}</span></p>`;
      return `<${b.ordered ? "ol" : "ul"}>${items.map((x) => `<li>${rich(x)}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`;
    }
    case "kv":
      return `<table class="kv${b.rows.length <= 10 ? " keep" : ""}"><thead><tr><th>${esc(b.head[0])}</th><th>${esc(b.head[1])}</th></tr></thead><tbody>${b.rows.map((r) => `<tr><td class="k">${esc(r[0])}</td><td>${val(r[1])}</td></tr>`).join("")}</tbody></table>`;
    case "table": {
      const total = b.cols.reduce((a, c) => a + c.w, 0);
      const rows = shownRows(b);
      const head = `<tr>${b.cols.map((c) => `<th style="width:${((c.w / total) * 100).toFixed(1)}%;${c.kind === "num" ? "text-align:right" : ""}">${esc(c.h)}</th>`).join("")}</tr>`;
      const body = rows.length
        ? rows
            .map((r, ri) => {
              const last = !!b.boldLast && ri === rows.length - 1;
              return `<tr class="${last ? "tot" : ""}">${b.cols.map((c, ci) => `<td class="${c.kind === "num" ? "r" : c.kind === "choice" || c.kind === "auto" ? "c" : ""}">${c.kind === "choice" || c.kind === "auto" ? pill(r[ci] ?? "", c.neutral) : val(r[ci] ?? "")}</td>`).join("")}</tr>`;
            })
            .join("")
        : `<tr><td colspan="${b.cols.length}" class="muted">None</td></tr>`;
      return `<table class="grid${rows.length <= 9 ? " keep" : ""}"><thead>${head}</thead><tbody>${body}</tbody></table>${b.note ? `<p class="note">${esc(b.note)}</p>` : ""}`;
    }
    case "checks": {
      const half = Math.ceil(b.items.length / 2);
      const cell = (it?: { label: string; on: boolean }) => (it ? `<td class="${it.on ? "on" : ""}"><span class="box">${it.on ? "☒" : "☐"}</span> ${esc(it.label)}</td>` : "<td></td>");
      const left = b.items.slice(0, half);
      const right = b.items.slice(half);
      return `<table class="checks"><tbody>${left.map((l, i) => `<tr>${cell(l)}${cell(right[i])}</tr>`).join("")}</tbody></table>${b.note ? `<p class="note">${esc(b.note)}</p>` : ""}`;
    }
    case "choice":
      return `<table class="kv"><tbody><tr><td class="k">${esc(b.label)}</td><td>${b.options.map((o) => `<div class="${o === b.value ? "sel" : ""}"><span class="box">${o === b.value ? "☒" : "☐"}</span> ${esc(o)}</div>`).join("")}</td></tr></tbody></table>${b.note ? `<p class="note">${esc(b.note)}</p>` : ""}`;
    case "callout": {
      const t = b.tone ?? "none";
      return `<div class="callout" style="border-left-color:#${t === "none" ? COLORS.blue : TONE[t].edge};background:#${t === "none" ? COLORS.tint : TONE[t].bg}"><div class="ct" style="color:#${t === "none" ? COLORS.navy : TONE[t].fg}">${esc(b.title)}</div>${rich(b.text)}</div>`;
    }
  }
}

export function reportHtml(rep: Report): string {
  const m = rep.meta;
  const rows: [string, string][] = [["Target / transaction", `${m.target}${m.transaction ? ` · ${m.transaction}` : ""}`], ["Prepared for", m.preparedFor], ["Prepared by", m.preparedBy], ["Date", m.date], ["Version", m.versionLabel], ["Confidentiality", m.confidentiality]];
  const css = `
@page{size:A4;margin:22mm 18mm 20mm 18mm;@top-left{content:"${m.target.replace(/"/g, "'")}  ·  ${m.purpose}";font:8pt ${FONT.body},Carlito,Arial,sans-serif;color:#${COLORS.muted}}@top-right{content:"${m.confidentiality.toUpperCase()}";font:bold 8pt ${FONT.body},Carlito,Arial,sans-serif;color:#${COLORS.navy}}@bottom-left{content:"Afrilens Consulting  ·  ${m.date}  ·  ${m.versionLabel}";font:8pt ${FONT.body},Carlito,Arial,sans-serif;color:#${COLORS.muted}}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt ${FONT.body},Carlito,Arial,sans-serif;color:#${COLORS.muted}}}
@page:first{margin:14mm 18mm 16mm 18mm;@top-left{content:""}@top-right{content:""}@bottom-left{content:""}@bottom-right{content:""}}
*{box-sizing:border-box}
body{font-family:${FONT.body},Carlito,Arial,sans-serif;font-size:10.5pt;line-height:1.38;color:#${COLORS.text};margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font:700 17pt ${FONT.head},Caladea,Georgia,serif;color:#${COLORS.navy};margin:0 0 4pt;padding-bottom:4pt;border-bottom:2pt solid #${COLORS.blue};break-after:avoid}
h3{font:700 12.5pt ${FONT.head},Caladea,Georgia,serif;color:#${COLORS.blue};margin:14pt 0 5pt;break-after:avoid}
section{margin-top:18pt}section.brk{break-before:page;margin-top:0}
.origin{font-size:8pt;font-style:italic;color:#${COLORS.muted};margin:0 0 6pt}
p{margin:0 0 6pt}.muted,.nil{color:#98A2B3;font-style:italic}.nil{font-style:normal}
.lead{font-weight:700;color:#${COLORS.navy};margin-bottom:2pt}
ul,ol{margin:0 0 7pt 16pt;padding:0}li{margin-bottom:3pt}ul li::marker{color:#${COLORS.blue}}ol li::marker{color:#${COLORS.navy};font-weight:700}
table{border-collapse:collapse;width:100%;margin:0 0 9pt;table-layout:fixed}
th{background:#${COLORS.navy};color:#fff;font-size:7.5pt;letter-spacing:.06em;text-transform:uppercase;text-align:left;padding:4pt 5pt;border:.5pt solid #${COLORS.navy}}
td{border:.5pt solid #${COLORS.rule};padding:3.5pt 5pt;font-size:9pt;vertical-align:top;overflow-wrap:anywhere}
tr{break-inside:avoid}table.keep{break-inside:avoid}thead{display:table-header-group}
tbody tr:nth-child(even) td{background:#${COLORS.zebra}}
td.k{background:#${COLORS.tint}!important;font-weight:700;width:30%}
td.r{text-align:right;font-variant-numeric:tabular-nums}td.c{text-align:center;vertical-align:middle}
tr.tot td{background:#${COLORS.tint}!important;font-weight:700;border-top:1.2pt solid #${COLORS.navy}}
.pill{display:inline-block;padding:1pt 6pt;border-radius:8pt;font-weight:700;font-size:8pt;white-space:nowrap}
.checks td{border:0;border-bottom:.5pt solid #E4E8EF;background:none!important;width:50%;font-size:9.5pt;padding:3pt 4pt}.checks td.on{background:#${COLORS.tint}!important;font-weight:700}
.box{font-family:"${FONT.symbol}","DejaVu Sans",sans-serif;color:#${COLORS.navy}}.sel{font-weight:700;color:#${COLORS.navy}}
.callout{border-left:4pt solid ${COLORS.blue};padding:7pt 10pt;margin:0 0 9pt;font-size:9.5pt;break-inside:avoid}
.ct{font-weight:700;font-size:7.5pt;letter-spacing:.07em;text-transform:uppercase;margin-bottom:2pt}
.note{font-size:8.5pt;color:#${COLORS.muted};font-style:italic;margin:-4pt 0 8pt}
a{color:#${COLORS.blue}}
.cover{break-after:page;padding-top:30mm}
.band{background:#${COLORS.navy};border-bottom:4pt solid #${COLORS.blue};padding:26pt 22pt;color:#fff;margin-bottom:22pt}
.band .k1{font-size:9.5pt;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#9CC3E6;margin-bottom:8pt}
.band .t{font:700 28pt/1.15 ${FONT.head},Caladea,Georgia,serif;margin-bottom:8pt}.band .s{font-size:12pt;color:#DCE8F5}
.toc{break-after:page}.toc h1{border:0}.toc div{margin:0 0 3.5pt;font-size:10.5pt}.toc b{display:inline-block;width:26pt;color:#${COLORS.blue}}
`;
  const toc = rep.sections.map((s) => `<div><b>${esc(s.no)}</b><a href="#sec${esc(s.no)}" style="color:#${COLORS.navy};text-decoration:none">${esc(s.title)}</a></div>`).join("");
  const body = rep.sections
    .map((s, i) => `<section id="sec${esc(s.no)}" class="${i === 0 || ["5", "18", "22"].includes(s.no) ? "brk" : ""}"><h1>${esc(s.no)}.&nbsp; ${esc(s.title)}</h1>${s.origin !== "analyst" ? `<div class="origin">${s.origin === "screening" ? "Prepared from public-source screening" : "Partly pre-filled from public-source screening"}</div>` : ""}${s.blocks.map(block).join("")}</section>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(`${m.purpose}: ${m.target}`)}</title><style>${css}</style></head><body>
<div class="cover"><div class="band"><div class="k1">${esc(m.purpose)}</div><div class="t">${esc(m.target)}</div><div class="s">${esc(m.transaction)}</div></div>
<table class="kv"><thead><tr><th>Field</th><th>Detail</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="k">${esc(r[0])}</td><td>${val(r[1])}</td></tr>`).join("")}</tbody></table>
<div class="callout"><div class="ct">Document control</div>This report supports a structured diligence decision. Findings marked Not provided or Not assessed depend on information not yet received. Material conclusions are supported by the evidence cited and the audit trail in Appendix J.</div></div>
<div class="toc"><h1>Contents</h1>${toc}</div>${body}
<div class="callout"><div class="ct">Confidentiality notice</div>This report contains confidential information prepared solely for the intended recipient and purpose. It should not be distributed, reproduced or relied upon by third parties without appropriate authorisation.</div>
</body></html>`;
}

export function printReport(rep: Report): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.srcdoc = reportHtml(rep);
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 180_000);
  };
  document.body.appendChild(frame);
}

export async function downloadReportDocx(rep: Report): Promise<void> {
  const { reportToDocx } = await import("./docx");
  const blob = await reportToDocx(rep);
  const slug = rep.meta.target.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "report";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `due-diligence-report_${slug}_${new Date().toISOString().slice(0, 10)}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
