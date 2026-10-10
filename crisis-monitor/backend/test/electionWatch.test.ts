import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../src/lib/feedSearch", () => ({
  searchFeeds: vi.fn(async () => new Map([["ew", hits]])),
}));

import { electionWatchRouter } from "../src/routes/electionWatch";
import { collectElectionItems, codeReport, deathsStated, findCounty, leadKind, resetElectionWatchCheck } from "../src/lib/electionWatch";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const hits = [
  { title: "Two killed as goons attack Gachagua rally in Kitengela", text: "Police say two people were killed and several injured when youths stormed a DCP rally.", link: "https://nation.africa/a1", published: iso(5), domain: "nation.africa", origin: "africa-wire" },
  { title: "Two killed as goons attack Gachagua rally in Kitengela, police say", text: "Goons attacked supporters; two people were killed.", link: "https://the-star.co.ke/a2", published: iso(4), domain: "the-star.co.ke", origin: "africa-wire" },
  { title: "NCIC summons MP over hate speech at Eldoret rally", text: "The commission said the remarks amounted to ethnic incitement.", link: "https://citizen.digital/a3", published: iso(8), domain: "citizen.digital", origin: "africa-wire" },
  { title: "New Infotrak poll shows Ruto leading 2027 presidential race", text: "The survey of voters puts the president ahead.", link: "https://capitalfm.co.ke/a4", published: iso(3), domain: "capitalfm.co.ke", origin: "africa-wire" },
  { title: "Gor Mahia beat AFC Leopards in Nairobi derby", text: "The football league match ended 2-1.", link: "https://kenyans.co.ke/a5", published: iso(2), domain: "kenyans.co.ke", origin: "africa-wire" },
  { title: "Analysis: why political violence keeps returning to Kenya", text: "Opinion piece on rallies and goons.", link: "https://nation.africa/a6", published: iso(2), domain: "nation.africa", origin: "africa-wire" },
];

