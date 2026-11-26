import { describe, expect, it, vi } from "vitest";

// The AI model is stubbed: these tests are about the numbers, the rules and the schedule around it.
const calls: { user: string }[] = [];
vi.mock("../src/lib/llm", async (orig) => ({
  ...(await orig<typeof import("../src/lib/llm")>()),
  callStructured: vi.fn(async (_env: unknown, call: { user: string }) => {
    calls.push(call);
    return {
      provider: "anthropic",
      model: "test",
      data: {
        status: "active",
        trend: "worsening",
        confidence: "moderate",
        bottomLine: "Violence in the north-east is intensifying as ISWAP raids spread beyond Borno.",
        assessment: "x".repeat(200),
        context: "History.",
        drivers: ["One", "Two", "Three"],
        outlook: "Outlook.",
        outlookLikelihood: "likely",
        indicators: ["Attacks on Maiduguri's outskirts"],
        evidence: ["E1", "E99"],
        coverageNote: null,
      },
    };
  }),
}));

import { assessmentDue, countryMetrics, dataStatus, getAssessments, runCountryAssessments } from "../src/lib/countryAssessment";
import { getCountryStatus } from "../src/lib/countryStatus";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const NOW = new Date("2026-11-26T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

function setup() {
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE escalation_incidents (id TEXT PRIMARY KEY, country_code TEXT, country_name TEXT, location_label TEXT, lat REAL, lon REAL, level TEXT, status TEXT, headline TEXT, summary TEXT, detail TEXT, first_event_date TEXT, last_event_date TEXT, updated_at TEXT);`);
  const ins = d1.db.prepare(`INSERT INTO escalation_incidents VALUES (?, 'NG', 'Nigeria', ?, 11.8, 13.1, ?, 'active', ?, NULL, ?, NULL, ?, ?)`);
  const det = (deaths: number, terror = false) => JSON.stringify({ actors: terror ? ["Islamic State West Africa Province"] : ["Bandits"], fatalitiesMax: deaths, indicators: [{ id: "armed_clash" }] });
  ins.run("big", "Maiduguri", "critical", "ISWAP overruns army base", det(40, true), day(2), day(2));
  ins.run("a1", "Konduga", "elevated", "Clash near Konduga", det(3), day(5), day(5));
  ins.run("a2", "Konduga", "elevated", "Second clash near Konduga", det(0), day(9), day(9));
  ins.run("old", "Bama", "watch", "Older raid", det(1), day(45), day(45));
  ins.run("ancient", "Bama", "watch", "Too old", det(9), day(120), day(120));
  return { d1, env: { DB: d1.DB } as unknown as Env };
}

describe("country assessments", () => {
  it("crunches the numbers from the Lens's own incidents", async () => {
    const { env } = setup();
    const m = await countryMetrics(env, "NG", NOW);
    expect(m).toMatchObject({ name: "Nigeria", n30: 3, nPrev30: 1, w30: 7, wPrev30: 1, n90: 4, critical30: 1, deaths30: 43, deaths90: 44, terror30: 1 });
    expect(m.weekly.reduce((a, b) => a + b, 0)).toBe(4);
    expect(m.weekly[12]).toBe(2);
    expect(m.places30[0]).toEqual({ name: "Konduga", n: 2 });
    expect(m.key[0].id).toBe("big");
  });

  it("raises status at once on strong evidence, and never lowers it on the numbers alone", () => {
    expect(dataStatus({ w30: 20, deaths30: 0, critical30: 0, n90: 30 }, "risk-low")).toBe("active");
    expect(dataStatus({ w30: 2, deaths30: 30, critical30: 0, n90: 3 }, "none")).toBe("active");
    expect(dataStatus({ w30: 6, deaths30: 0, critical30: 0, n90: 6 }, "none")).toBe("risk-high");
    expect(dataStatus({ w30: 0, deaths30: 0, critical30: 0, n90: 5 }, "active")).toBe("active"); // quiet, but not silent
    expect(dataStatus({ w30: 0, deaths30: 0, critical30: 0, n90: 0 }, "active")).toBe("active"); // silence may be thin coverage
  });

  it("rewrites an assessment when it is old, or sooner when the numbers move", () => {
    const at = NOW.getTime();
    const prev = (hoursAgo: number, w30: number, critical30 = 0) => ({ generatedAt: new Date(at - hoursAgo * 3600_000).toISOString(), metrics: { w30, critical30, deaths30: 0 } }) as never;
    expect(assessmentDue(undefined, { w30: 1, critical30: 0, deaths30: 0 }, "active", at)).toBe(true);
    expect(assessmentDue(prev(10, 10), { w30: 11, critical30: 0, deaths30: 0 }, "active", at)).toBe(false);
    expect(assessmentDue(prev(25, 10), { w30: 10, critical30: 0, deaths30: 0 }, "active", at)).toBe(true);
    expect(assessmentDue(prev(10, 10), { w30: 10, critical30: 1, deaths30: 0 }, "active", at)).toBe(true);
    expect(assessmentDue(prev(3, 10), { w30: 10, critical30: 1, deaths30: 0 }, "active", at)).toBe(false);
    expect(assessmentDue(prev(10, 4), { w30: 12, critical30: 0, deaths30: 0 }, "risk-low", at)).toBe(true);
  });

  it("writes the due assessment from the numbers, and the status then follows it", async () => {
    const { env } = setup();
    const rows = await getCountryStatus(env, NOW);
    const done = await runCountryAssessments(env, rows.filter((r) => r.code === "NG").map((r) => ({ code: r.code, status: r.status, baseline: r.baseline, note: r.note, w30: r.recent, critical30: r.critical30, deaths30: r.deaths30, n90: r.n90 })), NOW);
    expect(done).toEqual(["NG"]);
    expect(calls.at(-1)?.user).toContain("Last 30 days: 3 incidents (weighted 7)");
    expect(calls.at(-1)?.user).toContain("E1 | ");
    const a = (await getAssessments(env)).get("NG")!;
    expect(a.body.evidence).toEqual(["big"]); // E99 does not exist and is dropped
    const ng = (await getCountryStatus(env, NOW)).find((r) => r.code === "NG")!;
    expect(ng).toMatchObject({ status: "active", statusSource: "assessment", trend: "worsening" });
    expect(ng.assessment?.bottomLine).toContain("ISWAP");
    // Not due again straight away.
    expect(await runCountryAssessments(env, [{ code: "NG", status: "active", baseline: "active", note: null, w30: 7, critical30: 1, deaths30: 43, n90: 4 }], NOW)).toEqual([]);
  });
});
