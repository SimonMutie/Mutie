import type { DdCase, DdResult } from "../api";
import { B, CALL, PHOTO, CH, CHOICE, H, KV, LISTS, LIST_NAME, P, TBL, choice, clip, day, nid, num, pct, redFlags, resetIds, sec, severityRank, sourceFor, txt, type Flag, type Severity } from "./kit";
import { buildPersonReport } from "./personTemplate";
import { LMH, RAG, RISK, SENTIMENT, STATUS_IN, type Block, type CalcRule, type Col, type Report, type Section } from "./model";

/**
 * Builds the commercial due-diligence report for a screening: the 23 sections
 * of the firm's template, pre-filled wherever the public-source screening
 * has evidence, and left open (and marked "Not provided") where the content
 * depends on data-room documents the analyst still has to add.
 */

type Rag = "Green" | "Amber" | "Red" | "Not assessed";

function dimensionRatings(r: DdResult, flags: Flag[]) {
  const strong = r.sanctions.hits.some((h) => h.strength === "strong");
  const listsDown = r.sources.some((s) => LISTS.includes(s.id) && s.state !== "ok");
  const hasLegalFlag = flags.some((f) => f.category === "Legal" && f.severity !== "Low");
  const legal: [Rag, string] = strong
    ? ["Red", "Strong sanctions-list name match; identity must be resolved before any dealing."]
    : hasLegalFlag
      ? ["Amber", "Sanctions, public-office or offshore indicators need review (see Red Flag Report). Contracts, licences and litigation files not yet reviewed."]
      : listsDown
        ? ["Not assessed", "Sanctions screening incomplete; contracts, licences and litigation files not yet reviewed."]
        : ["Green", "No sanctions, PEP or offshore match in the public sources checked. Contracts, licences and litigation files not yet reviewed."];
  const mi = r.media.hits[0]?.items ?? [];
  const tone = r.mediaCoverage?.hits[0]?.tone;
  const rep: [Rag, string] =
    r.media.state !== "ok"
      ? ["Not assessed", "Media screening could not be completed."]
      : mi.some((i) => i.severity === "high" && i.relevance === "about_subject")
        ? ["Red", "Serious adverse reporting about the subject (see 9.4)."]
        : mi.some((i) => i.severity === "medium") || tone === "negative" || tone === "mixed"
          ? ["Amber", "Some adverse or mixed coverage; credibility and persistence to be assessed."]
          : ["Green", "No adverse reporting identified in the last three months (public sources only)."];
  const esgItems = mi.filter((i) => /environment|pollut|labou?r|human rights|safety|child|community|land/i.test(`${i.category} ${i.what}`));
  const esg: [Rag, string] = esgItems.length ? [esgItems.some((i) => i.severity === "high") ? "Red" : "Amber", "Reporting on environmental, labour or community issues (see Section 14)."] : ["Not assessed", "No ESG documents reviewed; no ESG controversy found in the media screen."];
  const na = (why: string): [Rag, string] => ["Not assessed", why];
  return [
    ["Financial", na("Requires financial statements and management accounts.")],
    ["Tax", na("Requires tax returns and filings.")],
    ["Legal / Regulatory", legal],
    ["Commercial / Market", na("Requires market data, customer and supplier information.")],
    ["Reputation & Media", rep],
    ["Operations", na("Requires management information and site review.")],
    ["Technology / Cyber", na("Requires IT documentation and security evidence.")],
    ["Human Resources", na("Requires HR records and contracts.")],
    ["ESG", esg],
  ] as [string, [Rag, string]][];
}

const worst = (rs: Rag[]): Rag => (rs.includes("Red") ? "Red" : rs.includes("Amber") ? "Amber" : rs.includes("Green") ? "Green" : "Not assessed");

const people = (r: DdResult) => r.companiesHouse.hits.filter((h) => h.strength === "strong").flatMap((h) => h.people).slice(0, 8).map((p) => `${p.name} (${p.role}${p.resigned ? ", resigned" : ""})`);
function ownershipText(r: DdResult): string {
  const g = r.gleif.hits.find((x) => x.strength === "strong");
  const parts: string[] = [];
  if (g?.directParent) parts.push(`Direct parent: ${g.directParent}`);
  if (g?.ultimateParent) parts.push(`Ultimate parent: ${g.ultimateParent}`);
  const ch = r.companiesHouse.hits.filter((h) => h.strength === "strong").flatMap((h) => h.people).filter((p) => /control|owner|shareholder/i.test(p.role)).slice(0, 4);
  if (ch.length) parts.push(`Persons of significant control: ${ch.map((p) => p.name).join("; ")}`);
  const wd = r.office.hits.flatMap((h) => h.facts.filter((f) => /owned|parent/i.test(f))).slice(0, 2);
  parts.push(...wd);
  return parts.join(". ");
}

const DATA_ROOM = [
  ["Audited financial statements and management accounts (3 years + LTM)", "Financial"],
  ["Tax returns, assessments and correspondence with the tax authority", "Tax"],
  ["Share register, constitutional documents and shareholder agreements", "Corporate"],
  ["Material customer, supplier and financing contracts", "Legal / Commercial"],
  ["Licences, permits and regulatory correspondence", "Regulatory"],
  ["Litigation and claims register", "Legal"],
  ["Organisation chart, key employment contracts and HR policies", "Human resources"],
  ["IT systems inventory, security policies and incident log", "Technology"],
  ["Insurance schedule and policies", "Insurance"],
  ["Related-party transaction schedule", "Related parties"],
  ["Environmental, health and safety permits and audits", "ESG"],
];

