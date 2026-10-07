import type { MonitoringQueryItem, QueryInsights, QueryNote, QueryNotebook, QueryOverview, QueryWatch } from "./api";
import { notebookHtml } from "./queryNotebook";

/**
 * The briefing: one document of everything the query dashboard is showing
 * for the chosen period — the figures and how they changed, what is open,
 * the top stories with their links, the names and places, where the
 * reporting comes from, the analyst's notes, and the daily counts.
 *
 * Built in the browser from data the dashboard already holds, as a
 * formatted page that Word and Google Docs open, or that the browser prints
 * to PDF. Everything is the dashboard's own figures and lists, laid out to
 * be read and edited, except the analytical summary at the top, which is the
 * Analyst Notebook's text: drafted by a model if the analyst asked for that,
 * and as edited by them.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isWebUrl = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);
const link = (url: string | null | undefined, text: string) => (isWebUrl(url) ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text));
const num = (n: number) => n.toLocaleString();
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const shortDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "up 23% on the previous period (412)" — in words, for a document. */
export function changeWords(now: number, before: number): string | null {
  if (before <= 0) return now > 0 ? "none in the previous period" : null;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return `level with the previous period (${num(before)})`;
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on the previous period (${num(before)})`;
}

function bucketDay(bucket: string): string {
  const [y, m, d] = bucket.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export interface BriefingInput {
  query: MonitoringQueryItem;
  periodLabel: string;
  overview: QueryOverview;
  insights: QueryInsights | null;
  watch: QueryWatch | null;
  notes: QueryNote[];
  /** The Analyst Notebook's analytical summary, when it has any text. */
  summary?: Pick<QueryNotebook, "body" | "source" | "model" | "updated_at" | "updated_by_name"> | null;
}

export function briefingHtml({ query, periodLabel, overview, insights, watch, notes, summary }: BriefingInput): string {
  const tone = overview.sentiment.overall;
  const toned = tone.negative + tone.neutral + tone.positive;
  const negative = toned ? tone.negative / toned : null;
  const days = overview.volume.filter((v) => v.bucket.length === 10);
  const busiest = overview.volume.reduce<QueryOverview["volume"][number] | null>((best, v) => (v.count > (best?.count ?? 0) ? v : best), null);
  const prev = overview.previous && !overview.previous.partial ? overview.previous : null;
  const parts: string[] = [];

  // ── The analyst's reading ──
  const summaryText = summary?.body.trim() ? summary.body : null;
  if (summaryText) {
    const who = summary?.updated_by_name ? ` Last edited by ${esc(summary.updated_by_name)}${summary.updated_at ? `, ${esc(day(summary.updated_at))}` : ""}.` : "";
    parts.push(
      `<h2>Analytical summary</h2><p class="meta">${
        summary?.source === "ai" ? "Drafted by an AI model from the figures, stories and alerts below, and not yet edited by an analyst. Check it against the sources before relying on it." : "Written or edited by an analyst, starting from an AI draft where one was used."
      }${who}</p>${notebookHtml(summaryText)}`,
    );
  }

  // ── At a glance ──
  const glance: [string, string][] = [["Items collected", `${num(overview.total)}${prev ? `, ${changeWords(overview.total, prev.total) ?? ""}` : ""}`]];
  if (days.length) glance.push(["Average per day", round(Math.round((overview.total / days.length) * 10) / 10)]);
  if (busiest && busiest.count > 0) glance.push([overview.bucket === "hour" ? "Busiest hour" : "Busiest day", `${bucketDay(busiest.bucket)} (${num(busiest.count)})`]);
  if (negative != null) {
    const before = prev?.negative != null ? ` (${Math.round(prev.negative * 100)}% in the previous period)` : "";
    glance.push(["Negative in tone", `${Math.round(negative * 100)}%${before}. An estimate from the wording.`]);
  }
  if (watch?.status && watch.status.state !== "learning")
    glance.push([
      "Last 24 hours",
      `${num(watch.status.last24h)} items; a usual day has ${watch.status.usual < 1 ? "fewer than one" : `about ${round(watch.status.usual)}`} (measured over ${watch.status.basisDays} days)`,
    ]);
  parts.push(`<h2>At a glance</h2><table>${glance.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`);

  // ── What is open ──
  if (watch && (watch.incidents.length || watch.alerts.length)) {
    const incidents = watch.incidents
      .map(
        (i) =>
          `<h3>${esc(i.level === "critical" ? "Critical" : "Elevated")} escalation: ${esc(i.headline)}</h3><p class="meta">${esc(i.place)}${i.fatalitiesMax ? ` · up to ${num(i.fatalitiesMax)} reported killed` : ""}${i.preliminary ? " · preliminary (headlines only)" : ""}</p><p>${esc(i.summary)}</p>${
            i.criteriaMet.length ? `<p class="label">Criteria met</p><ul>${i.criteriaMet.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""
          }${i.sources.length ? `<p class="label">Sources</p><ol>${i.sources.map((s) => `<li>${link(s.url, s.title || s.url)} <span class="meta">${esc(s.domain)}</span></li>`).join("")}</ol>` : ""}`,
      )
      .join("");
    const surges = watch.alerts.map((a) => `<h3>${esc(a.title)}</h3><p>${esc(a.description)}</p>`).join("");
    parts.push(`<h2>Open alerts</h2>${incidents}${surges}`);
  }

  // ── Top stories ──
  if (insights?.stories.length) {
    parts.push(
      `<h2>Top stories</h2><p class="meta">Reports of the same event, grouped by the wording of their headlines and ranked by how many outlets carried them.</p><ol>${insights.stories
        .map((s) => {
          const span = shortDay(s.firstAt) === shortDay(s.lastAt) ? shortDay(s.firstAt) : `${shortDay(s.firstAt)} to ${shortDay(s.lastAt)}`;
          return `<li>${link(s.url, s.title)}<br><span class="meta">${s.outlets} outlet${s.outlets === 1 ? "" : "s"}, ${s.items} report${s.items === 1 ? "" : "s"} · ${esc(span)}${s.place ? ` · ${esc(s.place)}` : ""}${s.sources.length ? ` · ${esc(s.sources.join(", "))}` : ""}</span></li>`;
        })
        .join("")}</ol>`,
    );
  }

  // ── Names, rising terms, topics ──
  const lists: string[] = [];
  if (insights?.names.length)
    lists.push(
      `<p><b>Names most often written:</b> ${insights.names
        .slice(0, 15)
        .map((n) => `${esc(n.label)} (${num(n.count)})`)
        .join(", ")}.</p>`,
    );
  if (insights?.rising.length)
    lists.push(`<p><b>Rising in the later half of the period:</b> ${insights.rising.map((n) => `${esc(n.label)} (${num(n.recent)}, ${n.fresh ? "new" : `was ${num(n.earlier)}`})`).join(", ")}.</p>`);
  if (overview.topics.length)
    lists.push(
      `<p><b>Recurring topics:</b> ${overview.topics
        .slice(0, 15)
        .map((t) => `${esc(t.label)} (${num(t.count)})`)
        .join(", ")}.</p>`,
    );
  if (lists.length) parts.push(`<h2>Who and what</h2>${lists.join("")}`);

  // ── Where ──
  const grid = overview.placeTrend;
  if (grid?.rows.length) {
    const head = grid.buckets.map((b) => `<th class="num">${esc(shortDay(`${b}T12:00:00`))}</th>`).join("");
    parts.push(
      `<h2>Where</h2><p class="meta">Items naming each place, by ${grid.bucket === "week" ? "week (starting Monday)" : "day"}.</p><table class="grid"><tr><th>Place</th>${head}<th class="num">Total</th></tr>${grid.rows
        .map((r) => `<tr><td>${esc(r.label)}</td>${r.counts.map((c) => `<td class="num">${c ? num(c) : ""}</td>`).join("")}<td class="num"><b>${num(r.total)}</b></td></tr>`)
        .join("")}</table>`,
    );
  } else if (overview.places.length) {
    parts.push(`<h2>Where</h2><p>${overview.places.map((p) => `${esc(p.label)} (${num(p.count)})`).join(", ")}.</p>`);
  }

  // ── Sources ──
  const src: string[] = [];
  if (overview.outlets.length) src.push(`<p><b>Outlets with the most reports:</b> ${overview.outlets.map((o) => `${esc(o.label)} (${num(o.count)})`).join(", ")}.</p>`);
  const mix = overview.sourceMix;
  if (mix) {
    const total = mix.inCountry + mix.elsewhereInAfrica + mix.international + mix.unclassified;
    if (total > 0) {
      const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
      const where = mix.countries.length ? mix.countries.join(", ") : "the country reported on";
      src.push(
        `<p><b>Where the outlets are based:</b> ${pct(mix.inCountry)} in ${esc(where)}; ${pct(mix.elsewhereInAfrica)} elsewhere in Africa or pan-African; ${pct(mix.international)} international outlets and institutions; ${pct(mix.unclassified)} not classified. ${num(mix.outlets)} outlets in all${
          mix.largest ? `; the largest, ${esc(mix.largest.label)}, carries ${Math.round(mix.largest.share * 100)}% of the reports` : ""
        }.</p>`,
      );
    }
  }
  if (src.length) parts.push(`<h2>Sources</h2>${src.join("")}`);

  // ── Notes ──
  const inPeriod = notes.filter((n) => n.day >= overview.from.slice(0, 10) && n.day <= overview.to.slice(0, 10));
  if (inPeriod.length)
    parts.push(
      `<h2>Analyst notes</h2><ul>${inPeriod.map((n) => `<li><b>${esc(bucketDay(n.day))}</b>${n.author_name ? ` <span class="meta">${esc(n.author_name)}</span>` : ""}<br>${esc(n.body)}</li>`).join("")}</ul>`,
    );

  // ── Daily counts ──
  if (days.length) {
    parts.push(
      `<h2>Items per day</h2><table class="grid"><tr><th>Day</th><th class="num">Items</th><th class="num">Events</th><th class="num">Conversations</th></tr>${[...days]
        .reverse()
        .map((d) => `<tr><td>${esc(bucketDay(d.bucket))}</td><td class="num">${num(d.count)}</td><td class="num">${num(d.events)}</td><td class="num">${num(d.conversations)}</td></tr>`)
        .join("")}</table>`,
    );
  }

  parts.push(
    `<h2>How these figures are made</h2><p class="meta">Counts are of the items this query collected. Tone is an estimate from the wording of each item. Stories are grouped by headline wording, names are picked out by their capital letters, and places are those the items themselves name; none of these is written by a model.${summaryText ? (summary?.source === "ai" ? " The analytical summary is the exception: it was drafted by an AI model from these figures." : " The analytical summary is the analyst's own text, which may have begun as an AI draft.") : ""} Escalation incidents come from the platform's incident pipeline, which codes reports against written criteria. ${
      overview.sampled.used < overview.sampled.total ? `Tone, topics and places use the most recent ${num(overview.sampled.used)} of ${num(overview.total)} items.` : ""
    }</p>`,
  );

  const title = `${query.name}: briefing`;
  const sub = `${periodLabel.replace(/^the /, "The ")} (${day(overview.from)} to ${day(overview.to)}) · prepared ${new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · The Lens`;
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#131722;line-height:1.35}h1{font-size:20pt;margin:0 0 4pt}h2{font-size:14pt;margin:18pt 0 6pt;color:#0b6e66}h3{font-size:11.5pt;margin:12pt 0 2pt}p{margin:0 0 6pt}ul,ol{margin:0 0 6pt 18pt;padding:0}li{margin-bottom:4pt}
.sub,.meta{color:#5b6577;font-size:9.5pt}.label{font-size:9.5pt;color:#5b6577;margin:6pt 0 2pt}.query{font-family:Consolas,monospace;font-size:9.5pt;color:#3c4454;background:#f1f3f7;padding:4pt 6pt}
table{border-collapse:collapse;margin:0 0 6pt}th,td{border:1px solid #c9d1d9;padding:3pt 6pt;font-size:10pt;text-align:left;vertical-align:top}th{background:#e6f2f0;font-weight:bold}.num{text-align:right}</style></head>
<body><h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p><p class="query">${esc(query.boolean_query)}</p>${parts.join("\n")}</body></html>`;
}

/** The briefing as a PDF: opens the browser's print box with the document loaded, where "Save as PDF" is the destination. */
export function printBriefing(input: BriefingInput): void {
  const html = briefingHtml(input).replace("</style>", "@page{margin:16mm}a{color:#0b5cad}h2,h3{page-break-after:avoid}li,tr{page-break-inside:avoid}</style>");
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

export function downloadBriefing(input: BriefingInput): void {
  const html = briefingHtml(input);
  const slug =
    input.query.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "query";
  const url = URL.createObjectURL(new Blob([html], { type: "application/msword" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}_briefing_${new Date().toISOString().slice(0, 10)}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
