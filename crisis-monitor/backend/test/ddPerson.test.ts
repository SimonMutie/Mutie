import { describe, it, expect } from "vitest";
import { buildReport } from "../../frontend/src/report/template";
import { reportHtml } from "../../frontend/src/report/html";
import { reportToDocx } from "../../frontend/src/report/docx";
import { shownRows, type Block } from "../../frontend/src/report/model";
import { outcomeOf } from "../../frontend/src/report/personTemplate";
import type { DdCase } from "../../frontend/src/api";

// A fictional public figure, with the sources as the screening engine would return them.
export const base: DdCase = {
  id: "dd_p", name: "Jane Q Example", subject_type: "person", reference: null, created_at: "2026-10-07T12:00:00Z",
  result: {
    input: { name: "Jane Q Example", kind: "person", country: "Kenya", aliases: ["J. Example"], identifiers: "Former minister, Kenyan, born 1968" },
    outcome: "pep",
    sanctions: { hits: [], lists: ["OFAC", "UN", "EU", "UK"].map((id) => ({ id, label: id, status: "ok", entries: 1000, asOf: "2026-10-07T03:00:00Z" })) },
    office: { id: "wikidata", label: "Wikidata", state: "ok", hits: [
      { url: "https://www.wikidata.org/wiki/Q9", label: "Jane Example", description: "Kenyan politician", strength: "strong", isHuman: true, countries: ["Kenya"], facts: [],
        positions: [{ label: "Cabinet Secretary for Energy", from: "2018", to: "2022", current: false }],
        person: { born: "1970", died: null, occupations: ["politician", "engineer"], education: [{ label: "University of Nairobi", from: "1988", to: "1992" }], employers: [{ label: "Example Power Ltd", from: "2002", to: "2012" }], parties: ["Example Party"], memberships: [], awards: ["Order of the Burning Spear"] } },
      { url: "https://www.wikidata.org/wiki/Q10", label: "Jane Example", description: "footballer", strength: "possible", isHuman: true, countries: ["Ghana"], facts: [], positions: [] },
    ] },
    gleif: { id: "gleif", label: "GLEIF", state: "ok", hits: [] },
    companiesHouse: { id: "ch", label: "CH", state: "ok", hits: [{ kind: "officer", url: "https://find-and-update.company-information.service.gov.uk/officers/x", name: "EXAMPLE, Jane", number: null, status: null, incorporated: null, people: [], appointments: 3, strength: "strong" }] },
    offshore: { id: "o", label: "Offshore", state: "ok", hits: [] },
    media: { id: "m", label: "Media", state: "ok", hits: [{ candidates: 4, read: 2, classified: true, items: [
      { url: "https://news.example/1", title: "Minister accused of bribery in power tender", domain: "news.example", published: "2026-09-02", basis: "full_text", relevance: "about_subject", category: "corruption", severity: "high", status: "allegation", what: "Anti-corruption body is reported to be examining a tender awarded during her tenure." },
      { url: "https://news.example/2", title: "Other Jane Example wins award", domain: "other.example", published: "2026-09-05", basis: "headline_only", relevance: "different_entity", category: "none", severity: "none", status: "none", what: "" },
    ] }] },
    mediaCoverage: { id: "mc", label: "Coverage", state: "ok", hits: [{ total: 8, byMonth: [], topOutlets: [], recent: [{ title: "Jane Example speaks on energy policy", url: "https://n.example/3", domain: "n.example", published: "2026-09-20", sentiment: "neutral" }], themes: ["Energy policy"], tone: "mixed", overview: "Regular coverage on energy policy.", aiWritten: false }] },
    social: { id: "s", label: "Social", state: "ok", hits: [{ accounts: [{ platform: "X (Twitter)", url: "https://x.com/jq", handle: "jq" }], accountsFrom: "https://www.wikidata.org/wiki/Q9", posts: [], networksSearched: ["Bluesky"], networksFailed: [], searchLinks: [], overview: "Official account on record." }] },
    registries: [], sources: [
      { id: "OFAC", label: "OFAC", state: "ok" }, { id: "wikidata", label: "Public office (Wikidata)", state: "ok" }, { id: "adverse_media", label: "Adverse media", state: "ok" },
    ],
    summary: { text: "x", keyPoints: ["a"], nextSteps: ["b"], aiWritten: false }, coverage: "Checked.", disclaimer: "", generatedAt: "2026-10-07T12:00:00Z",
  },
} as unknown as DdCase;

const tables = (rep: ReturnType<typeof buildReport>, no: string) => rep.sections.find((s) => s.no === no)!.blocks.filter((b): b is Extract<Block, { t: "table" }> => b.t === "table");

