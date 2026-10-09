import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeD1 } from "./fakeD1";
import { cleanDestination, toHtml, toText, channelsAvailable } from "../src/lib/notify";
import { detectChanges, dispatchAlertSubscriptions, ensureAlertTables, resetAlertTableCheck } from "../src/lib/alertDelivery";
import { getFlaggedIncidents, type IncidentView } from "../src/escalationIncidents";
import type { Env } from "../src/bindings";

const incident = (over: Partial<IncidentView>): IncidentView =>
  ({ id: "i1", level: "elevated", reportCount: 2, headline: "", summary: "", assessment: "", outlook: "", caveats: null, sources: [], updatedAt: "2026-10-07T10:00:00Z", countryName: "Ethiopia", locationLabel: null, preliminary: false, ...over }) as IncidentView;

describe("destinations", () => {
  it("accepts and normalises email and Signal numbers", () => {
    expect(cleanDestination("email", "  Simon@Example.com ")).toBe("simon@example.com");
    expect(cleanDestination("email", "not-an-email")).toBeNull();
    expect(cleanDestination("signal", "+254 712 345 678")).toBe("+254712345678");
    expect(cleanDestination("signal", "0712345678")).toBeNull();
  });
});

describe("rendering", () => {
  const n = {
    subject: "S <b>",
    overview: "Overview",
    analysis: "Reading",
    sections: [{ heading: "CRITICAL · Mekelle", changed: "New thing", analysis: "Why", links: [{ title: "A <script>", url: "javascript:alert(1)", source: "x.com" }] }],
    links: [{ title: "L", url: "https://example.com/a" }],
  };
  it("escapes HTML and only links http(s)", () => {
    const html = toHtml(n);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="https://example.com/a"');
  });
  it("reads as plain text with what changed, analysis and links", () => {
    const t = toText(n);
    expect(t).toMatch(/What changed: New thing/);
    expect(t).toMatch(/Analysis: Why/);
    expect(t).toContain("https://example.com/a");
  });
});

describe("detectChanges", () => {
  it("announces new, raised and re-reported incidents once, and respects the minimum level", () => {
    const seen = new Map([
      ["raised", { level: "elevated", report_count: 2 }],
      ["steady", { level: "elevated", report_count: 2 }],
      ["busy", { level: "elevated", report_count: 2 }],
    ]);
    const flagged = [
      incident({ id: "fresh", level: "critical" }),
      incident({ id: "raised", level: "critical" }),
      incident({ id: "steady", reportCount: 3 }),
      incident({ id: "busy", reportCount: 5 }),
      incident({ id: "lowfresh", level: "elevated" }),
    ];
    const got = detectChanges(flagged, seen, "elevated").map((c) => `${c.incident.id}:${c.kind}`);
    expect(got.sort()).toEqual(["busy:updated", "fresh:new", "lowfresh:new", "raised:escalated"]);
    expect(detectChanges(flagged, seen, "critical").map((c) => c.incident.id).sort()).toEqual(["fresh", "raised"]);
  });
});

