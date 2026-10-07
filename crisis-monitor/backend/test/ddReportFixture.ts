import type { DdCase } from "../../frontend/src/api";
export const fixture: DdCase = {
  id: "dd_1", name: "Acme Oilfield Services Company", subject_type: "entity", reference: "SAMPLE-001", created_at: "2026-10-07T12:45:00Z",
  result: {
    input: { name: "Acme Oilfield Services Company", kind: "entity", country: "South Sudan", aliases: ["ACME"], identifiers: "Oil and gas operator, Juba" },
    outcome: "review",
    sanctions: { hits: [
      { list: "OFAC", ref: "12345", kind: "entity", name: "Acme Oilfield Services Co Ltd", matchedName: "Acme Oilfield Services Co Ltd", score: 0.93, strength: "strong", countries: ["SS"], programs: ["SOUTH SUDAN"], listedOn: "2018-03-01", remarks: null },
    ], lists: [
      { id: "OFAC", label: "OFAC", status: "ok", entries: 17000, asOf: "2026-10-07T03:00:00Z" },
      { id: "UN", label: "UN", status: "ok", entries: 1000, asOf: "2026-10-07T03:00:00Z" },
      { id: "EU", label: "EU", status: "unavailable", error: "HTTP 404 from webgate.ec.europa.eu" },
      { id: "UK", label: "UK", status: "ok", entries: 5000, asOf: "2026-10-07T03:00:00Z" },
    ] },
    office: { id: "wikidata", label: "Wikidata", state: "ok", hits: [{ url: "https://www.wikidata.org/wiki/Q1", label: "Acme Oilfield Services", description: "oil company", strength: "possible", isHuman: false, positions: [], facts: ["Type: company", "Owned by: Example National Oil Corporation (state-owned)"] }] },
    gleif: { id: "gleif", label: "GLEIF", state: "ok", hits: [{ url: "https://search.gleif.org/", name: "Acme Oilfield Services Company Ltd", lei: "5493001KJTIIGC8Y1R12", status: "ACTIVE", jurisdiction: "SS", directParent: "Acme Group Holdings", ultimateParent: "Example National Oil Corporation", strength: "strong" }] },
    companiesHouse: { id: "ch", label: "CH", state: "not_configured", hits: [] },
    offshore: { id: "o", label: "Offshore", state: "ok", hits: [{ url: "https://offshoreleaks.icij.org/nodes/1", name: "Acme Holdings (BVI)", type: "Entity", strength: "strong" }] },
    media: { id: "m", label: "Media", state: "ok", hits: [{ candidates: 12, read: 6, classified: true, items: [
      { url: "https://example.org/a", title: "Auditors flag missing oil revenue at Acme Oilfield Services", domain: "example.org", published: "2026-09-02", basis: "full_text", relevance: "about_subject", category: "corruption", severity: "high", status: "investigation", what: "The national audit chamber is investigating unaccounted oil revenue at Acme Oilfield Services Company." },
      { url: "https://example.com/b", title: "Community protests oil spill near Block 5", domain: "example.com", published: "2026-08-14", basis: "headline_only", relevance: "mentions_subject", category: "environment", severity: "medium", status: "allegation", what: "Residents allege an oil spill polluted water sources near the Block 5 field." },
    ] }] },
    mediaCoverage: { id: "mc", label: "Coverage", state: "ok", hits: [{ total: 23, byMonth: [], topOutlets: [{ domain: "example.org", count: 5 }], recent: [{ title: "Acme Oilfield Services signs export deal", url: "https://example.net/c", domain: "example.net", published: "2026-09-20", sentiment: "positive" }], themes: ["Oil revenue transparency", "Export deals"], tone: "mixed", overview: "Acme Oilfield Services is regularly covered in regional business and political press, mostly on revenue transparency and exports.", aiWritten: true }] },
    social: { id: "s", label: "Social", state: "ok", hits: [{ accounts: [{ platform: "Website", url: "https://acme.example", handle: "https://acme.example" }, { platform: "LinkedIn", url: "https://linkedin.com/company/acme", handle: "acme" }], accountsFrom: "https://www.wikidata.org/wiki/Q1", posts: [], networksSearched: ["Bluesky"], networksFailed: [], searchLinks: [], overview: "Official accounts on record: LinkedIn. 0 recent public posts naming the subject on Bluesky. Activity on X, Facebook, Instagram, LinkedIn and TikTok is not measured; use the search links." }] },
    environment: { country: "South Sudan", incidents: [{ level: "critical", headline: "Fighting near Block 5 oilfields", location: "Upper Nile", summary: "Clashes reported near oil installations.", assessment: "Clashes close to production sites raise the risk of shutdowns and attacks on staff.", lastEventDate: "2026-10-05", reportCount: 6 }], note: "1 flagged conflict-escalation incident(s) currently active in South Sudan on this platform." },
    registries: [{ label: "OpenCorporates", url: "https://opencorporates.com/companies?q=Dar" }],
    sources: [
      { id: "OFAC", label: "OFAC sanctions list", state: "ok", note: "As of 2026-10-07" }, { id: "EU", label: "EU sanctions list", state: "unavailable", note: "HTTP 404" },
      { id: "wikidata", label: "Public office (Wikidata)", state: "ok" }, { id: "companies_house", label: "UK Companies House", state: "not_configured" },
    ],
    summary: { text: "A strong name match on the OFAC list was found. Treat as a potential match until identifiers are verified.", keyPoints: ["Strong name match on OFAC.", "Offshore Leaks record found.", "National audit investigation reported."], nextSteps: ["Verify identity using registration number.", "Search the national registers."], aiWritten: true },
    coverage: "Checked: OFAC. Not checked (EU: unavailable).", disclaimer: "This is an automated screening of public sources, not a finding of fact or legal advice.", generatedAt: "2026-10-07T12:45:32Z",
  },
} as unknown as DdCase;