describe("individual / public-figure report", () => {
  it("has the template's 30 sections and appendices, filled from the screening", () => {
    const rep = buildReport(base);
    expect(rep.meta.purpose).toBe("Individual / Public Figure Due Diligence Report");
    expect(rep.sections.filter((s) => /^\d+$/.test(s.no))).toHaveLength(30);
    expect(rep.sections.map((s) => s.no).slice(30, 36)).toEqual(["A", "B", "C", "D", "E", "F"]);
    const kv = rep.sections[1].blocks.find((b): b is Extract<Block, { t: "kv" }> => b.t === "kv")!;
    expect(kv.rows.find((r) => r[0].startsWith("Year of birth"))![1]).toContain("1970");
    expect(JSON.stringify(tables(rep, "4")[0].rows)).toContain("University of Nairobi");
    expect(JSON.stringify(tables(rep, "9")[0].rows)).toContain("Cabinet Secretary for Energy");
    // Anything said about a namesake is set aside, and the namesake is listed as a confusion risk.
    expect(JSON.stringify(rep.sections[1].blocks)).toContain("footballer");
    const crim = shownRows(tables(rep, "7")[0]);
    expect(crim[0][3]).toBe("Allegation");
  });

  it("weighs an allegation by evidence, never as a finding", () => {
    expect(outcomeOf("Critical", "Low")).toBe("Do not conclude");
    expect(outcomeOf("High", "Low")).toBe("Unresolved");
    const rep = buildReport(base);
    const flags = shownRows(tables(rep, "19")[0]);
    expect(flags.length).toBeGreaterThanOrEqual(2);
    const media = flags.find((r) => /examining a tender/.test(r[1]))!;
    expect(media[3]).toBe("High");
    expect(media[4]).toBe("Medium");
    expect(JSON.stringify(shownRows(tables(rep, "24")[0])[0])).toContain("Unverified");
  });

  it("cannot clear a person from open sources alone", () => {
    const rep = buildReport({ ...base, result: { ...base.result, media: { ...base.result.media, hits: [{ candidates: 0, read: 0, classified: true, items: [] }] }, office: { ...base.result.office, hits: [] }, companiesHouse: { ...base.result.companiesHouse, hits: [] } } } as DdCase);
    const choice = rep.sections.find((s) => s.no === "29")!.blocks.find((b): b is Extract<Block, { t: "choice" }> => b.t === "choice")!;
    expect(choice.value).not.toMatch(/^A\./);
  });

  it("flags a strong sanctions match as critical, pending identity", () => {
    const hit = { list: "UN", ref: "1", kind: "person", name: "Jane Example", matchedName: "Jane Example", score: 0.97, strength: "strong", countries: ["Ghana"], programs: ["X"], listedOn: null, remarks: null };
    const rep = buildReport({ ...base, result: { ...base.result, sanctions: { ...base.result.sanctions, hits: [hit] } } } as unknown as DdCase);
    const rows = shownRows(tables(rep, "22")[1]);
    expect(rows.find((r) => /sanctions/i.test(r[0]))![3]).toBe("Do not conclude");
    const fp = shownRows(tables(rep, "8")[1]);
    expect(fp[0][3]).toBe("Not yet resolved");
    const choice = rep.sections.find((s) => s.no === "29")!.blocks.find((b): b is Extract<Block, { t: "choice" }> => b.t === "choice")!;
    expect(choice.value).toMatch(/^E\./);
  });

  it("exports to Word and PDF", async () => {
    const rep = buildReport(base);
    expect(reportHtml(rep)).toContain("Individual / Public Figure Due Diligence Report");
    expect((await reportToDocx(rep)).size).toBeGreaterThan(20000);
  });
});

describe("photo section", () => {
  it("offers a Commons image only for an unambiguous match, and exports it", async () => {
    const withImg = JSON.parse(JSON.stringify(base)) as DdCase;
    withImg.result.office.hits[0].person!.image = "Jane Example.jpg";
    withImg.result.office.hits = [withImg.result.office.hits[0]];
    const rep = buildReport(withImg);
    const ph = rep.sections[1].blocks.find((b) => b.t === "photo") as Extract<Block, { t: "photo" }>;
    expect(ph.url).toContain("Special:FilePath/Jane%20Example.jpg");
    // With a namesake in the results the picture is not offered; the slot stays open for an authenticated image.
    const amb = buildReport({ ...withImg, result: { ...withImg.result, office: { ...withImg.result.office, hits: base.result.office.hits.map((h, i) => (i ? h : { ...h, person: { ...h.person!, image: "x.jpg" } })) } } } as DdCase);
    expect((amb.sections[1].blocks.find((b) => b.t === "photo") as Extract<Block, { t: "photo" }>).url).toBeUndefined();
    // A resolved picture is embedded in the Word file and the PDF page.
    const png = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
    ph.src = png; ph.w = 1; ph.h = 1;
    expect(reportHtml(rep)).toContain("<img src=\"data:image/jpeg");
    expect((await reportToDocx(rep)).size).toBeGreaterThan(20000);
  });
});

import { buildNetwork, graphSvg, linkRows, layout } from "../../frontend/src/report/network";

describe("link analysis", () => {
  const r = JSON.parse(JSON.stringify(base.result));
  r.office.hits = [r.office.hits[0]];
  it("connects the subject to offices, employers, parties, registers and risk records", () => {
    const g = buildNetwork(r, base.name);
    const labels = g.nodes.map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(["Cabinet Secretary for Energy", "Example Power Ltd", "Example Party"]));
    expect(g.edges.find((e) => e.label === "officer")?.basis).toBe("register");
    expect(g.edges.find((e) => e.label === "employer 2002–2012")?.basis).toBe("reported");
    expect(g.nodes.some((n) => n.kind === "risk")).toBe(true);
    const pos = layout(g.nodes, g.edges);
    expect(pos.size).toBe(g.nodes.length);
    expect(graphSvg(g)).toContain("Jane Q Example");
    expect(linkRows(g)[0][0]).toBe(base.name);
  });
  it("leaves out Wikidata links when a namesake makes the match ambiguous", () => {
    const amb = buildNetwork(base.result, base.name);
    expect(amb.nodes.some((n) => n.label === "Example Power Ltd")).toBe(false);
  });
  it("is in the individual report, the PDF and the entity report", () => {
    const rep = buildReport(base);
    expect(rep.sections.find((s) => s.no === "10")!.blocks.some((b) => b.t === "graph")).toBe(true);
    expect(reportHtml(rep)).toContain("<svg");
  });
});
