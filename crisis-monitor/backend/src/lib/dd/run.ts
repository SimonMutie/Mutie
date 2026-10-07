import type { Env } from "../../bindings";
import { callStructured } from "../llm";
import { screenSanctions, type ListHit, type ListStatus } from "./sanctionsLists";
import { checkCompaniesHouse, checkGleif, checkOffshoreLeaks, checkWikidata, registryLinks, type Check, type CompaniesHouseHit, type GleifHit, type Kind, type OffshoreHit, type RegistryLink, type WikidataHit } from "./sources";
import { screenAdverseMedia, type MediaResult } from "./adverseMedia";
import { checkMediaCoverage, checkSocial, type CoverageResult, type SocialResult } from "./presence";

/**
 * One due-diligence screening of an organisation or a public figure.
 * Everything here is public-source screening; the report says what was and
 * was not covered, and a source that could not be reached is reported as
 * such, never as "clear".
 */

export type Outcome = "potential_sanctions_match" | "pep_indicators" | "adverse_media" | "review" | "incomplete" | "no_adverse_indicators";

export interface DdInput {
  name: string;
  kind: Kind;
  country: string | null;
  aliases: string[];
  identifiers: string | null;
}

export interface SourceStatus {
  id: string;
  label: string;
  state: "ok" | "unavailable" | "not_configured";
  note?: string;
  url?: string;
}

export interface DdResult {
  input: DdInput;
  outcome: Outcome;
  sanctions: { hits: ListHit[]; lists: ListStatus[] };
  office: Check<WikidataHit>;
  gleif: Check<GleifHit>;
  companiesHouse: Check<CompaniesHouseHit>;
  offshore: Check<OffshoreHit>;
  media: Check<MediaResult>;
  mediaCoverage: Check<CoverageResult>;
  social: Check<SocialResult>;
  registries: RegistryLink[];
  sources: SourceStatus[];
  summary: { text: string; keyPoints: string[]; nextSteps: string[]; aiWritten: boolean };
  coverage: string;
  disclaimer: string;
  generatedAt: string;
}

export const DISCLAIMER =
  "This is an automated screening of public sources, not a finding of fact or legal advice. A name match is not proof of identity, and no match is not proof of a clean record. Confirm any hit against identifiers (date of birth, registration number, nationality) and check the registers listed before relying on it.";

const ISO2: Record<string, string> = { kenya: "KE", nigeria: "NG", "south africa": "ZA", ghana: "GH", uganda: "UG", tanzania: "TZ", rwanda: "RW" };
export const countryCodeOf = (country: string | null): string | null => {
  if (!country) return null;
  const c = country.trim();
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return ISO2[c.toLowerCase()] ?? null;
};

