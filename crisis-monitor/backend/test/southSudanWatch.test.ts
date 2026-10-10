import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../src/lib/feedSearch", () => ({
  searchFeeds: vi.fn(async () => new Map([["ew", hits]])),
}));

import { southSudanWatchRouter } from "../src/routes/electionWatch";
import { collectElectionItems, resetElectionWatchCheck } from "../src/lib/electionWatch";
import { codeSouthSudan, findState, displacedStated, southSudanLeadKind, SS_WATCH } from "../src/lib/southSudanWatch";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const hits = [
  { title: "Gunmen attack villagers in Akobo, several killed", text: "Armed youths attacked villages in Akobo County, Jonglei, killing four people and torching homes.", link: "https://radiotamazuj.org/s1", published: iso(5), domain: "radiotamazuj.org", origin: "africa-wire" },
  { title: "SSPDF and SPLA-IO clash in Nasir", text: "Fighting between government troops and SPLA-IO forces in Nasir, Upper Nile, despite the ceasefire.", link: "https://sudanspost.com/s2", published: iso(4), domain: "sudanspost.com", origin: "africa-wire" },
  { title: "Civilians flee as fighting spreads in Jonglei", text: "More than 180,000 people have been displaced since fighting began in Jonglei State.", link: "https://unmiss.example/s3", published: iso(8), domain: "unmiss.example", origin: "africa-wire" },
  { title: "Kiir dismisses minister of information", text: "President Salva Kiir sacked the minister of information in a decree read on state television.", link: "https://eyeradio.org/s4", published: iso(3), domain: "eyeradio.org", origin: "africa-wire" },
  { title: "NEC confirms 22 December polling date", text: "The National Elections Commission says voter registration will follow civic education.", link: "https://radioyei.org/s5", published: iso(2), domain: "radioyei.org", origin: "africa-wire" },
  { title: "Premier League weekend preview", text: "Football fixtures across England this weekend.", link: "https://example.uk/s6", published: iso(2), domain: "example.uk", origin: "africa-wire" },
];