describe("dispatch", () => {
  let env: Env;
  let db: ReturnType<typeof fakeD1>["db"];
  let sent: { url: string; body: any }[];

  beforeEach(async () => {
    resetAlertTableCheck();
    const f = fakeD1();
    db = f.db;
    env = { DB: f.DB, RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "The Lens <a@afrilensconsulting.com>", SIGNAL_API_URL: "https://sig.example", SIGNAL_SENDER_NUMBER: "+10000000000" } as unknown as Env;
    db.exec(`
      CREATE TABLE monitoring_queries (id TEXT PRIMARY KEY, name TEXT, boolean_query TEXT, is_active INTEGER DEFAULT 1);
      CREATE TABLE events (id TEXT PRIMARY KEY, title TEXT, content TEXT, url TEXT, sentiment REAL, geo_label TEXT, source_type TEXT);
      CREATE TABLE query_matches (id TEXT PRIMARY KEY, query_id TEXT, event_id TEXT, matched_at TEXT);
      CREATE TABLE alerts (id TEXT PRIMARY KEY, query_id TEXT, level TEXT, title TEXT, description TEXT, geo_label TEXT, created_at TEXT);
    `);
    await ensureAlertTables(env);
    sent = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const sub = (over: Record<string, unknown>) => {
    const row = { id: "s1", owner_id: "u1", scope: "query", query_id: "q1", channel: "email", destination: "me@example.com", min_level: "any", frequency_minutes: 15, enabled: 1, cursor_at: "2026-10-07T00:00:00.000Z", last_sent_at: null, created_at: "2026-10-07T00:00:00.000Z", ...over };
    db.prepare("INSERT INTO alert_subscriptions (id, owner_id, scope, query_id, channel, destination, min_level, frequency_minutes, enabled, cursor_at, last_sent_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
      row.id as string, row.owner_id as string, row.scope as string, row.query_id as string, row.channel as string, row.destination as string, row.min_level as string, row.frequency_minutes as number, row.enabled as number, row.cursor_at as string, row.last_sent_at as string | null, row.created_at as string
    );
  };
  const match = (id: string, title: string) => {
    db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?,?)").run(id, title, title, `https://news.example/${id}`, -0.5, "Mekelle", "news");
    db.prepare("INSERT INTO query_matches VALUES (?,?,?,?)").run(`m${id}`, "q1", id, new Date().toISOString());
  };

  it("emails a query digest with links, then stays quiet until there is more", async () => {
    db.prepare("INSERT INTO monitoring_queries VALUES ('q1','Tigray watch','Tigray',1)").run();
    sub({});
    await dispatchAlertSubscriptions(env);
    expect(sent).toHaveLength(0); // nothing new yet

    match("a", "Forces mass near Mekelle");
    match("b", "Airstrike reported in Tigray");
    await dispatchAlertSubscriptions(env);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.resend.com/emails");
    expect(sent[0].body.to).toEqual(["me@example.com"]);
    expect(sent[0].body.subject).toMatch(/Tigray watch: 2 new developments/);
    expect(sent[0].body.text).toContain("https://news.example/a");

    await dispatchAlertSubscriptions(env);
    expect(sent).toHaveLength(1);
    const row = db.prepare("SELECT last_status FROM alert_subscriptions WHERE id='s1'").get() as { last_status: string };
    expect(row.last_status).toBe("ok");
  });

  it("holds an alerts-only query subscription until an alert opens", async () => {
    db.prepare("INSERT INTO monitoring_queries VALUES ('q1','Tigray watch','Tigray',1)").run();
    sub({ min_level: "alert", channel: "signal", destination: "+254700000000" });
    match("a", "Forces mass near Mekelle");
    await dispatchAlertSubscriptions(env);
    expect(sent).toHaveLength(0);
    db.prepare("INSERT INTO alerts VALUES ('al1','q1','info','Coverage surge: Tigray watch','Coverage is above usual','Mekelle',?)").run(new Date().toISOString());
    await dispatchAlertSubscriptions(env);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://sig.example/v2/send");
    expect(sent[0].body.recipients).toEqual(["+254700000000"]);
    expect(sent[0].body.message).toMatch(/Coverage surge: Tigray watch/);
  });

  it("does not mark anything told when the send fails, and retries", async () => {
    db.prepare("INSERT INTO monitoring_queries VALUES ('q1','Tigray watch','Tigray',1)").run();
    sub({});
    match("a", "Forces mass near Mekelle");
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    await dispatchAlertSubscriptions(env);
    let row = db.prepare("SELECT last_status, last_error, cursor_at FROM alert_subscriptions WHERE id='s1'").get() as { last_status: string; last_error: string; cursor_at: string };
    expect(row.last_status).toBe("error");
    expect(row.last_error).toMatch(/500/);
    expect(row.cursor_at).toBe("2026-10-07T00:00:00.000Z");
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    });
    await dispatchAlertSubscriptions(env);
    expect(sent).toHaveLength(1);
  });

  it("reports an unconfigured channel instead of sending", async () => {
    db.prepare("INSERT INTO monitoring_queries VALUES ('q1','Tigray watch','Tigray',1)").run();
    sub({});
    match("a", "x story here");
    const bare = { DB: env.DB } as unknown as Env;
    expect(channelsAvailable(bare)).toEqual({ email: false, signal: false, push: true });
    await dispatchAlertSubscriptions(bare);
    expect(sent).toHaveLength(0);
    const row = db.prepare("SELECT last_error FROM alert_subscriptions WHERE id='s1'").get() as { last_error: string };
    expect(row.last_error).toMatch(/not set up/);
  });

  it("announces a new escalation incident once, with its assessment and sources", async () => {
    await getFlaggedIncidents(env); // creates the escalation tables
    sub({ id: "e1", scope: "escalations", query_id: null, min_level: "elevated" });
    await dispatchAlertSubscriptions(env); // baseline: nothing flagged yet
    expect(sent).toHaveLength(0);

    const now = new Date().toISOString();
    const detail = JSON.stringify({ reportCount: 4, sources: [{ n: 1, url: "https://news.example/mek", title: "Fighting near Mekelle", domain: "news.example", publishedAt: now, textBasis: "full" }] });
    db.prepare(
      `INSERT INTO escalation_incidents (id, country_code, country_name, region_key, location_label, lat, lon, geo_precision, level, status, headline, summary, assessment, outlook, detail, created_at, updated_at, last_event_date)
       VALUES ('inc1','ET','Ethiopia','tigray','Mekelle, Tigray',13.5,39.5,'place','critical','active','Heavy fighting near Mekelle','Two brigades clashed.','The clash suggests a breakdown of the ceasefire.','Further fighting likely within days.',?,?,?,?)`
    ).run(detail, now, now, now);

    await dispatchAlertSubscriptions(env);
    expect(sent).toHaveLength(1);
    const text = sent[0].body.text as string;
    expect(sent[0].body.subject).toMatch(/\[CRITICAL\].*Mekelle/);
    expect(text).toMatch(/breakdown of the ceasefire/);
    expect(text).toContain("https://news.example/mek");

    await dispatchAlertSubscriptions(env);
    expect(sent).toHaveLength(1); // not repeated
  });
});