export function buildReport(c: DdCase): Report {
  if (c.result.input.kind === "person") return buildPersonReport(c);
  resetIds();
  const r = c.result;
  const flags = redFlags(r);
  const dims = dimensionRatings(r, flags);
  const assessed = dims.filter(([, [rag]]) => rag !== "Not assessed");
  const overallRag = worst(dims.map(([, [rag]]) => rag));
  const strong = r.sanctions.hits.some((h) => h.strength === "strong");
  const listsDown = r.sources.some((s) => LISTS.includes(s.id) && s.state !== "ok");
  const media = r.media.hits[0]?.items ?? [];
  const mc = r.mediaCoverage?.hits[0];
  const so = r.social?.hits[0];
  const entity = r.input.kind === "entity";
  const when = day(r.generatedAt);
  // Identity fields are filled only from strong (90%+) matches, so a similarly named company is never presented as the target.
  const sg = r.gleif.hits.filter((h) => h.strength === "strong");
  const sch = r.companiesHouse.hits.filter((h) => h.strength === "strong" && h.kind === "company");
  const prof = r.office.hits.find((h) => h.profile && !h.isHuman && h.strength === "strong")?.profile;
  const weakIdentity = (r.gleif.hits.length > sg.length || r.companiesHouse.hits.length > sch.length) && r.input.kind === "entity";
  const topSev = flags[0]?.severity;
  const rec = strong ? "Do not proceed" : listsDown || flags.some((f) => f.severity === "High" || f.severity === "Critical") ? "Further diligence" : null;
  const overallRisk = topSev === "Critical" ? "Critical" : topSev === "High" ? "High" : topSev === "Medium" ? "Moderate" : null;

  const sections: Section[] = [];

  // 1 ─ Executive summary
  sections.push(
    sec("1", "Executive Summary & Decision Dashboard", "partly", [
      CALL("Basis of this report", `Pre-filled from public-source screening run on ${when}. Dimensions marked Not assessed need evidence from the data room. Ratings are preliminary until the analyst confirms them.`, "watch"),
      TBL(
        [txt("Dimension", 22), choice("Rating", 14, RAG), { ...choice("Confidence", 12, ["High", "Medium", "Low", "n/a"]), neutral: true }, txt("Key takeaway", 52)],
        [...dims.map(([d, [rag, why]]) => [d, rag, rag === "Not assessed" ? "n/a" : "Medium", why]), ["Overall", overallRag, assessed.length ? "Low" : "n/a", assessed.length ? `Preliminary: ${assessed.length} of ${dims.length} dimensions assessed, from public sources only.` : "No dimension assessed yet."]],
        { canAdd: false, boldLast: true }
      ),
      H("Decision"),
      CHOICE("Overall recommendation", ["Proceed", "Proceed with conditions", "Renegotiate", "Further diligence", "Do not proceed"], rec, rec ? "Preliminary indication from the screening; the analyst confirms." : "Select once the evidence is complete."),
      CHOICE("Overall risk", ["Low", "Moderate", "High", "Critical"], overallRisk),
      B(flags.slice(0, 5).map((f) => f.flag), "Top issues, in order of severity.", true),
      KV(["Item", "Detail"], [["Estimated financial exposure", ""], ["Required price adjustment", ""], ["Conditions precedent", ""]]),
      H("Key Findings"),
      B([...r.summary.keyPoints]),
      H("Investment / Transaction Thesis"),
      P("", undefined, "Why the transaction makes sense, the main value drivers and the assumptions behind them."),
      H("Immediate Deal Conditions"),
      B(r.summary.nextSteps),
    ])
  );

  // 2 ─ Scope
  const didCorp = !!(r.gleif.hits.length || r.companiesHouse.hits.length || r.offshore.state === "ok");
  sections.push(
    sec("2", "Scope, Methodology & Limitations", "partly", [
      H("Purpose"),
      P(`To establish whether ${c.name} is a sound counterparty: who owns and runs it, whether it or its owners are sanctioned or politically exposed, what is publicly reported about it, and what exposures a transaction would carry.`, undefined, "Edit to state the decision this report supports."),
      H("Scope"),
      CH(
        ["Corporate & ownership", "Financial", "Tax", "Legal & regulatory", "Commercial / market", "Operations", "Technology / IT", "Human resources", "ESG / environmental & social", "Intellectual property", "Insurance", "Litigation & disputes", "Cybersecurity / data protection", "Related-party transactions", "Sanctions, PEP & financial-crime screening", "Media, reputation & social media"],
        [didCorp ? "Corporate & ownership" : "", "Legal & regulatory", "Sanctions, PEP & financial-crime screening", "Media, reputation & social media", "Litigation & disputes", ...(r.environment?.country ? ["Commercial / market"] : [])].filter(Boolean),
        "Ticked items were covered, at least in part, by the public-source screening."
      ),
      H("Period Reviewed"),
      P(`Media: three months to ${when}. Sanctions lists: as published on ${when}. Registry and open-source records: as at ${when}.`),
      H("Information Sources"),
      B([...r.sources.filter((s) => s.state === "ok").map((s) => s.label), "Platform conflict-escalation monitoring (country operating environment)", "Other: management interviews, data room and site visits to be added by the analyst"]),
      H("Materiality & Evidence Standards"),
      P("A finding is reported as a red flag when it could affect the decision, price, structure or timing. Each is graded Critical, High, Medium or Low. Allegations are never treated as findings of fact: each media item shows how far matters have progressed (allegation, investigation, charge, conviction or cleared) and whether the full article or only a headline was read."),
      H("Limitations & Reliance"),
      P(`${r.coverage} Financial, tax, contractual, HR, IT and insurance matters need documents from the data room and are not assessed here. ${r.disclaimer}`),
    ])
  );

  // 3 ─ Target overview
  sections.push(
    sec("3", "Target Overview", "partly", [
      PHOTO(prof?.image ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(prof.image)}?width=480` : null, prof?.image ? "Logo from the target's Wikidata entry (Wikimedia Commons)." : "Company logo (optional).", "logo"),
      ...(weakIdentity ? [CALL("Check the match", "Registry records with a name match below 90% were found but not used to fill this section, in case they belong to a different company. Review them in the screening findings.", "watch")] : []),
      KV(["Item", "Details"], [
        ["Legal name", sg[0]?.name ?? sch[0]?.name ?? c.name],
        ["Trading name", r.input.aliases.join("; ")],
        ["Incorporation date", sch.find((h) => h.incorporated)?.incorporated ?? sg.find((h) => h.incorporated)?.incorporated ?? prof?.inception ?? ""],
        ["Jurisdiction", [sg[0]?.jurisdiction ?? r.input.country ?? "", sg[0]?.legalForm ?? sch.find((h) => h.companyType)?.companyType ?? ""].filter(Boolean).join(" · ")],
        ["Registered address", sch.find((h) => h.address)?.address ?? sg.find((h) => h.address)?.address ?? ""],
        ["Business activities", [prof?.industry.join(", "), sch.find((h) => h.sic?.length)?.sic?.map((x) => `SIC ${x}`).join(", "), r.office.hits[0]?.description, r.input.identifiers].filter(Boolean).join(". ")],
        ["Ownership", ownershipText(r)],
        ["Management", [...people(r), ...(prof?.leaders ?? [])].slice(0, 10).join("; ")],
        ["Employees", prof?.employees ? String(prof.employees) : ""],
        ["Locations", [prof?.headquarters, r.input.country].filter((x, i, a): x is string => !!x && a.indexOf(x) === i).join("; ")],
        ["Key products / services", ""],
        ["Key customers", ""],
        ["Key suppliers", ""],
        ["Regulatory licences", ""],
        ["Website", prof?.website ?? r.social?.hits[0]?.accounts.find((a) => a.platform === "Website")?.url ?? ""],
      ]),
      H("Business Model"),
      P("", undefined, "How the company creates, delivers and captures value."),
      H("Organisational / Ownership Structure"),
      B([...(ownershipText(r) ? [ownershipText(r)] : []), ...sg.slice(0, 2).map((g) => `${g.name}: LEI ${g.lei}${g.status ? `, ${g.status}` : ""}`)], "Add the group structure, legal-entity chart or transaction structure."),
      H("Strategic Position"),
      P("", undefined, "Competitive position, growth strategy, principal dependencies and value drivers."),
    ])
  );

  // 4 ─ Corporate
  const pepHit = r.office.hits.find((h) => h.positions.length);
  const corpRows: string[][] = [
    ["Ownership / shareholding", ownershipText(r) || "No ownership record found in GLEIF or UK Companies House.", r.offshore.hits.length ? "Medium" : "Not assessed", "Obtain the share register and a certified UBO declaration."],
    ["Share capital", "", "Not assessed", "Obtain the register of members and cap table."],
    ["Directors & officers", people(r).join("; ") || (pepHit ? `Public record: ${pepHit.label}` : ""), "Not assessed", "Verify directors against the registry and run individual screening."],
    ["Subsidiaries / affiliates", sg[0]?.directParent ? `Parent: ${sg[0].directParent}` : "", "Not assessed", "Obtain the group structure chart."],
    ["Shareholder agreements", "", "Not assessed", "Review for veto rights, drag/tag and change-of-control terms."],
    ["Corporate governance", "", "Not assessed", "Review board composition, committees and delegated authorities."],
    ["Beneficial ownership & PEP exposure", pepHit ? `${pepHit.label}: ${pepHit.positions.slice(0, 2).map((p) => p.label).join("; ")}` : "No public-office record found for the subject in Wikidata.", pepHit ? "High" : "Not assessed", "Apply enhanced due diligence where a PEP is involved."],
    ["Offshore structures", r.offshore.hits.length ? r.offshore.hits.slice(0, 2).map((h) => h.name).join("; ") + " in ICIJ Offshore Leaks" : r.offshore.state === "ok" ? "No ICIJ Offshore Leaks match." : "ICIJ Offshore Leaks not checked.", r.offshore.hits.length ? "Medium" : "Not assessed", "Ask management to explain any offshore holding."],
  ];
  sections.push(
    sec("4", "Corporate & Ownership Due Diligence", "partly", [
      TBL([txt("Area", 20), txt("Finding", 40), choice("Risk", 12, RISK), txt("Action", 28)], corpRows),
      H("Red Flags"),
      B(flags.filter((f) => f.category === "Legal" && !/sanction|screening/i.test(f.flag)).map((f) => f.flag)),
      H("Required Actions"),
      B(["Obtain constitutional documents, share register and a certified UBO declaration.", "Verify directors and shareholders against the registry and screen each individually."]),
    ])
  );

  // 5 ─ Financial
  const fy = ["FY-3", "FY-2", "FY-1", "LTM"];
  const histRows = ["Revenue", "Gross profit", "EBITDA", "EBIT", "Net income", "Operating cash flow", "Capex", "Free cash flow", "Revenue growth %", "Gross margin %", "EBITDA margin %", "Cash conversion % (OCF / EBITDA)"].map((l) => [l, "", "", "", ""]);
  sections.push(
    sec("5", "Financial Due Diligence", "analyst", [
      CALL("Data room needed", "Enter figures from audited statements and management accounts. Free cash flow, growth, margins and cash conversion are calculated.", "watch"),
      H("5.1 Historical Financial Performance"),
      TBL([txt("Report currency", 34), ...fy.map((f) => num(f, 16.5))], histRows, {
        canAdd: false,
        calc: [
          { row: 7, expr: "r5 - r6", fmt: "num" },
          { row: 8, expr: "r0 / r0@-1 - 1", fmt: "pct", only: [2, 3, 4] },
          { row: 9, expr: "r1 / r0", fmt: "pct" },
          { row: 10, expr: "r2 / r0", fmt: "pct" },
          { row: 11, expr: "r5 / r2", fmt: "pct" },
        ],
      }),
      H("Financial Analysis"),
      KV(["Measure", "Observation"], [["Revenue growth", ""], ["Gross margin trend", ""], ["EBITDA margin trend", ""], ["Cash conversion", ""], ["Working capital requirements", ""], ["Customer concentration", ""], ["Debt levels", ""]]),
      H("5.2 Quality of Earnings"),
      TBL([txt("Area", 24), txt("Observation", 46), txt("Adjustment / impact", 30)], ["Recurring vs non-recurring revenue", "One-off expenses", "Management adjustments", "Related-party transactions", "Revenue recognition", "Unusual margins", "Deferred revenue", "Customer churn"].map((a) => [a, "", ""])),
      TBL([txt("EBITDA bridge", 70), num("Amount", 30)], [["Reported EBITDA", ""], ["Adjustments (net)", ""], ["Normalised EBITDA", ""]], { canAdd: false, boldLast: true, calc: [{ row: 2, expr: "r0 + r1", fmt: "num" }] }),
      H("5.3 Balance Sheet & Net Debt"),
      TBL([txt("Item", 28), num("Amount", 22), txt("Comment", 50)], ["Cash", "Gross debt", "Accounts receivable", "Inventory", "Accounts payable", "Fixed assets", "Intangibles", "Provisions", "Contingent liabilities"].map((a) => [a, "", ""]), { canAdd: false }),
      TBL([txt("Net debt bridge", 70), num("Amount", 30)], [["Gross debt", ""], ["Less: cash", ""], ["Net debt", ""]], { canAdd: false, boldLast: true, calc: [{ row: 2, expr: "r0 - r1", fmt: "num" }] }),
    ])
  );

  // 6 ─ Tax
  sections.push(
    sec("6", "Tax Due Diligence", "analyst", [
      CH(["Corporate income tax", "VAT / sales tax", "Payroll taxes", "Withholding tax", "Transfer pricing", "Customs / duties", "Property taxes", "Other"]),
      TBL([txt("Area", 18), txt("Finding", 34), choice("Risk", 12, RISK), num("Est. exposure", 16), txt("Action", 20)], ["Corporate tax", "VAT", "Payroll", "Transfer pricing"].map((a) => [a, "", "Not assessed", "", ""])),
      H("Tax Red Flags"),
      B([]),
    ])
  );

  // 7 ─ Legal
  const litigationRows = media
    .filter((i) => ["investigation", "charge", "conviction", "penalty", "cleared"].includes(i.status) && i.relevance !== "different_entity")
    .slice(0, 8)
    .map((i) => [clip(i.what || i.title, 140), `Per ${i.domain}`, "", i.status[0].toUpperCase() + i.status.slice(1), "", i.severity === "high" ? "High" : i.severity === "medium" ? "Medium" : "Low"]);
  const sanctionRows = LISTS.map((id) => {
    const st = r.sanctions.lists.find((l) => l.id === id);
    const hits = r.sanctions.hits.filter((h) => h.list === id);
    const top = hits[0];
    const result = st?.status !== "ok" ? "Not checked" : top ? (top.strength === "strong" ? "Strong match" : "Possible match") : "No match";
    return [LIST_NAME[id], st?.asOf ? day(st.asOf) : "", result, st?.status !== "ok" ? (st?.error ?? "Source unavailable") : hits.slice(0, 2).map((h) => `${h.name} (as "${h.matchedName}", ${pct(h.score)})${h.programs.length ? `: ${h.programs.join(", ")}` : ""}`).join("; ")];
  });
  const wb = r.registries.find((l) => /World Bank/.test(l.label));
  sections.push(
    sec("7", "Legal & Regulatory Due Diligence", "partly", [
      H("7.1 Material Contracts"),
      TBL([txt("Contract", 20), txt("Counterparty", 20), num("Value", 12), txt("Expiry", 12), choice("Change of control?", 14, ["Yes", "No", "Unknown"]), choice("Risk", 12, RISK)], [], { blank: 3 }),
      P("", undefined, "Customer, supplier, financing, lease, distribution, joint-venture, employment, licensing and government contracts reviewed."),
      H("7.2 Litigation & Claims"),
      TBL([txt("Matter", 28), txt("Counterparty", 16), num("Amount", 12), txt("Status", 14), choice("Probability", 14, LMH), choice("Impact", 16, RISK)], litigationRows, { blank: litigationRows.length ? 0 : 2 }),
      CALL("Source", litigationRows.length ? "Rows come from media reports of investigations, charges, penalties or convictions. Obtain court and regulator records to confirm." : "No investigation, charge, penalty or conviction was found in public reporting. Court registers were not searched.", "none"),
      H("7.3 Regulatory Compliance"),
      P(`Sanctions, anti-bribery and public-office screening is in 7.4. Licences, permits, regulator correspondence and the target's compliance framework need documents from the data room.`),
      H("7.4 Sanctions, PEP & Financial-Crime Screening"),
      TBL([txt("List", 30), txt("Data as at", 16), choice("Result", 16, ["No match", "Possible match", "Strong match", "Not checked"]), txt("Detail", 38)], sanctionRows, { canAdd: false }),
      TBL(
        [txt("Check", 26), choice("Result", 16, ["No match", "Possible match", "Strong match", "Not checked"]), txt("Detail", 58)],
        [
          ["Politically exposed person / state ownership (Wikidata)", r.office.state !== "ok" ? "Not checked" : pepHit ? "Possible match" : "No match", pepHit ? `${pepHit.label}: ${[...pepHit.positions.slice(0, 2).map((p) => p.label), ...pepHit.facts.slice(0, 2)].join("; ")}` : "No public-office or state-ownership record found."],
          ["Beneficial ownership and corporate records (GLEIF, UK Companies House)", r.gleif.state === "ok" || r.companiesHouse.state === "ok" ? (r.gleif.hits.length || r.companiesHouse.hits.length ? "Possible match" : "No match") : "Not checked", r.gleif.hits.length || r.companiesHouse.hits.length ? "Records found; see Section 4." : "No record found."],
          ["ICIJ Offshore Leaks", r.offshore.state === "ok" ? (r.offshore.hits.length ? "Possible match" : "No match") : "Not checked", r.offshore.hits.length ? r.offshore.hits.slice(0, 2).map((h) => h.name).join("; ") : "No record found."],
          ["World Bank debarment list", "Not checked", wb ? `Search by hand: ${wb.url}` : "Search by hand."],
        ],
        { canAdd: false }
      ),
    ])
  );

  // 8 ─ Commercial
  const env = r.environment;
  sections.push(
    sec("8", "Commercial & Market Due Diligence", "partly", [
      H("Market"),
      KV(["Metric", "Value / assessment"], [["Market size", ""], ["Growth rate", ""], ["Competitive intensity", ""], ["Market trends", ""]]),
      H("Customers"),
      TBL([txt("Customer", 26), num("Revenue %", 14), txt("Relationship", 20), txt("Contract term", 18), choice("Churn risk", 22, RISK)], [], { blank: 4 }),
      H("Commercial Risks"),
      CH(["Customer concentration", "Customer churn", "Pricing pressure", "Competitive threats", "Dependence on key accounts", "Market disruption", "Supplier concentration", "Geographic concentration"]),
      H("Competitive Position"),
      P("", undefined, "Competitive advantages and disadvantages, barriers to entry, substitutes and differentiation."),
      H("Country & Operating Environment"),
      P(env?.note ?? "No country was given."),
      ...(env?.incidents.length ? [TBL([choice("Level", 12, ["Critical", "Elevated"]), txt("Incident", 34), txt("Location", 16), txt("Assessment", 38)], env.incidents.map((i) => [i.level === "critical" ? "Critical" : "Elevated", i.headline, i.location ?? "", clip(i.assessment || i.summary, 220)]), { canAdd: false })] : []),
      CALL("Source", "From this platform's own conflict-escalation monitoring, which flags Elevated and Critical incidents from news reporting. It is not a country risk rating.", "none"),
    ])
  );

  // 9 ─ Media
  const covRows: string[][] = [];
  for (const i of media.filter((x) => x.relevance !== "different_entity").slice(0, 6)) covRows.push([i.published ?? "", i.domain, clip(i.title, 90), "Negative", "", clip(i.what || i.title, 140), i.severity === "high" ? "High" : i.severity === "medium" ? "Medium" : "Low"]);
  const seen = new Set(covRows.map((x) => x[2]));
  for (const i of (mc?.recent ?? []).slice(0, 10)) if (!seen.has(clip(i.title, 90)) && covRows.length < 12) covRows.push([i.published ?? "", i.domain, clip(i.title, 90), i.sentiment ? i.sentiment[0].toUpperCase() + i.sentiment.slice(1) : "Not rated", "", "", ""]);
  const socialRows: string[][] = [];
  for (const a of so?.accounts.filter((x) => x.platform !== "Website") ?? []) socialRows.push([a.platform, a.url, "Not measured", "Not rated", "Not measured", "", ""]);
  for (const p of ["X (Twitter)", "Facebook", "LinkedIn", "Instagram", "YouTube", "TikTok"]) if (!socialRows.some((x) => x[0] === p)) socialRows.push([p, "No account on record in Wikidata; check by hand", "Not measured", "Not rated", "Not measured", "", ""]);
  if (so?.posts.length) socialRows.push(["Bluesky / Mastodon", `${so.posts.length} recent public posts naming the subject`, "n/a", "Not rated", "n/a", clip(so.posts[0].text, 100), ""]);
  const flagged = (re: RegExp) => media.some((i) => re.test(`${i.category} ${i.what}`) && i.relevance !== "different_entity");
  const sentimentWord = mc?.tone && mc.tone !== "unclear" ? mc.tone[0].toUpperCase() + mc.tone.slice(1) : "Not rated";
  sections.push(
    sec("9", "Media, Reputation & Social Media Due Diligence", "screening", [
      P("Reputation and sentiment across traditional media, online publications and open social networks. Verified facts are kept apart from allegations, opinion and unsubstantiated claims."),
      H("9.1 Media Coverage"),
      CALL("Coverage in brief", mc ? `${mc.overview}${mc.total ? ` ${mc.total} headlines in three months.` : ""}${mc.themes.length ? ` Themes: ${mc.themes.join("; ")}.` : ""}` : "Media coverage could not be checked.", mc?.tone === "negative" ? "bad" : mc?.tone === "mixed" ? "watch" : "none"),
      TBL([txt("Date", 10), txt("Source / outlet", 13), txt("Topic", 20), choice("Sentiment", 11, SENTIMENT), choice("Prominence", 13, ["High", "Medium", "Low", "Not rated"]), txt("Key message / finding", 22), choice("Risk", 11, RISK)], covRows, { blank: 2 }),
      H("9.2 Social Media Coverage & Sentiment"),
      CALL("Social presence in brief", so?.overview ?? "Social media could not be checked.", "none"),
      TBL([txt("Platform", 12), txt("Account / source", 20), txt("Following / reach", 12), choice("Sentiment", 12, SENTIMENT), txt("Engagement", 14), txt("Key themes", 16), choice("Risk", 14, RISK)], socialRows),
      H("9.3 Reputation & Sentiment Assessment"),
      TBL(
        [txt("Dimension", 22), txt("Assessment", 36), choice("Rating", 14, ["Positive", "Neutral", "Negative", "Low risk", "Medium risk", "High risk", "Not assessed"]), txt("Evidence / notes", 28)],
        [
          ["Overall public sentiment", mc?.overview ?? "", sentimentWord, mc?.total ? `${mc.total} headlines; AI-rated from headlines.` : ""],
          ["Brand reputation", "", "Not assessed", ""],
          ["Management / key individuals", pepHit ? `Public office on record: ${pepHit.label}` : "", "Not assessed", ""],
          ["Products / services", "", "Not assessed", ""],
          ["Customer complaints", "", "Not assessed", "Review sites and complaint forums were not searched."],
          ["Regulatory / legal controversy", media.filter((i) => ["investigation", "charge", "conviction", "penalty"].includes(i.status)).slice(0, 2).map((i) => clip(i.what, 100)).join("; "), media.some((i) => ["charge", "conviction", "penalty"].includes(i.status)) ? "High risk" : media.some((i) => i.status === "investigation") ? "Medium risk" : "Not assessed", ""],
          ["ESG / community issues", "", flagged(/environment|labou?r|human rights|community|safety/i) ? "Medium risk" : "Not assessed", ""],
        ]
      ),
      H("9.4 Adverse Media & Reputation Red Flags"),
      CH(
        ["Allegations of fraud, corruption, bribery, misconduct or unethical behaviour", "Material lawsuits, regulatory investigations, sanctions or enforcement actions", "Significant customer or employee complaints", "Negative coverage involving founders, directors, executives or beneficial owners", "Product safety, quality, environmental, labour or human-rights controversies", "Sustained negative sentiment or coordinated reputational campaigns", "Viral incidents or posts with material potential to damage the brand", "Fake, impersonation, bot or coordinated social-media activity"],
        [
          ...(flagged(/fraud|corrupt|brib|launder|embezzl|misconduct|abuse of office|enrichment/i) ? ["Allegations of fraud, corruption, bribery, misconduct or unethical behaviour"] : []),
          ...(media.some((i) => ["investigation", "charge", "penalty", "conviction"].includes(i.status)) || strong ? ["Material lawsuits, regulatory investigations, sanctions or enforcement actions"] : []),
          ...(flagged(/environment|labou?r|human rights|safety|pollut/i) ? ["Product safety, quality, environmental, labour or human-rights controversies"] : []),
          ...(mc?.tone === "negative" ? ["Sustained negative sentiment or coordinated reputational campaigns"] : []),
        ],
        "Ticked from the media screen. Complaints, viral and coordinated activity need manual review of review sites and social platforms."
      ),
      H("9.5 Positive Reputation Indicators"),
      CH(["Consistently positive independent media coverage", "Strong customer advocacy and positive reviews", "Positive employee / workplace sentiment", "Credible awards, certifications or industry recognition", "Positive community or ESG reputation", "Strong executive / founder reputation"], mc?.tone === "positive" ? ["Consistently positive independent media coverage"] : []),
      H("9.6 Media & Social Media Conclusion"),
      P(`Overall sentiment: ${sentimentWord}. ${mc?.overview ?? ""} ${so?.overview ?? ""} ${media.length ? `${media.length} adverse item(s) were identified; the most serious: ${clip(media[0].what || media[0].title, 160)}` : "No adverse reporting was identified in the sources searched."}`.trim(), undefined, "Add the credibility of any negative claims, likely persistence, transaction impact and recommended mitigation."),
    ])
  );

  // 10–16 ─ data-room sections
  sections.push(
    sec("10", "Operations Due Diligence", "analyst", [
      P("", undefined, "The operating model and key processes."),
      CH(["Production / service delivery", "Capacity", "Supply chain", "Procurement", "Quality control", "Inventory", "Logistics", "Facilities", "Business continuity"]),
      H("Operational Findings"),
      TBL([txt("Area", 20), txt("Current state", 40), choice("Risk", 12, RISK), txt("Recommendation", 28)], [], { blank: 4 }),
    ]),
    sec("11", "Technology & Cybersecurity", "analyst", [
      H("Technology Environment"),
      P("", undefined, "Architecture, critical systems, applications, infrastructure, cloud, integration and technical debt."),
      H("Systems Inventory"),
      TBL([txt("System", 18), txt("Purpose", 24), txt("Age", 10), txt("Owner", 14), choice("Criticality", 16, LMH), choice("Risk", 18, RISK)], [], { blank: 3 }),
      H("Cybersecurity Assessment"),
      CH(["Access controls", "MFA", "Backups", "Disaster recovery", "Incident history", "Penetration testing", "Endpoint security", "Cloud infrastructure", "Data protection", "Third-party vendors"]),
      H("Technology Risks"),
      B([]),
    ]),
    sec("12", "Human Resources", "analyst", [
      H("Workforce"),
      TBL([txt("Category", 50), num("Number", 25), num("% of workforce", 25)], [["Management", "", ""], ["Employees", "", ""], ["Contractors", "", ""], ["Total", "", ""]], { canAdd: false, boldLast: true, calc: [{ row: 3, expr: "r0 + r1 + r2", fmt: "num", only: [1] }] }),
      H("HR Review"),
      CH(["Employment contracts", "Compensation", "Benefits", "Bonuses", "Key-person dependency", "Employee turnover", "Labour disputes", "Pension obligations", "Restrictive covenants", "Organisational structure"]),
      H("Key-Person Risk"),
      P(""),
    ]),
    sec("13", "Intellectual Property", "analyst", [
      TBL([txt("Asset", 14), txt("Owner", 18), txt("Registration", 18), txt("Expiry", 12), txt("Encumbrance", 18), choice("Risk", 20, RISK)], ["Trademark", "Patent", "Copyright", "Domain"].map((a) => [a, "", "", "", "", "Not assessed"])),
      H("IP Risks"),
      B([]),
    ])
  );

  // 14 ─ ESG
  const esgRows = media.filter((i) => /environment|pollut|labou?r|human rights|safety|child|community|land/i.test(`${i.category} ${i.what}`)).slice(0, 5).map((i) => [clip(i.category, 40), clip(i.what, 160) + ` (${i.domain})`, i.severity === "high" ? "High" : "Medium", ""]);
  sections.push(
    sec("14", "ESG / Environmental & Social", "partly", [
      CH(["Environmental permits", "Pollution / contamination", "Waste management", "Health & safety", "Labour practices", "Community impact", "Governance", "Anti-bribery & corruption", "Human rights", "Climate-related risks"], flags.some((f) => f.category === "Legal" || /corrupt|brib/i.test(f.flag)) ? ["Anti-bribery & corruption"] : []),
      H("ESG Findings"),
      TBL([txt("Issue", 22), txt("Finding", 46), choice("Severity", 14, RISK), txt("Remediation", 18)], esgRows, { blank: esgRows.length ? 0 : 3 }),
    ]),
    sec("15", "Insurance", "analyst", [
      TBL([txt("Policy", 18), txt("Insurer", 16), txt("Coverage", 18), num("Limit", 14), num("Deductible", 14), txt("Expiry", 12)], ["General liability", "Property", "Professional indemnity", "Cyber", "Directors & officers", "Political violence / terrorism"].map((p) => [p, "", "", "", "", ""])),
      H("Insurance Gaps"),
      B([]),
    ]),
    sec("16", "Related-Party Transactions", "analyst", [
      TBL([txt("Related party", 20), txt("Relationship", 16), txt("Transaction", 20), num("Annual value", 12), txt("Terms", 18), choice("Risk", 14, RISK)], [], { blank: 3 }),
      P("Assess whether transactions are at arm's length, properly documented, commercially justified and fully disclosed."),
    ])
  );

  // 17 ─ Risk matrix
  const L: Record<Severity, [string, string]> = { Critical: ["High", "High"], High: ["Medium", "High"], Medium: ["Medium", "Medium"], Low: ["Low", "Low"] };
  const riskRowsSeed = flags.map((f) => [clip(f.flag, 130), f.category, L[f.severity][0], L[f.severity][1], "", clip(f.action, 140), ""]);
  const covered = new Set(flags.map((f) => f.category));
  for (const cat of ["Financial", "Legal", "Commercial", "Operational", "Tax", "Technology", "HR", "Reputation"]) if (!covered.has(cat)) riskRowsSeed.push([cat === "Legal" || cat === "Reputation" ? "No issue identified in the public sources screened" : "Not assessed: evidence not yet provided", cat, "", "", "", "", ""]);
  sections.push(
    sec("17", "Integrated Risk Matrix", "partly", [
      TBL(
        [txt("Risk", 24), txt("Category", 11), choice("Likelihood", 11, LMH), choice("Impact", 10, LMH), { h: "Rating", w: 11, kind: "auto" }, txt("Mitigation", 24), txt("Owner", 9)],
        riskRowsSeed
      ),
      H("Risk Rating Definitions"),
      TBL([txt("Rating", 18), txt("Definition", 82)], [["Critical", "Could materially impair or prevent the transaction."], ["High", "Material financial, legal, operational or strategic concern."], ["Medium", "Manageable risk requiring mitigation."], ["Low", "Limited impact or routine issue."]], { canAdd: false }),
      CALL("How ratings are worked out", "Rating = likelihood × impact on a 3 × 3 scale (Low 1, Medium 2, High 3): 9 Critical, 6 High, 3–4 Medium, 1–2 Low. Rows with no likelihood or impact show Not assessed.", "none"),
    ])
  );

  // 18 ─ Red flags
  const crit = flags.filter((f) => f.severity === "Critical" || f.severity === "High");
  sections.push(
    sec("18", "Red Flag Report", "screening", [
      CALL("Principle", "The most decision-useful section. Every red flag shows its evidence, potential impact, severity and the action required. Allegations are reported as allegations.", "watch"),
      TBL([txt("#", 4), txt("Red flag", 22), txt("Evidence", 28), txt("Potential impact", 18), choice("Severity", 10, RISK), txt("Recommended action", 18)], flags.map((f, i) => [String(i + 1), f.flag, f.evidence, f.impact, f.severity, f.action]), { blank: flags.length ? 0 : 1 }),
      H("Critical Issues Requiring Resolution Before Closing"),
      B(crit.map((f) => `${f.flag}: ${f.action}`)),
    ])
  );

  // 19 ─ Valuation
  sections.push(
    sec("19", "Valuation & Deal Implications", "analyst", [
      H("Key Valuation Assumptions"),
      KV(["Assumption", "Value"], [["Revenue", ""], ["EBITDA", ""], ["EBITDA multiple", ""], ["Net debt", ""], ["Working capital", ""], ["Growth rate", ""]]),
      H("Purchase Price Bridge"),
      TBL([txt("Item", 70), num("Amount", 30)], [["Indicative enterprise value", ""], ["Less: net debt", ""], ["Plus / minus: working capital adjustment", ""], ["Indicative equity value", ""]], { canAdd: false, boldLast: true, calc: [{ row: 3, expr: "r0 - r1 + r2", fmt: "num" }] }),
      H("Due Diligence Adjustments"),
      TBL([txt("Issue", 70), num("Estimated financial impact", 30)], [["Normalisation adjustments", ""], ["Debt-like items", ""], ["Working capital adjustment", ""], ["Contingent liabilities", ""], ["Required capex", ""], ["Tax exposure", ""], ["Other", ""], ["Total", ""]], { canAdd: false, boldLast: true, calc: [{ row: 7, expr: "r0 + r1 + r2 + r3 + r4 + r5 + r6", fmt: "num", only: [1] }] }),
    ])
  );

  // 20 ─ Info gaps
  const questions = flags.filter((f) => f.severity !== "Low").slice(0, 8).map((f, i) => [String(i + 1), clip(`Please explain and evidence: ${f.flag}`, 170), f.category, f.severity === "Critical" || f.severity === "High" ? "High" : "Medium"]);
  sections.push(
    sec("20", "Management Representations & Information Gaps", "partly", [
      H("Management Representations"),
      P("", undefined, "Material representations made by management, and any that need contractual protection."),
      H("Information Not Provided"),
      TBL(
        [txt("Requested information", 52), choice("Status", 18, STATUS_IN), txt("Impact", 30)],
        [...DATA_ROOM.map(([d, area]) => [d, "Outstanding", `${area} cannot be assessed.`]), ...r.sources.filter((s) => s.state !== "ok").map((s) => [`Screening source: ${s.label}`, "Outstanding", s.state === "not_configured" ? "Not set up on this platform; result incomplete." : (s.note ?? "Could not be checked; result incomplete.")])]
      ),
      H("Questions for Management"),
      TBL([txt("#", 5), txt("Question", 62), txt("Area", 17), choice("Priority", 16, ["High", "Medium", "Low"])], questions, { blank: questions.length ? 0 : 2 }),
      H("Reliance / Limitations"),
      P(r.disclaimer),
    ])
  );

  // 21 ─ Recommendation
  sections.push(
    sec("21", "Final Recommendation & Closing Conditions", "partly", [
      CHOICE("Decision", ["Proceed", "Proceed subject to conditions", "Renegotiate terms", "Conduct further diligence", "Do not proceed"], rec === "Further diligence" ? "Conduct further diligence" : rec, rec ? "Preliminary, from the screening." : undefined),
      H("Rationale"),
      P(`${r.summary.text} ${strong ? "A confirmed sanctions match would prevent the transaction." : ""}`.trim(), undefined, "Link the transaction thesis to the risks, opportunities and valuation."),
      H("Conditions Precedent"),
      B([...(strong ? ["Written confirmation, with evidence, that the target and its owners are not the designated party on the matched list."] : []), ...r.summary.nextSteps, ...crit.slice(0, 3).map((f) => f.action)].filter((x, i, a) => a.indexOf(x) === i).slice(0, 8)),
      H("Post-Closing Priorities"),
      KV(["Timeframe", "Priorities"], [["First 30 days", ""], ["First 90 days", ""], ["First 12 months", ""]]),
    ])
  );

  // 22 ─ Appendices
  const mediaAll = media;
  sections.push(
    sec("22", "Appendices", "partly", [
      H("A. Documents & Sources Reviewed"),
      TBL(
        [txt("Document / source", 44), txt("Date", 14), choice("Status", 14, ["Received", "Outstanding"]), txt("Notes", 28)],
        r.sources.map((s) => [s.label, day(r.generatedAt), s.state === "ok" ? "Received" : "Outstanding", s.note ?? ""])
      ),
      H("B. Management Interviews"),
      TBL([txt("Name / role", 24), txt("Date", 14), txt("Topics", 26), txt("Key takeaways", 36)], [], { blank: 3 }),
      H("C. Detailed Financial Analysis"),
      P("", undefined, "Schedules, supporting calculations, bridges, KPIs and reconciliations."),
      H("D. Legal Documents"),
      P("", undefined, "Legal review schedules."),
      H("E. Contract Register"),
      P("", undefined, "Detailed contract register."),
      H("F. Litigation Register"),
      P("", undefined, "Detailed litigation and claims register."),
      H("G. Risk Register"),
      P("The integrated risk matrix in Section 17 is the working risk register."),
      H("H. Data Room Exceptions"),
      P("", undefined, "Exceptions, missing documents, inconsistent records and follow-up requests."),
      H("I. Assumptions & Definitions"),
      B([
        "Currency and periods: as set in the report details; LTM means last twelve months.",
        "Name matching: a candidate is a strong match at 90% similarity or above and a possible match from 72%. Matching ignores word order, accents, common transliterations and company suffixes (Ltd, Limited, Inc).",
        "Evidence confidence: High where an official register or full article was read; Medium where a database or headline supports the finding; Low where a source was unavailable or the match is a name only.",
        "Adverse media: allegation, investigation, charge, conviction, penalty or cleared, as stated in the source. Namesakes are screened out where the article is evidently about a different person or company.",
        "Materiality: a finding is a red flag if it could change the decision, price, structure or timing of the transaction.",
      ]),
      H("J. Screening Audit Trail"),
      KV(["Item", "Detail"], [["Subject searched", [c.name, ...r.input.aliases].join("; ")], ["Subject type", entity ? "Organisation" : "Public figure"], ["Country", r.input.country ?? ""], ["Identifiers supplied", r.input.identifiers ?? ""], ["Run", new Date(r.generatedAt).toLocaleString("en-GB")], ["Reference", c.reference ?? ""]]),
      TBL([txt("Source", 50), choice("Status", 16, ["Checked", "Unavailable", "Not set up"]), txt("Note", 34)], r.sources.map((s) => [s.label, s.state === "ok" ? "Checked" : s.state === "unavailable" ? "Unavailable" : "Not set up", s.note ?? ""]), { canAdd: false }),
      H("K. Adverse Media Evidence"),
      TBL([txt("Date", 10), txt("Outlet", 14), txt("Report and link", 38), txt("Status", 12), choice("Severity", 11, RISK), txt("Basis", 15)], mediaAll.map((i) => [i.published ?? "", i.domain, `${clip(i.title, 100)} ${i.url}`, i.status, i.severity === "high" ? "High" : i.severity === "medium" ? "Medium" : "Low", `${i.relevance.replace("_", " ")}; ${i.basis === "full_text" ? "full text" : "headline only"}`]), { canAdd: false, blank: mediaAll.length ? 0 : 1 }),
      H("L. Registers to Check by Hand"),
      B(r.registries.map((l) => `${l.label}: ${l.url}`)),
    ])
  );

  // 23 ─ Sign-off
  sections.push(
    sec("23", "Review & Sign-Off", "analyst", [
      TBL([txt("Role", 20), txt("Name", 30), txt("Signature", 28), txt("Date", 22)], [["Prepared by", "", "", ""], ["Reviewed by", "", "", ""], ["Approved by", "", "", ""]], { canAdd: false }),
    ])
  );

  return {
    version: 1,
    caseId: c.id,
    meta: {
      target: c.name,
      transaction: c.reference ? `Ref ${c.reference}` : entity ? "Counterparty due diligence" : "Public-figure due diligence",
      preparedFor: "",
      preparedBy: "Afrilens Consulting",
      date: when,
      versionLabel: "v1.0 (draft)",
      confidentiality: "Strictly Confidential",
      currency: "USD",
      purpose: "Commercial Due Diligence Report",
    },
    sections,
  };
}

export { redFlags, severityRank };
