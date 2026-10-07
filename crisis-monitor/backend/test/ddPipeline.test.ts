import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeD1 } from "./fakeD1";
import { primeList, resetListCache, resetListTableCheck, type ListEntry } from "../src/lib/dd/sanctionsLists";
import { setCoverageDelay } from "../src/lib/dd/presence";
import { runDueDiligence } from "../src/lib/dd/run";
import { buildReport } from "../../frontend/src/report/template";
import { shownRows, type Block } from "../../frontend/src/report/model";
import type { Env } from "../src/bindings";

// The analyst model is replaced by canned answers keyed on the tool being called.
vi.mock("../src/lib/llm", () => ({
  callStructured: async (_env: unknown, call: { toolName: string; user: string }) => {
    if (call.toolName === "report_articles") return { data: { items: [
      { index: 0, relevance: "about_subject", category: "corruption", severity: "high", status: "investigation", what: "The audit chamber is investigating unaccounted oil revenue at Acme Oilfield Services." },
      { index: 1, relevance: "different_entity", category: "none", severity: "none", status: "none", what: "" },
    ] }, provider: "anthropic", model: "test" };
    if (call.toolName === "summarise_coverage") return { data: { themes: ["Oil revenue"], tone: "mixed", overview: "Regular coverage on revenue transparency.", headlines: [{ index: 0, sentiment: "negative" }, { index: 1, sentiment: "positive" }] }, provider: "anthropic", model: "test" };
    if (call.toolName === "write_summary") return { data: { text: "A strong sanctions-list match and an audit investigation need resolving.", keyPoints: ["Strong OFAC match", "Audit investigation"], nextSteps: ["Verify registration number"] }, provider: "anthropic", model: "test" };
    return null;
  },
}));

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const claim = (value: unknown) => ({ mainsnak: { datavalue: { value } } });

function route(url: string): Response {
  if (url.includes("api.gdeltproject.org"))
    return json({ articles: [
      { url: "https://news.example/audit", title: "Auditors flag missing oil revenue at Acme Oilfield Services", seendate: "20260902T101500Z", domain: "news.example", language: "English", sourcecountry: "South Sudan" },
      { url: "https://news.example/other", title: "Acme Oilfield Services signs export deal", seendate: "20260920T101500Z", domain: "biz.example", language: "English", sourcecountry: "Kenya" },
    ] });
  if (url.includes("action=wbsearchentities")) return json({ search: [{ id: "Q111" }] });
  if (url.includes("action=wbgetentities") && url.includes("ids=Q111")) {
    return json({ entities: { Q111: { id: "Q111", labels: { en: { value: "Acme Oilfield Services Company" } }, descriptions: { en: { value: "oil services company in South Sudan" } }, aliases: {}, claims: {
      P31: [claim({ id: "Q4830453" })], P571: [claim({ time: "+2009-00-00T00:00:00Z" })], P1128: [claim({ amount: "+450" })], P159: [claim({ id: "Q1946" })], P452: [claim({ id: "Q2" })], P127: [claim({ id: "Q3" })], P856: [claim("https://acme.example")], P2002: [claim("acme_oil")],
    } } } });
  }
  if (url.includes("action=wbgetentities")) return json({ entities: { Q4830453: { id: "Q4830453", labels: { en: { value: "company" } } }, Q1946: { id: "Q1946", labels: { en: { value: "Juba" } } }, Q2: { id: "Q2", labels: { en: { value: "oilfield services" } } }, Q3: { id: "Q3", labels: { en: { value: "Example National Oil Corporation" } } } } });
  if (url.includes("fuzzycompletions")) return json({ data: [{ attributes: { value: "ACME OILFIELD SERVICES COMPANY" }, relationships: { "lei-records": { data: { id: "LEI0000000000000001" } } } }] });
  if (url.includes("/direct-parent")) return json({ data: { attributes: { entity: { legalName: { name: "Acme Group Holdings" } } } } });
  if (url.includes("/ultimate-parent")) return json({}, 404);
  if (url.includes("api.gleif.org") && url.includes("lei-records")) return json({ data: [{ id: "LEI0000000000000001", attributes: { lei: "LEI0000000000000001", entity: { legalName: { name: "Acme Oilfield Services Company" }, status: "ACTIVE", jurisdiction: "SS", legalAddress: { addressLines: ["Plot 5 Ministries Road"], city: "Juba", country: "SS" }, creationDate: "2009-03-04T00:00:00Z", legalForm: { other: "Limited liability company" } } } }] });
  if (url.includes("offshoreleaks")) return json({ q0: { result: [{ id: 12000001, name: "ACME OILFIELD SERVICES CO", type: [{ name: "Entity" }] }] } });
  if (url.includes("bsky.app")) return json({ posts: [{ uri: "at://did:plc:x/app.bsky.feed.post/3abc", author: { handle: "reporter.bsky.social" }, record: { text: "Acme Oilfield Services under audit scrutiny", createdAt: "2026-09-30T08:00:00Z" } }] });
  return new Response("not found", { status: 404 });
}