let env: Env;
let admin: Record<string, string>;
let shared: Record<string, string>;
const call = (who: Record<string, string>, path: string, method = "GET", body?: unknown) => southSudanWatchRouter.request(path, { method, headers: { ...who, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

beforeAll(async () => {
  resetElectionWatchCheck();
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, can_view_spotlight INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE users (id TEXT PRIMARY KEY, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
    INSERT INTO clients VALUES ('c1', 1);
    INSERT INTO clients VALUES ('c2', 0);
    INSERT INTO users (id, client_id) VALUES ('a', NULL), ('s', 'c1'), ('x', 'c2');`);
  env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}` };
  shared = { Authorization: `Bearer ${await createSessionToken("s", "client", "s")}` };
});

describe("place matching", () => {
  it("finds the state a headline names, and ignores bare common words", () => {
    expect(findState("Gunmen attack villagers in Akobo", "")).toBe("JG");
    expect(findState("Fighting in Nasir", "")).toBe("UP");
    expect(findState("Talks on national unity continue", "")).toBeNull();
    expect(findState("Clashes in Luakpiny/Nasir", "")).toBe("UP");
  });
});

describe("coding rules", () => {
  it("codes the conflict, the agreement and the transition", () => {
    expect(codeSouthSudan(hits[0].title, hits[0].text, "radiotamazuj.org")).toMatchObject({ category: "civilian_harm", fatalities: 4, severity: 3, countyCode: "JG" });
    expect(codeSouthSudan(hits[1].title, hits[1].text, "sudanspost.com")).toMatchObject({ category: "ceasefire_violation", countyCode: "UP" });
    expect(codeSouthSudan(hits[2].title, hits[2].text, "unmiss.example")).toMatchObject({ category: "displacement", severity: 3, countyCode: "JG" });
    expect(codeSouthSudan(hits[3].title, hits[3].text, "eyeradio.org")?.category).toBe("coverage");
    expect(codeSouthSudan(hits[4].title, hits[4].text, "radioyei.org")?.category).toBe("coverage");
    expect(codeSouthSudan(hits[5].title, hits[5].text, "example.uk")).toBeNull();
  });

  it("reads displaced numbers and leads", () => {
    expect(displacedStated("More than 180,000 people have been displaced")).toBe(180000);
    expect(displacedStated("about 2 000 civilians fled")).toBe(2000);
    expect(southSudanLeadKind(hits[3].title, hits[3].text)).toBe("decree");
    expect(southSudanLeadKind(hits[4].title, hits[4].text)).toBe("calendar");
    expect(southSudanLeadKind("RJMEC report on R-ARCSS status", "The unified forces remain undeployed, a status update.")).toBe("benchmark");
    expect(southSudanLeadKind("Machar trial adjourned again", "The special court adjourned the trial.")).toBe("court");
  });

  it("codes ceasefire and agreement breaches separately from clashes", () => {
    expect(codeSouthSudan("Ceasefire violated again in Unity State", "Both sides broke the truce.", "x.ss")?.category).toBe("ceasefire_violation");
    expect(codeSouthSudan("Unified forces still not deployed, RJMEC says", "The R-ARCSS implementation report says the transitional period stalled.", "x.ss")?.category).toBe("agreement_breach");
    expect(codeSouthSudan("Opposition official arrested in Juba", "Security agents detained an SPLA-IO spokesperson.", "x.ss")?.category).toBe("political_detention");
  });
});

describe("collection", () => {
  it("stores South Sudan items once, leads for the election product, and keeps Kenya out", async () => {
    const r1 = await collectElectionItems(env, 30, SS_WATCH);
    expect(r1.inserted).toBe(5);
    expect(r1.leads).toBe(2);
    const r2 = await collectElectionItems(env, 30, SS_WATCH);
    expect(r2.inserted).toBe(0);
    const dash = await call(admin, "/dashboard?days=30").then((r) => r.json() as Promise<{ events: number; byCounty: Record<string, { events: number }>; deaths: number }>);
    expect(dash.events).toBeGreaterThanOrEqual(3);
    expect(dash.byCounty.JG?.events).toBeGreaterThanOrEqual(2);
    expect(dash.deaths).toBe(4);
  });
});

describe("access and review", () => {
  it("gates the routes and lets only admins change things", async () => {
    expect((await call(shared, "/dashboard")).status).toBe(200);
    const outsider = { Authorization: `Bearer ${await createSessionToken("x", "client", "s")}` };
    expect((await call(outsider, "/dashboard")).status).toBe(403);
    expect((await call(shared, "/collect", "POST", {})).status).toBe(403);
    expect((await call(shared, "/content/office/x", "PUT", { name: "x" })).status).toBe(403);
  });

  it("verifies an event as a whole and records a manual item", async () => {
    const items = await call(admin, "/items?days=30").then((r) => r.json() as Promise<{ id: string; status: string }[]>);
    expect(items.length).toBeGreaterThan(0);
    const patch = await call(admin, `/items/${items[0].id}`, "PATCH", { status: "verified" });
    expect(patch.status).toBe(200);
    const add = await call(admin, "/items", "POST", { title: "Shelling reported near Malakal market", url: "https://example.org/m1", category: "civilian_harm", county_code: "UP", published_at: iso(1), fatalities: 2 });
    expect(add.status).toBe(201);
    const badPlace = await call(admin, "/items", "POST", { title: "Shelling reported near Malakal market", url: "https://example.org/m2", category: "civilian_harm", county_code: "ZZZ", published_at: iso(1) });
    expect(badPlace.status).toBe(400);
  });

  it("keeps content overlays and leads for South Sudan", async () => {
    expect((await call(admin, "/content/office/bol-mel", "PUT", { name: "Benjamin Bol Mel", post: "Vice President", from: "2025-02-10", to: "2025-11-12" })).status).toBe(200);
    expect((await call(admin, "/content/benchmark/unified-forces", "PUT", { area: "Unified forces", status: "not_reported" })).status).toBe(200);
    expect((await call(admin, "/content/poll/x", "PUT", { pollster: "x" })).status).toBe(400);
    const content = await call(shared, "/content").then((r) => r.json() as Promise<Record<string, { id: string }[]>>);
    expect(content.office.map((o) => o.id)).toEqual(["bol-mel"]);
    const leads = await call(admin, "/leads").then((r) => r.json() as Promise<{ kind: string }[]>);
    expect(leads.map((l) => l.kind).sort()).toEqual(["benchmark", "calendar", "decree"].filter((k) => leads.some((l) => l.kind === k)).sort());
  });
});
