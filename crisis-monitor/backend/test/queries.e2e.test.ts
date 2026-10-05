/**
 * The query editor's preview and a new query's first fetch, run through the
 * real routes against an in-memory database, with the news search service
 * mocked. Uses the exact query that failed on the live platform.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createRequire } from "node:module";
import { queriesRouter } from "../src/routes/queries";
import { eventsRouter } from "../src/routes/events";
import { createSessionToken } from "../src/auth";
import { AfricaWireActor } from "../src/durableObjects/africaWireActor";
import { ingestFeedMatches, loadActiveCompiledQueries } from "../src/ingest";
import type { Env } from "../src/bindings";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

class FakeStmt {
  constructor(private db: InstanceType<typeof DatabaseSync>, private sql: string, private params: unknown[] = []) {}
  bind(...params: unknown[]) {
    return new FakeStmt(this.db, this.sql, params);
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) as T) ?? null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { meta: { changes: Number(r.changes) } };
  }
}

const QUERY = '((Ethiopia AND Tigray) AND (Conflict OR Attack OR Fighting OR "drone strike"))';
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const seen = (hoursAgo: number) => iso(hoursAgo).replace(/[-:]/g, "").slice(0, 15) + "Z";

let db: InstanceType<typeof DatabaseSync>;
let env: Env;
let auth: Record<string, string>;
const gdeltCalls: { query: string; timespan: string }[] = [];
let gdeltLimited = false;

// What the platform's own crawl of African outlets currently holds.
const wireItem = (id: string, title: string, description: string, hoursAgo: number) => ({ id, index: 0, country: "ET", domain: "addisnews.example", title, link: `https://addisnews.example/${id}`, published: iso(hoursAgo), description });
const crawl = new Map([
  [
    "items:0",
    [
      wireItem("w1", "Drone strike in Tigray: Ethiopia denies role", "Regional officials said the strike hit a market.", 4),
      wireItem("w2", "Ethiopia opens new hydropower dam", "The prime minister attended the ceremony.", 3), // unrelated
      wireItem("w3", "Fighting in Tigray as Ethiopia truce frays", "An older report.", 120), // matches, but older than the 3-day window
    ],
  ],
]);
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;

const post = (path: string, body: unknown) => queriesRouter.request(path, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) }, env, ctx);

beforeAll(async () => {
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, config TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE TABLE events (id TEXT PRIMARY KEY, source_id TEXT, source_type TEXT NOT NULL, external_id TEXT, author TEXT, title TEXT, content TEXT NOT NULL, url TEXT, lang TEXT,
      sentiment REAL, published_at TEXT NOT NULL, ingested_at TEXT NOT NULL, geo_lat REAL, geo_lng REAL, geo_label TEXT, raw_metadata TEXT NOT NULL DEFAULT '{}');
    CREATE UNIQUE INDEX idx_events_external ON events (external_id) WHERE external_id IS NOT NULL;
    CREATE TABLE monitoring_queries (id TEXT PRIMARY KEY, name TEXT NOT NULL, boolean_query TEXT NOT NULL, category TEXT DEFAULT 'general', is_active INTEGER NOT NULL DEFAULT 1,
      baseline_window_minutes INTEGER NOT NULL DEFAULT 60, elevated_threshold REAL NOT NULL DEFAULT 2.5, critical_threshold REAL NOT NULL DEFAULT 4.0, owner_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE query_matches (id TEXT PRIMARY KEY, query_id TEXT NOT NULL, event_id TEXT NOT NULL, matched_at TEXT NOT NULL, UNIQUE (query_id, event_id));
  `);
  const ins = db.prepare("INSERT INTO events (id, source_type, external_id, author, title, content, url, published_at, ingested_at, geo_lat, geo_lng, geo_label, raw_metadata) VALUES (?, 'news', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  // A large table of unrelated articles, each with a long body — the shape that made the old preview fail.
  const filler = "Shares rose on Friday as investors weighed the outlook for interest rates and corporate earnings. ".repeat(40);
  for (let i = 0; i < 3200; i++) {
    const url = `https://news.example/markets/${i}`;
    ins.run(`f${i}`, url, "news.example", `Markets update ${i}`, `Markets update ${i} ${url} ${filler}`, url, iso(1 + (i % 60)), iso(1), 38.9, -77.0, "United States", JSON.stringify({ connector: "gdelt", sourcecountry: "United States" }));
  }
  // An unrelated attack story, which the old "OR every term" search would have fetched.
  ins.run("x1", "https://news.example/kharkiv", "news.example", "Attack on Kharkiv kills three", "Attack on Kharkiv kills three https://news.example/kharkiv Fighting continued overnight.", "https://news.example/kharkiv", iso(3), iso(3), 49.0, 32.0, "Ukraine", JSON.stringify({ connector: "gdelt", fulltext: true, geo: "text" }));
  // A relevant article held with its full text.
  ins.run("e1", "https://addis.example/mekelle-strike", "addis.example", "Drone strike hits Mekelle", "Drone strike hits Mekelle https://addis.example/mekelle-strike A drone strike hit the capital of Ethiopia's Tigray region on Wednesday, officials said.", "https://addis.example/mekelle-strike", iso(5), iso(5), 1.0, 38.0, "Kenya", JSON.stringify({ connector: "gdelt", sourcecountry: "Kenya", fulltext: true }));
  // A relevant article held as headline only (its body was never fetched): the engine alone cannot match it.
  ins.run("e2", "https://wire.example/adigrat", "wire.example", "Tigray: fighting resumes near Adigrat", "Tigray: fighting resumes near Adigrat https://wire.example/adigrat", "https://wire.example/adigrat", iso(8), iso(8), 1.0, 38.0, "Kenya", JSON.stringify({ connector: "gdelt", sourcecountry: "Kenya" }));

  env = {
    DB: { prepare: (sql: string) => new FakeStmt(db, sql), batch: async (stmts: FakeStmt[]) => Promise.all(stmts.map((s) => s.run())) },
    LIVE_FEED: { idFromName: () => "id", get: () => ({ fetch: async () => new Response("ok") }) },
    AFRICA_WIRE_ACTOR: {
      idFromName: () => "global",
      // The real actor, over a fake storage — so its query search is what runs.
      get: () => ({ fetch: (url: string, init?: RequestInit) => new AfricaWireActor({ storage: { list: async () => crawl } } as never, {} as Env).fetch(new Request(url, init)) }),
    },
    SESSION_SECRET: "test-secret",
  } as unknown as Env;
  auth = { Authorization: `Bearer ${await createSessionToken("u1", "admin", "test-secret")}` };

  vi.stubGlobal("caches", { default: { match: async () => undefined, put: async () => {} } });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.hostname === "api.gdeltproject.org") {
      gdeltCalls.push({ query: url.searchParams.get("query")!, timespan: url.searchParams.get("timespan")! });
      if (gdeltLimited) return new Response("Please limit requests to one every 5 seconds", { status: 429 });
      return Response.json({
        articles: [
          { url: "https://wire.example/adigrat", title: "Tigray: fighting resumes near Adigrat", seendate: seen(8), domain: "wire.example", language: "English", sourcecountry: "Kenya" },
          { url: "https://paper.example/shire", title: "Civilians killed as drone strike hits Shire", seendate: seen(2), domain: "paper.example", language: "English", sourcecountry: "Kenya" },
          { url: "https://paper.example/shire-copy", title: "Civilians killed as drone strike hits Shire", seendate: seen(2), domain: "copy.example", language: "English", sourcecountry: "Uganda" },
          { url: "https://daily.example/axum", title: "Clashes reported around Axum", seendate: seen(1), domain: "daily.example", language: "English", sourcecountry: "Ethiopia" },
        ],
      });
    }
    if (url.href === "https://daily.example/axum") {
      return new Response(`<html><body><article><p>${"Fighting was reported around Axum in Ethiopia's Tigray region on Sunday, residents said, in the latest attack on the area. ".repeat(4)}</p></article></body></html>`, { headers: { "content-type": "text/html" } });
    }
    return new Response("not found", { status: 404 }); // other article pages cannot be read
  });
});

afterAll(() => vi.unstubAllGlobals());

describe("query editor preview", () => {
  it("returns stored matches instead of failing on a large table", async () => {
    const res = await post("/preview", { boolean_query: QUERY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matches: { id: string; geo_label: string | null }[]; scanned: number; live: unknown };
    expect(body.matches.map((m) => m.id)).toEqual(["e1"]);
    // Only candidate rows were read, not the 3,200 unrelated articles.
    expect(body.scanned).toBeLessThan(10);
    // Shown where the article says it is, not at its publisher's country.
    expect(body.matches[0].geo_label).toBe("Mekelle, Ethiopia");
    expect(body.live).toBeNull();
  });

  it("with live search on, shows what the query will fetch: the platform's own feeds plus the wider search", async () => {
    const res = await post("/preview", { boolean_query: QUERY, live: true });
    const body = (await res.json()) as { live: { status: string; search: string; exact: boolean; notice: string | null; articles: { title: string; place: string | null; source: string }[] } };
    expect(body.live.status).toBe("ok");
    // The wider search keeps the query's AND/OR structure.
    expect(body.live.search).toBe('ethiopia tigray (conflict OR attack OR fighting OR "drone strike")');
    expect(body.live.exact).toBe(true);
    expect(body.live.notice).toBeNull();
    // Newest first; the republished copy of one headline is listed once; the
    // unrelated and the too-old feed items are not listed at all.
    expect(body.live.articles.map((a) => [a.title, a.source])).toEqual([
      ["Clashes reported around Axum", "search"],
      ["Civilians killed as drone strike hits Shire", "search"],
      ["Drone strike in Tigray: Ethiopia denies role", "feeds"],
      ["Tigray: fighting resumes near Adigrat", "search"],
    ]);
    expect(body.live.articles.find((a) => a.title.includes("Adigrat"))!.place).toBe("Adigrat, Ethiopia");
    expect(gdeltCalls.at(-1)).toEqual({ query: body.live.search, timespan: "3d" });
  });

  it("still shows the platform's own feed matches when the wider search is rate-limited", async () => {
    gdeltLimited = true;
    try {
      const res = await post("/preview", { boolean_query: QUERY, live: true });
      const body = (await res.json()) as { live: { status: string; notice: string; articles: { title: string }[] } };
      expect(body.live.status).toBe("ok");
      expect(body.live.articles.map((a) => a.title)).toEqual(["Drone strike in Tigray: Ethiopia denies role"]);
      expect(body.live.notice).toMatch(/own news feeds only.*limiting requests/);

      // Nothing in the feeds either: say so, rather than showing an empty list as if it were complete.
      const none = await post("/preview", { boolean_query: "Kismayo AND cholera", live: true });
      const noneBody = (await none.json()) as { live: { status: string; message: string; articles: unknown[] } };
      expect(noneBody.live.status).toBe("busy");
      expect(noneBody.live.articles).toEqual([]);
      expect(noneBody.live.message).toMatch(/Search again/);
    } finally {
      gdeltLimited = false;
    }
  });

  it("rejects an invalid query with its reason, and says when the wider search cannot look for a query", async () => {
    const bad = await post("/preview", { boolean_query: "(Ethiopia AND", live: true });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBeTruthy();
    const calls = gdeltCalls.length;
    const short = await post("/preview", { boolean_query: "AU AND dam", live: true });
    const body = (await short.json()) as { live: { status: string; search: string | null; notice: string } };
    expect(body.live.status).toBe("ok");
    expect(body.live.search).toBe("dam");
    const none = await post("/preview", { boolean_query: "NOT drill", live: true });
    const noneBody = (await none.json()) as { live: { status: string; search: string | null; notice: string } };
    expect(noneBody.live.search).toBeNull();
    expect(noneBody.live.notice).toMatch(/three letters/);
    expect(gdeltCalls.length).toBe(calls + 1); // only the searchable one was sent
  });
});

describe("a new query fetches its own results", () => {
  let queryId = "";
  it("creates the query and, in the background, searches the news for it and backfills", async () => {
    gdeltCalls.length = 0;
    const res = await post("/", { name: "Tigray", boolean_query: QUERY });
    expect(res.status).toBe(201);
    queryId = ((await res.json()) as { id: string }).id;
    await Promise.all(pending);
    expect(gdeltCalls).toEqual([{ query: 'ethiopia tigray (conflict OR attack OR fighting OR "drone strike")', timespan: "3d" }]);
  }, 30_000);

  it("matches the right articles and none of the noise", () => {
    const rows = db.prepare("SELECT e.id, e.title FROM query_matches m JOIN events e ON e.id = m.event_id WHERE m.query_id = ? ORDER BY e.title").all(queryId) as { id: string; title: string }[];
    expect(rows.map((r) => r.title)).toEqual([
      "Civilians killed as drone strike hits Shire", // new, body unreadable: accepted on the search's own full-text match
      "Civilians killed as drone strike hits Shire", // the republished copy is a separate URL
      "Clashes reported around Axum", // new, body read and checked by the engine
      "Drone strike hits Mekelle", // already held with full text
      "Drone strike in Tigray: Ethiopia denies role", // from the platform's own crawl of African outlets
      "Tigray: fighting resumes near Adigrat", // already held as headline only: credited from the search
    ]);
    // (Filler ids are f0…f3199; newly fetched articles get random ids, which may also begin with "f".)
    expect(rows.some((r) => r.id === "x1" || /^f\d+$/.test(r.id))).toBe(false);
  });

  it("stores new articles where their text says they are, not at the publisher's country", () => {
    const shire = db.prepare("SELECT geo_label, geo_lat FROM events WHERE url = 'https://paper.example/shire'").get() as { geo_label: string; geo_lat: number };
    expect(shire.geo_label).toBe("Shire, Ethiopia");
    expect(shire.geo_lat).toBeCloseTo(14.1, 1);
  });

  it("serves them located for the Live Intel map", async () => {
    const res = await eventsRouter.request(`/located?query_id=${queryId}&hours=24`, { headers: auth }, env, ctx);
    const body = (await res.json()) as { total: number; located: number; events: { place: string; precision: string }[] };
    expect(body.total).toBe(6);
    expect(body.located).toBe(6);
    expect(new Set(body.events.map((e) => e.place))).toEqual(new Set(["Shire, Ethiopia", "Axum, Ethiopia", "Mekelle, Ethiopia", "Adigrat, Ethiopia", "Tigray, Ethiopia"]));
    expect(body.events.some((e) => e.place.includes("Kenya"))).toBe(false);
  });

  it("keeps collecting from the platform's own feeds on later runs, even while the wider search is rate-limited, without duplicates", async () => {
    gdeltLimited = true;
    try {
      crawl.get("items:0")!.push(wireItem("w4", "Tigray fighting displaces thousands, Ethiopia aid groups say", "Aid agencies reported new displacement.", 0.5));
      const queries = await loadActiveCompiledQueries(env);
      expect(await ingestFeedMatches(env, queries, 12)).toEqual({ inserted: 1, credited: 2 }); // w4 is new; w1 was already held
      expect(await ingestFeedMatches(env, queries, 12)).toEqual({ inserted: 0, credited: 2 });
      const count = (sql: string) => (db.prepare(sql).get(queryId) as { n: number }).n;
      expect(count("SELECT COUNT(*) AS n FROM query_matches WHERE query_id = ?")).toBe(7);
      expect((db.prepare("SELECT COUNT(*) AS n FROM events WHERE url LIKE 'https://addisnews.example/%'").get() as { n: number }).n).toBe(2);
    } finally {
      gdeltLimited = false;
    }
  });
});
