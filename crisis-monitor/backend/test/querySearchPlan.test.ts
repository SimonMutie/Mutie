import { describe, it, expect } from "vitest";
import { parseBooleanQuery } from "../src/booleanQuery";
import { buildSearchPlan, toGdeltQueries, toSqlPrefilter } from "../src/lib/querySearchPlan";

const plan = (q: string) => buildSearchPlan(parseBooleanQuery(q).ast);
const gdelt = (q: string) => toGdeltQueries(plan(q));

describe("search plan keeps the query's AND/OR structure", () => {
  it("the reported query searches for Tigray, not for every article that says 'attack'", () => {
    const q = '((Ethiopia AND Tigray) AND (Conflict OR Attack OR Fighting OR "drone strike"))';
    expect(gdelt(q)).toEqual(['ethiopia tigray (conflict OR attack OR fighting OR "drone strike")']);
    expect(plan(q).exact).toBe(true);
  });
  it("handles plain OR, plain AND and single terms", () => {
    expect(gdelt("cholera OR ebola")).toEqual(["(cholera OR ebola)"]);
    expect(gdelt('"Rapid Support Forces" AND Darfur')).toEqual(['"rapid support forces" darfur']);
    expect(gdelt("cholera")).toEqual(["cholera"]);
  });
  it("ignores NOT and field-scoped parts instead of searching for them", () => {
    expect(gdelt('(cholera OR outbreak) AND Nairobi NOT drill')).toEqual(["nairobi (cholera OR outbreak)"]);
    expect(plan('(cholera OR outbreak) AND Nairobi NOT drill').exact).toBe(false);
    expect(gdelt("Sudan AND topDomain:reuters.com")).toEqual(["sudan"]);
  });
  it("spells a wildcard out as word endings", () => {
    expect(gdelt("flood* AND Kenya")).toEqual(["kenya (flood OR floods OR flooded OR flooding)"]);
  });
  it("an OR of AND-groups still yields a true necessary condition", () => {
    // (A AND B) OR (C AND D) => (A OR C)
    expect(gdelt("(Sudan AND RSF) OR (Mali AND JNIM)")).toEqual(["(sudan OR mali)"]);
  });
  it("drops a group GDELT cannot search (too-short keyword) rather than failing", () => {
    expect(gdelt("(AU OR UN) AND Somalia")).toEqual(["somalia"]);
    expect(gdelt("AU OR UN")).toEqual([]);
  });
  it("splits an oversized OR-group across several requests, keeping the AND terms on each", () => {
    const many = Array.from({ length: 23 }, (_, i) => `term${i}aa`).join(" OR ");
    const qs = gdelt(`Sudan AND (${many})`);
    expect(qs).toHaveLength(3);
    expect(qs.every((q) => q.startsWith("sudan ("))).toBe(true);
  });
  it("gives no plan for a query with nothing positive to search for", () => {
    expect(gdelt("NOT drill")).toEqual([]);
    expect(toSqlPrefilter(plan("NOT drill"))).toBeNull();
  });
});

describe("database pre-filter", () => {
  it("is an AND of OR-groups with escaped LIKE patterns", () => {
    const f = toSqlPrefilter(plan('(Ethiopia AND Tigray) AND (Conflict OR "100% sure")'))!;
    expect(f.sql).toBe("(content LIKE ? ESCAPE '\\') AND (content LIKE ? ESCAPE '\\') AND (content LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')");
    expect(f.params).toEqual(["%ethiopia%", "%tigray%", "%conflict%", "%100\\% sure%"]);
  });
  it("leaves out terms the database cannot filter on reliably (non-ASCII, or over the pattern limit)", () => {
    // Left out, never mis-filtered: the query engine still judges every row that is read.
    expect(toSqlPrefilter(plan("Sévaré AND Mali"))!.params).toEqual(["%mali%"]);
    const long = `"${"international humanitarian coordination office ".repeat(2).trim()}"`;
    expect(toSqlPrefilter(plan(`${long} AND Sudan`))!.params).toEqual(["%sudan%"]);
    expect(toSqlPrefilter(plan("Sévaré"))).toBeNull();
  });
});
