/**
 * The watch on a monitoring query (queryWatch.ts) against an in-memory
 * database: what counts as usual, when a coverage surge is called, that one
 * surge is one alert kept current and closed by itself, that a query too
 * young to have a "usual" raises nothing, and the housekeeping that retires
 * the old scorer's alerts and empties its table a little at a time.
 * Then the dashboard's routes that read it: status, alerts, the escalation
 * incidents a query's own wording matches, stories and names, and notes.
 */
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { judge, median, surgeThreshold, runQueryWatch, getWatchStatus, resetWatchTableCheck, isWatchTick, MIN_SURGE_ITEMS } from "../src/queryWatch";
import { queryInsightsRouter, resetInsightCache } from "../src/routes/queryInsights";
import { createSessionToken } from "../src/auth";
import { resetEscalationTableCheck } from "../src/escalationIncidents";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

const NOW = new Date("2026-10-07T09:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("the rule", () => {
  it("takes the median day as usual, so one earlier spike does not move the bar", () => {
    expect(median([4, 5, 6, 5, 90, 4, 5])).toBe(5);
    expect(median([])).toBe(0);
    expect(median([2, 4])).toBe(3);
  });
  it("sets the bar at a multiple of usual, never below the minimum", () => {
    expect(surgeThreshold(10, 2.5)).toBe(25);
    expect(surgeThreshold(0, 2.5)).toBe(MIN_SURGE_ITEMS); // a quiet query needs real items, not "three times nothing"
    expect(surgeThreshold(0.5, 2.5)).toBe(MIN_SURGE_ITEMS);
    expect(surgeThreshold(3, 2.5)).toBe(8);
  });
  it("judges a day against it", () => {
    const base = { usual: 10, basisDays: 28, multiple: 2.5, majorMultiple: 4 };
    expect(judge({ ...base, last24h: 0 }).state).toBe("quiet");
    expect(judge({ ...base, last24h: 11 }).state).toBe("normal");
    expect(judge({ ...base, last24h: 16 }).state).toBe("above");
    expect(judge({ ...base, last24h: 25 })).toMatchObject({ state: "surge", major: false, threshold: 25 });
    expect(judge({ ...base, last24h: 40 })).toMatchObject({ state: "surge", major: true });
    // A surge is over only well below the bar, so a count hovering at it does not flap.
    expect(judge({ ...base, last24h: 24 }).exit).toBe(18);
  });
  it("calls nothing while a query is too new to have a usual", () => {
    expect(judge({ usual: 2, basisDays: 3, multiple: 2.5, majorMultiple: 4, last24h: 80 }).state).toBe("learning");
  });
  it("runs on one tick in three of the five-minute schedule", () => {
    const at = (m: number) => Date.UTC(2026, 9, 7, 9, m, 3);
    expect([0, 5, 10, 15, 20, 30, 45, 50].map((m) => isWatchTick(at(m)))).toEqual([true, false, false, true, false, true, true, false]);
  });
});

let db: ReturnType<typeof fakeD1>["db"];
let env: Env;
let broadcasts: { type: string; payload: { title?: string; level?: string }; ownerIds: string[] }[];