const notRun = (id: string, label: string, err: unknown): Check<never> => ({ id, label, state: "unavailable", note: err instanceof Error ? err.message : String(err), hits: [] });
const withDeadline = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} took too long and was skipped`)), ms))]);
const settled = async <T>(id: string, label: string, p: Promise<Check<T>>): Promise<Check<T>> => {
  try {
    return await withDeadline(p, 25_000, label);
  } catch (err) {
    return notRun(id, label, err) as Check<T>;
  }
};

export function decideOutcome(r: Pick<DdResult, "sanctions" | "office" | "offshore" | "media" | "gleif" | "companiesHouse">): Outcome {
  if (r.sanctions.hits.some((h) => h.strength === "strong")) return "potential_sanctions_match";
  if (r.office.hits.some((h) => h.isHuman && h.positions.some((p) => p.current || p.to) && h.strength === "strong")) return "pep_indicators";
  const items = r.media.hits[0]?.items ?? [];
  if (items.some((i) => i.severity === "high" && i.relevance === "about_subject")) return "adverse_media";
  const anyHit = r.sanctions.hits.length > 0 || r.offshore.hits.length > 0 || r.office.hits.some((h) => h.positions.length > 0) || items.some((i) => i.severity !== "low");
  if (anyHit) return "review";
  const sanctionsDown = r.sanctions.lists.some((l) => l.status === "unavailable");
  const mediaDown = r.media.state === "unavailable" || r.media.hits[0]?.classified === false;
  if (sanctionsDown || mediaDown) return "incomplete";
  return "no_adverse_indicators";
}

export function coverageStatement(r: Pick<DdResult, "sources">): string {
  const ok = r.sources.filter((s) => s.state === "ok");
  const missing = r.sources.filter((s) => s.state !== "ok");
  let t = `Checked: ${ok.map((s) => s.label).join("; ") || "nothing"}.`;
  if (missing.length) t += ` Not checked (${missing.map((s) => `${s.label}: ${s.state === "not_configured" ? "not set up" : "unavailable"}${s.note ? ` - ${s.note}` : ""}`).join("; ")}).`;
  t += " Not covered: non-public records, court files not reported in the media, most national company registers (links provided), and sources in languages the news search does not index.";
  return t;
}

function fallbackSummary(r: DdResult): DdResult["summary"] {
  const keyPoints: string[] = [];
  const strong = r.sanctions.hits.filter((h) => h.strength === "strong");
  if (strong.length) keyPoints.push(`Strong name match on ${[...new Set(strong.map((h) => h.list))].join(", ")} sanctions list${strong.length > 1 ? "s" : ""}: ${strong[0].name}.`);
  else if (r.sanctions.hits.length) keyPoints.push(`${r.sanctions.hits.length} possible sanctions-list name match(es) to verify.`);
  const pol = r.office.hits.find((h) => h.positions.length);
  if (pol) keyPoints.push(`Public record (Wikidata) lists ${pol.label} as holding or having held: ${pol.positions.map((p) => p.label).slice(0, 3).join(", ")}.`);
  if (r.offshore.hits.length) keyPoints.push(`${r.offshore.hits.length} possible match(es) in the ICIJ Offshore Leaks database.`);
  const mi = r.media.hits[0]?.items ?? [];
  if (mi.length) keyPoints.push(`${mi.length} adverse-media item(s); most serious: ${mi[0].what || mi[0].title}`);
  const down = r.sources.filter((x) => x.state === "unavailable");
  if (!keyPoints.length) keyPoints.push(down.length ? "Nothing was found, but this is NOT a clear result: " + down.map((x) => x.label).join(", ") + " could not be checked." : "No matches were found in the sources checked.");
  const text = {
    potential_sanctions_match: "A strong name match on a sanctions list was found. Treat as a potential match until identifiers are verified.",
    pep_indicators: "Public records indicate the subject holds or has held public office. Enhanced due diligence is usually expected.",
    adverse_media: "Serious adverse reporting about the subject was found. Review the articles and their status (allegation, charge, conviction).",
    review: "Some matches need analyst review before any conclusion.",
    incomplete: "Screening is incomplete because some sources could not be reached. Do not read this as clear.",
    no_adverse_indicators: "No adverse indicators were found in the sources checked.",
  }[r.outcome];
  const nextSteps = ["Verify identity using date of birth, registration number or nationality.", "Search the national registers linked below.", "Read the cited articles in full."];
  return { text, keyPoints, nextSteps, aiWritten: false };
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" }, keyPoints: { type: "array", items: { type: "string" } }, nextSteps: { type: "array", items: { type: "string" } } },
  required: ["text", "keyPoints", "nextSteps"],
};

async function synthesise(env: Env, r: DdResult): Promise<DdResult["summary"]> {
  const base = fallbackSummary(r);
  const facts = {
    subject: r.input,
    outcome: r.outcome,
    sanctionsHits: r.sanctions.hits.slice(0, 6).map((h) => ({ list: h.list, name: h.name, matched: h.matchedName, score: h.score, strength: h.strength, programs: h.programs, listedOn: h.listedOn, countries: h.countries })),
    sanctionsListsUnavailable: r.sanctions.lists.filter((l) => l.status !== "ok").map((l) => l.id),
    office: r.office.hits.slice(0, 3).map((h) => ({ label: h.label, description: h.description, positions: h.positions.slice(0, 4), facts: h.facts.slice(0, 4), strength: h.strength })),
    offshore: r.offshore.hits.slice(0, 4).map((h) => ({ name: h.name, type: h.type, strength: h.strength })),
    corporate: r.gleif.hits.slice(0, 2).map((h) => ({ name: h.name, jurisdiction: h.jurisdiction, status: h.status, directParent: h.directParent, ultimateParent: h.ultimateParent })),
    coverageOverview: r.mediaCoverage.hits[0]?.overview ?? null,
    socialOverview: r.social.hits[0]?.overview ?? null,
    media: (r.media.hits[0]?.items ?? []).slice(0, 8).map((i) => ({ title: i.title, domain: i.domain, category: i.category, severity: i.severity, status: i.status, what: i.what, basis: i.basis })),
  };
  const res = await callStructured<{ text: string; keyPoints: string[]; nextSteps: string[] }>(env, {
    role: "analyst",
    system:
      "You write the summary of a due-diligence screening for an analyst. Use ONLY the facts given. Be plain and neutral. Never state or imply guilt; distinguish allegation, investigation, charge and conviction. A name match is not an identity match. If any source was unavailable, say the screening is incomplete rather than clear. text: 2-4 sentences. keyPoints: up to 6 short bullets. nextSteps: up to 4 concrete verification steps.",
    user: JSON.stringify(facts),
    schema: SUMMARY_SCHEMA,
    toolName: "write_summary",
    toolDescription: "Write the screening summary.",
    maxTokens: 900,
  }).catch(() => null);
  if (!res?.data?.text) return base;
  return { text: res.data.text, keyPoints: (res.data.keyPoints ?? []).slice(0, 6), nextSteps: (res.data.nextSteps ?? []).slice(0, 4), aiWritten: true };
}

export async function runDueDiligence(env: Env, input: DdInput): Promise<DdResult> {
  const names = [input.name, ...input.aliases].filter(Boolean).slice(0, 5);
  const context = [input.identifiers, input.country].filter(Boolean).join("; ") || null;

  const [sanctions, office, gleif, ch, offshore, media, mediaCoverage, social] = await Promise.all([
    screenSanctions(env, names, input.kind).catch((err) => ({ hits: [] as ListHit[], statuses: [{ id: "OFAC", label: "Sanctions lists", searchUrl: "", status: "unavailable", error: String(err) } as ListStatus] })),
    settled("wikidata", "Public office (Wikidata)", checkWikidata(input.name, input.kind)),
    input.kind === "entity" ? settled("gleif", "Corporate records (GLEIF)", checkGleif(input.name)) : Promise.resolve<Check<GleifHit>>({ id: "gleif", label: "Corporate records (GLEIF)", state: "ok", note: "Not applicable to individuals.", hits: [] }),
    settled("companies_house", "UK Companies House", checkCompaniesHouse(env, input.name, input.kind)),
    settled("offshore", "ICIJ Offshore Leaks", checkOffshoreLeaks(input.name, input.kind)),
    withDeadline(screenAdverseMedia(env, { names, kind: input.kind, country: input.country, context }), 50_000, "Adverse media").catch((err) => notRun("adverse_media", "Adverse media", err) as Check<MediaResult>),
    settled("media_coverage", "Mainstream media coverage", checkMediaCoverage(env, { names, kind: input.kind, country: input.country })),
    settled("social", "Social media presence", checkSocial(env, { names, kind: input.kind })),
  ]);

  const sources: SourceStatus[] = [
    ...sanctions.statuses.map((s) => ({ id: s.id, label: `${s.id} sanctions list`, state: s.status, note: s.error ?? (s.stale ? "Showing the last copy loaded; the latest refresh failed." : s.asOf ? `As of ${s.asOf}` : undefined), url: s.searchUrl })),
    ...[office, gleif, ch, offshore, media, mediaCoverage, social].filter((c) => !(c.id === "gleif" && input.kind === "person")).map((c) => ({ id: c.id, label: c.label, state: c.state, note: c.note })),
  ];

  const r: DdResult = {
    input,
    outcome: "review",
    sanctions: { hits: sanctions.hits, lists: sanctions.statuses },
    office,
    gleif,
    companiesHouse: ch,
    offshore,
    media,
    mediaCoverage,
    social,
    registries: registryLinks(input.name, countryCodeOf(input.country)),
    sources,
    summary: { text: "", keyPoints: [], nextSteps: [], aiWritten: false },
    coverage: "",
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
  };
  r.outcome = decideOutcome(r);
  r.coverage = coverageStatement(r);
  r.summary = await synthesise(env, r);
  return r;
}