const entry = (name: string): ListEntry => ({ list: "OFAC", ref: "9001", kind: "entity", name, aliases: [], countries: ["SS"], programs: ["SOUTH SUDAN"], listedOn: "2018-03-01", remarks: null });

describe("screening to report, end to end", () => {
  let env: Env;
  beforeEach(() => {
    setCoverageDelay(0);
    resetListCache();
    resetListTableCheck();
    primeList("OFAC", [...Array.from({ length: 60 }, (_, i) => entry(`Filler Holdings Number${i} Ltd`)), entry("Acme Oilfield Services Co Ltd")]);
    env = { DB: fakeD1().DB } as unknown as Env;
    vi.stubGlobal("fetch", async (u: string | URL) => route(String(u)));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads each source, and the report picks the information up", async () => {
    const result = await runDueDiligence(env, { name: "Acme Oilfield Services Company", kind: "entity", country: "South Sudan", aliases: [], identifiers: "oil services, Juba" });
    // The sources were read
    expect(result.sanctions.hits[0]).toMatchObject({ list: "OFAC", strength: "strong" });
    expect(result.gleif.hits[0]).toMatchObject({ lei: "LEI0000000000000001", directParent: "Acme Group Holdings", address: "Plot 5 Ministries Road, Juba, SS" });
    expect(result.office.hits[0].profile).toMatchObject({ inception: "2009", employees: 450, headquarters: "Juba" });
    expect(result.offshore.hits).toHaveLength(1);
    expect(result.media.hits[0].items[0]).toMatchObject({ severity: "medium", status: "investigation" });
    expect(result.mediaCoverage.hits[0].recent[0].sentiment).toBe("negative");
    expect(result.social.hits[0].accounts.map((a) => a.platform)).toContain("X (Twitter)");
    expect(result.social.hits[0].posts).toHaveLength(1);

    // The report is filled from them
    const rep = buildReport({ id: "dd_x", name: "Acme Oilfield Services Company", subject_type: "entity", reference: null, created_at: "", result } as never);
    const sec = (no: string) => rep.sections.find((s) => s.no === no)!;
    const kv = sec("3").blocks.find((b): b is Extract<Block, { t: "kv" }> => b.t === "kv")!;
    const f = (k: string) => kv.rows.find((r) => r[0] === k)![1];
    expect(f("Incorporation date")).toBe("2009-03-04");
    expect(f("Registered address")).toContain("Juba");
    expect(f("Employees")).toBe("450");
    expect(f("Ownership")).toContain("Acme Group Holdings");
    expect(f("Website")).toBe("https://acme.example");
    const tables = (no: string) => sec(no).blocks.filter((b): b is Extract<Block, { t: "table" }> => b.t === "table");
    expect(shownRows(tables("7")[2]).find((r) => String(r[0]).includes("OFAC"))![2]).toBe("Strong match");
    expect(JSON.stringify(tables("4")[0].rows)).toContain("Offshore Leaks");
    expect(JSON.stringify(tables("9")[0].rows)).toContain("news.example");
    expect(JSON.stringify(tables("9")[1].rows)).toContain("Bluesky");
    const flags = tables("18")[0].rows;
    expect(flags.length).toBeGreaterThanOrEqual(4);
    expect(flags[0][4]).toBe("Critical");
    const dash = tables("1")[0].rows;
    expect(dash.find((r) => r[0] === "Legal / Regulatory")![1]).toBe("Red");
    expect(dash.find((r) => r[0] === "Reputation & Media")![1]).toBe("Amber");
  });
});
