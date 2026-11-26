import { api, type CountryDetail, type CountryMetrics } from "../api";

/**
 * The full country view inside its map popup: the numbers (with a 13-week chart), and the Lens's written
 * assessment: bottom line, assessment, historical context, drivers, outlook, what to watch, and the incidents the
 * judgement rests on. The popup opens at once with the short card; this fills in below it when it arrives.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const paras = (s: string) => s.split(/\n\s*\n/).map((p) => `<p style="margin:0 0 7px">${esc(p.trim())}</p>`).join("");
const head = (t: string) => `<div style="margin:11px 0 4px;font-size:9.5px;letter-spacing:.12em;font-weight:800;color:#8fa3bf">${t}</div>`;
const LIKELIHOOD_COLOR: Record<string, string> = {
  "remote chance": "#6b7b8f",
  "highly unlikely": "#7f93ab",
  unlikely: "#9db3cc",
  "realistic possibility": "#e8c65a",
  likely: "#f29b4b",
  "highly likely": "#ef6a4a",
  "almost certain": "#e0413d",
};

function ago(iso: string): string {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return "under an hour ago";
  if (h < 48) return `${Math.round(h)} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

function change(a: number, b: number): string {
  if (b === 0) return a === 0 ? "no change" : "up from none";
  const p = Math.round(((a - b) / b) * 100);
  return `${p >= 0 ? "+" : ""}${p}% on the 30 days before`;
}

function stat(value: string, label: string, sub: string, tone = "#eef3f9") {
  return `<div style="flex:1;min-width:0;padding:6px 7px;border-radius:7px;background:rgba(255,255,255,.05)"><div style="font-size:16px;font-weight:800;color:${tone}">${value}</div><div style="font-size:10px;line-height:1.25;color:#b9c7d8">${label}</div><div style="font-size:9.5px;color:#8fa3bf;margin-top:2px">${sub}</div></div>`;
}

/** Thirteen weekly bars, the last four (the last 30 days) brighter. */
function chart(m: CountryMetrics): string {
  const max = Math.max(1, ...m.weekly);
  const w = 13 * 14;
  const bars = m.weekly
    .map((n, i) => {
      const h = Math.max(n ? 2 : 1, (n / max) * 34);
      return `<rect x="${i * 14 + 1}" y="${36 - h}" width="11" height="${h}" rx="1.5" fill="${i >= 9 ? "#9fc8f0" : "#4a6f99"}"><title>${n} incidents</title></rect>`;
    })
    .join("");
  return `<div style="display:flex;align-items:flex-end;gap:8px;margin-top:8px"><svg width="${w}" height="38" viewBox="0 0 ${w} 38" role="img" aria-label="Incidents per week over 13 weeks">${bars}</svg><div style="font-size:9.5px;color:#8fa3bf;line-height:1.3">Incidents per week,<br/>13 weeks to ${esc(m.asOf)}</div></div>`;
}

function numbers(m: CountryMetrics): string {
  const up = m.w30 > m.wPrev30 * 1.3 && m.w30 - m.wPrev30 >= 2;
  const down = m.w30 < m.wPrev30 * 0.77 && m.wPrev30 - m.w30 >= 2;
  const tone = up ? "#ff8a6a" : down ? "#6fdc9a" : "#eef3f9";
  return (
    `<div style="display:flex;gap:5px">` +
    stat(String(m.n30), "incidents, 30 days", change(m.n30, m.nPrev30), tone) +
    stat(String(m.deaths30), "reported deaths, 30 days", `${m.deathsPrev30} the 30 before`) +
    stat(String(m.critical30), "critical incidents, 30 days", `${m.terror30} terrorism · ${m.hybrid30} hybrid`) +
    `</div>` +
    chart(m) +
    (m.gdelt ? `<div style="font-size:10.5px;color:#b9c7d8;margin-top:5px">GDELT conflict events: ${m.gdelt.events7d} this week, ${m.gdelt.prev7d} the week before.</div>` : "") +
    (m.actors90.length ? `<div style="font-size:10.5px;color:#b9c7d8;margin-top:3px"><b>Actors (90 days):</b> ${m.actors90.slice(0, 5).map((a) => `${esc(a.name)} (${a.n})`).join(", ")}</div>` : "") +
    (m.places30.length ? `<div style="font-size:10.5px;color:#b9c7d8;margin-top:2px"><b>Hotspots (30 days):</b> ${m.places30.slice(0, 5).map((p) => `${esc(p.name)} (${p.n})`).join(", ")}</div>` : "")
  );
}