let env: Env;
let admin: Record<string, string>;
let shared: Record<string, string>;
let closed: Record<string, string>;
const call = (who: Record<string, string>, path: string, method = "GET", body?: unknown) => electionWatchRouter.request(path, { method, headers: { ...who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

beforeAll(async () => {
  resetElectionWatchCheck();
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, can_view_spotlight INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE users (id TEXT PRIMARY KEY, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
    INSERT INTO clients VALUES ('c1', 1), ('c2', 0);
    INSERT INTO users (id, client_id) VALUES ('a', NULL), ('s', 'c1'), ('x', 'c2');`);
  env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}` };
  shared = { Authorization: `Bearer ${await createSessionToken("s", "client", "s")}` };
  closed = { Authorization: `Bearer ${await createSessionToken("x", "client", "s")}` };
});

describe("coding rules", () => {
  it("codes the main categories and ignores sport and explainers", () => {
    expect(codeReport(hits[0].title, hits[0].text, "nation.africa")).toMatchObject({ category: "political_violence", fatalities: 2, severity: 3, countyCode: "034" });
    expect(codeReport(hits[2].title, hits[2].text, "citizen.digital")).toMatchObject({ category: "hate_speech", countyCode: "027" });
    expect(codeReport(hits[3].title, hits[3].text, "capitalfm.co.ke")?.category).toBe("coverage");
    expect(codeReport(hits[4].title, hits[4].text, "kenyans.co.ke")).toBeNull();
    expect(codeReport(hits[5].title, hits[5].text, "nation.africa")?.category).not.toBe("political_violence");
    expect(codeReport("Teargas as police disperse protesters in Nairobi CBD", "Police fired teargas at demonstrators.", "x.ke")?.category).toBe("protest_policing");
    expect(codeReport("IEBC registration centre torched in Migori", "Unknown people torched an IEBC office.", "x.ke")?.category).toBe("election_admin");
    expect(codeReport("Aspirant receives death threats ahead of ODM primaries in Kisumu", "He reported threats to police.", "x.ke")?.category).toBe("intimidation");
    expect(codeReport("Fake video of Ruto circulates ahead of elections", "Fact-checkers say it is a deepfake.", "x.ke")?.category).toBe("disinformation");
    expect(codeReport("Man killed in road accident on Thika road", "A matatu crashed.", "x.ke")).toBeNull();
  });
  it("reads tolls, places and leads", () => {
    expect(deathsStated("five people were killed in clashes")).toBe(5);
    expect(deathsStated("a man was shot dead")).toBe(1);
    expect(deathsStated("clashes erupted")).toBeNull();
    expect(findCounty("Chaos in Murang'a", "")).toBe("021");
    expect(findCounty("Chaos at Githurai", "")).toBe("047");
    expect(leadKind(hits[3].title, hits[3].text)).toBe("poll");
    expect(leadKind("Kalonzo declares 2027 presidential bid", "")).toBe("declaration");
  });
});

describe("collection and dashboard", () => {
  it("stores items once, groups duplicate reports, and queues leads", async () => {
    const r1 = await collectElectionItems(env, 24);
    expect(r1).toMatchObject({ scanned: 6, leads: 1 });
    expect(r1.inserted).toBe(4); // the sport story and the explainer are not kept
    const r2 = await collectElectionItems(env, 24);
    expect(r2.inserted).toBe(0);
    const dash = (await (await call(shared, "/dashboard")).json()) as { events: number; reports: number; deaths: number; byCategory: Record<string, number>; byCounty: Record<string, { events: number; deaths: number }> };
    expect(dash.events).toBe(2); // the rally attack counted once, plus the hate-speech case
    expect(dash.reports).toBe(3);
    expect(dash.deaths).toBe(2);
    expect(dash.byCounty["034"]).toEqual({ events: 1, deaths: 2 });
    const items = (await (await call(shared, "/items")).json()) as { reports: number; category: string }[];
    expect(items.find((i) => i.category === "political_violence")!.reports).toBe(2);
  });

  it("is closed to clients it is not shared with, and only admins can review", async () => {
    expect((await call(closed, "/dashboard")).status).toBe(403);
    expect((await call(shared, "/leads")).status).toBe(403);
    expect((await call(shared, "/collect", "POST")).status).toBe(403);
    const items = (await (await call(admin, "/items")).json()) as { id: string; category: string }[];
    const attack = items.find((i) => i.category === "political_violence")!;
    expect((await call(shared, `/items/${attack.id}`, "PATCH", { status: "rejected" })).status).toBe(403);
    expect((await call(admin, `/items/${attack.id}`, "PATCH", { status: "rejected" })).status).toBe(200);
    const dash = (await (await call(shared, "/dashboard")).json()) as { events: number };
    expect(dash.events).toBe(1); // rejecting one report rejects the whole event
    expect((await call(admin, `/items/${attack.id}`, "PATCH", { status: "verified" })).status).toBe(200);
  });

  it("adds a manual report, rejects duplicates, and exports a safe CSV", async () => {
    const body = { title: "=HYPERLINK(\"x\") Attack on aspirant in Kisii", url: "https://example.org/m1", category: "political_violence", county_code: "045", published_at: iso(1), fatalities: 0 };
    expect((await call(admin, "/items", "POST", body)).status).toBe(201);
    expect((await call(admin, "/items", "POST", body)).status).toBe(409);
    const csv = await (await call(shared, "/items.csv")).text();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.split("\n")[0]).toContain("published_at");
  });

  it("stores content overrides for admins and serves them to everyone with access", async () => {
    expect((await call(shared, "/content/poll/p1", "PUT", { pollster: "X" })).status).toBe(403);
    expect((await call(admin, "/content/poll/p1", "PUT", { pollster: "Mizani" })).status).toBe(200);
    expect((await call(admin, "/content/bogus/p1", "PUT", { a: 1 })).status).toBe(400);
    const c = (await (await call(shared, "/content")).json()) as { poll: { id: string; data: { pollster: string } }[] };
    expect(c.poll[0].data.pollster).toBe("Mizani");
    const leads = (await (await call(admin, "/leads")).json()) as { id: string; kind: string }[];
    expect(leads[0].kind).toBe("poll");
    expect((await call(admin, `/leads/${leads[0].id}`, "PATCH", { status: "done" })).status).toBe(200);
    expect(((await (await call(admin, "/leads")).json()) as unknown[]).length).toBe(0);
  });
});