function freshDb() {
  resetWatchTableCheck();
  resetEscalationTableCheck();
  resetInsightCache();
  const d1 = fakeD1();
  db = d1.db;
  db.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, source_id TEXT, source_type TEXT NOT NULL, external_id TEXT, author TEXT, title TEXT, content TEXT NOT NULL, url TEXT, lang TEXT,
      sentiment REAL, published_at TEXT NOT NULL, ingested_at TEXT NOT NULL, geo_lat REAL, geo_lng REAL, geo_label TEXT, raw_metadata TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE monitoring_queries (id TEXT PRIMARY KEY, name TEXT NOT NULL, boolean_query TEXT NOT NULL, category TEXT DEFAULT 'general', is_active INTEGER NOT NULL DEFAULT 1,
      baseline_window_minutes INTEGER NOT NULL DEFAULT 60, elevated_threshold REAL NOT NULL DEFAULT 2.5, critical_threshold REAL NOT NULL DEFAULT 4.0, owner_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE query_matches (id TEXT PRIMARY KEY, query_id TEXT NOT NULL, event_id TEXT NOT NULL, matched_at TEXT NOT NULL, UNIQUE (query_id, event_id));
    CREATE INDEX idx_query_matches_query_time ON query_matches (query_id, matched_at DESC);
    CREATE TABLE alerts (id TEXT PRIMARY KEY, query_id TEXT, level TEXT NOT NULL CHECK (level IN ('info', 'elevated', 'critical')), title TEXT NOT NULL, description TEXT NOT NULL,
      metric_snapshot TEXT NOT NULL DEFAULT '{}', geo_label TEXT, geo_lat REAL, geo_lng REAL, created_at TEXT NOT NULL, acknowledged_at TEXT, resolved_at TEXT);
    CREATE TABLE escalation_snapshots (id TEXT PRIMARY KEY, query_id TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, volume INTEGER NOT NULL, baseline_volume REAL NOT NULL,
      avg_sentiment REAL, escalation_score REAL NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, display_name TEXT);
    INSERT INTO users VALUES ('u1', 'mutua', 'Mutua'), ('u2', 'client', NULL);
  `);
  broadcasts = [];
  env = {
    DB: d1.DB,
    SESSION_SECRET: "test-secret",
    GDELT_ENABLED: "false",
    LIVE_FEED: {
      idFromName: () => "global",
      get: () => ({
        fetch: async (_url: string, init: { body: string }) => {
          broadcasts.push(JSON.parse(init.body));
          return new Response("ok");
        },
      }),
    },
  } as unknown as Env;
}

let n = 0;
/** Adds `count` matched items for a query, spread across the 24 hours ending at `end`. */
function addItems(queryId: string, count: number, end: number, title = "Report") {
  const ev = db.prepare("INSERT INTO events (id, source_type, title, content, url, published_at, ingested_at) VALUES (?,?,?,?,?,?,?)");
  const match = db.prepare("INSERT INTO query_matches VALUES (?,?,?,?)");
  for (let i = 0; i < count; i++) {
    const at = iso(end - Math.floor(((i + 0.5) * DAY) / count));
    const id = `e${++n}`;
    ev.run(id, "news", `${title} ${n}`, `${title} ${n} https://outlet.example/${id} text`, `https://outlet.example/${id}`, at, at);
    match.run(`m${n}`, queryId, id, at);
  }
}
const addQuery = (id: string, name: string, createdDaysAgo: number, extra = "") =>
  db.exec(`INSERT INTO monitoring_queries (id, name, boolean_query, owner_id, created_at, updated_at ${extra ? ", elevated_threshold" : ""}) VALUES ('${id}', '${name}', 'sudan', 'owner-1', '${iso(NOW.getTime() - createdDaysAgo * DAY)}', '${iso(NOW.getTime())}' ${extra})`);
/** `perDay` items on each of the 28 complete days before today. */
function history(queryId: string, perDay: number) {
  const today = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate());
  for (let d = 1; d <= 28; d++) addItems(queryId, perDay, today - (d - 1) * DAY - 1000);
}
const openAlerts = (queryId: string) => db.prepare("SELECT * FROM alerts WHERE query_id = ? AND resolved_at IS NULL").all(queryId) as { id: string; level: string; title: string; description: string; metric_snapshot: string }[];