export function renderCountryDetail(d: CountryDetail, canEdit: boolean): string {
  const a = d.assessment;
  const m = d.metrics;
  let out = head("THE NUMBERS") + numbers(m);
  if (a) {
    const b = a.body;
    const lk = b.outlookLikelihood;
    const evidence = b.evidence.map((id) => a.metrics.key?.find((k) => k.id === id)).filter((k): k is NonNullable<typeof k> => !!k);
    out +=
      head("ASSESSMENT") +
      paras(b.assessment) +
      (b.context ? head("IN CONTEXT") + paras(b.context) : "") +
      (b.drivers.length ? head("DRIVERS") + `<ul style="margin:0;padding-left:17px">${b.drivers.map((x) => `<li style="margin-bottom:2px">${esc(x)}</li>`).join("")}</ul>` : "") +
      (b.outlook
        ? head("OUTLOOK, NEXT 30–90 DAYS") +
          (lk ? `<span style="display:inline-block;margin-bottom:5px;padding:1px 8px;border-radius:9px;font-size:10px;font-weight:800;background:${LIKELIHOOD_COLOR[lk] ?? "#9db3cc"};color:#0b1220">${esc(lk.toUpperCase())}</span>` : "") +
          paras(b.outlook)
        : "") +
      (b.indicators.length ? head("WATCH FOR") + `<ul style="margin:0;padding-left:17px">${b.indicators.map((x) => `<li style="margin-bottom:2px">${esc(x)}</li>`).join("")}</ul>` : "") +
      (evidence.length
        ? head("EVIDENCE") +
          evidence
            .map((k) => `<div style="font-size:11px;margin-bottom:3px;color:#cfdcec"><span style="color:#8fa3bf">${esc(k.date)}</span> · ${esc(k.headline)}${k.deaths ? ` <span style="color:#8fa3bf">(up to ${k.deaths} dead)</span>` : ""}</div>`)
            .join("")
        : "") +
      (b.coverageNote ? `<div style="margin-top:8px;font-size:11px;font-style:italic;color:#b9c7d8">${esc(b.coverageNote)}</div>` : "") +
      `<div style="margin-top:9px;padding-top:6px;border-top:1px solid rgba(255,255,255,.1);font-size:10.5px;color:#8fa3bf">Lens assessment, written ${ago(a.generatedAt)} from ${a.metrics.n90 ?? 0} incidents over 90 days · confidence ${esc(b.confidence)}. Rewritten daily for active conflicts, and sooner when the numbers move.</div>`;
  } else {
    out += `<div style="margin-top:9px;font-size:11.5px;color:#b9c7d8">No written assessment yet: the Lens writes one for each country in turn, within a day.</div>`;
  }
  if (canEdit) {
    out += `<div style="margin-top:7px"><button style="background:rgba(127,127,127,.18);border:1px solid rgba(127,127,127,.4);border-radius:6px;padding:3px 9px;font-size:11.5px;cursor:pointer" onclick="this.disabled=true;this.textContent='Writing the assessment (up to a minute)…';window.dispatchEvent(new CustomEvent('lens-country-status',{detail:{code:'${esc(d.metrics.code)}',assess:true}}))">Reassess now</button></div>`;
  }
  return out;
}

/** Fills the popup's detail slot for a country (and re-fills it after a reassessment). */
export async function fillCountryDetail(root: ParentNode | null | undefined, code: string, canEdit: boolean) {
  const slot = root?.querySelector<HTMLElement>(`.lens-cs-detail[data-code="${code}"]`);
  if (!slot) return;
  try {
    const d = await api.getCountryDetail(code);
    slot.innerHTML = renderCountryDetail(d, canEdit);
  } catch {
    slot.innerHTML = `<div style="font-size:11.5px;color:#b9c7d8">The assessment could not be loaded just now.</div>`;
  }
}
