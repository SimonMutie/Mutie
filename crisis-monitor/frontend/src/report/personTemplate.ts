import type { DdCase, DdMediaItem, DdResult } from "../api";
import { B, CALL, CH, CHOICE, H, KV, LISTS, LIST_NAME, P, TBL, choice, clip, day, pct, redFlags, resetIds, sec, severityRank, txt, type Flag } from "./kit";
import type { Block, Col, Report, Section } from "./model";

/**
 * Builds the individual / public-figure due-diligence report: the 30 sections
 * and six appendices of the firm's template, filled from the public-source
 * screening where it has evidence and left open where the analyst must add
 * primary-source work (court records, regulators, declarations of interest).
 *
 * The template's principle is followed throughout: facts, evidence-supported
 * concerns, allegations and unknowns are kept apart, and an allegation is
 * never given the weight of an official finding.
 */

const PERSON_RATING = ["Minimal", "Low", "Moderate", "High", "Critical", "Not assessed"];
const CONF = ["High", "Medium", "Low", "n/a"];
const STAGES = ["Allegation", "Investigation", "Arrest", "Charge", "Trial", "Conviction", "Civil finding / penalty", "Settlement", "Appeal", "Cleared (acquittal / dismissal)"];
const CLAIM_STATUS = ["Confirmed", "Probable", "Disputed", "Unverified", "Unsupported", "False"];
const SEV = ["Low", "Moderate", "High", "Critical"];
const neutral = (h: string, w: number, options: string[] = CONF): Col => ({ ...choice(h, w, options), neutral: true });

type Conf = "High" | "Medium" | "Low";
type RiskWord = "Low" | "Moderate" | "High" | "Critical";

// ── The evidence-confidence matrix (section 22) ─────────────────────────

const MATRIX: Record<RiskWord, Record<Conf, string>> = {
  Low: { Low: "Monitor", Medium: "Monitor", High: "Low" },
  Moderate: { Low: "Investigate", Medium: "Moderate", High: "Moderate" },
  High: { Low: "Unresolved", Medium: "High", High: "High" },
  Critical: { Low: "Do not conclude", Medium: "Escalate", High: "Critical" },
};
const riskWord = (s: Flag["severity"]): RiskWord => (s === "Medium" ? "Moderate" : s);
export const outcomeOf = (sev: Flag["severity"], conf: Conf): string => MATRIX[riskWord(sev)][conf];

/** How strong the evidence behind a screening finding is: a name match or a headline is weak, a full article or an official register stronger. */
export function confidenceOf(f: Flag): Conf {
  if (/^Strong name match|^Possible sanctions|^Appears in the ICIJ/.test(f.flag)) return "Low";
  if (/^Public office|^State or political/.test(f.flag)) return "Medium";
  if (/^Screening incomplete|^Identity not settled/.test(f.flag)) return "Low";
  if (/full text read/.test(f.evidence)) return "Medium";
  return "Low";
}

// ── Classifying what the media reported ─────────────────────────────────

const CRIM = /corrupt|brib|fraud|launder|crim|traffick|terror|violen|embezzl|theft|murder|assault|arrest|charge|convict|abduct|kill/i;
const REG = /regulat|sanction|licen[cs]|tax|competition|securit|penalt|fine|debar|ethic|disciplin/i;
const CIVIL = /litigat|lawsuit|sued|civil|dispute|claim|court|insolven|bankrupt/i;
const ETHIC = /harass|discriminat|human rights|abuse|labou?r|exploit|environment|misconduct|assault|slavery|child/i;
const kindOf = (i: DdMediaItem): "crim" | "reg" | "civil" | "other" => {
  const t = `${i.category} ${i.what}`;
  return CRIM.test(t) ? "crim" : REG.test(t) ? "reg" : CIVIL.test(t) ? "civil" : "other";
};
const stageOf = (status: string): string =>
  ({ allegation: "Allegation", investigation: "Investigation", charge: "Charge", conviction: "Conviction", penalty: "Civil finding / penalty", cleared: "Cleared (acquittal / dismissal)" })[status] ?? "Allegation";
const confOfItem = (i: DdMediaItem): Conf => (i.basis === "full_text" ? "Medium" : "Low");
const outcomeText = (status: string) =>
  ({ allegation: "Not established; reported as an allegation", investigation: "Under investigation per the report; no finding recorded", charge: "Charged per the report; outcome not recorded", conviction: "Conviction reported; check the court record", penalty: "Penalty reported; check the regulator's decision", cleared: "Reported as cleared; check the record" })[status] ?? "Not recorded";
const claimStatusOf = (i: DdMediaItem): string => (i.status === "cleared" ? "Disputed" : i.basis === "full_text" && ["conviction", "penalty"].includes(i.status) ? "Probable" : "Unverified");

type Rating = [string, Conf | "n/a", string];

function ratingFor(r: DdResult, flags: Flag[]) {
  const wdStrong = r.office.hits.filter((h) => h.isHuman && h.strength === "strong");
  const wd = wdStrong[0];
  const per = wd?.person;
  const sanctionsHits = r.sanctions.hits;
  const strongS = sanctionsHits.filter((h) => h.strength === "strong");
  const listsDown = r.sources.some((s) => LISTS.includes(s.id) && s.state !== "ok");
  const listsOk = LISTS.filter((id) => r.sanctions.lists.find((l) => l.id === id)?.status === "ok").length;
  const media = (r.media.hits[0]?.items ?? []).filter((i) => i.relevance !== "different_entity");
  const mc = r.mediaCoverage?.hits[0];
  const so = r.social?.hits[0];
  const chOff = r.companiesHouse.hits.filter((h) => h.kind === "officer");
  const offshoreStrong = r.offshore.hits.filter((h) => h.strength === "strong");
  const na = (why: string): Rating => ["Not assessed", "n/a", why];

  const namesakes = wdStrong.length > 1 || r.office.hits.some((h) => h.isHuman && h.strength === "possible") || chOff.filter((h) => h.strength === "strong").length > 1;
  const identity: Rating = !wd && !chOff.length
    ? na("No public-record entry was found to anchor the subject's identity; the name alone is not enough.")
    : namesakes
      ? ["Moderate", "Low", "Several people share or resemble this name in the public records; reports must be tied to this person before use."]
      : ["Low", "Medium", `One strong match in public records${wd ? ` (${wd.label})` : ""}; the match is by name and must be confirmed against the identifiers supplied.`];

  const professional: Rating = per && (per.education.length || per.employers.length || wd?.positions.length)
    ? ["Not assessed", "n/a", "A public biography exists in Wikidata but has not been verified against primary records (university, employer, professional body)."]
    : na("No public biography was found; requires CV and primary-source verification.");

  const corporate: Rating = offshoreStrong.length
    ? ["Moderate", "Low", `Appears in the ICIJ Offshore Leaks database (${offshoreStrong[0].name}), a name match; appearing there is not an allegation of wrongdoing.`]
    : chOff.length
      ? ["Not assessed", "n/a", `${chOff[0].appointments ?? "Some"} UK company appointment(s) are listed; directorships elsewhere were not searched.`]
      : na("Directorships and shareholdings need company-registry searches in the relevant jurisdictions.");

  const crimMedia = media.filter((i) => kindOf(i) === "crim" && i.relevance === "about_subject");
  const legal: Rating = strongS.length
    ? ["Critical", "Low", "A strong sanctions-list name match needs identity resolution before anything is concluded."]
    : crimMedia.some((i) => i.severity === "high")
      ? ["High", confOfItem(crimMedia[0]) , "Serious criminal or corruption allegations are reported about the subject; none is confirmed from a court record."]
      : listsDown && !listsOk
        ? na("Sanctions lists could not be checked, and court records have not been searched.")
        : ["Low", "Low", "No criminal or civil matter found in the media searched. Court records have not been searched, so this is weak evidence."];

  const regMedia = media.filter((i) => kindOf(i) === "reg");
  const regulatory: Rating = regMedia.length
    ? [regMedia.some((i) => i.severity === "high") ? "High" : "Moderate", "Low", "Regulatory or disciplinary matters are mentioned in reporting; regulator records still need checking."]
    : na("Financial, securities, professional and electoral regulators have not been searched.");

  const sanctions: Rating = strongS.length
    ? ["Critical", "Low", `Strong name match: ${strongS[0].name} (${strongS[0].list}). A name alone does not establish identity; resolve the false positive.`]
    : sanctionsHits.length
      ? ["Moderate", "Low", "Possible name match(es) to resolve."]
      : listsDown || !listsOk
        ? na("One or more sanctions lists could not be checked.")
        : ["Minimal", "Medium", `No match on the ${listsOk} sanctions lists checked.`];

  const current = wd?.positions.some((p) => p.current);
  const political: Rating = wd?.positions.length
    ? [current ? "High" : "Moderate", "Medium", `${current ? "Holds" : "Has held"} public office (${wd.positions.slice(0, 2).map((p) => p.label).join("; ")}). Politically exposed status needs enhanced diligence and is not itself evidence of wrongdoing.`]
    : r.office.state === "ok"
      ? ["Low", "Low", "No public-office record found in Wikidata, which is not a complete register of office-holders."]
      : na("Public-office records could not be searched.");

  const conflicts: Rating = na("Needs declarations of interest, registers and the proposed role to assess.");

  const rep: Rating =
    r.media.state !== "ok"
      ? na("Media screening could not be completed.")
      : media.some((i) => i.severity === "high" && i.relevance === "about_subject")
        ? ["High", media.some((i) => i.basis === "full_text") ? "Medium" : "Low", "Serious adverse reporting about the subject (see Section 12)."]
        : media.some((i) => i.severity === "medium") || mc?.tone === "negative" || mc?.tone === "mixed"
          ? ["Moderate", "Low", "Some adverse or mixed coverage; credibility and persistence to be assessed."]
          : ["Low", "Low", "No adverse reporting identified in the last three months of the sources searched."];

  const official = so?.accounts.filter((a) => a.platform !== "Website") ?? [];
  const digital: Rating = official.length
    ? ["Low", "Low", `Official accounts on record (${official.map((a) => a.platform).join(", ")}); no verification of authenticity yet.`]
    : so?.posts.length
      ? ["Low", "Low", "Public posts naming the subject were found on open networks; no official accounts are on record."]
      : na("Major networks (X, Facebook, Instagram, LinkedIn, TikTok) have no open search and could not be measured.");

  const ethicMedia = media.filter((i) => ETHIC.test(`${i.category} ${i.what}`));
  const ethical: Rating = ethicMedia.length
    ? [ethicMedia.some((i) => i.severity === "high") ? "High" : "Moderate", confOfItem(ethicMedia[0]), "Reporting touches on conduct, labour, human-rights or environmental issues (Section 17)."]
    : na("No ethical-conduct reporting found; workplace and employment records are not public.");

  const rows: [string, Rating][] = [
    ["Identity", identity],
    ["Professional history", professional],
    ["Corporate interests", corporate],
    ["Financial", na("Needs declared interests, filings and public-company records; none is reachable by open search.")],
    ["Legal", legal],
    ["Regulatory", regulatory],
    ["Sanctions", sanctions],
    ["Political exposure", political],
    ["Conflicts of interest", conflicts],
    ["Reputation", rep],
    ["Digital footprint", digital],
    ["Associates", na("Associations need documented relationships, not proximity; none has been established.")],
    ["Ethical conduct", ethical],
    ["Governance", na("Needs board, committee and compliance records.")],
    ["Other", na("Add any other material risk relevant to the stated purpose.")],
  ];
  void flags;
  return rows;
}

