import { describe, it, expect } from "vitest";
import { buildReport, redFlags } from "../../frontend/src/report/template";
import { evalExpr, fmtTyped, riskRating, shownRows, withCalc, type Block } from "../../frontend/src/report/model";
import { reportHtml } from "../../frontend/src/report/html";
import { reportToDocx } from "../../frontend/src/report/docx";
import { fixture } from "./ddReportFixture";

type Table = Extract<Block, { t: "table" }>;
const tables = (rep: ReturnType<typeof buildReport>) => rep.sections.flatMap((s) => s.blocks.filter((b): b is Table => b.t === "table"));

describe("report calculations", () => {
  it("evaluates cell formulas with previous-column references and refuses to divide by zero", () => {
    const rows = [["Revenue", "100", "150"], ["Cost", "0", "50"]];
    expect(evalExpr("r0 / r0@-1 - 1", rows, 2, new Map())).toBeCloseTo(0.5);
    expect(evalExpr("r0 / r1", rows, 1, new Map())).toBeNull();
    expect(evalExpr("r0 + r9", rows, 1, new Map())).toBeNull();
  });
  it("works out margins, growth and bridges from typed figures", () => {
    const rep = buildReport(fixture);
    const hist = tables(rep).find((t) => t.cols[0].h === "Report currency")!;
    [[1000, 1200], [400, 500], [250, 300], [0, 0], [0, 0], [200, 270], [50, 60]].forEach((v, i) => v.forEach((x, j) => (hist.rows[i][j + 1] = String(x))));
    const out = withCalc(hist);
    expect(out[7][2]).toBe("210"); // free cash flow
    expect(out[8][2]).toBe("20.0%"); // growth
    expect(out[10][2]).toBe("25.0%"); // EBITDA margin
    const bridge = tables(rep).find((t) => t.cols[0].h === "Net debt bridge")!;
    bridge.rows[0][1] = "500";
    bridge.rows[1][1] = "120";
    expect(withCalc(bridge)[2][1]).toBe("380");
  });
  it("formats typed numbers and rates risk by likelihood and impact", () => {
    expect(fmtTyped("1200000")).toBe("1,200,000");
    expect(fmtTyped("-45")).toBe("(45)");
    expect(fmtTyped("USD 5m")).toBe("USD 5m");
    expect(riskRating("High", "High")).toBe("Critical");
    expect(riskRating("Medium", "High")).toBe("High");
    expect(riskRating("Low", "Medium")).toBe("Low");
    expect(riskRating("", "High")).toBe("Not assessed");
  });
});

describe("report from a screening", () => {
  const rep = buildReport(fixture);
  it("has all 23 sections in the template's order", () => {
    expect(rep.sections.map((s) => s.no)).toEqual(Array.from({ length: 23 }, (_, i) => String(i + 1)));
    expect(rep.sections[8].title).toMatch(/Media, Reputation/);
  });
  it("turns findings into ranked red flags and a computed risk matrix", () => {
    const flags = redFlags(fixture.result);
    expect(flags[0].severity).toBe("Critical");
    expect(flags[0].flag).toMatch(/OFAC/);
    const matrix = tables(rep).find((t) => t.cols.some((c) => c.kind === "auto"))!;
    const rated = shownRows(matrix);
    expect(rated[0][4]).toBe("Critical");
    expect(rated[rated.length - 1][4]).toBe("Not assessed");
  });
  it("rates only what the evidence supports and never calls the overall result clear on screening alone", () => {
    const dash = tables(rep)[0];
    const row = (n: string) => dash.rows.find((r) => r[0] === n)!;
    expect(row("Legal / Regulatory")[1]).toBe("Red");
    expect(row("Financial")[1]).toBe("Not assessed");
    const clean = buildReport({ ...fixture, result: { ...fixture.result, sanctions: { ...fixture.result.sanctions, hits: [] }, offshore: { ...fixture.result.offshore, hits: [] }, media: { ...fixture.result.media, hits: [{ items: [], candidates: 0, read: 0, classified: true }] }, environment: undefined, sources: [], gleif: { ...fixture.result.gleif, hits: [{ ...fixture.result.gleif.hits[0] }] } } } as typeof fixture);
    const d2 = tables(clean)[0];
    expect(d2.rows.find((r) => r[0] === "Overall")![1]).not.toBe("Green");
  });
  it("recommends further diligence, not approval, when a source was unavailable", () => {
    const rec = rep.sections[0].blocks.find((b) => b.t === "choice" && b.label === "Overall recommendation") as Extract<Block, { t: "choice" }>;
    expect(rec.value).toBe("Do not proceed"); // strong sanctions match in the fixture
    const soft = buildReport({ ...fixture, result: { ...fixture.result, sanctions: { ...fixture.result.sanctions, hits: [] } } } as typeof fixture);
    const rec2 = soft.sections[0].blocks.find((b) => b.t === "choice" && b.label === "Overall recommendation") as Extract<Block, { t: "choice" }>;
    expect(rec2.value).toBe("Further diligence");
  });
});

describe("exports", () => {
  it("renders HTML with every section and the cover", () => {
    const html = reportHtml(buildReport(fixture));
    expect(html).toContain("Red Flag Report");
    expect(html).toContain("Acme Oilfield Services Company");
    expect(html).not.toContain("undefined");
  });
  it("produces a real .docx file", async () => {
    const blob = await reportToDocx(buildReport(fixture));
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 2);
    expect(String.fromCharCode(head[0], head[1])).toBe("PK");
    expect(blob.size).toBeGreaterThan(20_000);
  });
});
