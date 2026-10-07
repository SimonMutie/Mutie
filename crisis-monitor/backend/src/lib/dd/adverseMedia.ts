import type { Env } from "../../bindings";
import { fetchGdeltArticles } from "../../connectors/gdelt";
import { parseBooleanQuery } from "../../booleanQuery";
import { searchFeeds } from "../feedSearch";
import { readArticle } from "../articleReader";
import { callStructured } from "../llm";
import { nameTokens, normalizeName } from "./match";
import type { Check, Kind } from "./sources";

/**
 * Adverse-media screening: public reporting that ties the subject to
 * corruption, fraud, sanctions, sanctions-evasion, violence and similar.
 *
 * Search is broad (GDELT's three-month window plus the platform's own feeds);
 * judgement is narrow. Each candidate article is read and classified for
 * whether it is really ABOUT the subject (namesakes are the main false-positive
 * risk) and what, if anything, it alleges. The classifier is told never to
 * infer guilt; every item carries its status (allegation → conviction) and
 * whether the full text or only a headline was seen.
 */

export type MediaRelevance = "about_subject" | "mentions_subject" | "different_entity" | "unclear";
export type MediaStatus = "allegation" | "investigation" | "charge" | "conviction" | "penalty" | "cleared" | "none";
export type MediaSeverity = "high" | "medium" | "low" | "none";

export interface MediaItem {
  url: string;
  title: string;
  domain: string;
  published: string | null;
  basis: "full_text" | "headline_only";
  relevance: MediaRelevance;
  category: string;
  severity: MediaSeverity;
  status: MediaStatus;
  what: string;
}

export interface MediaResult {
  items: MediaItem[];
  candidates: number;
  read: number;
  classified: boolean;
}

const RISK_TERMS = [
  "fraud", "corruption", "bribery", "\"money laundering\"", "embezzlement", "sanctions", "sanctioned", "indicted", "arrested", "convicted",
  "investigation", "scandal", "blacklisted", "debarred", "\"terror financing\"", "smuggling", "trafficking", "lawsuit", "\"tax evasion\"", "\"abuse of office\"", "\"illicit enrichment\"",
];

const MAX_READ = 8;
const MAX_CANDIDATES = 40;

interface Candidate {
  url: string;
  title: string;
  domain: string;
  published: string | null;
  snippet: string;
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A few hundred characters either side of each mention of the name. */
export function excerptsAround(text: string, name: string, width = 350, max = 3): string {
  const lower = text.toLowerCase();
  const needle = name.toLowerCase();
  const parts: string[] = [];
  let from = 0;
  let lastEnd = -1;
  while (parts.length < max) {
    const i = lower.indexOf(needle, from);
    if (i < 0) break;
    const start = Math.max(0, i - width, lastEnd);
    const end = Math.min(text.length, i + needle.length + width);
    parts.push(text.slice(start, end).replace(/\s+/g, " ").trim());
    lastEnd = end;
    from = end;
  }
  return parts.join(" … ");
}

async function gather(env: Env, names: string[]): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  const primary = names[0];
  const risk = RISK_TERMS.join(" OR ");

  const gdelt = Promise.allSettled(
    names.slice(0, 3).map((n) => fetchGdeltArticles(`"${n}" (${risk})`, 60, "3months"))
  ).then((rs) => {
    for (const r of rs) {
      if (r.status !== "fulfilled") continue;
      for (const a of r.value) {
        if (!out.has(a.url)) out.set(a.url, { url: a.url, title: a.title, domain: a.domain || hostOf(a.url), published: a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : null, snippet: "" });
      }
    }
  });

  const feeds = (async () => {
    try {
      const queries = names.slice(0, 3).map((n, i) => {
        const text = `"${n}"`;
        return { id: `n${i}`, text, parsed: parseBooleanQuery(text) };
      });
      const res = await searchFeeds(env, queries, 90 * 24, 30);
      for (const list of res.values()) {
        for (const h of list) {
          if (!out.has(h.link)) out.set(h.link, { url: h.link, title: h.title, domain: h.domain || hostOf(h.link), published: h.published || null, snippet: h.text });
        }
      }
    } catch (err) {
      console.error("[dd] feed search failed:", err);
    }
  })();

  await Promise.all([gdelt, feeds]);
  void primary;
  // Only articles whose headline or snippet carries the name are worth reading.
  // Headlines often drop "Company"/"Ltd", so the name without suffixes (two or more words) counts too.
  const keys = names.flatMap((n) => {
    const full = normalizeName(n);
    const core = nameTokens(n, "entity").join(" ");
    return core !== full && core.split(" ").length >= 2 ? [full, core] : [full];
  }).filter(Boolean);
  const list = [...out.values()].filter((c) => {
    const hay = normalizeName(`${c.title} ${c.snippet}`);
    return keys.some((k) => hay.includes(k));
  });
  return list.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? "")).slice(0, MAX_CANDIDATES);
}

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          relevance: { type: "string", enum: ["about_subject", "mentions_subject", "different_entity", "unclear"] },
          category: { type: "string", description: "e.g. corruption, fraud, sanctions, money laundering, violence, litigation, regulatory, other, none" },
          severity: { type: "string", enum: ["high", "medium", "low", "none"] },
          status: { type: "string", enum: ["allegation", "investigation", "charge", "conviction", "penalty", "cleared", "none"] },
          what: { type: "string", description: "One or two plain sentences: what the article reports about the subject. Empty if nothing adverse." },
        },
        required: ["index", "relevance", "category", "severity", "status", "what"],
      },
    },
  },
  required: ["items"],
};