const RATING_ORDER = ["Minimal", "Low", "Moderate", "High", "Critical"];
function overall(rows: [string, Rating][], flags: Flag[], thin: boolean): string {
  const outs = flags.map((f) => outcomeOf(f.severity, confidenceOf(f)));
  if (outs.some((o) => ["Critical", "Escalate", "Do not conclude"].includes(o))) return "Critical";
  if (outs.some((o) => ["High", "Unresolved"].includes(o))) return "High";
  const worst = rows.map(([, [rt]]) => RATING_ORDER.indexOf(rt)).reduce((a, b) => Math.max(a, b), -1);
  if (worst >= 3) return "High";
  if (outs.some((o) => ["Moderate", "Investigate"].includes(o)) || worst === 2) return "Moderate";
  const assessed = rows.filter(([, [rt]]) => rt !== "Not assessed").length;
  if (thin || assessed < 3) return "Insufficient Evidence";
  return "Low";
}

const REC = [
  "A. No material concern identified",
  "B. Proceed with ordinary monitoring",
  "C. Proceed subject to mitigation",
  "D. Enhanced due diligence recommended",
  "E. Escalation / do not proceed pending review",
];

export function buildPersonReport(c: DdCase): Report {
  resetIds();
  const r = c.result;
  const when = day(r.generatedAt);
  const flags0 = redFlags(r);
  const wdAll = r.office.hits.filter((h) => h.isHuman);
  const wdStrong = wdAll.filter((h) => h.strength === "strong");
  const wd = wdStrong[0];
  const per = wd?.person;
  const chOff = r.companiesHouse.hits.filter((h) => h.kind === "officer");
  const chStrong = chOff.filter((h) => h.strength === "strong");
  const namesakes = wdStrong.length > 1 || wdAll.some((h) => h.strength === "possible") || chStrong.length > 1;
  const identityKnown = !!(r.input.identifiers && r.input.identifiers.trim());

  // Findings that the report adds to the ones the screening engine raises.
  const extra: Flag[] = [];
  if (namesakes)
    extra.push({
      flag: "Identity not settled: other people share or resemble this name",
      evidence: `${wdAll.length} person record(s) in Wikidata${chStrong.length ? ` and ${chStrong.length} officer listing(s) in UK Companies House` : ""} match the name. ${identityKnown ? "Compare them with the identifiers supplied." : "No identifying details were supplied."}`,
      impact: "Reports and records about a namesake could be attributed to the subject, or the subject's own record missed.",
      severity: "Medium",
      action: "Tie every adverse finding to this person using date of birth, nationality, role or employer before it is relied on.",
      category: "Identity",
    });
  const flags = [...flags0, ...extra].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const rows = ratingFor(r, flags);
  const listsDown = r.sources.some((s) => LISTS.includes(s.id) && s.state !== "ok");
  const thin = listsDown || r.media.state !== "ok";
  const overallRisk = overall(rows, flags, thin);
  const strongS = r.sanctions.hits.some((h) => h.strength === "strong");

  const recIdx = overallRisk === "Critical" ? 4 : overallRisk === "High" ? 3 : overallRisk === "Moderate" ? (listsDown ? 3 : 2) : overallRisk === "Insufficient Evidence" ? 3 : flags.length ? 1 : 1;
  const rec = REC[recIdx];

  const allMedia = (r.media.hits[0]?.items ?? []).filter((i) => i.relevance !== "different_entity");
  const adverse = allMedia.filter((i) => i.severity !== "none" || i.status !== "none");
  const namesakeItems = (r.media.hits[0]?.items ?? []).filter((i) => i.relevance === "different_entity").length;
  const mc = r.mediaCoverage?.hits[0];
  const so = r.social?.hits[0];
  const ok = (id: string) => r.sources.find((s) => s.id === id)?.state === "ok";
  const listsOk = LISTS.filter((id) => r.sanctions.lists.find((l) => l.id === id)?.status === "ok");

  const positives: string[] = [];
  if (listsOk.length && !r.sanctions.hits.length) positives.push(`No match on the ${listsOk.length} sanctions list(s) checked (${listsOk.join(", ")}).`);
  if (r.offshore.state === "ok" && !r.offshore.hits.length) positives.push("No record in the ICIJ Offshore Leaks database.");
  if (r.media.state === "ok" && !adverse.length) positives.push("No adverse reporting about the subject in the last three months of the sources searched.");
  if (per?.awards.length) positives.push(`Public recognition on record: ${per.awards.slice(0, 3).join("; ")}.`);
  if (per?.education.length) positives.push(`Public biography lists education at ${per.education.slice(0, 2).map((e) => e.label).join(" and ")} (unverified).`);
  if (so?.accounts.some((a) => a.platform !== "Website")) positives.push("Official accounts are recorded in a public reference (Wikidata), which helps rule out impersonation once checked.");
  if (mc && mc.total > 0 && mc.tone === "positive") positives.push("Mainstream coverage is predominantly positive.");

  const unresolved: string[] = [];
  if (namesakes) unresolved.push("Which public records and reports concern this individual and which concern namesakes.");
  if (listsDown) unresolved.push(`Sanctions screening is incomplete (${r.sources.filter((s) => LISTS.includes(s.id) && s.state !== "ok").map((s) => s.id).join(", ")} not checked).`);
  if (strongS) unresolved.push("Whether the sanctions-list name match is the subject or a namesake.");
  for (const i of adverse.filter((x) => ["allegation", "investigation"].includes(x.status)).slice(0, 3)) unresolved.push(`${clip(i.what || i.title, 140)} (${i.status}, ${i.domain}).`);
  unresolved.push("Court, regulatory and company-registry records beyond the open sources searched.");

  const overallText = `${
    flags.length
      ? `${flags.length} finding(s) were raised from public sources, the most serious being: ${flags.slice(0, 2).map((f) => f.flag).join("; ")}.`
      : "No adverse finding was raised from the public sources searched."
  } ${thin ? "The screening was incomplete, so the absence of findings is weak evidence. " : ""}Findings are weighed by both severity and the strength of evidence (Section 22), so an unverified allegation does not carry the weight of an official finding.`;

  const sections: Section[] = [];
  const meta = (k: string, v: string): [string, string] => [k, v];

  // 1 ─ Executive summary
  sections.push(
    sec("1", "Executive Summary", "partly", [
      CALL("Basis of this report", `Pre-filled from public-source screening run on ${when}. Court records, regulators, declarations of interest and the subject's own response are not covered and need analyst work. Ratings are preliminary until confirmed.`, "watch"),
      KV(["Item", "Detail"], [
        meta("Subject", c.name),
        meta("Aliases / professional names", r.input.aliases.join("; ")),
        meta("Research period", `Media: three months to ${when}. Lists and registers: as at ${when}.`),
        meta("Source cut-off date", when),
        meta("Overall risk rating", overallRisk),
      ]),
      H("1.1 Purpose"),
      CH(["Reputational due diligence", "Business / investment assessment", "Political-risk assessment", "Media / editorial assessment", "Employment / appointment assessment", "Partnership assessment", "Other"], ["Reputational due diligence"], "Tick the purposes this report serves; the research must be proportionate to them."),
      H("1.2 Scope"),
      CH(
        ["Identity and professional history", "Education and qualifications", "Corporate and organisational affiliations", "Business interests", "Political and public affiliations", "Legal and regulatory history", "Litigation and disputes", "Financial and commercial indicators", "Sanctions and watchlists", "Conflicts of interest", "Public statements and conduct", "Media and reputation", "Digital / public online presence", "Charitable and nonprofit activities", "Associates and relevant entities", "Contradictions and discrepancies"],
        [
          "Identity and professional history",
          ...(per?.education.length ? ["Education and qualifications"] : []),
          ...(chOff.length || r.offshore.state === "ok" ? ["Corporate and organisational affiliations"] : []),
          "Political and public affiliations",
          ...(adverse.length ? ["Legal and regulatory history"] : []),
          "Sanctions and watchlists",
          "Media and reputation",
          "Digital / public online presence",
        ],
        "Ticked items were covered, at least in part, by the public-source screening."
      ),
      KV(["Scope", "Detail"], [meta("Geographic scope", r.input.country ?? "Not limited; add jurisdictions searched"), meta("Temporal scope", "Media: last three months. Lists: current."), meta("Subject identifiers supplied", r.input.identifiers ?? "None")]),
      H("1.3 Executive Assessment"),
      B(positives.length ? positives : ["None established from the open sources searched."], "Key positive findings"),
      B(flags.slice(0, 6).map((f) => `${f.flag} (${f.severity}; evidence confidence ${confidenceOf(f)})`).concat(flags.length ? [] : ["None raised from the open sources searched."]), "Key adverse findings"),
      B(unresolved.slice(0, 6), "Material unresolved issues"),
      P(overallText, "Overall assessment"),
      CALL("Keep these apart", "Established facts · allegations · findings reported by credible sources · matters under investigation · disputed claims · reasonable analytical inferences · researcher judgment. Never collapse one into another.", "none"),
    ])
  );

  // 2 ─ Subject identification
  const idRows: string[][] = [
    ["Full name", c.name, wd ? `Wikidata: ${wd.url}` : "As supplied", wd ? "Medium" : "Low"],
    ["Professional name / aliases", r.input.aliases.join("; "), r.input.aliases.length ? "As supplied" : "", r.input.aliases.length ? "Low" : ""],
    ["Occupation", per?.occupations.join(", ") ?? "", per?.occupations.length ? `Wikidata: ${wd!.url}` : "", per?.occupations.length ? "Low" : ""],
    ["Organisation", per?.employers.filter((e) => !e.to).map((e) => e.label).join("; ") ?? "", per?.employers.length ? `Wikidata: ${wd!.url}` : "", per?.employers.length ? "Low" : ""],
    ["Public biography", wd?.description ?? "", wd ? wd.url : "", wd?.description ? "Low" : ""],
    ["Identifiers supplied by the requester", r.input.identifiers ?? "", "Requester", r.input.identifiers ? "Medium" : ""],
  ];
  const other = wdAll.filter((h) => h !== wd);
  sections.push(
    sec("2", "Subject Identification", "partly", [
      H("2.1 Core Identity"),
      KV(["Item", "Detail"], [
        ["Full name", c.name],
        ["Year of birth (only if publicly established and relevant)", wd && per?.born ? `${per.born} (Wikidata; confirm)` : ""],
        ["Nationality / citizenship", wd?.countries?.length ? `${wd.countries.join(", ")} (Wikidata; confirm)` : ""],
        ["Primary countries of activity", r.input.country ?? ""],
        ["Known professional names", r.input.aliases.join("; ")],
        ["Current occupation / title", per?.occupations.join(", ") ?? ""],
        ["Current organisations", per?.employers.filter((e) => !e.to).map((e) => e.label).join("; ") ?? ""],
        ["Publicly stated residence / base", ""],
      ]),
      P("Record a base only where it is relevant and publicly stated. Home addresses and similar personal-location details are out of scope.", undefined, undefined),
      H("2.2 Identity Verification"),
      P("Evidence that sources with different names or profiles concern the same individual.", undefined),
      TBL([txt("Identifier", 20), txt("Information", 32), txt("Source", 30), neutral("Confidence", 18)], idRows, { blank: 2 }),
      H("Potential Identity Confusion"),
      B(
        [
          ...other.slice(0, 4).map((h) => `${h.label}${h.description ? ` (${h.description})` : ""}: ${h.strength} name match in Wikidata, ${h.url}`),
          ...chStrong.slice(0, 3).map((h) => `${h.name}: UK Companies House officer listing${h.appointments != null ? `, ${h.appointments} appointment(s)` : ""}`),
          ...(namesakeItems ? [`${namesakeItems} news article(s) were set aside as concerning a different person or company.`] : []),
        ].concat(namesakes || namesakeItems ? [] : ["No namesake was found in the sources searched; this does not rule one out."]),
        "People with similar names, duplicate or misattributed profiles, conflicting biographies, doubtful social accounts, outdated information, copied or AI-generated biographies, unverified identity claims."
      ),
      CHOICE("Assessment", ["Confirmed", "Probable", "Uncertain"], !wd && !chStrong.length ? "Uncertain" : namesakes ? "Uncertain" : identityKnown ? "Probable" : "Uncertain", "Preliminary. Confirmed needs a document-level match; a name match is never enough."),
    ])
  );

  // 3 ─ Methodology
  const srcRows = r.sources.map((s) => [s.label, s.state === "ok" ? "Searched" : s.state === "unavailable" ? "Unavailable" : "Not set up", s.note ?? ""]);
  sections.push(
    sec("3", "Research Methodology", "screening", [
      H("3.1 Sources Consulted"),
      TBL([txt("Source", 44), choice("Status", 16, ["Searched", "Unavailable", "Not set up"]), txt("Note", 40)], srcRows, { canAdd: false }),
      P("Sources not reachable by open search and so not consulted: court records, parliamentary registers of interest, professional registers, regulators' enforcement databases, non-UK company registries, paywalled press. Tertiary sources (Wikipedia, Wikidata, social platforms, aggregators) are treated as leads, not conclusions, unless corroborated."),
      H("3.2 Search Methodology"),
      KV(["Item", "Detail"], [
        ["Names searched", [c.name, ...r.input.aliases].join("; ")],
        ["Name variations", "Word order, accents, common transliterations and honorifics are handled by the matcher; no manual variants were added."],
        ["Organisations searched", per?.employers.map((e) => e.label).join("; ") ?? ""],
        ["Jurisdictions", r.input.country ?? "Not limited"],
        ["Date range", "Media: last three months. Lists and registers: current."],
        ["Languages", "Names as supplied; news indexed in many languages, classified in English."],
        ["Databases", r.sources.filter((s) => s.state === "ok").map((s) => s.label).join("; ")],
        ["Social platforms reviewed", so?.networksSearched.join(", ") ?? ""],
        ["Court and regulatory systems reviewed", "None automatically"],
        ["Corporate registries reviewed", [r.companiesHouse.state === "ok" ? "UK Companies House" : "", r.offshore.state === "ok" ? "ICIJ Offshore Leaks" : ""].filter(Boolean).join("; ")],
      ]),
      H("3.3 Source Reliability Framework"),
      TBL(
        [txt("Tier", 18), txt("Evidence", 40), txt("Used in this screening", 42)],
        [
          ["1 — Primary evidence", "Official records, original filings, court documents, regulatory decisions, direct statements.", "Official sanctions lists; UK Companies House."],
          ["2 — High-quality secondary", "Established investigative reporting, reputable journalism, academic and specialist publications.", "News articles read in full (outlet quality still to be judged)."],
          ["3 — Corroborated open source", "Multiple independent sources with consistent evidence.", "Applied only where two outlets report independently."],
          ["4 — Unverified material", "Single-source allegations, anonymous claims, social posts, blogs, forums.", "Headline-only items; Wikidata; Bluesky and Mastodon posts."],
          ["5 — Speculation", "Rumour, unsupported inference, anonymous commentary.", "Not relied on."],
        ],
        { canAdd: false }
      ),
    ])
  );

  // 4 ─ Biography
  const edu = (per?.education ?? []).map((e) => [e.label, "", "", [e.from, e.to].filter(Boolean).join("–"), "", wd ? `Wikidata ${wd.url}` : "", "Unverified (Wikidata only)"]);
  const jobs: string[][] = [
    ...(wd?.positions ?? []).map((p) => [[p.from, p.current ? "present" : p.to].filter(Boolean).join("–"), "", p.label, r.input.country ?? "", `Wikidata ${wd!.url}`, "Medium"]),
    ...(per?.employers ?? []).map((e) => [[e.from, e.to ?? "present"].filter(Boolean).join("–"), e.label, "", "", `Wikidata ${wd!.url}`, "Low"]),
  ];
  sections.push(
    sec("4", "Biographical & Professional History", "partly", [
      H("4.1 Education"),
      TBL([txt("Institution", 18), txt("Degree", 12), txt("Field", 12), txt("Dates", 10), txt("Graduation", 13), txt("Source", 17), txt("Verification", 18)], edu, { blank: edu.length ? 1 : 3 }),
      CH(["Inconsistent dates", "Institution did not exist in the period", "Unverifiable qualification", "Exaggerated credential", "Honorary presented as earned", "Conflicting biographies"], [], "Qualification concerns: tick any found when the records are checked."),
      H("4.2 Employment / Career Timeline"),
      TBL([txt("Period", 11), txt("Organisation", 20), txt("Position", 20), txt("Location", 12), txt("Evidence", 20), neutral("Confidence", 17)], jobs, { blank: 2 }),
      P("", "Gaps and inconsistencies", "Identify unexplained gaps and significant inconsistencies in the timeline."),
      H("4.3 Professional Credentials"),
      CH(["Licences", "Professional memberships", "Directorships", "Certifications", "Disciplinary history", "Revoked or suspended credentials", "Claimed expertise matches qualifications"], [], "Check each against the issuing body's register."),
      B(per?.memberships.length ? per.memberships : [], "Memberships recorded in Wikidata (unverified)."),
    ])
  );

  // 5 ─ Corporate
  sections.push(
    sec("5", "Corporate & Business Interests", "partly", [
      H("5.1 Current Organisations"),
      TBL(
        [txt("Entity", 22), txt("Role", 12), txt("Ownership / control", 16), txt("Jurisdiction", 14), txt("Status", 14), txt("Source", 22)],
        [
          ...(per?.employers.filter((e) => !e.to).map((e) => [e.label, "Employer or affiliation", "", "", "Current", `Wikidata ${wd!.url}`]) ?? []),
          ...chStrong.map((h) => [`UK company officer listing: ${h.name}`, "Officer", "See register", "United Kingdom", `${h.appointments ?? "?"} appointment(s)`, h.url]),
        ],
        { blank: 2 }
      ),
      H("5.2 Historical Organisations"),
      B(per?.employers.filter((e) => e.to).map((e) => `${e.label} (${[e.from, e.to].filter(Boolean).join("–")})`) ?? [], "Previous and dissolved companies, insolvencies, mergers, failed ventures, renamed entities, and entities linked through directors or shareholders."),
      CH(["Previous companies identified", "Dissolved or liquidated entities", "Bankruptcies / insolvencies", "Mergers or acquisitions", "Failed ventures", "Renamed entities"], [], "Tick when searched in the relevant registers."),
      H("5.3 Beneficial Ownership"),
      P("Where legally and legitimately available: direct ownership, disclosed beneficial ownership, controlling interests, nominees, trusts or holding structures, and family or business relationships relevant to control. Beneficial ownership is never inferred from proximity or association.", undefined, "Record what registers show, and the register consulted."),
      H("5.4 Corporate Red Flags"),
      CH(["Rapid company formation or dissolution", "Repeated insolvency", "Regulatory intervention", "Undisclosed related-party transactions", "Unexplained ownership transfers", "Shell-company indicators", "Inconsistent corporate disclosures", "Public biography conflicts with filings"], [], "Tick only on evidence."),
      ...(r.offshore.hits.length ? [CALL("ICIJ Offshore Leaks", `${r.offshore.hits.slice(0, 3).map((h) => `${h.name} (${h.strength} name match, ${h.url})`).join("; ")}. Appearing in the database is not an allegation of wrongdoing; confirm the record is this person.`, r.offshore.hits.some((h) => h.strength === "strong") ? "watch" : "none")] : [CALL("ICIJ Offshore Leaks", r.offshore.state === "ok" ? "No record found." : "Not checked.", "none")]),
    ])
  );

  // 6 ─ Financial
  sections.push(
    sec("6", "Financial & Commercial Due Diligence", "analyst", [
      CALL("Proportionality", "Include only financial information that is lawfully obtainable, relevant and proportionate to the purpose. Do not label unexplained wealth as illicit wealth without evidence.", "none"),
      H("6.1 Publicly Documented Financial Interests"),
      TBL([txt("Interest", 26), txt("Type", 16), txt("Detail", 28), txt("Source", 30)], [], { blank: 3 }),
      P("", undefined, "Disclosed investments, public-company holdings, directorships, declared assets where officially available, public-office disclosures, major transactions, publicly disclosed compensation."),
      H("6.2 Commercial Track Record"),
      P("", undefined, "Successful and failed ventures, creditor disputes, insolvencies, contractual disputes, procurement history, government contracts and significant counterparties."),
      H("6.3 Financial Red Flags"),
      CH(["Unexplained wealth claims", "Declared interests differ from documented holdings", "Suspicious corporate structures", "Regulatory findings", "Documented financial misconduct", "Fraud judgments or enforcement actions"], [], "Investigate only where evidence supports doing so."),
    ])
  );

  // 7 ─ Legal
  const crim = adverse.filter((i) => kindOf(i) === "crim");
  const civ = adverse.filter((i) => kindOf(i) === "civil");
  const reg = adverse.filter((i) => kindOf(i) === "reg");
  const legalCols = [txt("Jurisdiction / authority", 14), txt("Date", 10), txt("Nature of allegation", 28), choice("Stage", 14, STAGES), txt("Outcome", 12), txt("Source", 14), neutral("Confidence", 10)];
  const legalRow = (i: DdMediaItem) => [r.input.country ?? "", i.published ?? "", i.what || i.title, stageOf(i.status), outcomeText(i.status), `${i.domain} ${i.url}`, confOfItem(i)];
  sections.push(
    sec("7", "Legal & Litigation History", "partly", [
      CALL("Never collapse these", "Allegation · investigation · arrest · charge · trial · conviction · acquittal · dismissal · civil finding · settlement · appeal. Entries below come from news reports only; each needs the court or regulator record before it is treated as fact.", "watch"),
      H("7.1 Criminal Matters"),
      TBL(legalCols, crim.map(legalRow), { blank: crim.length ? 1 : 2 }),
      H("7.2 Civil Litigation"),
      TBL([txt("Matter", 26), txt("Role", 12), txt("Amount", 12), txt("Judgment / settlement", 20), txt("Appeal", 10), choice("Ongoing?", 10, ["Yes", "No", "Unknown"]), txt("Source", 10)], civ.map((i) => [i.what || i.title, "", "", outcomeText(i.status), "", "Unknown", i.domain]), { blank: civ.length ? 1 : 2 }),
      H("7.3 Regulatory / Administrative Proceedings"),
      TBL(legalCols, reg.map(legalRow), { blank: reg.length ? 1 : 2 }),
      CH(["Financial regulators", "Competition authorities", "Securities regulators", "Professional regulators", "Licensing bodies", "Electoral authorities", "Tax authorities (where public)", "Industry regulators"], [], "Tick each regulator searched; none was searched automatically."),
      H("7.4 Legal Pattern Assessment"),
      CHOICE("Pattern", ["Isolated disputes", "Recurring litigation", "Repeated regulatory problems", "Repeated allegations of similar conduct", "Systematic noncompliance", "No pattern evident", "Not assessed"], adverse.length ? null : "Not assessed", "A high volume of litigation is not misconduct without context."),
    ])
  );

  // 8 ─ Sanctions
  const sanctionRows: string[][] = [];
  for (const id of LISTS) {
    const st = r.sanctions.lists.find((l) => l.id === id);
    const asOf = st?.asOf ? new Date(st.asOf).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const hits = r.sanctions.hits.filter((h) => h.list === id);
    if (st?.status !== "ok") sanctionRows.push([LIST_NAME[id] ?? id, "Not checked", st?.error ?? "List not loaded", "", "Not checked", "n/a"]);
    else if (!hits.length) sanctionRows.push([LIST_NAME[id] ?? id, "No match", `${st.entries ?? ""} entries searched`.trim(), asOf, "Not listed", "Medium"]);
    else for (const h of hits) sanctionRows.push([LIST_NAME[id] ?? id, `${h.strength === "strong" ? "Strong" : "Possible"} match: ${h.name}`, `Matched "${h.matchedName}" at ${pct(h.score)}${h.programs.length ? `; ${h.programs.join(", ")}` : ""}; entry ${h.ref}`, h.listedOn ?? asOf, "Listed on current list", "Low"]);
  }
  const fp = r.sanctions.hits.map((h) => {
    const country = (r.input.country ?? "").toLowerCase();
    const same = country && h.countries.some((x) => x.toLowerCase().includes(country) || country.includes(x.toLowerCase()));
    return [`${h.name} (${h.list})`, same ? `Country consistent (entry: ${h.countries.join(", ")})` : h.countries.length ? `None established (entry: ${h.countries.join(", ")})` : "None established", same ? "" : "Country differs or is not stated", "Not yet resolved"];
  });
  sections.push(
    sec("8", "Sanctions, Watchlists & Restrictive Measures", "screening", [
      TBL([txt("List", 20), txt("Match", 20), txt("Basis", 24), txt("Date", 10), txt("Current status", 14), neutral("Confidence", 12)], sanctionRows, { canAdd: false }),
      H("False-positive analysis (mandatory)"),
      CALL("A matching name alone is insufficient", "Compare date of birth, nationality, role, associates and the list entry's own identifiers before any conclusion. The lists searched here carry names, countries and programmes only.", r.sanctions.hits.length ? "watch" : "none"),
      TBL([txt("Listed party", 28), txt("Identifiers shared", 28), txt("Differences", 20), choice("Conclusion", 24, ["Not yet resolved", "Excluded as namesake", "Confirmed match"])], fp, { blank: fp.length ? 0 : 1 }),
      TBL(
        [txt("Other restrictive-measure source", 40), txt("How to check", 60)],
        [["Export-control, debarment and professional exclusion lists", r.registries.filter((x) => /debar|world bank|exclusion|export/i.test(x.label)).map((x) => `${x.label}: ${x.url}`).join(" | ") || "Search by hand."], ["National and regional lists not loaded here", "Search the relevant authority's list for the subject's jurisdictions."]],
        { canAdd: false }
      ),
    ])
  );

  // 9 ─ Political
  const pepStatus = wd?.positions.some((p) => p.current) ? "Current PEP" : wd?.positions.length ? "Former PEP" : r.office.state === "ok" ? "Not a PEP on available evidence" : "Not determined";
  sections.push(
    sec("9", "Political & Government Connections", "partly", [
      CH(["Current or past public office", "Political party roles", "Campaign positions", "Appointments", "Government advisory roles", "Government contracts", "State-owned enterprise relationships", "Political donations (where public)", "Documented relationships with political actors", "Lobbying", "Political organisations"], [...(wd?.positions.length ? ["Current or past public office"] : []), ...(per?.parties.length ? ["Political party roles"] : [])], "Ticked where the record shows it."),
      ...(per?.parties.length ? [P(per.parties.join("; "), "Party affiliation (Wikidata)")] : []),
      H("9.1 Public-Office Timeline"),
      TBL([txt("Period", 14), txt("Office / role", 30), txt("Institution", 18), txt("Authority", 16), txt("Evidence", 22)], (wd?.positions ?? []).map((p) => [[p.from, p.current ? "present" : p.to].filter(Boolean).join("–") || "dates not recorded", p.label, "", wd!.countries?.join(", ") ?? "", `Wikidata ${wd!.url}`]), { blank: 2 }),
      H("9.2 Politically Exposed Person Assessment"),
      CHOICE("PEP status", ["Current PEP", "Former PEP", "Not a PEP on available evidence", "Not determined"], pepStatus, "Preliminary, from Wikidata, which is not a complete register of office-holders."),
      P("", "Jurisdiction and definition used", "State the framework, for example FATF Recommendation 12 or the applicable national anti-money-laundering law, and whether family members and close associates are in scope."),
      CALL("Not an accusation", "PEP status is a risk category requiring enhanced due diligence. It is not evidence of wrongdoing.", "none"),
    ])
  );

  // 10 ─ Associates
  sections.push(
    sec("10", "Associates, Affiliates & Network Analysis", "analyst", [
      TBL([txt("Relationship", 18), txt("Nature", 18), txt("Period", 10), txt("Evidence", 22), txt("Significance", 16), txt("Risk implication", 16)], [], { blank: 3 }),
      CALL("Association standard", "A relationship is not evidence of wrongdoing because two people appeared together, follow each other online, attended the same event, work in the same sector or share an acquaintance. State the actual nature and evidence of each relationship.", "none"),
    ])
  );

  // 11 ─ Conflicts
  sections.push(
    sec("11", "Conflicts of Interest", "analyst", [
      TBL([txt("Potential conflict", 20), txt("Role", 14), txt("Interest", 18), txt("Rules", 14), choice("Disclosed?", 10, ["Yes", "No", "Unknown"]), txt("Evidence", 12), choice("Assessment", 12, ["No concern", "Potential", "Material", "Confirmed"])], [], { blank: 3 }),
      CH(["Public office", "Business interests", "Family or business relationships", "Government contracts", "Appointments", "Investment interests", "Regulatory responsibilities", "Political activity", "Nonprofit roles", "Media ownership or interests"], [], "Areas to test against the proposed role."),
    ])
  );

  // 12 ─ Reputation
  const covRows = (mc?.recent ?? []).slice(0, 10).map((i) => [i.published ?? "", i.domain, `${clip(i.title, 110)} ${i.url}`, i.sentiment ? i.sentiment[0].toUpperCase() + i.sentiment.slice(1) : "Not rated"]);
  const themes = mc?.themes ?? [];
  sections.push(
    sec("12", "Reputational Due Diligence", "screening", [
      H("12.1 Media Coverage"),
      mc ? P(`${mc.overview}${mc.total ? ` (${mc.total} headline(s) in three months${mc.aiWritten ? "; summary AI-assisted, from headlines only" : ""}.)` : ""}`, "Pattern") : P("Mainstream coverage could not be measured."),
      TBL([txt("Date", 12), txt("Outlet", 18), txt("Headline", 54), choice("Tone", 16, ["Positive", "Neutral", "Negative", "Mixed", "Not rated"])], covRows, { canAdd: false }),
      H("Adverse reporting"),
      TBL(
        [txt("Date", 10), txt("Outlet", 14), txt("Report", 34), txt("Type", 14), choice("Severity", 10, ["Low", "Moderate", "High", "Critical"]), txt("Basis", 18)],
        adverse.map((i) => [i.published ?? "", i.domain, `${clip(i.what || i.title, 150)} ${i.url}`, `${stageOf(i.status)} · ${kindOf(i) === "crim" ? "criminal" : kindOf(i) === "reg" ? "regulatory" : kindOf(i) === "civil" ? "civil" : "other"}`, i.severity === "high" ? "High" : i.severity === "medium" ? "Moderate" : "Low", i.basis === "full_text" ? "Full article read" : "Headline only"]),
        { canAdd: false }
      ),
      CH(["Positive", "Neutral", "Critical", "Investigative", "Allegation-based", "Corrective / retracted", "Legally adjudicated", "Opinion / commentary"], [...(mc?.tone === "positive" ? ["Positive"] : []), ...(adverse.some((i) => i.status === "allegation") ? ["Allegation-based"] : []), ...(adverse.some((i) => i.status === "investigation") ? ["Investigative"] : []), ...(adverse.some((i) => ["conviction", "penalty"].includes(i.status)) ? ["Legally adjudicated"] : [])], "Categories of coverage seen. Assess the overall pattern, not a count of negative articles."),
      H("12.2 Reputational Themes"),
      B(themes, "Recurring themes in headlines. For each, note independent corroboration."),
      CH(["Integrity", "Governance", "Professional conduct", "Financial conduct", "Treatment of employees", "Conflicts of interest", "Political conduct", "Public statements", "Discrimination / harassment allegations", "Corruption allegations", "Regulatory issues"], [...new Set(adverse.flatMap((i) => (/corrupt|brib/i.test(`${i.category} ${i.what}`) ? ["Corruption allegations"] : [])))], "Themes seen in the adverse reporting."),
      H("12.3 Media Reliability"),
      TBL([txt("Outlet", 20), txt("Original reporting?", 16), txt("Documents?", 14), txt("Named sources?", 14), txt("Corrections / reply?", 18), txt("Assessment", 18)], [...new Set(adverse.map((i) => i.domain))].map((d) => [d, "", "", "", "", ""]), { blank: 1 }),
    ])
  );

  // 13 ─ Statements
  sections.push(
    sec("13", "Public Statements & Conduct", "analyst", [
      TBL([txt("Statement", 24), txt("Date", 9), txt("Original source", 16), txt("Context", 16), txt("Clarification", 12), txt("Contradiction?", 12), txt("Assessment", 11)], [], { blank: 3 }),
      CALL("Context first", "Do not present edited clips or decontextualised quotations as complete evidence. Always cite the original source.", "none"),
    ])
  );

  // 14 ─ Digital
  const acct = (so?.accounts ?? []).filter((a) => a.platform !== "Website");
  sections.push(
    sec("14", "Digital & Social-Media Footprint", "screening", [
      so ? P(so.overview, "Summary") : P("Social media presence could not be measured."),
      H("14.1 Account Authentication"),
      TBL(
        [txt("Platform", 14), txt("Handle", 20), txt("Evidence of authenticity", 28), choice("Officially linked?", 12, ["Yes", "No", "Unknown"]), choice("Verification", 14, ["Verified", "Unverified", "Impersonation suspected"]), neutral("Confidence", 12)],
        acct.map((a) => [a.platform, `${a.handle} ${a.url}`, `Listed in the subject's Wikidata entry${so?.accountsFrom ? ` (${so.accountsFrom})` : ""}; not independently confirmed`, "Unknown", "Unverified", "Low"]),
        { blank: 1 }
      ),
      CALL("Do not infer ownership", "An account is not the subject's merely because it uses the name or photograph. Authenticate through an official link, a verified badge or the subject's own site.", "watch"),
      ...((so?.posts.length ?? 0) > 0
        ? [H("Recent public posts naming the subject"), TBL([txt("Date", 12), txt("Network", 12), txt("Author", 18), txt("Post", 58)], so!.posts.slice(0, 8).map((p) => [p.published?.slice(0, 10) ?? "", p.network, p.author, `${clip(p.text.replace(/\s+/g, " "), 200)} ${p.url}`]), { canAdd: false })]
        : []),
      B((so?.searchLinks ?? []).map((l) => `${l.label}: ${l.url}`), "Check by hand (no open search)."),
      H("14.2 Digital Risk"),
      CH(["Misinformation", "Contradictory public statements", "Reputational controversies", "Harassment or abusive conduct", "Undisclosed commercial promotions", "Impersonation", "Account compromise", "Coordinated manipulation claims"], [], "Tick on evidence only."),
    ])
  );

  // 15, 16 ─ Philanthropy, output
  sections.push(
    sec("15", "Charitable, Nonprofit & Philanthropic Activity", "analyst", [
      CH(["Foundations", "Charities", "Nonprofit directorships", "Donations", "Fundraising", "Humanitarian work", "Charitable campaigns", "Nonprofit financial disclosures"], [], "Tick what was found."),
      P("", "Substantive contribution", "Real positive contribution."),
      P("", "Governance or reputational concerns", "Weigh both. Legitimate philanthropy is not evidence of misconduct."),
    ]),
    sec("16", "Academic, Professional & Intellectual Output", "analyst", [
      B(per?.awards ?? [], "Awards recorded in Wikidata (unverified)."),
      TBL([txt("Output", 28), txt("Type", 14), txt("Date", 10), txt("Authorship checked?", 16), txt("Retraction / finding?", 16), txt("Notes", 16)], [], { blank: 2 }),
      CH(["Authorship verified", "Credentials verified", "Institutional affiliations verified", "Publication dates consistent", "No exaggeration of expertise", "No retractions or disciplinary findings"], [], "Checks."),
    ])
  );

  // 17 ─ Ethical conduct
  const eth = adverse.filter((i) => ETHIC.test(`${i.category} ${i.what}`));
  sections.push(
    sec("17", "Human Rights & Ethical Conduct", "partly", [
      CALL("Heightened care", "Serious allegations need heightened evidentiary care. Complete one allegation assessment form (Appendix E) for each.", "watch"),
      TBL(
        [txt("Allegation", 28), txt("Made by", 14), txt("Date", 9), txt("Evidence", 14), txt("Investigated?", 12), txt("Outcome", 12), choice("Status", 11, ["Substantiated", "Settled", "Withdrawn", "Disproven", "Unresolved"])],
        eth.map((i) => [i.what || i.title, i.domain, i.published ?? "", i.basis === "full_text" ? "Article read" : "Headline", "Unknown", outcomeText(i.status), "Unresolved"]),
        { blank: eth.length ? 1 : 2 }
      ),
      CH(["Workplace conduct", "Harassment", "Discrimination", "Exploitation", "Labour practices", "Treatment of vulnerable groups", "Environmental conduct", "Human-rights allegations", "Ethical violations"], [], "Areas considered."),
    ])
  );

  // 18 ─ Discrepancies
  const supplied = /\b(19\d{2}|20\d{2})\b/.exec(r.input.identifiers ?? "")?.[1];
  const disc: string[][] = [];
  if (supplied && per?.born && supplied !== per.born) disc.push([`Year of birth supplied: ${supplied}`, `Wikidata: ${per.born}`, `${Math.abs(Number(supplied) - Number(per.born))} year(s)`, "Different person, or an error in either source", wd!.url, "Unresolved"]);
  sections.push(
    sec("18", "Discrepancies & Contradictions", "partly", [
      TBL([txt("Record A", 20), txt("Record B", 20), txt("Difference", 14), txt("Possible explanation", 18), txt("Evidence", 14), choice("Assessment", 14, ["Immaterial", "Administrative", "Explainable", "Unresolved", "Material", "Potentially deceptive"])], disc, { blank: 2 }),
      CALL("No assumption of deceit", "An inconsistency does not show intentional deception. Classify it, seek the explanation and record the evidence.", "none"),
    ])
  );

  // 19 ─ Red flags
  sections.push(
    sec("19", "Red-Flag Register", "screening", [
      TBL(
        [txt("#", 4), txt("Red flag", 30), txt("Evidence", 34), choice("Severity", 10, SEV), neutral("Confidence", 10, CONF.slice(0, 3)), choice("Status", 12, ["Open", "Resolved"])],
        flags.map((f, i) => [String(i + 1), f.flag, `${f.evidence} Action: ${f.action}`, riskWord(f.severity), confidenceOf(f), "Open"]),
        { blank: flags.length ? 1 : 2 }
      ),
      TBL([txt("Severity", 16), txt("Meaning", 84)], [["Low", "Limited significance; little foreseeable impact."], ["Moderate", "Requires awareness, monitoring or clarification."], ["High", "Material concern that could affect the proposed relationship."], ["Critical", "Potentially disqualifying; requires escalation or specialist review."]], { canAdd: false }),
    ])
  );

  // 20 ─ Positives
  sections.push(
    sec("20", "Positive & Mitigating Factors", "partly", [
      P("Due diligence is not a search for negative information alone.", undefined),
      TBL([txt("Factor", 28), txt("Evidence", 36), txt("Relevance", 20), choice("Weight", 16, ["Low", "Medium", "High"])], positives.map((p) => [p, "Screening result", "To be confirmed", "Low"]), { blank: 2 }),
    ])
  );

  // 21 ─ Risk matrix
  sections.push(
    sec("21", "Risk Matrix", "partly", [
      TBL(
        [txt("Category", 20), choice("Risk", 14, PERSON_RATING), neutral("Confidence", 12), txt("Rationale", 54)],
        rows.map(([k, [rt, cf, why]]) => [k, rt, cf, why]),
        { canAdd: false }
      ),
      TBL(
        [txt("Rating", 20), txt("Meaning", 80)],
        [["1 — Minimal", "No material concern identified."], ["2 — Low", "Minor issues with limited relevance."], ["3 — Moderate", "Issues warranting monitoring or clarification."], ["4 — High", "Material concerns requiring enhanced due diligence or mitigation."], ["5 — Critical", "Potentially disqualifying or requiring immediate escalation."]],
        { canAdd: false }
      ),
    ])
  );

  // 22 ─ Evidence-confidence matrix
  sections.push(
    sec("22", "Evidence-Confidence Matrix", "screening", [
      P("Every material finding has two separate dimensions: risk severity (how serious if established) and evidence confidence (how strong the evidence is). This stops an unverified allegation from carrying the weight of an official finding."),
      TBL(
        [txt("", 22), txt("Low confidence", 26), txt("Medium confidence", 26), txt("High confidence", 26)],
        (["Low", "Moderate", "High", "Critical"] as RiskWord[]).map((k) => [`${k} risk`, MATRIX[k].Low, MATRIX[k].Medium, MATRIX[k].High]),
        { canAdd: false }
      ),
      H("Applied to this report's findings"),
      TBL(
        [txt("Finding", 46), choice("Risk if established", 14, SEV), neutral("Evidence confidence", 14, CONF.slice(0, 3)), txt("Outcome", 26)],
        flags.map((f) => [f.flag, riskWord(f.severity), confidenceOf(f), outcomeOf(f.severity, confidenceOf(f))]),
        { canAdd: false }
      ),
    ])
  );

  // 23 ─ Source register
  const reg23: string[][] = [];
  let sn = 0;
  const sid = () => `S${String(++sn).padStart(3, "0")}`;
  for (const s of r.sources.filter((x) => x.state === "ok")) reg23.push([sid(), s.label, /OFAC|UN|EU|UK$|companies_house/.test(s.id) ? "Primary" : s.id === "adverse_media" || s.id === "media_coverage" ? "Secondary" : "Tertiary", day(r.generatedAt), "Screening result for this subject", /OFAC|UN|EU|UK$|companies_house/.test(s.id) ? "High" : s.id === "wikidata" || s.id === "social" ? "Low" : "Medium", s.url ?? ""]);
  for (const i of adverse) reg23.push([sid(), `${i.domain}: ${clip(i.title, 90)}`, "Secondary", i.published ?? "", clip(i.what || i.title, 120), i.basis === "full_text" ? "Medium" : "Low", i.url]);
  sections.push(
    sec("23", "Source Register", "screening", [
      TBL([txt("ID", 6), txt("Source", 26), txt("Type", 10), txt("Date", 10), txt("Claim supported", 24), neutral("Reliability", 10, ["High", "Medium", "Low"]), txt("URL / reference", 14)], reg23, { blank: 1 }),
      P("For a material negative finding, record the original source, not merely an article repeating another."),
    ])
  );

  // 24 ─ Claim verification
  const claims = adverse.map((i) => [clip(i.what || i.title, 160), `${i.domain} ${i.url}`, "None identified in this screening", claimStatusOf(i), confOfItem(i)]);
  sections.push(
    sec("24", "Claim Verification Table", "partly", [
      TBL([txt("Claim", 34), txt("Source", 24), txt("Independent corroboration", 18), neutral("Status", 12, CLAIM_STATUS), neutral("Confidence", 12)], claims, { blank: 2 }),
      TBL(
        [txt("Status", 16), txt("Definition", 84)],
        [["Confirmed", "Strong primary evidence or multiple reliable independent sources."], ["Probable", "Strong evidence, but no definitive confirmation."], ["Disputed", "Material disagreement between credible sources."], ["Unverified", "A claim exists but cannot presently be substantiated."], ["Unsupported", "Available evidence does not substantiate the claim."], ["False", "Reliable evidence affirmatively contradicts the claim."]],
        { canAdd: false }
      ),
    ])
  );

  // 25 ─ Right of reply
  const toPut = adverse.filter((i) => ["allegation", "investigation", "charge"].includes(i.status));
  sections.push(
    sec("25", "Subject's Response / Right of Reply", "analyst", [
      KV(["Item", "Detail"], [["Date contacted", ""], ["Method", ""], ["Response received", ""], ["Response summary", ""], ["Evidence provided", ""], ["Follow-up performed", ""], ["Outstanding issues", ""]]),
      B(toPut.map((i) => `${clip(i.what || i.title, 150)} (${i.domain})`), "Material allegations to put to the subject, where appropriate and feasible."),
      P("The subject was given an opportunity to respond to the material issues identified in this report but no response was received as of [date]. Failure to respond is not proof that an allegation is true.", undefined),
    ])
  );

  // 26 ─ Open questions
  const oq: string[][] = [];
  if (namesakes) oq.push(["Which records and reports concern this individual and which a namesake?", "Adverse findings could be misattributed", `${wdAll.length} Wikidata person record(s) match`, "Date of birth, nationality, employer or a document-level match", "Yes"]);
  if (listsDown) oq.push(["Is the subject on the sanctions lists that could not be checked?", "Absence of a match cannot be relied on", "Other lists searched", "Re-run when the lists load, or search them by hand", "Yes"]);
  if (strongS) oq.push(["Is the sanctions-list name match the subject?", "A true match could bar dealings", "Name, country and programme", "Identifiers on the list entry compared with the subject", "Yes"]);
  for (const i of toPut.slice(0, 3)) oq.push([clip(i.what || i.title, 140), "Could change the recommendation", `${i.domain}, ${i.basis === "full_text" ? "article read" : "headline only"}`, "Court or regulator record; subject's response; second independent source", "Yes"]);
  oq.push(["Are there court, regulatory or registry records beyond the open sources searched?", "Open sources are incomplete", "None searched", "Searches in the relevant jurisdictions", "Yes"]);
  sections.push(
    sec("26", "Open Questions", "partly", [
      TBL([txt("Question", 30), txt("Why it matters", 20), txt("Evidence available", 18), txt("Evidence required", 22), choice("Proportionate?", 10, ["Yes", "No", "Unsure"])], oq, { blank: 1 }),
    ])
  );

  // 27 ─ Limitations
  sections.push(
    sec("27", "Limitations", "partly", [
      B([
        ...(r.sources.filter((s) => s.state !== "ok").map((s) => `${s.label}: ${s.state === "unavailable" ? "unavailable" : "not set up"}${s.note ? ` (${s.note})` : ""}.`)),
        "Court records, parliamentary registers of interest, professional registers and regulators' databases were not searched.",
        "Company registries other than UK Companies House were not searched; beneficial ownership is therefore incomplete.",
        "X, Facebook, Instagram, LinkedIn and TikTok have no open search and were not measured.",
        "Media search covers the last three months; older reporting is not included.",
        `Identity rests on name matching${identityKnown ? " and the identifiers supplied" : " alone, as no identifiers were supplied"}.`,
        "Reliance on secondary reporting; articles seen only as headlines were not read.",
      ]),
      P("This report is based on information reasonably available during the stated research period. Absence of evidence in the sources reviewed should not be read as evidence that an event did not occur.", undefined),
      P(r.coverage, "Screening coverage"),
    ])
  );

  // 28 ─ Analytical assessment
  const confirmed = [
    ...(wd ? [`A public record exists for ${wd.label}${wd.description ? ` (${wd.description})` : ""}, matching the name (to be confirmed as the subject).`] : []),
    ...(wd?.positions.length ? [`Public office on record: ${wd.positions.slice(0, 3).map((p) => p.label).join("; ")}.`] : []),
    ...(listsOk.length && !r.sanctions.hits.length ? [`Not on the ${listsOk.length} sanctions list(s) checked, by name.`] : []),
  ];
  const strongly = adverse.filter((i) => i.basis === "full_text" && ["conviction", "penalty", "charge"].includes(i.status)).map((i) => `${clip(i.what || i.title, 150)} (${i.domain}, ${i.status}).`);
  const disputed = adverse.filter((i) => i.status === "cleared").map((i) => `${clip(i.what || i.title, 150)} (${i.domain}).`);
  const unverified = adverse.filter((i) => ["allegation", "investigation"].includes(i.status) || i.basis === "headline_only").map((i) => `${clip(i.what || i.title, 150)} (${i.domain}, ${i.basis === "headline_only" ? "headline only" : i.status}).`);
  sections.push(
    sec("28", "Overall Analytical Assessment", "partly", [
      CALL("Four questions", "What do we know? What do we reasonably believe? What has been alleged but not established? What do we not know? The aim is a fair, reproducible, source-traceable assessment of material risk, not a positive or negative profile.", "none"),
      H("28.1 What is established?"),
      B(confirmed, "Facts supported by reliable evidence."),
      H("28.2 What is strongly indicated?"),
      B(strongly, "Findings supported by substantial but incomplete evidence."),
      H("28.3 What remains disputed?"),
      B(disputed, "Material competing claims."),
      H("28.4 What remains unverified?"),
      B(unverified, "Important unresolved allegations or assertions."),
      H("28.5 What is not supported?"),
      B(namesakeItems ? [`${namesakeItems} article(s) were set aside as concerning a different person or company.`] : [], "Claims investigated that lack credible evidence."),
      H("28.6 Principal Risks"),
      B(flags.slice(0, 5).map((f) => f.flag)),
      H("28.7 Principal Mitigating Factors"),
      B(positives.slice(0, 5)),
    ])
  );

  // 29 ─ Recommendation
  sections.push(
    sec("29", "Recommendation", "partly", [
      CHOICE("Recommendation", REC, rec, "Preliminary, from the screening. A recommendation of A is not offered from open sources alone, because court and regulatory records are not searched."),
      P("A. Available evidence does not reveal material concerns relevant to the stated purpose.\nB. Some minor issues exist but do not presently justify enhanced measures.\nC. Material but manageable risks have been identified; proceed subject to conditions and monitoring.\nD. Material unresolved issues need additional investigation before proceeding.\nE. Credible evidence indicates a potentially material risk needing legal, compliance, board, editorial or specialist review.", "Definitions"),
      B(flags.slice(0, 4).map((f) => f.action).filter((a, i, all) => all.indexOf(a) === i), "Recommended conditions or next steps."),
      P("", "Reason", "Evidence-based explanation."),
    ])
  );

  // 30 ─ Conclusion
  sections.push(
    sec("30", "Final Conclusion", "partly", [
      P("", "Answer to the decision question", "One to three paragraphs on the actual decision the client faces."),
      P(confirmed.join(" ") || "Nothing is yet established beyond the name match.", "Facts"),
      P(strongly.join(" ") || (flags.length ? "Concerns rest on unconfirmed reporting or name matches (see Facts and Unresolved)." : "None from the sources searched."), "Evidence-supported concerns"),
      P(unresolved.join(" "), "Unresolved allegations"),
      P(overallRisk, "Overall risk"),
      P(rec, "Recommended action"),
    ])
  );

  // Appendices
  const chron: string[][] = [
    ...(per?.born ? [[per.born, "Born (per Wikidata)", `Wikidata ${wd!.url}`, "Identity anchor"]] : []),
    ...(wd?.positions ?? []).map((p) => [p.from ?? "", `${p.label}${p.current ? " (current)" : ""}`, `Wikidata ${wd!.url}`, "Public office"]),
    ...adverse.map((i) => [i.published ?? "", clip(i.what || i.title, 140), `${i.domain} ${i.url}`, `${stageOf(i.status)} (${i.basis === "full_text" ? "article read" : "headline"})`]),
  ].sort((a, b) => a[0].localeCompare(b[0]));
  const entityMap: string[] = [
    `${c.name}`,
    ...(per?.employers.slice(0, 5).map((e) => `→ ${e.label}${e.to ? ` (to ${e.to})` : ""}: employer / affiliation (Wikidata)`) ?? []),
    ...(wd?.positions.slice(0, 5).map((p) => `→ ${p.label}: public office (Wikidata)`) ?? []),
    ...(per?.parties.map((p) => `→ ${p}: party affiliation (Wikidata)`) ?? []),
    ...chStrong.map((h) => `→ UK Companies House listing, ${h.appointments ?? "?"} appointment(s)`),
    ...r.offshore.hits.slice(0, 3).map((h) => `→ ${h.name}: Offshore Leaks record (${h.strength} name match)`),
  ];
  const quality = [...new Set(adverse.map((i) => i.domain))].map((d) => {
    const its = adverse.filter((i) => i.domain === d);
    return [d, "", "", its.some((i) => i.basis === "full_text") ? "Article read" : "Headline only", "", "", ""];
  });
  const searchLog: string[][] = r.sources.map((s) => [new Date(r.generatedAt).toLocaleDateString("en-GB"), s.label, [c.name, ...r.input.aliases].join(" | "), r.input.country ?? "", s.state === "ok" ? "Searched" : s.state === "unavailable" ? `Unavailable${s.note ? `: ${s.note}` : ""}` : "Not set up", s.state === "ok" ? "" : "Re-run or search by hand"]);
  const forms: Block[] = adverse.slice(0, 4).flatMap((i, n) => [
    H(`Allegation ${n + 1}`),
    KV(["Item", "Detail"], [
      ["Allegation", i.what || i.title],
      ["Date alleged", i.published ?? ""],
      ["Made by", i.domain],
      ["Original source", i.url],
      ["Nature", `${i.category}; ${stageOf(i.status)}`],
      ["Evidence offered", i.basis === "full_text" ? "Article read in full; documents not seen" : "Headline only"],
      ["Independent corroboration", "None identified in this screening"],
      ["Subject response", ""],
      ["Legal / regulatory outcome", ""],
      ["Contradictory evidence", ""],
      ["Current status", stageOf(i.status)],
      ["Confidence", confOfItem(i)],
      ["Risk significance", riskWord(i.severity === "high" ? "High" : i.severity === "medium" ? "Medium" : "Low")],
    ]),
    CHOICE("Conclusion", ["Established", "Probable", "Disputed", "Unverified", "Unsupported", "False"], claimStatusOf(i)),
  ]);
  sections.push(
    sec("A", "Chronology", "partly", [TBL([txt("Date", 12), txt("Event", 46), txt("Source", 26), txt("Significance", 16)], chron, { blank: 2 })]),
    sec("B", "Entity Map", "partly", [B(entityMap, "Subject and documented relationships. State the evidence for each link."), CALL("Evidence for every link", "A relationship appears here only with a source. Proximity is not a link.", "none")]),
    sec("C", "Source Quality Assessment", "partly", [
      TBL([txt("Source", 20), choice("Original?", 10, ["Yes", "No", "Unknown"]), choice("Editorial process?", 12, ["Yes", "No", "Unknown"]), txt("Documents", 14), txt("Fact vs allegation", 16), txt("Corrections", 12), txt("Conflict of interest", 16)], quality, { blank: 1 }),
      CH(["Original source identified", "Source identifiable", "Credible editorial or review process", "Documentary evidence provided", "Distinguishes fact from allegation", "Discloses corrections", "Independently corroborated", "Conflict of interest considered", "Information is current", "Not copied from another source"], [], "Apply to each major source."),
    ]),
    sec("D", "Search Log", "screening", [TBL([txt("Date", 10), txt("Database", 24), txt("Query", 24), txt("Jurisdiction", 12), txt("Result", 18), txt("Follow-up", 12)], searchLog, { blank: 1 })]),
    sec("E", "Allegation Assessment Forms", "partly", forms.length ? forms : [P("", undefined, "One form per allegation: who alleged what, when, with what evidence, the subject's response, the outcome and the conclusion.")]),
    sec("F", "Quality-Control Checklist", "partly", [
      H("Identity"),
      CH(["Subject correctly identified", "Names and aliases reconciled", "Same-name individuals excluded", "Identity evidence documented"], [], "Tick when done."),
      H("Evidence"),
      CH(["Material claims have sources", "Primary sources used wherever possible", "Allegations clearly labelled", "No rumour presented as fact", "Corroborated where appropriate", "Contradictory evidence considered", "Source reliability assessed"], ["Allegations clearly labelled"]),
      H("Legal / regulatory"),
      CH(["Jurisdictions searched", "Litigation distinguished from conviction", "Allegations distinguished from findings", "Appeals and outcomes checked", "Regulatory records checked", "Sanctions and watchlists checked where relevant"], [...(listsOk.length ? ["Sanctions and watchlists checked where relevant"] : []), "Allegations distinguished from findings"]),
      H("Corporate / financial"),
      CH(["Current affiliations checked", "Historical affiliations checked", "Ownership reviewed where legally available", "Insolvencies and dissolutions considered", "Conflicts assessed", "No unsupported inference of illicit wealth"], ["No unsupported inference of illicit wealth"]),
      H("Reputation"),
      CH(["Positive and negative evidence considered", "Original reporting identified", "Corrections and retractions checked", "Subject's response considered", "Social-media claims authenticated before use"], ["Positive and negative evidence considered"]),
      H("Fairness"),
      CH(["Subject given an opportunity to respond where warranted", "Material exculpatory evidence included", "No guilt inferred from association", "No guilt inferred from allegation alone", "No unnecessary protected or sensitive personal information", "Research proportionate to the legitimate purpose"], ["No guilt inferred from association", "No guilt inferred from allegation alone", "No unnecessary protected or sensitive personal information"]),
      H("Conclusion"),
      CH(["Facts separated from inference", "Confidence levels stated", "Unresolved questions stated", "Limitations stated", "Risk rating explained", "Recommendation follows the evidence", "Report independently quality-checked"], ["Confidence levels stated", "Unresolved questions stated", "Limitations stated"]),
    ]),
    sec("G", "Review & Sign-Off", "analyst", [
      TBL([txt("Role", 20), txt("Name", 30), txt("Signature", 28), txt("Date", 22)], [["Prepared by", "", "", ""], ["Reviewed by", "", "", ""], ["Approved by", "", "", ""]], { canAdd: false }),
    ])
  );

  return {
    version: 1,
    caseId: c.id,
    meta: {
      target: c.name,
      transaction: c.reference ? `Ref ${c.reference}` : `Overall risk: ${overallRisk}`,
      preparedFor: "",
      preparedBy: "Afrilens Consulting",
      date: when,
      versionLabel: "v1.0 (draft)",
      confidentiality: "Strictly Confidential",
      currency: "USD",
      purpose: "Individual / Public Figure Due Diligence Report",
    },
    sections,
  };
}
