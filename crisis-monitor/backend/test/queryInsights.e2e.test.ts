/**
 * The query dashboard's data routes, through the real router against an
 * in-memory database: items per day in the viewer's own days, tone, topics,
 * map points, the stream with its filters, a day's digest, and the AI
 * summary with its limits.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { queryInsightsRouter } from "../src/routes/queryInsights";
import { createSessionToken } from "../src/auth";
import { resetDaySummaryTableCheck } from "../src/lib/daySummary";
import { resetAiBudgetTableCheck } from "../src/lib/aiBudget";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const TZ = 180; // Nairobi
let db: ReturnType<typeof fakeD1>["db"];
let env: Env;
let admin: Record<string, string>;
let stranger: Record<string, string>;
let aiCalls = 0;
let aiReply: unknown = null;

const get = (path: string, headers = admin, e = env) => queryInsightsRouter.request(path, { headers }, e);
const post = (path: string, body: unknown, e = env) => queryInsightsRouter.request(path, { method: "POST", headers: { ...admin, "content-type": "application/json" }, body: JSON.stringify(body) }, e);

// 5 October 2026 in Nairobi runs from 4 Oct 21:00 UTC to 5 Oct 21:00 UTC.
const ITEMS: [string, string, string, string, string, string | null][] = [
  // id, type, published (UTC), headline, text, author
  ["a1", "news", "2026-10-04T22:30:00.000Z", "Rapid Support Forces shell El Fasher market", "Shelling by the Rapid Support Forces killed nine people in El Fasher, North Darfur, medics said.", null],
  ["a2", "news", "2026-10-05T06:00:00.000Z", "El Fasher: Rapid Support Forces advance on army base", "Fighting was reported near the army base in El Fasher.", null],
  ["a3", "news", "2026-10-05T09:15:00.000Z", "Aid convoy reaches El Fasher after ceasefire talks", "The convoy is the first to arrive since ceasefire talks began in Jeddah.", null],
  ["a4", "social", "2026-10-05T10:00:00.000Z", "", "People in El Fasher say shelling started again this morning, families fleeing", "@darfur_watch"],
  ["a5", "forum", "2026-10-05T20:59:00.000Z", "", "Thread: is the ceasefire talks process in Jeddah going anywhere?", "analyst42"],
  // 5 October in UTC, but already 6 October in Nairobi.
  ["b1", "news", "2026-10-05T21:30:00.000Z", "Drone strike kills four in Omdurman, medics say", "A drone strike killed four people in Omdurman late on Monday.", null],
  ["b2", "news", "2026-10-06T08:00:00.000Z", "Sudan army says drone strike hit Omdurman depot", "The army said a drone strike hit a fuel depot in Omdurman.", null],
  // Nothing on the 7th.
  ["c1", "news", "2026-10-08T12:00:00.000Z", "Ceasefire talks resume in Jeddah with peace agreement in sight", "Mediators welcomed progress towards a peace agreement.", null],
];

beforeAll(async () => {
  resetDaySummaryTableCheck();
  resetAiBudgetTableCheck();
  const d1 = fakeD1();
  db = d1.db;
  db.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, source_id TEXT, source_type TEXT NOT NULL, external_id TEXT, author TEXT, title TEXT, content TEXT NOT NULL, url TEXT, lang TEXT,
      sentiment REAL, published_at TEXT NOT NULL, ingested_at TEXT NOT NULL, geo_lat REAL, geo_lng REAL, geo_label TEXT, raw_metadata TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE monitoring_queries (id TEXT PRIMARY KEY, name TEXT NOT NULL, boolean_query TEXT NOT NULL, owner_id TEXT);
    CREATE TABLE query_matches (id TEXT PRIMARY KEY, query_id TEXT NOT NULL, event_id TEXT NOT NULL, matched_at TEXT NOT NULL, UNIQUE (query_id, event_id));
    INSERT INTO monitoring_queries VALUES ('q1', 'Sudan war', '(Sudan AND (RSF OR "Rapid Support Forces" OR army))', 'owner-1');
    INSERT INTO monitoring_queries VALUES ('q2', 'Something else', 'other', 'owner-1');
  `);
  const ev = db.prepare("INSERT INTO events (id, source_type, author, title, content, url, published_at, ingested_at) VALUES (?,?,?,?,?,?,?,?)");
  const match = db.prepare("INSERT INTO query_matches VALUES (?, 'q1', ?, ?)");
  for (const [id, type, at, title, text, author] of ITEMS) {
    const url = type === "news" ? `https://www.sudan-daily.example/${id}` : null;
    ev.run(id, type, author, title || null, title ? `${title} ${url} ${text}` : text, url, at, at);
    match.run(`m-${id}`, id, at);
  }
  // An item of another query's, on the same day: must never appear.
  ev.run("z1", "news", null, "Unrelated: markets rally", "Unrelated: markets rally", "https://x.example/z1", "2026-10-05T08:00:00.000Z", "2026-10-05T08:00:00.000Z");
  db.prepare("INSERT INTO query_matches VALUES ('m-z1', 'q2', 'z1', '2026-10-05T08:00:00.000Z')").run();

  env = {
    DB: d1.DB,
    SESSION_SECRET: "test-secret",
    AI: {
      run: async () => {
        aiCalls++;
        return { response: aiReply };
      },
    },
    AI_DAILY_NEURON_BUDGET: "100000",
  } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("u1", "admin", "test-secret")}` };
  stranger = { Authorization: `Bearer ${await createSessionToken("someone-else", "client" as never, "test-secret")}` };
  vi.stubGlobal("fetch", async () => new Response("no network in this test", { status: 500 }));
});

afterAll(() => vi.unstubAllGlobals());

const PERIOD = `from=2026-10-03T21:00:00.000Z&to=2026-10-08T20:59:59.000Z&tz=${TZ}`;

describe("overview", () => {
  it("counts items per day in the viewer's days, including the quiet ones", async () => {
    const res = await get(`/q1/overview?${PERIOD}`);
    expect(res.status).toBe(200);
    const o = (await res.json()) as { bucket: string; total: number; volume: { bucket: string; count: number; events: number; conversations: number }[] };
    expect(o.bucket).toBe("day");
    expect(o.total).toBe(8);
    expect(o.volume.map((v) => `${v.bucket}:${v.count}`)).toEqual(["2026-10-04:0", "2026-10-05:5", "2026-10-06:2", "2026-10-07:0", "2026-10-08:1"]);
    // 22:30 UTC on the 4th is the 5th in Nairobi; 21:30 UTC on the 5th is the 6th.
    expect(o.volume[1]).toMatchObject({ events: 3, conversations: 2 });
  });

  it("the same items fall on different days for a viewer in UTC", async () => {
    const o = (await (await get(`/q1/overview?from=2026-10-04T00:00:00.000Z&to=2026-10-08T23:59:59.000Z&tz=0`)).json()) as { volume: { bucket: string; count: number }[] };
    expect(o.volume.map((v) => `${v.bucket}:${v.count}`)).toEqual(["2026-10-04:1", "2026-10-05:5", "2026-10-06:1", "2026-10-07:0", "2026-10-08:1"]);
  });

  it("switches to hours for a period of two days or less", async () => {
    const o = (await (await get(`/q1/overview?from=2026-10-05T03:00:00.000Z&to=2026-10-05T12:00:00.000Z&tz=${TZ}`)).json()) as { bucket: string; total: number; volume: { bucket: string; count: number }[] };
    expect(o.bucket).toBe("hour");
    expect(o.total).toBe(3);
    expect(o.volume.find((v) => v.bucket === "2026-10-05T09")?.count).toBe(1); // 06:00 UTC
    expect(o.volume.find((v) => v.bucket === "2026-10-05T10")?.count).toBe(0);
  });

  it("gives tone per day, topics, and map points placed from the text", async () => {
    const o = (await (await get(`/q1/overview?${PERIOD}`)).json()) as {
      sentiment: { overall: { negative: number; neutral: number; positive: number }; series: { bucket: string; negative: number; positive: number }[] };
      topics: { term: string; label: string; count: number; tone: number }[];
      points: { id: string; place: string; lat: number; lon: number; url: string | null }[];
      sampled: { used: number; total: number };
    };
    expect(o.sentiment.overall.negative + o.sentiment.overall.neutral + o.sentiment.overall.positive).toBe(8);
    expect(o.sentiment.overall.negative).toBeGreaterThan(o.sentiment.overall.positive);
    expect(o.sentiment.series.find((s) => s.bucket === "2026-10-08")?.positive).toBe(1);
    const topic = (term: string) => o.topics.find((t) => t.term === term);
    expect(topic("el fasher")?.count).toBe(4);
    expect(topic("rapid support forces")?.label).toBe("Rapid Support Forces");
    expect(topic("ceasefire talks")?.count).toBe(3);
    expect(topic("drone strike")?.count).toBe(2);
    expect(topic("sudan")).toBeUndefined(); // the query's own word
    expect(topic("ceasefire talks")!.tone).toBeGreaterThan(topic("drone strike")!.tone);
    const elFasher = o.points.find((p) => p.id === "a1")!;
    expect(elFasher.place).toBe("El Fasher, Sudan");
    expect(Math.abs(elFasher.lat - 13.63)).toBeLessThan(0.1);
    expect(o.points.some((p) => p.id === "z1")).toBe(false);
    expect(o.sampled).toEqual({ used: 8, total: 8 });
  });

  it("is refused to someone who does not own the query", async () => {
    expect((await get(`/q1/overview?${PERIOD}`, stranger)).status).toBe(404);
    expect((await get(`/q1/stream?${PERIOD}`, stranger)).status).toBe(404);
    expect((await get(`/q1/day?day=2026-10-05&tz=${TZ}`, stranger)).status).toBe(404);
    expect((await get(`/q1/overview?${PERIOD}`, {})).status).toBe(401);
  });
});

describe("stream", () => {
  type Stream = { total: number; items: { id: string; kind: string; title: string; snippet: string; source: string | null; tone: string; place: string | null; url: string | null }[] };
  it("lists the items newest first, without the address or a repeated headline in the text", async () => {
    const s = (await (await get(`/q1/stream?${PERIOD}`)).json()) as Stream;
    expect(s.total).toBe(8);
    expect(s.items.map((i) => i.id)).toEqual(["c1", "b2", "b1", "a5", "a4", "a3", "a2", "a1"]);
    const a1 = s.items.find((i) => i.id === "a1")!;
    expect(a1).toMatchObject({ kind: "event", title: "Rapid Support Forces shell El Fasher market", source: "sudan-daily.example", tone: "negative", place: "El Fasher, Sudan" });
    expect(a1.snippet).toBe("Shelling by the Rapid Support Forces killed nine people in El Fasher, North Darfur, medics said.");
    const a4 = s.items.find((i) => i.id === "a4")!;
    expect(a4).toMatchObject({ kind: "conversation", source: "@darfur_watch" });
    expect(a4.title).toContain("People in El Fasher say shelling started again");
  });
  it("filters to one viewer's day, to events or conversations, and by a phrase", async () => {
    const day = (await (await get(`/q1/stream?day=2026-10-05&tz=${TZ}`)).json()) as Stream;
    expect(day.items.map((i) => i.id)).toEqual(["a5", "a4", "a3", "a2", "a1"]);
    const conversations = (await (await get(`/q1/stream?day=2026-10-05&tz=${TZ}&kind=conversation`)).json()) as Stream;
    expect(conversations.items.map((i) => i.id)).toEqual(["a5", "a4"]);
    const events = (await (await get(`/q1/stream?day=2026-10-05&tz=${TZ}&kind=event`)).json()) as Stream;
    expect(events.total).toBe(3);
    const phrase = (await (await get(`/q1/stream?${PERIOD}&q=${encodeURIComponent("ceasefire talks")}`)).json()) as Stream;
    expect(phrase.items.map((i) => i.id)).toEqual(["c1", "a5", "a3"]);
    // A search term is text, not a pattern.
    expect(((await (await get(`/q1/stream?${PERIOD}&q=${encodeURIComponent("%")}`)).json()) as Stream).total).toBe(0);
  });
  it("pages", async () => {
    const page = (await (await get(`/q1/stream?${PERIOD}&limit=3&offset=3`)).json()) as Stream;
    expect(page.total).toBe(8);
    expect(page.items.map((i) => i.id)).toEqual(["a5", "a4", "a3"]);
  });
});

describe("a day", () => {
  type Day = { digest: { total: number; events: number; conversations: number; tone: { negative: number }; topics: { term: string }[]; places: { label: string; count: number }[]; outlets: { label: string }[]; headlines: { id: string; title: string; topic: string | null }[] }; ai: { status: string } };
  it("has a digest that needs no AI", async () => {
    const d = (await (await get(`/q1/day?day=2026-10-05&tz=${TZ}`)).json()) as Day;
    expect(d.digest).toMatchObject({ total: 5, events: 3, conversations: 2 });
    expect(d.digest.tone.negative).toBeGreaterThanOrEqual(2);
    expect(d.digest.topics[0].term).toBe("el fasher");
    expect(d.digest.places[0]).toEqual({ label: "El Fasher, Sudan", count: 4 });
    expect(d.digest.outlets.map((o) => o.label)).toContain("sudan-daily.example");
    expect(d.digest.headlines.length).toBeGreaterThanOrEqual(3);
    expect(d.digest.headlines[0].topic).toBe("El Fasher");
    expect(d.ai.status).toBe("none");
    expect(aiCalls).toBe(0);
  });

  it("writes the AI summary once, keeps only citations to headlines it was shown, and stores it", async () => {
    aiReply = {
      summary: "Shelling and an advance by the Rapid Support Forces were reported in El Fasher [1], while an aid convoy reached the town after ceasefire talks.",
      developments: [
        { text: "Rapid Support Forces shelled a market in El Fasher, with nine reported killed.", sources: [1, 2] },
        { text: "An aid convoy reached El Fasher.", sources: [3, 99] },
        { text: "Something no headline supports.", sources: [42] },
      ],
    };
    const first = (await (await post(`/q1/day-summary`, { day: "2026-10-05", tz: TZ })).json()) as { status: string; ai: { summary: string; developments: { text: string; sources: number[] }[]; cited: { n: number; id: string }[]; item_count: number } };
    expect(first.status).toBe("ready");
    expect(first.ai.summary).not.toMatch(/\[\d+\]/);
    expect(first.ai.developments.map((d) => d.sources)).toEqual([[1, 2], [3]]);
    expect(first.ai.cited.map((c) => `${c.n}:${c.id}`)).toEqual(["1:a1", "2:a2", "3:a3"]); // numbered in the order of the day
    expect(first.ai.item_count).toBe(5);
    const calls = aiCalls;
    expect(calls).toBeGreaterThan(0);
    // Asked again — by the day view or the button: returned from store, no second call.
    const again = (await (await post(`/q1/day-summary`, { day: "2026-10-05", tz: TZ })).json()) as { status: string };
    const viaDay = (await (await get(`/q1/day?day=2026-10-05&tz=${TZ}`)).json()) as Day;
    expect(again.status).toBe("ready");
    expect(viaDay.ai.status).toBe("ready");
    expect(aiCalls).toBe(calls);
  });

  it("does not ask the AI about a day with almost nothing on it", async () => {
    const calls = aiCalls;
    const r = (await (await post(`/q1/day-summary`, { day: "2026-10-06", tz: TZ })).json()) as { status: string; reason: string };
    expect(r.status).toBe("unavailable");
    expect(r.reason).toMatch(/too few items/);
    expect(aiCalls).toBe(calls);
  });

  it("says why when the AI allowance or the daily count is used up, and makes no call", async () => {
    db.prepare("DELETE FROM query_day_summaries").run();
    const calls = aiCalls;
    const noBudget = (await (await post(`/q1/day-summary`, { day: "2026-10-05", tz: TZ }, { ...env, AI_DAILY_NEURON_BUDGET: "0" } as Env)).json()) as { status: string; reason: string };
    expect(noBudget).toMatchObject({ status: "unavailable" });
    expect(noBudget.reason).toMatch(/switched off/);
    const noCount = (await (await post(`/q1/day-summary`, { day: "2026-10-05", tz: TZ }, { ...env, DAY_SUMMARIES_PER_DAY: "0" } as Env)).json()) as { status: string; reason: string };
    expect(noCount.reason).toMatch(/AI summaries have been used/);
    expect(aiCalls).toBe(calls);
  });

  it("says so when the model returns nothing usable, and stores nothing", async () => {
    aiReply = { summary: "", developments: [] };
    const r = (await (await post(`/q1/day-summary`, { day: "2026-10-05", tz: TZ })).json()) as { status: string; reason: string };
    expect(r.status).toBe("unavailable");
    expect((db.prepare("SELECT COUNT(*) AS n FROM query_day_summaries").get() as { n: number }).n).toBe(0);
  });

  it("rejects a malformed day", async () => {
    expect((await get(`/q1/day?day=yesterday&tz=${TZ}`)).status).toBe(400);
  });
});