const SYSTEM = `You screen news articles for a due-diligence analyst. For each numbered article decide whether it is really about the SUBJECT and what adverse conduct, if any, it reports about them.
Rules:
- Namesakes are common. If the article is evidently about a different person or company with a similar name (different country, profession, or industry than the subject details given), mark "different_entity". If you cannot tell, mark "unclear".
- "about_subject" = the subject is a main actor. "mentions_subject" = the subject appears only in passing.
- Never infer guilt. Report what the article says, and use status to show how far it has gone: allegation, investigation, charge, conviction, penalty, or cleared (acquitted, charges dropped, exonerated). Use "none" when nothing adverse is reported.
- Severity: high = corruption, fraud, money laundering, sanctions, terror or serious violence, trafficking, convictions; medium = formal investigations, regulatory penalties, serious litigation; low = minor disputes, unproven rumours, passing mentions.
- If only a headline was available, keep severity at medium or below and say so in "what".
- Stay neutral and factual. Do not speculate beyond the text.`;

export async function screenAdverseMedia(env: Env, input: { names: string[]; kind: Kind; country: string | null; context: string | null }): Promise<Check<MediaResult>> {
  const id = "adverse_media";
  const label = "Adverse media (GDELT and platform feeds, last 3 months)";
  let candidates: Candidate[];
  try {
    candidates = await gather(env, input.names);
  } catch (err) {
    return { id, label, state: "unavailable", note: err instanceof Error ? err.message : String(err), hits: [] };
  }
  if (!candidates.length) return { id, label, state: "ok", hits: [{ items: [], candidates: 0, read: 0, classified: true }] };

  const subject = input.names[0];
  const toRead = candidates.slice(0, MAX_READ);
  const docs = await Promise.all(
    toRead.map(async (c) => {
      const art = await readArticle(c.url).catch(() => null);
      const body = art?.text ? excerptsAround(art.text, subject, 350, 3) || art.text.slice(0, 900) : "";
      return { c, body, full: !!art?.text };
    })
  );
  const rest = candidates.slice(MAX_READ, MAX_READ + 12);
  const all = [...docs, ...rest.map((c) => ({ c, body: c.snippet.slice(0, 500), full: false }))];

  const listing = all
    .map((d, i) => `[${i}] ${d.c.title} (${d.c.domain}, ${d.c.published ?? "undated"})\n${d.body || "(headline only)"}`)
    .join("\n\n");
  const user = `SUBJECT: ${input.names.join(" / ")} (${input.kind === "person" ? "individual" : "organisation"}${input.country ? `, ${input.country}` : ""})${input.context ? `\nDetails: ${input.context}` : ""}\n\nARTICLES:\n${listing}`;

  const result = await callStructured<{ items: { index: number; relevance: MediaRelevance; category: string; severity: MediaSeverity; status: MediaStatus; what: string }[] }>(env, {
    role: "analyst",
    system: SYSTEM,
    user,
    schema: SCHEMA,
    toolName: "report_articles",
    toolDescription: "Report the classification of each article.",
    maxTokens: 2500,
  }).catch(() => null);

  if (!result) {
    // Unclassified: show the headlines so the analyst can judge, but flag it plainly.
    const items: MediaItem[] = all.slice(0, 10).map((d) => ({
      url: d.c.url, title: d.c.title, domain: d.c.domain, published: d.c.published, basis: d.full ? "full_text" : "headline_only",
      relevance: "unclear", category: "unclassified", severity: "low", status: "none", what: "Not assessed: the analysis service was unavailable. Read the article.",
    }));
    return { id, label, state: "ok", note: "Articles were found but could not be assessed automatically.", hits: [{ items, candidates: candidates.length, read: docs.filter((d) => d.full).length, classified: false }] };
  }

  const items: MediaItem[] = [];
  for (const r of result.data.items ?? []) {
    const d = all[r.index];
    if (!d || r.relevance === "different_entity") continue;
    if (r.severity === "none" && r.status === "none") continue;
    items.push({
      url: d.c.url, title: d.c.title, domain: d.c.domain, published: d.c.published, basis: d.full ? "full_text" : "headline_only",
      relevance: r.relevance, category: r.category, severity: d.full ? r.severity : r.severity === "high" ? "medium" : r.severity, status: r.status, what: r.what,
    });
  }
  const rank = { high: 0, medium: 1, low: 2, none: 3 } as const;
  items.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { id, label, state: "ok", hits: [{ items, candidates: candidates.length, read: docs.filter((d) => d.full).length, classified: true }] };
}
