import { describe, expect, it, vi } from "vitest";

const sc = (id: string, likelihood: number, terms: string[][]) => ({
  id, name: `Future ${id}`, u1: "low", u2: "high", likelihood, narrative: "n", pathway: "p",
  implications: { investors: "i", humanitarian: "h", security: "s" },
  signposts: terms.map((t, i) => ({ text: `sign ${i}`, terms: t, direction: i === 1 ? "away" : "toward" })),
});
const edition = (likes: number[]) => ({
  headline: "ISWAP's comeback reshapes Borno", bottomLine: "Jihadist violence is intensifying in the north-east.",
  keyJudgements: [{ judgement: "More base attacks", likelihood: "likely", confidence: "moderate", basis: "b" }, { judgement: "x", likelihood: "maybe", confidence: "sure", basis: "b" }],
  situation: "s", trajectory: "t", history: "h", drivers: [{ name: "d", direction: "escalatory", note: "n" }], predetermined: ["Dry season"],
  uncertainties: [{ name: "ISWAP capacity", low: "contained", high: "resurgent" }, { name: "Army posture", low: "hollow", high: "reinforced" }],
  scenarios: [sc("A", likes[0], [["marte", "iswap"], ["ceasefire"]]), sc("B", likes[1], [["monguno"]]), sc("C", likes[2], [["dikwa", "army"]]), sc("D", likes[3], [["maiduguri"]])],
  wildcard: { name: "w", description: "d", triggers: ["t"], indicators: ["i"] }, assumptions: [{ assumption: "a", invalidatedBy: "b" }],
  indicatorMatrix: [{ area: "Security", level: "serious", trend: "rising", note: "n" }, { area: "Economy", level: "dire", trend: "up", note: "n" }],
  triggers: [{ when: "2027-02", event: "Elections" }], changes: null, confidence: "moderate", confidenceBasis: "c", sourcesNote: "s",
});
vi.mock("../src/lib/llm", async (orig) => ({
  ...(await orig<typeof import("../src/lib/llm")>()),
  callStructured: vi.fn(async () => ({ provider: "anthropic", model: "test", data: edition([50, 30, 30, 0]) })),
}));

import { listSpotlights, normaliseSpotlight, runCountrySpotlights, spotlightDue, spotlightHistory, spotlightPage, termFor, trackSignposts } from "../src/lib/countrySpotlight";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const NOW = new Date("2026-11-26T12:00:00Z");
function setup() {
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE escalation_incidents (id TEXT PRIMARY KEY, country_code TEXT, country_name TEXT, location_label TEXT, lat REAL, lon REAL, level TEXT, status TEXT, headline TEXT, summary TEXT, detail TEXT, first_event_date TEXT, last_event_date TEXT, updated_at TEXT);`);
  const ins = d1.db.prepare(`INSERT INTO escalation_incidents VALUES (?, 'NG', 'Nigeria', NULL, 11.8, 13.1, ?, 'active', ?, ?, '{"fatalitiesMax": 5}', NULL, ?, ?)`);
  ins.run("a", "critical", "ISWAP fighters overrun army base at Marte", null, "2026-11-20", "2026-11-20");
  ins.run("b", "elevated", "Clashes near Monguno", "Army repels attack", "2026-11-24", "2026-11-24");
  ins.run("c", "watch", "Older raid near Dikwa by the army", null, "2026-06-10", "2026-06-10");
  return { env: { DB: d1.DB } as unknown as Env };
}

describe("country spotlights", () => {
  it("tidies an edition: likelihoods add to 100, scale terms only, terms lower-case", () => {
    const s = normaliseSpotlight(edition([50, 30, 30, 0]) as never)!;
    expect(s.scenarios.map((x) => x.likelihood).reduce((a, b) => a + b, 0)).toBe(100);
    expect(s.keyJudgements[1]).toMatchObject({ likelihood: "roughly even chance", confidence: "moderate" });
    expect(s.indicatorMatrix[1]).toMatchObject({ level: "moderate", trend: "steady" });
    expect(normaliseSpotlight({ ...edition([1, 1, 1, 1]), scenarios: [] } as never)).toBeNull();
    expect(termFor(62)).toBe("likely");
    expect(termFor(3)).toBe("almost no chance");
  });

  it("checks each signpost against the incidents since the edition: every term must appear", async () => {
    const { env } = setup();
    const s = normaliseSpotlight(edition([25, 25, 25, 25]) as never)!;
    const { hits, tracking } = await trackSignposts(env, "NG", s, "2026-11-01");
    expect(hits.map((h) => `${h.scenario}${h.index}`).sort()).toEqual(["A0", "B0"]);
    expect(tracking.find((t) => t.scenario === "A")).toMatchObject({ seenToward: 1, seenAway: 0, totalToward: 1, totalAway: 1 });
    expect(tracking.find((t) => t.scenario === "C")?.seenToward).toBe(0); // the Dikwa raid is older than the edition
  });

  it("is due when old, when the status changes, or when signposts trip", () => {
    const at = NOW.getTime();
    const prev = (h: number, status = "active") => ({ generatedAt: new Date(at - h * 3600_000).toISOString(), status }) as never;
    expect(spotlightDue(undefined, "active", null, at)).toBe(true);
    expect(spotlightDue(prev(30), "active", [], at)).toBe(false);
    expect(spotlightDue(prev(73), "active", [], at)).toBe(true);
    expect(spotlightDue(prev(13, "risk-high"), "active", [], at)).toBe(true);
    expect(spotlightDue(prev(30), "active", [{ scenario: "A", seenToward: 2, seenAway: 1, totalToward: 3, totalAway: 1 }], at)).toBe(true);
  });

  it("writes the due edition, keeps its likelihoods in the history, and serves the page", async () => {
    const { env } = setup();
    const done = await runCountrySpotlights(env, [{ code: "NG", status: "active", trend: "worsening", baseline: "active", note: null, n90: 3 }, { code: "TZ", status: "none", trend: null, baseline: "none", note: null, n90: 0 }], NOW);
    expect(done).toEqual(["NG"]); // TZ: no rating and no incidents, so nothing to write about
    expect([...(await listSpotlights(env)).keys()]).toEqual(["NG"]);
    const h = await spotlightHistory(env, "NG");
    expect(h).toHaveLength(1);
    expect(h[0].likelihoods.map((l) => l.likelihood).reduce((a, b) => a + b, 0)).toBe(100);
    const page = await spotlightPage(env, "NG");
    expect(page.spotlight?.body.headline).toContain("ISWAP");
    expect(page.months.length).toBeGreaterThan(0);
    // Not due again straight away.
    expect(await runCountrySpotlights(env, [{ code: "NG", status: "active", trend: null, baseline: "active", note: null, n90: 3 }], NOW)).toEqual([]);
  });

  it("writes up to two first editions per tick, hottest first", async () => {
    const { env } = setup();
    const c = (code: string, status: "active" | "risk-high" | "risk-low", n90: number) => ({ code, status, trend: null, baseline: status, note: null, n90 });
    const done = await runCountrySpotlights(env, [c("KE", "risk-low", 4), c("NG", "active", 3), c("SD", "active", 40)], NOW);
    expect(done).toEqual(["SD", "NG"]);
    expect(await runCountrySpotlights(env, [c("KE", "risk-low", 4), c("NG", "active", 3), c("SD", "active", 40)], NOW)).toEqual(["KE"]);
  });
});
