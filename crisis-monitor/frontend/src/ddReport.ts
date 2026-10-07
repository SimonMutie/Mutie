import type { DdCase, DdOutcome } from "./api";

export const OUTCOME_LABEL: Record<DdOutcome, string> = {
  potential_sanctions_match: "Potential sanctions match",
  pep_indicators: "Public office indicators",
  adverse_media: "Serious adverse media",
  review: "Needs review",
  incomplete: "Incomplete: some sources unavailable",
  no_adverse_indicators: "No adverse indicators found in sources checked",
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const link = (url: string, text?: string) => (/^https?:\/\//i.test(url) ? `<a href="${esc(url)}">${esc(text ?? url)}</a>` : esc(text ?? url));
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** The screening report as a Word/print-ready HTML document. */
export function ddReportHtml(c: DdCase): string {
  const r = c.result;
  const p: string[] = [];
  p.push(`<h1>Due diligence screening: ${esc(c.name)}</h1>`);
  p.push(`<p class="sub">${r.input.kind === "person" ? "Individual (public figure)" : "Organisation"}${r.input.country ? ` · ${esc(r.input.country)}` : ""}${c.reference ? ` · Ref ${esc(c.reference)}` : ""} · screened ${esc(new Date(r.generatedAt).toLocaleString())} · The Lens</p>`);
  if (r.input.aliases.length) p.push(`<p class="sub">Also searched as: ${esc(r.input.aliases.join("; "))}</p>`);
  if (r.input.identifiers) p.push(`<p class="sub">Identifiers supplied: ${esc(r.input.identifiers)}</p>`);
  p.push(`<p class="outcome"><b>Result:</b> ${esc(OUTCOME_LABEL[r.outcome])}</p>`);
  p.push(`<p class="note">${esc(r.disclaimer)}</p>`);
  p.push(`<h2>Summary</h2><p>${esc(r.summary.text)}</p>`);
  if (r.summary.keyPoints.length) p.push(`<ul>${r.summary.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>`);
  if (r.summary.nextSteps.length) p.push(`<h3>Next steps</h3><ul>${r.summary.nextSteps.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>`);
  p.push(`<p class="note">${r.summary.aiWritten ? "Summary drafted by AI from the findings below; check it against them." : "Summary generated from the findings below."}</p>`);

  p.push(`<h2>Sanctions lists</h2>`);
  if (!r.sanctions.hits.length) p.push(`<p>No name matches in the lists that could be checked (see source status).</p>`);
  else
    p.push(`<table><tr><th>List</th><th>Listed as</th><th>Match</th><th>Programmes</th><th>Countries</th><th>Listed</th></tr>${r.sanctions.hits
      .slice(0, 20)
      .map((h) => `<tr><td>${esc(h.list)}</td><td>${esc(h.name)}${h.matchedName !== h.name ? `<br><small>matched alias: ${esc(h.matchedName)}</small>` : ""}</td><td>${h.strength === "strong" ? "Strong" : "Possible"} (${pct(h.score)})</td><td>${esc(h.programs.join(", "))}</td><td>${esc(h.countries.join(", "))}</td><td>${esc(h.listedOn ?? "")}</td></tr>`)
      .join("")}</table>`);

  p.push(`<h2>Public office and state links (Wikidata)</h2>`);
  if (!r.office.hits.length) p.push(`<p>${r.office.state === "ok" ? "No matching record." : "Not checked: " + esc(r.office.note ?? r.office.state)}</p>`);
  for (const h of r.office.hits) {
    p.push(`<h3>${link(h.url, h.label)}${h.description ? ` <small>(${esc(h.description)})</small>` : ""} <small>${esc(h.strength)} name match</small></h3>`);
    const items = [...h.positions.map((x) => `${x.label}${x.from || x.to ? ` (${x.from ?? "?"}–${x.current ? "present" : x.to ?? "?"})` : ""}`), ...h.facts];
    if (items.length) p.push(`<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`);
  }

  p.push(`<h2>Ownership and corporate records</h2>`);
  const corp = [...r.gleif.hits.map((h) => `<li>${link(h.url, h.name)} · LEI ${esc(h.lei)} · ${esc(h.status ?? "")} ${esc(h.jurisdiction ?? "")}${h.directParent ? ` · direct parent: ${esc(h.directParent)}` : ""}${h.ultimateParent ? ` · ultimate parent: ${esc(h.ultimateParent)}` : ""}</li>`), ...r.companiesHouse.hits.map((h) => `<li>${link(h.url, h.name)} (UK Companies House, ${esc(h.kind)}) ${esc(h.status ?? "")}${h.people.length ? `<br><small>${esc(h.people.slice(0, 8).map((x) => `${x.name} (${x.role}${x.resigned ? ", resigned" : ""})`).join("; "))}</small>` : ""}${h.appointments != null ? ` · ${h.appointments} appointments` : ""}</li>`)];
  p.push(corp.length ? `<ul>${corp.join("")}</ul>` : `<p>No records found in GLEIF${r.companiesHouse.state === "ok" ? " or UK Companies House" : ""}. National registers are linked below.</p>`);

  p.push(`<h2>ICIJ Offshore Leaks</h2>`);
  p.push(r.offshore.hits.length ? `<ul>${r.offshore.hits.map((h) => `<li>${link(h.url, h.name)} ${esc(h.type ?? "")} <small>${esc(h.strength)} name match; appearing in the database is not an allegation of wrongdoing</small></li>`).join("")}</ul>` : `<p>${r.offshore.state === "ok" ? "No matching record." : "Not checked: " + esc(r.offshore.note ?? r.offshore.state)}</p>`);

  p.push(`<h2>Adverse media</h2>`);
  const m = r.media.hits[0];
  if (!m || !m.items.length) p.push(`<p>${r.media.state === "ok" ? `No adverse reporting identified among ${m?.candidates ?? 0} articles found in the last three months.` : "Not checked: " + esc(r.media.note ?? r.media.state)}</p>`);
  else {
    if (!m.classified) p.push(`<p class="note">These articles could not be assessed automatically. Read them before drawing conclusions.</p>`);
    p.push(`<table><tr><th>Date</th><th>Report</th><th>Severity</th><th>Status</th></tr>${m.items.map((i) => `<tr><td>${esc(i.published ?? "")}</td><td>${link(i.url, i.title)} <small>(${esc(i.domain)}${i.basis === "headline_only" ? ", headline only" : ""})</small><br>${esc(i.what)}</td><td>${esc(i.severity)}<br><small>${esc(i.category)}</small></td><td>${esc(i.status)}</td></tr>`).join("")}</table>`);
  }

  p.push(`<h2>Registers to check by hand</h2><ul>${r.registries.map((l) => `<li>${link(l.url, l.label)}${l.note ? ` <small>${esc(l.note)}</small>` : ""}</li>`).join("")}</ul>`);
  p.push(`<h2>Coverage and source status</h2><p>${esc(r.coverage)}</p><table><tr><th>Source</th><th>Status</th><th>Note</th></tr>${r.sources.map((s) => `<tr><td>${esc(s.label)}</td><td>${s.state === "ok" ? "Checked" : s.state === "not_configured" ? "Not set up" : "Unavailable"}</td><td>${esc(s.note ?? "")}</td></tr>`).join("")}</table>`);

  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(`Due diligence: ${c.name}`)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#131722;line-height:1.35}h1{font-size:20pt;margin:0 0 4pt}h2{font-size:14pt;margin:18pt 0 6pt;color:#0b6e66}h3{font-size:11.5pt;margin:12pt 0 2pt}p{margin:0 0 6pt}ul{margin:0 0 6pt 18pt;padding:0}li{margin-bottom:4pt}
.sub{color:#5b6577;font-size:9.5pt;margin:0 0 2pt}.note{color:#5b6577;font-size:9.5pt;font-style:italic}.outcome{font-size:12pt;margin:10pt 0}small{color:#5b6577}
table{border-collapse:collapse;margin:0 0 6pt;width:100%}th,td{border:1px solid #c9d1d9;padding:3pt 6pt;font-size:10pt;text-align:left;vertical-align:top}th{background:#e6f2f0}</style></head><body>${p.join("\n")}</body></html>`;
}

export function printDdReport(c: DdCase): void {
  const html = ddReportHtml(c).replace("</style>", "@page{margin:16mm}a{color:#0b5cad}h2,h3{page-break-after:avoid}li,tr{page-break-inside:avoid}</style>");
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 120_000);
  };
  document.body.appendChild(frame);
}

export function downloadDdReport(c: DdCase): void {
  const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "subject";
  const url = URL.createObjectURL(new Blob([ddReportHtml(c)], { type: "application/msword" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `due-diligence_${slug}_${new Date().toISOString().slice(0, 10)}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
