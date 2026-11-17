import { describe, expect, it, vi } from "vitest";

vi.mock("../src/escalationIncidents", () => ({
  getMapIncidents: async () => [{ id: "i1", headline: "Fano seize Debre Markos", summary: "Fano fighters took the town.", assessment: "", countryName: "Ethiopia", locationLabel: "Debre Markos", level: "elevated", lat: 10.3, lon: 37.7, sources: [{ url: "https://x/1" }], lastEventDate: "2026-11-15" }],
  getSituationEvents: async () => [],
}));
vi.mock("../src/lib/osintFeed", () => ({
  fetchWireArticleItems: async () => [{ title: "Ethiopia army retakes towns from Fano in Amhara", description: "The army said...", link: "https://w/1", published: "2026-11-14T00:00:00Z", domain: "reuters.com" }],
  fetchTelegramPostItems: async () => [],
}));
const replies: unknown[] = [];
vi.mock("../src/lib/llm", () => ({ callStructured: async () => ({ data: replies.shift(), provider: "anthropic", model: "test" }) }));

import { advance, makePeriods, nextStep, normaliseShares, poolWorlds, questionTerms, type AfrIntelRun } from "../src/lib/afrIntel";

const blank = (): AfrIntelRun => ({ id: "r1", owner: "u", question: "Will Fano capture Bahir Dar before March 2027?", material: "", worldCount: 2, periodCount: 2, stage: "context", createdAt: "", updatedAt: "", context: [], frame: null, actors: [], links: [], periods: [], worlds: [], injects: [], report: null, pooled: null, error: null, model: null, chat: [] });

describe("AfrIntel helpers", () => {
  it("takes the telling words of a question", () => {
    expect(questionTerms("Will Fano capture Bahir Dar before March 2027?")).toEqual(["fano", "capture", "bahir", "march"]);
  });
  it("normalises shares and splits time into periods", () => {
    expect(normaliseShares([2, 2], 2)).toEqual([0.5, 0.5]);
    expect(normaliseShares([], 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    const p = makePeriods(new Date("2026-11-16T00:00:00Z"), "2027-02-14", 3);
    expect(p.map((x) => x.from)).toEqual(["2026-11-16", "2026-12-16", "2027-01-15"]);
    expect(p[2].to).toBe("2027-02-14");
  });
  it("pools the worlds' final standings", () => {
    const w = (s: number[]) => ({ id: "A", temper: "", periods: [{ period: 0, moves: [], events: [], standing: { resolved: null, shares: s }, note: "" }] });
    expect(poolWorlds([w([1, 0]), w([0.5, 0.5])], 2)).toEqual([0.75, 0.25]);
  });
});

describe("a whole AfrIntel run", () => {
  it("goes from research to a report, period by period in every world", async () => {
    const now = new Date("2026-11-16T00:00:00Z");
    let r = blank();
    r = await advance({} as never, r, now);
    expect(r.stage).toBe("graph");
    expect(r.context.map((c) => c.kind)).toEqual(expect.arrayContaining(["incident", "wire", "zone"]));

    replies.push({ kind: "binary", proposition: "Fano forces control Bahir Dar city centre", outcomes: [], resolution: "Credible reports of control", horizon: "2027-03-01", baseRate: [0.1, 0.9], baseRateReason: "Insurgents rarely hold regional capitals", uncertainties: ["ENDF strength"], actors: [{ id: "a1", name: "Fano", kind: "armed group", lat: 11.6, lng: 37.4, stance: "wants it" }, { id: "a2", name: "ENDF", kind: "army", lat: 9.0, lng: 38.7, stance: "defends" }], links: [{ from: "a1", to: "a2", relation: "fighting" }] });
    r = await advance({} as never, r, now);
    expect(r.stage).toBe("agents");
    expect(r.periods).toHaveLength(2);

    replies.push({ actors: [{ id: "a1", goal: "take the city", levers: ["raids"], redLines: ["none"], style: "fast" }] });
    r = await advance({} as never, r, now);
    expect(r.stage).toBe("simulate");
    expect(r.worlds).toHaveLength(2);
    expect(nextStep(r)).toEqual({ stage: "simulate", world: 0, period: 0 });

    for (let i = 0; i < 4; i++) {
      replies.push({ moves: [{ actor: "a1", move: "attacks" }], events: ["Fighting on the outskirts."], resolved: i === 3 ? "YES" : null, shares: [0.2, 0.8], note: "" });
      r = await advance({} as never, r, now);
    }
    expect(r.stage).toBe("report");
    expect(r.worlds[1].periods[1].standing.shares).toEqual([1, 0]);

    replies.push({ shares: [0.15, 0.85], confidence: "medium", headline: "Unlikely", summary: "s", path: [], actorOutlook: [], drivers: [{ text: "ENDF holds", sources: ["c1", "zz"] }], scenarios: [], signposts: [], caveats: "" });
    r = await advance({} as never, r, now);
    expect(r.stage).toBe("done");
    expect(r.pooled).toEqual([0.6, 0.4]);
    expect(r.report?.drivers[0].sources).toEqual(["c1"]);
  });
});
