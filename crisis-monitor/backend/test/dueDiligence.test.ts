import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { primeList, resetListCache, type ListEntry, type ListId } from "../src/lib/dd/sanctionsLists";
import { decideOutcome, runDueDiligence, countryCodeOf, coverageStatement } from "../src/lib/dd/run";
import { excerptsAround } from "../src/lib/dd/adverseMedia";
import type { Env } from "../src/bindings";

const entry = (list: ListId, name: string, kind: ListEntry["kind"] = "entity"): ListEntry => ({ list, ref: `${list}-1`, kind, name, aliases: [], countries: ["RU"], programs: ["TEST"], listedOn: "2024-01-01", remarks: null });
const filler = (list: ListId): ListEntry[] => Array.from({ length: 60 }, (_, i) => entry(list, `Filler Holdings Number${i} Ltd`));

const sanctions = (hits: any[] = [], down = false) => ({ hits, lists: [{ id: "OFAC", label: "OFAC", searchUrl: "", status: down ? "unavailable" : "ok" }] }) as any;
const check = (hits: any[] = [], state = "ok") => ({ id: "x", label: "x", state, hits }) as any;
const base = (over: any = {}) => ({ sanctions: sanctions(), office: check(), offshore: check(), gleif: check(), companiesHouse: check(), media: check([{ items: [], candidates: 0, read: 0, classified: true }]), ...over });

describe("outcome", () => {
  it("ranks a strong sanctions match first", () => {
    expect(decideOutcome(base({ sanctions: sanctions([{ strength: "strong" }]) }))).toBe("potential_sanctions_match");
  });
  it("flags current office holders", () => {
    const office = check([{ isHuman: true, strength: "strong", positions: [{ label: "Governor", current: true, to: null }] }]);
    expect(decideOutcome(base({ office }))).toBe("pep_indicators");
  });
  it("flags serious reporting that is about the subject, not passing mentions", () => {
    const mk = (relevance: string) => check([{ items: [{ severity: "high", relevance }], classified: true }]);
    expect(decideOutcome(base({ media: mk("about_subject") }))).toBe("adverse_media");
    expect(decideOutcome(base({ media: mk("mentions_subject") }))).toBe("review");
  });
  it("never calls an incomplete screening clear", () => {
    expect(decideOutcome(base({ sanctions: sanctions([], true) }))).toBe("incomplete");
    expect(decideOutcome(base({ media: check([], "unavailable") }))).toBe("incomplete");
    expect(decideOutcome(base())).toBe("no_adverse_indicators");
  });
});

describe("helpers", () => {
  it("takes excerpts around the name", () => {
    const text = `${"filler ".repeat(200)}Acme Trading Ltd was fined by the regulator. ${"more ".repeat(200)}`;
    const ex = excerptsAround(text, "Acme Trading Ltd", 50);
    expect(ex).toContain("was fined");
    expect(ex.length).toBeLessThan(250);
  });
  it("maps countries to codes and states what was not checked", () => {
    expect(countryCodeOf("Kenya")).toBe("KE");
    expect(countryCodeOf("ng")).toBe("NG");
    expect(countryCodeOf("Atlantis")).toBeNull();
    expect(coverageStatement({ sources: [{ id: "a", label: "A", state: "ok" }, { id: "b", label: "B", state: "unavailable" }] })).toMatch(/Not checked \(B: unavailable\)/);
  });
});

describe("full screening with every outside service unreachable", () => {
  beforeEach(() => {
    resetListCache();
    primeList("OFAC", [...filler("OFAC"), entry("OFAC", "Volkov Trading Company Limited")]);
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("finds the sanctions match from the cached list and reports the other lists as unavailable", async () => {
    const r = await runDueDiligence({} as Env, { name: "Volkov Trading Co", kind: "entity", country: "Kenya", aliases: [], identifiers: null });
    expect(r.outcome).toBe("potential_sanctions_match");
    expect(r.sanctions.hits[0].list).toBe("OFAC");
    const un = r.sources.find((s) => s.id === "UN");
    expect(un?.state).toBe("unavailable");
    expect(r.coverage).toMatch(/Not checked/);
    expect(r.summary.aiWritten).toBe(false);
    expect(r.summary.text.length).toBeGreaterThan(10);
    expect(r.registries.some((l) => /Kenya|kenya|brs/i.test(l.label))).toBe(true);
    expect(r.disclaimer).toMatch(/not proof of identity/);
  });

  it("does not report a clean result when sources are down", async () => {
    const r = await runDueDiligence({} as Env, { name: "Zzyzx Quuxmore Partners", kind: "entity", country: null, aliases: [], identifiers: null });
    expect(r.outcome).toBe("incomplete");
  });
});
