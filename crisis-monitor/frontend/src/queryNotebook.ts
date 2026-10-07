import type { MonitoringQueryItem, QueryInsights, QueryOverview, QueryWatch } from "./api";

/**
 * What the Analyst Notebook's AI draft is shown: the figures, stories,
 * alerts and incidents this dashboard holds for the chosen period, boiled
 * down to what an analyst would put in front of a colleague. The server
 * limits and checks every field again.
 */
export function buildNotebookDigest(input: { query: MonitoringQueryItem; periodLabel: string; overview: QueryOverview; insights: QueryInsights | null; watch: QueryWatch | null }) {
  const { overview, insights, watch, periodLabel } = input;
  const tone = overview.sentiment.overall;
  const toned = tone.negative + tone.neutral + tone.positive;
  const days = overview.volume.filter((v) => v.bucket.length === 10);
  const busiest = overview.volume.reduce<QueryOverview["volume"][number] | null>((best, v) => (v.count > (best?.count ?? 0) ? v : best), null);
  const prev = overview.previous && !overview.previous.partial ? overview.previous : null;
  const mix = overview.sourceMix;
  const mixTotal = mix ? mix.inCountry + mix.elsewhereInAfrica + mix.international + mix.unclassified : 0;
  const pct = (n: number) => `${Math.round((n / mixTotal) * 100)}%`;
  return {
    periodLabel,
    from: overview.from,
    to: overview.to,
    total: overview.total,
    previousTotal: prev ? prev.total : null,
    perDay: days.length ? Math.round((overview.total / days.length) * 10) / 10 : null,
    busiest: busiest && busiest.count > 0 ? `${busiest.bucket.slice(0, 10)} (${busiest.count})` : null,
    negativePct: toned ? Math.round((tone.negative / toned) * 100) : null,
    previousNegativePct: prev?.negative != null ? Math.round(prev.negative * 100) : null,
    watch: watch?.status && watch.status.state !== "learning" ? { last24h: watch.status.last24h, usual: Math.round(watch.status.usual * 10) / 10, state: watch.status.state } : null,
    alerts: (watch?.alerts ?? []).slice(0, 10).map((a) => ({ title: a.title, description: a.description })),
    incidents: (watch?.incidents ?? []).slice(0, 8).map((i) => ({ level: i.level, headline: i.headline, place: i.place, summary: i.summary, criteriaMet: i.criteriaMet.slice(0, 8), preliminary: i.preliminary, fatalitiesMax: i.fatalitiesMax })),
    stories: (insights?.stories ?? []).slice(0, 12).map((s) => ({ title: s.title, url: s.url, outlets: s.outlets, items: s.items, place: s.place, first: s.firstAt, last: s.lastAt, sources: s.sources.slice(0, 6) })),
    names: (insights?.names ?? []).slice(0, 12).map((n) => ({ label: n.label, count: n.count })),
    rising: (insights?.rising ?? []).slice(0, 8).map((n) => ({ label: n.label, recent: n.recent, earlier: n.earlier, fresh: !!n.fresh })),
    topics: overview.topics.slice(0, 12).map((t) => ({ label: t.label, count: t.count })),
    places: overview.places.slice(0, 10).map((p) => ({ label: p.label, count: p.count })),
    outlets: overview.outlets.slice(0, 8).map((o) => ({ label: o.label, count: o.count })),
    sourceMixNote:
      mix && mixTotal > 0
        ? `${pct(mix.inCountry)} of reports from outlets in the country reported on, ${pct(mix.elsewhereInAfrica)} from elsewhere in Africa, ${pct(mix.international)} international${mix.largest ? `; the largest outlet, ${mix.largest.label}, carries ${Math.round(mix.largest.share * 100)}%` : ""}`
        : null,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain web addresses in already-escaped text become links; trailing punctuation stays outside them. */
function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (m) => {
    const trail = m.match(/[.,;:)\]]+$/)?.[0] ?? "";
    const url = trail ? m.slice(0, -trail.length) : m;
    return `<a href="${url}">${url}</a>${trail}`;
  });
}

/** The summary's plain text (## headings, - bullets, paragraphs) as HTML for the Word and PDF documents. */
export function notebookHtml(body: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
    para = [];
  };
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushPara();
    } else if (line.startsWith("## ")) {
      flushList();
      flushPara();
      out.push(`<h3>${linkify(esc(line.slice(3)))}</h3>`);
    } else if (/^[-•*]\s+/.test(line)) {
      flushPara();
      list.push(linkify(esc(line.replace(/^[-•*]\s+/, ""))));
    } else {
      flushList();
      para.push(linkify(esc(line)));
    }
  }
  flushList();
  flushPara();
  return out.join("");
}
