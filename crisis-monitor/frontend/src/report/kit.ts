import type { DdResult } from "../api";
import type { Block, CalcRule, Col, Section } from "./model";

/** Shared building blocks for the report templates (commercial and individual). */

export type Severity = "Critical" | "High" | "Medium" | "Low";
export interface Flag {
  flag: string;
  evidence: string;
  impact: string;
  severity: Severity;
  action: string;
  category: string;
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
export const LISTS = ["OFAC", "UN", "EU", "UK"];
export const LIST_NAME: Record<string, string> = { OFAC: "US Treasury OFAC (SDN)", UN: "UN Security Council consolidated", EU: "EU consolidated financial sanctions", UK: "UK Sanctions List (FCDO)" };

let seq = 0;
export const nid = (p: string) => `${p}${++seq}`;

export const H = (text: string): Block => ({ t: "h", id: nid("h"), text });
export const P = (text: string, label?: string, hint?: string): Block => ({ t: "para", id: nid("p"), text, label, hint });
export const B = (items: string[], hint?: string, ordered?: boolean): Block => ({ t: "bullets", id: nid("b"), items, hint, ordered });
export const KV = (head: [string, string], rows: [string, string][]): Block => ({ t: "kv", id: nid("kv"), head, rows });
export const CH = (items: string[], on: string[] = [], note?: string): Block => ({ t: "checks", id: nid("c"), items: items.map((label) => ({ label, on: on.includes(label) })), note });
export const CALL = (title: string, text: string, tone: Extract<Block, { t: "callout" }>["tone"] = "none"): Block => ({ t: "callout", id: nid("co"), title, text, tone });
export const CHOICE = (label: string, options: string[], value: string | null, note?: string): Block => ({ t: "choice", id: nid("ch"), label, options, value, note });
export const PHOTO = (url: string | null, caption: string, shape: "portrait" | "logo" = "portrait"): Block => ({ t: "photo", id: nid("ph"), src: null, url: url ?? undefined, caption, shape });
export const TBL = (cols: Col[], rows: string[][], o: { calc?: CalcRule[]; blank?: number; canAdd?: boolean; boldLast?: boolean; note?: string } = {}): Block => {
  const blanks = Array.from({ length: o.blank ?? 0 }, () => cols.map(() => ""));
  return { t: "table", id: nid("t"), cols, rows: [...rows, ...blanks], calc: o.calc, canAdd: o.canAdd ?? true, boldLast: o.boldLast, note: o.note };
};
export const txt = (h: string, w: number): Col => ({ h, w });
export const num = (h: string, w: number): Col => ({ h, w, kind: "num" });
export const choice = (h: string, w: number, options: string[]): Col => ({ h, w, kind: "choice", options });

export const sec = (no: string, title: string, origin: Section["origin"], blocks: Block[], intro?: string): Section => ({ id: `s${no}`, no, title, origin, intro, blocks });

export function severityRank(s: string) {
  return { Critical: 0, High: 1, Medium: 2, Low: 3 }[s] ?? 4;
}

export function sourceFor(r: DdResult, id: string) {
  return r.sources.find((s) => s.id === id);
}

/** The red flags the screening supports, most serious first. */
export function redFlags(r: DdResult): Flag[] {
  const out: Flag[] = [];
  const bySanction = new Map<string, DdResult["sanctions"]["hits"]>();
  for (const h of r.sanctions.hits) bySanction.set(h.strength, [...(bySanction.get(h.strength) ?? []), h]);
  for (const h of (bySanction.get("strong") ?? []).slice(0, 4))
    out.push({
      flag: `Strong name match on the ${h.list} sanctions list: ${h.name}`,
      evidence: `${LIST_NAME[h.list] ?? h.list}, entry ${h.ref}. Matched "${h.matchedName}" at ${pct(h.score)}${h.programs.length ? `; programmes: ${h.programs.join(", ")}` : ""}${h.listedOn ? `; listed ${h.listedOn}` : ""}. A name match is not proof of identity.`,
      impact: "If the target or an owner is the designated party, dealing with it may breach sanctions law, block payments and cause banks and partners to withdraw.",
      severity: "Critical",
      action: "Stop until identity is resolved against registration number, date of birth and ownership. Take legal advice and escalate to compliance.",
      category: "Legal",
    });
  for (const h of (bySanction.get("possible") ?? []).slice(0, 3))
    out.push({
      flag: `Possible sanctions-list name match (${h.list}): ${h.name}`,
      evidence: `${LIST_NAME[h.list] ?? h.list}, entry ${h.ref}; ${pct(h.score)} similarity to "${h.matchedName}".`,
      impact: "May be a namesake; if not, the same consequences as a confirmed match.",
      severity: "High",
      action: "Compare identifiers (registration number, address, directors) with the list entry and record the conclusion.",
      category: "Legal",
    });
  for (const h of r.office.hits.filter((x) => x.positions.length).slice(0, 2))
    out.push({
      flag: `${r.input.kind === "person" ? "Public office held" : "State or political link"}: ${h.label}`,
      evidence: `Wikidata (${h.url}): ${[...h.positions.slice(0, 3).map((p) => p.label), ...h.facts.slice(0, 2)].join("; ")}. ${h.strength === "strong" ? "Strong" : "Possible"} name match.`,
      impact: "Politically exposed persons need enhanced due diligence on source of wealth and funds, and carry higher corruption risk.",
      severity: h.positions.some((p) => p.current) ? "High" : "Medium",
      action: "Apply enhanced due diligence: source of wealth, family and close associates, and compliance sign-off.",
      category: "Legal",
    });
  for (const h of r.offshore.hits.filter((x) => x.strength === "strong").slice(0, 2))
    out.push({
      flag: `Appears in the ICIJ Offshore Leaks database: ${h.name}`,
      evidence: `${h.url} (${h.type ?? "record"}). Appearing there is not an allegation of wrongdoing.`,
      impact: "Indicates an offshore structure that may obscure beneficial ownership.",
      severity: "Medium",
      action: "Ask management to explain the structure and provide a certified ultimate-beneficial-owner declaration.",
      category: "Legal",
    });
  const media = r.media.hits[0]?.items ?? [];
  for (const i of media.filter((x) => x.severity !== "low" && x.relevance !== "different_entity").slice(0, 8)) {
    const serious = ["conviction", "penalty", "charge"].includes(i.status);
    out.push({
      flag: clip(i.what || i.title, 150),
      evidence: `${i.domain}${i.published ? `, ${i.published}` : ""}: ${i.url} (${i.basis === "full_text" ? "full text read" : "headline only"}; status: ${i.status}; ${i.relevance.replace("_", " ")})`,
      impact: i.severity === "high" ? "Serious reputational and legal exposure; may affect financing, licences and counterparties." : "Reputational and regulatory exposure if substantiated.",
      severity: i.severity === "high" ? (serious && i.relevance === "about_subject" ? "Critical" : "High") : "Medium",
      action: i.status === "allegation" ? "Obtain management's response and independent corroboration; do not treat the allegation as fact." : "Obtain court or regulator records and management's response; assess financial and licence consequences.",
      category: "Reputation",
    });
  }
  const down = r.sources.filter((s) => s.state === "unavailable" && ["OFAC", "UN", "EU", "UK", "adverse_media"].includes(s.id));
  if (down.length)
    out.push({
      flag: `Screening incomplete: ${down.map((d) => d.label).join(", ")} could not be checked`,
      evidence: down.map((d) => `${d.label}: ${d.note ?? "unavailable"}`).join(" | "),
      impact: "Absence of a match cannot be relied on for the unchecked sources.",
      severity: "Medium",
      action: "Re-run the screening once the sources are reachable, or check them manually.",
      category: "Legal",
    });
  const noOwn = !r.gleif.hits.length && !r.companiesHouse.hits.length;
  if (r.input.kind === "entity" && noOwn)
    out.push({
      flag: "Ownership could not be verified from open registries",
      evidence: "No record in GLEIF or UK Companies House. National registers were not searched automatically.",
      impact: "Beneficial owners, directors and group links are unconfirmed.",
      severity: "Low",
      action: "Obtain the share register, certificate of incorporation and a UBO declaration; search the national registry.",
      category: "Legal",
    });
  const env = r.environment;
  const crit = env?.incidents.filter((i) => i.level === "critical") ?? [];
  const elev = env?.incidents.filter((i) => i.level === "elevated") ?? [];
  if (env && (crit.length || elev.length))
    out.push({
      flag: `Active conflict escalation in ${env.country}: ${crit.length} Critical, ${elev.length} Elevated incident(s)`,
      evidence: env.incidents.slice(0, 3).map((i) => `${i.level.toUpperCase()}: ${i.headline}${i.location ? ` (${i.location})` : ""}`).join(" | "),
      impact: "Operational disruption, staff and asset security, supply-chain and insurance exposure.",
      severity: crit.length ? "High" : "Medium",
      action: "Map the target's sites and routes against the affected areas; review business-continuity plans and political-violence insurance.",
      category: "Operational",
    });
  return out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

export const resetIds = () => {
  seq = 0;
};