describe("a run of the watch", () => {
  beforeEach(freshDb);

  it("records the status of a query that is running as usual, and raises nothing", async () => {
    addQuery("q1", "Sudan war", 60);
    history("q1", 4);
    db.prepare("DELETE FROM query_matches WHERE matched_at > ?").run(iso(NOW.getTime() - DAY));
    addItems("q1", 5, NOW.getTime());
    expect(await runQueryWatch(env, NOW)).toEqual({ queries: 1, surges: 0 });
    const s = (await getWatchStatus(env, "q1"))!;
    expect(s).toMatchObject({ last24h: 5, usual: 4, basisDays: 28, threshold: 10, state: "normal" });
    expect(openAlerts("q1")).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
  });

  it("opens one alert for a surge, with its figures, criteria and headlines, at level info", async () => {
    addQuery("q1", "Sudan war", 60);
    history("q1", 4);
    db.prepare("DELETE FROM query_matches WHERE matched_at > ?").run(iso(NOW.getTime() - DAY));
    addItems("q1", 14, NOW.getTime(), "Shelling in El Fasher");
    expect((await runQueryWatch(env, NOW)).surges).toBe(1);
    const [a] = openAlerts("q1");
    expect(a.level).toBe("info"); // a count of reporting is never an "escalation"
    expect(a.title).toBe("Coverage surge: Sudan war");
    expect(a.description).toContain("14 items in the last 24 hours, 3.5 times the usual");
    expect(a.description).toContain("not a judgement that the situation itself has escalated");
    const snap = JSON.parse(a.metric_snapshot);
    expect(snap).toMatchObject({ kind: "surge", major: false, last24h: 14, usual: 4, threshold: 10, basisDays: 28 });
    expect(snap.criteriaMet).toHaveLength(3);
    expect(snap.headlines).toHaveLength(5);
    expect(snap.headlines[0]).toMatchObject({ source: "outlet.example" });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({ type: "alert", ownerIds: ["owner-1"] });

    // The next runs: same surge, same alert. Its figures follow the count.
    await runQueryWatch(env, new Date(NOW.getTime() + 15 * 60_000));
    expect(openAlerts("q1")).toHaveLength(1);
    addItems("q1", 6, NOW.getTime() + 30 * 60_000, "More shelling");
    await runQueryWatch(env, new Date(NOW.getTime() + 30 * 60_000));
    const after = openAlerts("q1");
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(a.id);
    expect(after[0].title).toBe("Major coverage surge: Sudan war"); // past four times usual
    expect(JSON.parse(after[0].metric_snapshot).headlines).toHaveLength(5); // kept from when it opened
    expect(broadcasts).toHaveLength(1);
  });

  it("closes the alert by itself when coverage falls back, and can then open a new one", async () => {
    addQuery("q1", "Sudan war", 60);
    history("q1", 4);
    db.prepare("DELETE FROM query_matches WHERE matched_at > ?").run(iso(NOW.getTime() - DAY));
    addItems("q1", 12, NOW.getTime());
    await runQueryWatch(env, NOW);
    expect(openAlerts("q1")).toHaveLength(1);
    // Nine hours on, 8 of the 12 are still inside 24 hours: under the bar of 10 but not under the exit of 7.
    const later = new Date(NOW.getTime() + 9 * 3_600_000);
    await runQueryWatch(env, later);
    expect((await getWatchStatus(env, "q1"))!.last24h).toBeGreaterThanOrEqual(7);
    expect(openAlerts("q1")).toHaveLength(1);
    // A day and a half on, nothing is.
    const muchLater = new Date(NOW.getTime() + 36 * 3_600_000);
    await runQueryWatch(env, muchLater);
    expect(openAlerts("q1")).toHaveLength(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NOT NULL").get() as { n: number }).n).toBe(1);
    addItems("q1", 15, muchLater.getTime() + 3_600_000);
    await runQueryWatch(env, new Date(muchLater.getTime() + 3_600_000));
    expect(openAlerts("q1")).toHaveLength(1);
    expect(broadcasts).toHaveLength(2);
  });

  it("does not raise the same surge again after the analyst has resolved it", async () => {
    addQuery("q1", "Sudan war", 60);
    history("q1", 4);
    db.prepare("DELETE FROM query_matches WHERE matched_at > ?").run(iso(NOW.getTime() - DAY));
    addItems("q1", 14, NOW.getTime());
    await runQueryWatch(env, NOW);
    db.prepare("UPDATE alerts SET resolved_at = ?").run(NOW.toISOString());
    addItems("q1", 3, NOW.getTime() + 15 * 60_000);
    await runQueryWatch(env, new Date(NOW.getTime() + 15 * 60_000));
    expect(openAlerts("q1")).toHaveLength(0);
    expect(broadcasts).toHaveLength(1);
  });

  it("raises nothing for a query under a week old, and says it is still learning", async () => {
    addQuery("q1", "New query", 3);
    addItems("q1", 60, NOW.getTime());
    await runQueryWatch(env, NOW);
    expect(openAlerts("q1")).toHaveLength(0);
    // Created three days ago at nine in the morning: two complete days of history.
    expect(await getWatchStatus(env, "q1")).toMatchObject({ state: "learning", last24h: 60, basisDays: 2 });
  });

  it("needs real items from a query that is usually silent", async () => {
    addQuery("q1", "Rare subject", 60);
    addItems("q1", 5, NOW.getTime());
    await runQueryWatch(env, NOW);
    expect(await getWatchStatus(env, "q1")).toMatchObject({ usual: 0, state: "above", threshold: MIN_SURGE_ITEMS });
    expect(openAlerts("q1")).toHaveLength(0);
    addItems("q1", 1, NOW.getTime() + 60_000);
    await runQueryWatch(env, new Date(NOW.getTime() + 15 * 60_000));
    expect(openAlerts("q1")).toHaveLength(1);
    expect(openAlerts("q1")[0].description).toContain("well above the usual (fewer than one a day");
  });

  it("uses the query's own multiple", async () => {
    addQuery("q1", "Sensitive", 60, ", 1.5");
    history("q1", 10);
    db.prepare("DELETE FROM query_matches WHERE matched_at > ?").run(iso(NOW.getTime() - DAY));
    addItems("q1", 16, NOW.getTime());
    await runQueryWatch(env, NOW);
    expect(await getWatchStatus(env, "q1")).toMatchObject({ threshold: 15, multiple: 1.5, state: "surge" });
  });

  it("works the usual day out once a day, not on every run", async () => {
    addQuery("q1", "Sudan war", 60);
    history("q1", 4);
    await runQueryWatch(env, NOW);
    // History changes behind its back; the same day's later run keeps the figure it has.
    history("q1", 20);
    await runQueryWatch(env, new Date(NOW.getTime() + 15 * 60_000));
    expect((db.prepare("SELECT usual FROM query_watch WHERE query_id = 'q1'").get() as { usual: number }).usual).toBe(4);
    await runQueryWatch(env, new Date(NOW.getTime() + DAY));
    expect((db.prepare("SELECT usual FROM query_watch WHERE query_id = 'q1'").get() as { usual: number }).usual).toBe(24);
  });

  it("closes the old scorer's alerts once and leaves everything else alone", async () => {
    addQuery("q1", "Sudan war", 60);
    const ins = db.prepare("INSERT INTO alerts (id, query_id, level, title, description, metric_snapshot, created_at) VALUES (?,?,?,?,?,?,?)");
    ins.run("old", "q1", "elevated", "Elevated escalation: Sudan war", "Match volume (3) in the last 5 min…", JSON.stringify({ currentVolume: 3, escalationScore: 2.7 }), NOW.toISOString());
    ins.run("incident", null, "critical", "Critical: Shelling in El Fasher", "…", JSON.stringify({ incidentId: "i1", criteriaMet: ["x"] }), NOW.toISOString());
    await runQueryWatch(env, NOW);
    expect((db.prepare("SELECT resolved_at FROM alerts WHERE id = 'old'").get() as { resolved_at: string | null }).resolved_at).not.toBeNull();
    expect((db.prepare("SELECT resolved_at FROM alerts WHERE id = 'incident'").get() as { resolved_at: string | null }).resolved_at).toBeNull();
  });

  it("empties the old scorer's table a little on each run, then stops trying", async () => {
    addQuery("q1", "Sudan war", 60);
    const ins = db.prepare("INSERT INTO escalation_snapshots VALUES (?, 'q1', ?, ?, 0, 0, NULL, 0, ?)");
    for (let i = 0; i < 400; i++) ins.run(`s${i}`, NOW.toISOString(), NOW.toISOString(), NOW.toISOString());
    const left = () => (db.prepare("SELECT COUNT(*) AS n FROM escalation_snapshots").get() as { n: number }).n;
    await runQueryWatch(env, NOW);
    expect(left()).toBe(250);
    await runQueryWatch(env, NOW);
    await runQueryWatch(env, NOW);
    expect(left()).toBe(0);
    await runQueryWatch(env, NOW); // finds nothing: records that it is done
    expect((db.prepare("SELECT value FROM query_watch_state WHERE key = 'snapshots_empty'").get() as { value: string }).value).toBe("1");
  });
});

describe("the dashboard's routes", () => {
  let admin: Record<string, string>;
  let stranger: Record<string, string>;
  const get = (path: string, headers = admin) => queryInsightsRouter.request(path, { headers }, env);
  const send = (method: string, path: string, body?: unknown, headers = admin) =>
    queryInsightsRouter.request(path, { method, headers: { ...headers, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);

  beforeAll(async () => {
    admin = { Authorization: `Bearer ${await createSessionToken("u1", "admin", "test-secret")}` };
    stranger = { Authorization: `Bearer ${await createSessionToken("someone-else", "client" as never, "test-secret")}` };
  });
  beforeEach(freshDb);

  it("gives the status, the open alerts, the alerts recently closed and collection health", async () => {
    addQuery("q1", "Sudan war", 60);
    history("q1", 4);
    db.prepare("DELETE FROM query_matches WHERE matched_at > ?").run(iso(Date.now() - DAY));
    addItems("q1", 14, Date.now() - 60_000);
    // No scheduled run has happened: the route works the status out itself.
    const res = await get("/q1/watch");
    expect(res.status).toBe(200);
    const w = (await res.json()) as { status: { state: string; last24h: number; threshold: number }; alerts: { title: string; level: string; metric_snapshot: { kind: string } }[]; closed: unknown[]; incidents: unknown[]; health: { search: { state: string }; feeds: unknown } };
    expect(w.status).toMatchObject({ state: "surge", last24h: 14 });
    expect(w.alerts).toHaveLength(1);
    expect(w.alerts[0]).toMatchObject({ level: "info", metric_snapshot: { kind: "surge" } });
    expect(w.closed).toEqual([]);
    expect(w.incidents).toEqual([]);
    expect(w.health).toEqual({ feeds: null, search: { state: "off" } });
    // Closed surges are listed; the old scorer's alerts are not.
    db.prepare("UPDATE alerts SET resolved_at = ?").run(new Date().toISOString());
    db.prepare("INSERT INTO alerts (id, query_id, level, title, description, metric_snapshot, created_at, resolved_at) VALUES ('old', 'q1', 'elevated', 'Elevated escalation: Sudan war', 'x', '{}', ?, ?)").run(NOW.toISOString(), NOW.toISOString());
    const again = (await (await get("/q1/watch")).json()) as { alerts: unknown[]; closed: { title: string }[] };
    expect(again.alerts).toEqual([]);
    expect(again.closed.map((a) => a.title)).toEqual(["Coverage surge: Sudan war"]);
    expect((await get("/q1/watch", stranger)).status).toBe(404);
  });

  it("lists the escalation incidents that the query's own wording matches, with their criteria and sources", async () => {
    db.exec(`INSERT INTO monitoring_queries (id, name, boolean_query, owner_id, created_at, updated_at) VALUES
      ('q1', 'Darfur', '(Sudan OR Darfur) AND (RSF OR "Rapid Support Forces")', 'owner-1', '${iso(NOW.getTime() - 60 * DAY)}', '${NOW.toISOString()}'),
      ('q2', 'Sahel', 'Mali AND (JNIM OR jihadist)', 'owner-1', '${iso(NOW.getTime() - 60 * DAY)}', '${NOW.toISOString()}')`);
    await get("/q1/watch"); // creates the incident tables
    const detail = (headline: string, actors: string[]) =>
      JSON.stringify({ criteriaMet: ["Ten or more reported killed in one event"], sources: [{ n: 1, url: "https://dabangasudan.org/a", title: headline, domain: "dabangasudan.org", publishedAt: NOW.toISOString(), textBasis: "full" }], actors, places: ["El Fasher"], fatalitiesMax: 14, reportCount: 2, indicators: [] });
    const ins = db.prepare(
      `INSERT INTO escalation_incidents (id, country_code, country_name, region_key, location_label, lat, lon, geo_precision, level, status, headline, summary, assessment, outlook, detail, first_event_date, last_event_date, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    ins.run("i1", "SD", "Sudan", "SD:north-darfur", "El Fasher, North Darfur", 13.63, 25.35, "place", "critical", "active", "Drone strike on El Fasher displacement camp", "A drone strike attributed to the Rapid Support Forces killed at least 14 people.", "Marks a step up in attacks on the camp.", "", detail("Drone strike kills 14 at El Fasher camp", ["Rapid Support Forces"]), "2026-10-06", "2026-10-06", NOW.toISOString(), NOW.toISOString());
    ins.run("i2", "SO", "Somalia", "SO:", "Mogadishu", 2.04, 45.34, "place", "elevated", "active", "Bombing in Mogadishu", "A car bomb killed six.", "", "", detail("Car bomb in Mogadishu", ["al-Shabaab"]), "2026-10-06", "2026-10-06", NOW.toISOString(), NOW.toISOString());
    resetInsightCache();
    const w = (await (await get("/q1/watch")).json()) as { incidents: { id: string; level: string; headline: string; place: string; criteriaMet: string[]; sources: { domain: string }[]; fatalitiesMax: number }[] };
    expect(w.incidents.map((i) => i.id)).toEqual(["i1"]);
    expect(w.incidents[0]).toMatchObject({ level: "critical", place: "El Fasher, North Darfur, Sudan", fatalitiesMax: 14, criteriaMet: ["Ten or more reported killed in one event"] });
    expect(w.incidents[0].sources[0].domain).toBe("dabangasudan.org");
    // A query about somewhere else sees neither.
    expect(((await (await get("/q2/watch")).json()) as { incidents: unknown[] }).incidents).toEqual([]);
  });

  it("gives stories, names and rising terms for a period", async () => {
    addQuery("q1", "Sudan war", 60);
    const ev = db.prepare("INSERT INTO events (id, source_type, title, content, url, published_at, ingested_at) VALUES (?,?,?,?,?,?,?)");
    const match = db.prepare("INSERT INTO query_matches VALUES (?,?,?,?)");
    const add = (id: string, host: string, at: string, title: string, text: string) => {
      ev.run(id, "news", title, `${title} https://${host}/${id} ${text}`, `https://${host}/${id}`, at, at);
      match.run(`m-${id}`, "q1", id, at);
    };
    add("a1", "dabangasudan.org", "2026-10-05T06:00:00.000Z", "Drone strike kills 14 at El Fasher displacement camp", "Medics said the strike was carried out by the Rapid Support Forces.");
    add("a2", "bbc.com", "2026-10-05T08:00:00.000Z", "Sudan: drone strike on El Fasher camp kills at least 14", "Residents blamed the Rapid Support Forces for the attack.");
    add("a3", "aljazeera.com", "2026-10-05T09:30:00.000Z", "At least 14 killed in drone strike on displacement camp in El Fasher", "The army accused the Rapid Support Forces.");
    add("b1", "reuters.com", "2026-10-02T10:00:00.000Z", "Ceasefire talks resume in Jeddah as mediators press both sides", "Mediators said talks had resumed.");
    const res = await get("/q1/insights?from=2026-10-01T00:00:00.000Z&to=2026-10-07T00:00:00.000Z&tz=180");
    expect(res.status).toBe(200);
    const i = (await res.json()) as { stories: { title: string; outlets: number; items: number; members: { id: string }[] }[]; names: { label: string; count: number }[]; rising: unknown[]; used: number };
    expect(i.used).toBe(4);
    expect(i.stories[0]).toMatchObject({ outlets: 3, items: 3, title: "Drone strike kills 14 at El Fasher displacement camp" });
    expect(i.stories[1]).toMatchObject({ outlets: 1, items: 1 });
    expect(i.names[0]).toMatchObject({ label: "Rapid Support Forces", count: 3 });
    expect(i.rising).toEqual([]); // four items are too few to call anything rising
    expect((await get("/q1/insights", stranger)).status).toBe(404);
  });

  it("adds the previous period, the place grid, the source mix and the last collection time to the overview", async () => {
    addQuery("q1", "Sudan war", 60);
    const ev = db.prepare("INSERT INTO events (id, source_type, title, content, url, published_at, ingested_at) VALUES (?,?,?,?,?,?,?)");
    const match = db.prepare("INSERT INTO query_matches VALUES (?,?,?,?)");
    const add = (id: string, host: string, at: string, title: string) => {
      ev.run(id, "news", title, `${title} https://${host}/${id} ${title}.`, `https://${host}/${id}`, at, `${at.slice(0, 11)}23:00:00.000Z`);
      match.run(`m-${id}`, "q1", id, at);
    };
    // This period: 1–7 October. The one before: 25–30 September.
    add("c1", "dabangasudan.org", "2026-10-02T08:00:00.000Z", "Shelling kills nine in El Fasher");
    add("c2", "dabangasudan.org", "2026-10-03T08:00:00.000Z", "Fighting spreads in El Fasher");
    add("c3", "bbc.com", "2026-10-05T08:00:00.000Z", "Clashes reported in Khartoum");
    add("c4", "nation.co.ke", "2026-10-06T08:00:00.000Z", "Peace agreement welcomed in Khartoum");
    add("p1", "bbc.com", "2026-09-26T08:00:00.000Z", "Attack kills civilians in Omdurman");
    add("p2", "bbc.com", "2026-09-28T08:00:00.000Z", "Massacre reported near Omdurman");
    const o = (await (await get("/q1/overview?from=2026-10-01T00:00:00.000Z&to=2026-10-07T00:00:00.000Z&tz=0")).json()) as {
      total: number;
      previous: { from: string; to: string; total: number; negative: number | null; partial: boolean };
      placeTrend: { bucket: string; buckets: string[]; rows: { label: string; total: number; counts: number[] }[] };
      sourceMix: { countries: string[]; inCountry: number; elsewhereInAfrica: number; international: number; outlets: number; largest: { label: string; share: number } };
      lastCollectedAt: string;
    };
    expect(o.total).toBe(4);
    expect(o.previous).toMatchObject({ from: "2026-09-25T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z", total: 2, negative: 1, partial: false });
    expect(o.placeTrend.bucket).toBe("day");
    expect(o.placeTrend.buckets).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(o.placeTrend.rows.find((r) => r.label === "El Fasher, Sudan")).toMatchObject({ total: 2, counts: [0, 1, 1, 0, 0, 0, 0] });
    expect(o.sourceMix).toMatchObject({ countries: ["Sudan"], inCountry: 2, elsewhereInAfrica: 1, international: 1, outlets: 3 });
    expect(o.sourceMix.largest).toEqual({ label: "dabangasudan.org", share: 0.5 });
    expect(o.lastCollectedAt).toBe("2026-10-06T23:00:00.000Z");
    // Over a fortnight the grid is by week, each starting on a Monday.
    const wide = (await (await get("/q1/overview?from=2026-09-07T00:00:00.000Z&to=2026-10-07T00:00:00.000Z&tz=0")).json()) as { placeTrend: { bucket: string; buckets: string[] } };
    expect(wide.placeTrend.bucket).toBe("week");
    expect(wide.placeTrend.buckets).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
  });

  it("counts an item collected days after it was published, and asks the match index only for the period", async () => {
    addQuery("q1", "Sudan war", 60);
    const ev = db.prepare("INSERT INTO events (id, source_type, title, content, url, published_at, ingested_at) VALUES (?,?,?,?,?,?,?)");
    const match = db.prepare("INSERT INTO query_matches VALUES (?,?,?,?)");
    // Published on the 2nd, found by a later search on the 5th.
    ev.run("late", "news", "Fighting in El Fasher", "Fighting in El Fasher https://x.example/late text", "https://x.example/late", "2026-10-02T08:00:00.000Z", "2026-10-05T08:00:00.000Z");
    match.run("m-late", "q1", "late", "2026-10-05T08:00:00.000Z");
    // Long before the period: must not be counted, and need not be read.
    ev.run("old", "news", "Fighting in Khartoum", "Fighting in Khartoum https://x.example/old text", "https://x.example/old", "2026-06-01T08:00:00.000Z", "2026-06-01T08:00:00.000Z");
    match.run("m-old", "q1", "old", "2026-06-01T08:00:00.000Z");
    const o = (await (await get("/q1/overview?from=2026-10-01T00:00:00.000Z&to=2026-10-07T00:00:00.000Z&tz=0")).json()) as { total: number; previous: { total: number } };
    expect(o).toMatchObject({ total: 1, previous: { total: 0 } });
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM query_matches qm JOIN events e ON e.id = qm.event_id WHERE qm.query_id = 'q1' AND qm.matched_at >= '2026-09-30' AND e.published_at >= '2026-10-01'").all() as { detail: string }[];
    expect(plan.map((r) => r.detail).join(" | ")).toMatch(/idx_query_matches_query_time \(query_id=\? AND matched_at>\?\)/);
    await get("/q1/watch");
    const alertsPlan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM alerts WHERE query_id = 'q1' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 20").all() as { detail: string }[];
    expect(alertsPlan.map((r) => r.detail).join(" | ")).toMatch(/idx_alerts_query/);
  });

  it("does not compare with a period from before the query existed", async () => {
    addQuery("q1", "New query", 5);
    const o = (await (await get(`/q1/overview?from=${iso(NOW.getTime() - 7 * DAY)}&to=${NOW.toISOString()}&tz=0`)).json()) as { previous: { partial: boolean; negative: number | null } };
    expect(o.previous).toMatchObject({ partial: true, negative: null });
  });

  it("keeps notes pinned to days: added, listed newest day first, deleted by their author or an admin", async () => {
    db.exec(`INSERT INTO monitoring_queries (id, name, boolean_query, owner_id, created_at, updated_at) VALUES ('q1', 'Sudan war', 'sudan', 'u2', '${NOW.toISOString()}', '${NOW.toISOString()}')`);
    const client = { Authorization: `Bearer ${await createSessionToken("u2", "client" as never, "test-secret")}` };
    expect((await send("POST", "/q1/notes", { day: "2026-10-05", body: "  RSF statement on El Fasher  " })).status).toBe(201);
    const second = (await (await send("POST", "/q1/notes", { day: "2026-10-06", body: "Talks postponed" }, client)).json()) as { id: string; author_name: string | null };
    expect(second.author_name).toBe("client");
    const list = (await (await get("/q1/notes")).json()) as { id: string; day: string; body: string; author_name: string }[];
    expect(list.map((x) => `${x.day}:${x.body}`)).toEqual(["2026-10-06:Talks postponed", "2026-10-05:RSF statement on El Fasher"]);
    expect(list[1].author_name).toBe("Mutua");
    expect((await send("POST", "/q1/notes", { day: "yesterday", body: "x" })).status).toBe(400);
    expect((await send("POST", "/q1/notes", { day: "2026-10-05", body: "   " })).status).toBe(400);
    expect((await send("POST", "/q1/notes", { day: "2026-10-05", body: "x".repeat(601) })).status).toBe(400);
    expect((await send("POST", "/q1/notes", { day: "2026-10-05", body: "x" }, stranger)).status).toBe(404);
    // The client cannot delete the admin's note; the admin can delete anyone's.
    expect((await send("DELETE", `/q1/notes/${list[1].id}`, undefined, client)).status).toBe(403);
    expect((await send("DELETE", `/q1/notes/${second.id}`)).status).toBe(200);
    expect((await send("DELETE", `/q1/notes/${second.id}`)).status).toBe(404);
    expect(((await (await get("/q1/notes")).json()) as unknown[]).length).toBe(1);
  });
});
