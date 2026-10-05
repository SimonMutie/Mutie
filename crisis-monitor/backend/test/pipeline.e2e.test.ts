/**
 * End-to-end run of the escalation pipeline against an in-memory database,
 * with the network mocked: article pages are fixtures, and the coding model
 * is replaced by canned codings (what a careful reader would return for each
 * fixture, plus deliberate mistakes). This tests everything the pipeline
 * does WITH a coding — verification, location, grouping, levels, alerts —
 * using the exact failures that were reported from the live platform. It
 * does not test the model's own reading; that is what the quote and place
 * verification, and the audit log, are for in production.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createRequire } from "node:module";
import { runEscalationPipeline, getFlaggedIncidents, getAuditLog, getPipelineStatus } from "../src/escalationIncidents";
import { countryAt, isInOrNearCountry } from "../src/lib/africaGeo";
import type { Env } from "../src/bindings";
import type { RawCoding } from "../src/lib/escalationCoder";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

// ── Minimal D1 stand-in over node:sqlite ──
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
    const stmt = this.db.prepare(this.sql);
    if (/\bRETURNING\b/i.test(this.sql)) {
      stmt.all(...(this.params as never[]));
      return { meta: { changes: 1 } };
    }
    const r = stmt.run(...(this.params as never[]));
    return { meta: { changes: Number(r.changes) } };
  }
}

const NOW = new Date();
const day = (offset: number) => new Date(NOW.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const gdeltTs = (hoursAgo: number) => iso(hoursAgo).replace(/[-:T]/g, "").slice(0, 14);

interface Fixture {
  url: string;
  title: string;
  body: string;
  sourceCountry: string; // where the OUTLET is based
  coding: RawCoding;
}

const pad = (s: string) => `${s} The report could not be independently verified. Communications in the area remain intermittent and aid agencies said access was restricted. Local officials said further details would be released, and residents described the situation as tense through the night.`;

const FIXTURES: Fixture[] = [
  {
    // A Kenyan outlet reporting fighting in Somaliland. Must land in Somalia (Las Anod) — not Kenya, not Mali, not Ethiopia.
    url: "https://kenyan-daily.example/world/somaliland-las-anod-fighting",
    title: "Artillery exchange outside Las Anod as Somaliland, SSC-Khatumo forces clash",
    sourceCountry: "KE",
    body: pad("Somaliland troops and SSC-Khatumo fighters exchanged artillery fire outside Las Anod on Thursday, residents said, in the heaviest fighting since the August truce. At least nine fighters were killed, a hospital source said. Ethiopian officials in Addis Ababa called for restraint, while traders in Mali and Kenya reported no disruption."),
    coding: {
      is_event_report: true, rejection_reason: null,
      events: [{
        country: "Somaliland", country_iso2: "SO", place: "Las Anod", admin1: "Sool", lat: 8.47, lon: 47.36, event_date: day(1), novelty: "new_event",
        actors: ["Somaliland forces", "SSC-Khatumo"],
        indicators: [
          { id: "heavy_weapons", quote: "exchanged artillery fire outside Las Anod on Thursday" },
          { id: "ceasefire_violation", quote: "the heaviest fighting since the August truce" },
        ],
        fatalities: 9, fatalities_quote: "At least nine fighters were killed", trajectory: "escalation", trajectory_reason: "Heaviest fighting since the August truce.",
        what_happened: "Somaliland troops and SSC-Khatumo fighters exchanged artillery fire outside Las Anod, with at least nine fighters reported killed.", significance: "The first major breach of the August truce.", confidence: "high",
      }],
    },
  },
  {
    // Tigray, mentioning Djibouti in passing. Must land at Mekelle, in Ethiopia.
    url: "https://addis-news.example/2026/tigray-drone-strike",
    title: "Drone strike near Mekelle kills seven, Tigray officials say",
    sourceCountry: "ET",
    body: pad("Ethiopian federal forces carried out a drone strike near Mekelle on Wednesday, killing seven people, Tigray interim administration officials said. It was the first strike on the regional capital since the Pretoria agreement. Fuel convoys arriving from Djibouti were delayed at the Afar checkpoint."),
    coding: {
      is_event_report: true, rejection_reason: null,
      events: [{
        country: "Ethiopia", country_iso2: "ET", place: "Mekelle", admin1: "Tigray", lat: 11.588, lon: 43.145 /* wrong on purpose: Djibouti */, event_date: day(1), novelty: "new_event",
        actors: ["Ethiopian National Defense Force", "Tigray interim administration"],
        indicators: [
          { id: "air_or_drone_strike", quote: "carried out a drone strike near Mekelle on Wednesday" },
          { id: "coup_or_mutiny", quote: "soldiers seized the presidential palace" /* invented on purpose */ },
        ],
        fatalities: 7, fatalities_quote: "killing seven people", trajectory: "escalation", trajectory_reason: "First strike on the regional capital since the Pretoria agreement.",
        what_happened: "Ethiopian federal forces carried out a drone strike near Mekelle, killing seven people according to Tigray officials.", significance: "First strike on Mekelle since the Pretoria agreement.", confidence: "high",
      }],
    },
  },
  {
    // A second, independent Tigray report — should join the same incident.
    url: "https://regional-wire.example/tigray-second-report",
    title: "Tigray: residents report strike on Mekelle outskirts",
    sourceCountry: "PAN",
    body: pad("Residents of Mekelle said an unmanned aircraft struck a compound on the northern outskirts of the city on Wednesday morning. The Tigray interim administration blamed the federal government, which has not commented. Hospital staff said seven bodies were received."),
    coding: {
      is_event_report: true, rejection_reason: null,
      events: [{
        country: "Ethiopia", country_iso2: "ET", place: "Mekelle", admin1: "Tigray", lat: null, lon: null, event_date: day(1), novelty: "new_event",
        actors: ["Tigray interim administration"],
        indicators: [{ id: "air_or_drone_strike", quote: "an unmanned aircraft struck a compound on the northern outskirts of the city" }],
        fatalities: 7, fatalities_quote: "seven bodies were received", trajectory: "unclear", trajectory_reason: null,
        what_happened: "Residents and hospital staff in Mekelle reported an unmanned aircraft strike on a compound that killed seven.", significance: null, confidence: "medium",
      }],
    },
  },
  {
    // Kenyan troops attacked IN SOMALIA, reported by a Kenyan outlet. Must not flag Kenya.
    url: "https://kenyan-daily.example/news/kdf-convoy-gedo",
    title: "Three KDF soldiers killed in Gedo roadside blast",
    sourceCountry: "KE",
    body: pad("Three Kenya Defence Forces soldiers were killed when their convoy struck an improvised explosive device near Beled Hawo in Somalia's Gedo region on Friday, the military said in Nairobi. Al-Shabaab claimed responsibility for the attack."),
    coding: {
      is_event_report: true, rejection_reason: null,
      events: [{
        country: "Somalia", country_iso2: "SO", place: "Beled Hawo", admin1: "Gedo", lat: null, lon: null, event_date: day(0), novelty: "new_event",
        actors: ["Kenya Defence Forces", "Al-Shabaab"],
        indicators: [
          { id: "ied_or_bombing", quote: "their convoy struck an improvised explosive device near Beled Hawo" },
          { id: "attack_on_security_forces", quote: "Three Kenya Defence Forces soldiers were killed" },
        ],
        fatalities: 3, fatalities_quote: "Three Kenya Defence Forces soldiers were killed", trajectory: "continuation", trajectory_reason: null,
        what_happened: "Three Kenyan soldiers were killed by an IED near Beled Hawo in Gedo, Somalia; al-Shabaab claimed the attack.", significance: null, confidence: "high",
      }],
    },
  },
  {
    // GDELT geocoded this Yemen story onto Africa. Must be rejected outright.
    url: "https://gulf-news.example/yemen-taiz-shelling",
    title: "Houthi shelling hits Taiz as Riyadh talks stall",
    sourceCountry: "GDELT",
    body: pad("Houthi forces shelled government positions in Taiz on Thursday, Yemeni officials said, as Saudi mediators in Riyadh pressed for a new round of talks. Shipping near Port Sudan and the Bab al-Mandab strait was unaffected."),
    coding: {
      is_event_report: true, rejection_reason: null,
      events: [{
        country: "Yemen", country_iso2: "YE", place: "Taiz", admin1: null, lat: 13.58, lon: 44.02, event_date: day(1), novelty: "new_event", actors: ["Houthis"],
        indicators: [{ id: "heavy_weapons", quote: "Houthi forces shelled government positions in Taiz on Thursday" }],
        fatalities: null, fatalities_quote: null, trajectory: "continuation", trajectory_reason: null,
        what_happened: "Houthi forces shelled government positions in Taiz.", significance: null, confidence: "high",
      }],
    },
  },
  {
    // A Ghana politics story GDELT pinned on South Africa. Not an event at all.
    url: "https://sa-times.example/africa/ghana-parliament-budget",
    title: "Ghana parliament clash over budget vote",
    sourceCountry: "GDELT",
    body: pad("Lawmakers in Accra clashed over the timing of the budget vote on Thursday, with the minority walking out of the chamber. Analysts in Johannesburg said the dispute could delay a planned Eurobond issue."),
    coding: { is_event_report: false, rejection_reason: "not_security_related", rejection_note: "A parliamentary dispute over a budget vote in Ghana; 'clash' is figurative.", events: [] },
  },
  {
    // A model that mis-attributes: says Kenya, but nothing in the text supports any indicator there.
    url: "https://kenyan-daily.example/opinion/security-outlook",
    title: "Opinion: what the Somalia drawdown means for Kenya",
    sourceCountry: "KE",
    body: pad("As the African Union mission draws down, Kenya faces hard choices about its border posture. Analysts argue that Nairobi should invest in county-level policing rather than forward bases, and warn that clashes could follow if the transition is rushed."),
    coding: {
      is_event_report: true, rejection_reason: null,
      events: [{
        country: "Kenya", country_iso2: "KE", place: "Mandera", admin1: "Mandera County", lat: 3.94, lon: 41.86, event_date: day(0), novelty: "new_event", actors: ["KDF"],
        indicators: [{ id: "armed_clash", quote: "KDF troops clashed with militants in Mandera" /* not in the text */ }],
        fatalities: null, fatalities_quote: null, trajectory: "escalation", trajectory_reason: null, what_happened: "KDF clashed with militants in Mandera.", significance: null, confidence: "high",
      }],
    },
  },
];

const html = (f: Fixture) => `<html><head><meta property="og:title" content="${f.title}"><meta property="article:published_time" content="${iso(6)}"></head><body><article><p>${f.body.replace(/\. /g, ".</p><p>")}</p></article></body></html>`;

let db: InstanceType<typeof DatabaseSync>;
let env: Env;
const analystCalls: string[] = [];
let modelDown = false;
let workersAiJsonModeCalls = 0;

/** Stand-in for the Workers AI binding: refuses schema-constrained JSON mode
 *  (as a platform that does not support the schema would), and in plain mode
 *  answers with the coding wrapped in prose and a code fence. */
async function workersAiRun(_model: string, input: { messages: { role: string; content: string }[]; response_format?: unknown }) {
  if (input.response_format) {
    workersAiJsonModeCalls++;
    throw new Error("5025: This model doesn't support JSON Schema.");
  }
  const user = input.messages.find((m) => m.role === "user")!.content;
  if (user.startsWith("INCIDENT LOCATION")) {
    const where = /INCIDENT LOCATION: (.+)/.exec(user)![1];
    return { response: `Here is the assessment:\n\`\`\`json\n${JSON.stringify({ headline: `Assessment for ${where}`, summary: `Reports describe events at ${where} [1], with details from the coded material.`, assessment: "A shift.", outlook: "Watch.", caveats: null })}\n\`\`\`` };
  }
  const fixture = FIXTURES.find((f) => user.includes(`Headline: ${f.title}`))!;
  return { response: `Sure. ${JSON.stringify(fixture.coding)} Hope that helps.` };
}

beforeAll(() => {
  db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE alerts (id TEXT PRIMARY KEY, query_id TEXT, level TEXT NOT NULL CHECK (level IN ('info','elevated','critical')), title TEXT NOT NULL, description TEXT NOT NULL,
            metric_snapshot TEXT NOT NULL DEFAULT '{}', geo_label TEXT, geo_lat REAL, geo_lng REAL, created_at TEXT NOT NULL, acknowledged_at TEXT, resolved_at TEXT);
           CREATE TABLE gdelt_bulk_events (id TEXT PRIMARY KEY, event_date TEXT, date_added TEXT, lat REAL, lon REAL, place_name TEXT, goldstein REAL, num_mentions INTEGER, avg_tone REAL,
            event_code TEXT, quad_class INTEGER, source_url TEXT, ingested_at TEXT);`);
  // An alert left behind by the old country-level scorer.
  db.prepare("INSERT INTO alerts (id, query_id, level, title, description, metric_snapshot, geo_label, created_at) VALUES ('legacy', NULL, 'elevated', 'Elevated escalation: Kenya', 'x', '{\"escalationScore\":3.1}', 'Kenya', ?)").run(iso(3));
  // GDELT rows: the Yemen story geocoded onto Sudan's coast, the Ghana story geocoded onto Pretoria.
  const ins = db.prepare("INSERT INTO gdelt_bulk_events (id, date_added, lat, lon, place_name, num_mentions, event_code, quad_class, source_url) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run("g1", gdeltTs(2), 19.6, 37.2, "Port Sudan, Red Sea, Sudan", 40, "194", 4, "https://gulf-news.example/yemen-taiz-shelling");
  ins.run("g2", gdeltTs(2), -25.75, 28.23, "Pretoria, Gauteng, South Africa", 12, "190", 4, "https://sa-times.example/africa/ghana-parliament-budget");

  const wireCandidates = FIXTURES.filter((f) => f.sourceCountry !== "GDELT").map((f, i) => ({
    id: `w${i}`, title: f.title, description: f.body.slice(0, 160), textEn: null, link: f.url, published: iso(6), domain: new URL(f.url).hostname, sourceCountry: f.sourceCountry, priority: 5 - i,
  }));

  env = {
    DB: { prepare: (sql: string) => new FakeStmt(db, sql), batch: async (stmts: FakeStmt[]) => Promise.all(stmts.map((s) => s.run())) },
    AFRICA_WIRE_ACTOR: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ candidates: wireCandidates }) }) },
    LIVE_FEED: { idFromName: () => "id", get: () => ({ fetch: async () => new Response("ok") }) },
    AI: { run: async () => ({ response: null }) },
    ANTHROPIC_API_KEY: "test-key",
    ESCALATION_ARTICLES_PER_TICK: "30",
  } as unknown as Env;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.anthropic.com/")) {
      if (modelDown) return new Response("down for test", { status: 503 });
      const body = JSON.parse(String(init?.body)) as { tools: { name: string }[]; messages: { content: string }[] };
      const user = body.messages[0].content;
      if (body.tools[0].name === "record_incident_assessment") {
        analystCalls.push(user);
        const where = /INCIDENT LOCATION: (.+)/.exec(user)![1];
        return Response.json({ content: [{ type: "tool_use", name: "record_incident_assessment", input: { headline: `Assessment for ${where}`, summary: `Reports describe events at ${where} [1]. A second detail is cited to a source that does not exist [9].`, assessment: `This marks a shift at ${where} [1].`, outlook: "Watch for follow-on strikes.", caveats: null } }] });
      }
      const fixture = FIXTURES.find((f) => user.includes(`Headline: ${f.title}`));
      if (!fixture) return new Response("no fixture", { status: 500 });
      return Response.json({ content: [{ type: "tool_use", name: "record_article_coding", input: fixture.coding }] });
    }
    if (url.startsWith("https://nominatim.openstreetmap.org/")) return Response.json([]);
    const fixture = FIXTURES.find((f) => f.url === url);
    if (fixture) return new Response(html(fixture), { headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404 }); // wire-service RSS feeds etc.
  });
});

afterAll(() => vi.unstubAllGlobals());

describe("escalation pipeline, end to end", () => {
  it("runs a tick", async () => {
    await runEscalationPipeline(env);
    const status = await getPipelineStatus(env);
    expect(status.provider.provider).toBe("anthropic");
    const counts = Object.fromEntries(status.last24h.map((s) => [s.status, s.count]));
    expect(counts.coded).toBe(4);
    expect(counts.rejected).toBe(3);
  });

  it("flags only incidents that are in the right country and at the right place", async () => {
    const incidents = await getFlaggedIncidents(env);
    const byCountry = incidents.map((i) => `${i.countryCode}:${i.locationLabel}`).sort();
    expect(byCountry).toEqual(["ET:Mekelle, Tigray", "SO:Las Anod, Sool"]);
    for (const i of incidents) {
      // Every marker is inside the country it is attributed to.
      expect(isInOrNearCountry(i.countryCode, i.lat, i.lon), `${i.locationLabel}`).toBe(true);
      expect(i.geoPrecision).toBe("place");
    }
    // Nothing in Kenya, South Africa, Mali, Djibouti, or outside Africa.
    for (const wrong of ["KE", "ZA", "ML", "DJ", "SD"]) expect(incidents.some((i) => i.countryCode === wrong), wrong).toBe(false);
  });

  it("puts Tigray at Mekelle even though the model's own coordinates were in Djibouti", async () => {
    const tigray = (await getFlaggedIncidents(env)).find((i) => i.countryCode === "ET")!;
    expect(countryAt(tigray.lat, tigray.lon)).toBe("ET");
    expect(Math.abs(tigray.lat - 13.4967)).toBeLessThan(0.01);
    expect(tigray.sources).toHaveLength(2); // both Tigray reports joined one incident
    expect(tigray.fatalitiesMax).toBe(7);
  });

  it("every flagged incident lists its criteria, and every indicator has a real quote and a real source", async () => {
    for (const i of await getFlaggedIncidents(env)) {
      expect(i.criteriaMet.length).toBeGreaterThan(0);
      expect(i.indicators.length).toBeGreaterThan(0);
      for (const ind of i.indicators) {
        for (const ev of ind.evidence) {
          const src = i.sources.find((s) => s.n === ev.source)!;
          expect(src).toBeDefined();
          const fixture = FIXTURES.find((f) => f.url === src.url)!;
          expect(fixture.body).toContain(ev.quote);
        }
      }
      // The invented coup indicator never made it through.
      expect(i.indicators.some((ind) => ind.id === "coup_or_mutiny")).toBe(false);
    }
  });

  it("writes an incident-specific assessment and strips citations to sources that do not exist", async () => {
    const incidents = await getFlaggedIncidents(env);
    const tigray = incidents.find((i) => i.countryCode === "ET")!;
    const somaliland = incidents.find((i) => i.countryCode === "SO")!;
    expect(tigray.analystWritten).toBe(true);
    expect(tigray.summary).toContain("Mekelle, Tigray, Ethiopia");
    expect(somaliland.summary).toContain("Las Anod, Sool, Somalia");
    expect(tigray.summary).toContain("[1]");
    expect(tigray.summary).not.toContain("[9]");
    // The analyst was given the quotes and what each article reports, not just counts.
    const prompt = analystCalls.find((p) => p.includes("Mekelle"))!;
    expect(prompt).toContain("carried out a drone strike near Mekelle on Wednesday");
    expect(prompt).toContain("First strike on Mekelle since the Pretoria agreement.");
  });

  it("keeps the Kenyan-troops-in-Somalia attack as a Somalia event, below the alert threshold", async () => {
    const audit = await getAuditLog(env, { q: "KDF" });
    const kdf = audit.find((a) => a.url.includes("kdf-convoy-gedo"))!;
    expect(kdf.status).toBe("coded");
    expect(kdf.reports[0].country).toBe("Somalia");
    expect(kdf.reports[0].location).toBe("Beled Hawo");
    const incidents = await getFlaggedIncidents(env);
    expect(incidents.some((i) => i.countryCode === "KE")).toBe(false);
  });

  it("records why each rejected article was rejected", async () => {
    const audit = await getAuditLog(env, { status: "rejected" });
    const reason = (frag: string) => audit.find((a) => a.url.includes(frag))?.rejectionReason;
    expect(reason("yemen-taiz")).toBe("outside_africa");
    expect(reason("ghana-parliament")).toBe("not_security_related");
    expect(reason("security-outlook")).toBe("unverified");
  });

  it("raises one located alert per incident and retires the old country-level alert", async () => {
    const alerts = db.prepare("SELECT * FROM alerts").all() as { id: string; title: string; geo_label: string; geo_lat: number; geo_lng: number; resolved_at: string | null; metric_snapshot: string; description: string }[];
    expect(alerts.find((a) => a.id === "legacy")!.resolved_at).not.toBeNull();
    const open = alerts.filter((a) => !a.resolved_at);
    expect(open.map((a) => a.geo_label).sort()).toEqual(["Las Anod, Sool, Somalia", "Mekelle, Tigray, Ethiopia"]);
    for (const a of open) {
      const snap = JSON.parse(a.metric_snapshot) as { incidentId: string; criteriaMet: string[] };
      expect(snap.incidentId).toBeTruthy();
      expect(snap.criteriaMet.length).toBeGreaterThan(0);
      expect(a.description).not.toMatch(/\[\d+\]/);
    }
  });

  it("a second tick reads nothing twice and raises no duplicate alerts", async () => {
    const before = (db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as { n: number }).n;
    const reportsBefore = (db.prepare("SELECT COUNT(*) AS n FROM escalation_reports").get() as { n: number }).n;
    const analystBefore = analystCalls.length;
    await runEscalationPipeline(env);
    expect((db.prepare("SELECT COUNT(*) AS n FROM alerts").get() as { n: number }).n).toBe(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM escalation_reports").get() as { n: number }).n).toBe(reportsBefore);
    expect(analystCalls.length).toBe(analystBefore);
  });

  it("when no model answers, stops early, keeps the articles queued, and records why", async () => {
    // New articles appear while both providers are down.
    db.prepare("DELETE FROM escalation_articles").run();
    db.prepare("DELETE FROM escalation_reports").run();
    db.prepare("DELETE FROM escalation_incidents").run();
    db.prepare("DELETE FROM alerts").run();
    modelDown = true;
    for (let i = 0; i < 4; i++) await runEscalationPipeline(env); // more ticks than the retry limit
    const rows = db.prepare("SELECT status, rejection_reason, attempts, model FROM escalation_articles").all() as { status: string; rejection_reason: string; attempts: number; model: string | null }[];
    // The headline first pass needs no model: the three reports whose
    // headlines state an event are on record, at low confidence, and stay
    // there however often the attempt to read them in full fails.
    const firstPass = rows.filter((r) => r.model === "headline-rules");
    expect(firstPass).toHaveLength(3);
    expect(firstPass.every((r) => r.status === "coded" && r.attempts === 0)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM escalation_reports").get() as { n: number }).n).toBe(3);
    // Only the first group of three was attempted each tick, not the whole
    // batch: one first-pass article and two others, which are queued.
    const failed = rows.filter((r) => r.model !== "headline-rules");
    expect(failed).toHaveLength(2);
    expect(failed.every((r) => r.status === "error" && r.rejection_reason === "model_unavailable")).toBe(true);
    const last = JSON.parse((db.prepare("SELECT value FROM escalation_pipeline_state WHERE key = 'last_run'").get() as { value: string }).value);
    expect(last.modelFailures).toBe(3);
    expect(last.lastModelError.message).toMatch(/down for test|not valid JSON|503/);

    // The model comes back: everything is read, including the articles that failed four times.
    modelDown = false;
    await runEscalationPipeline(env);
    const after = db.prepare("SELECT status, COUNT(*) AS n FROM escalation_articles GROUP BY status").all() as { status: string; n: number }[];
    expect(Object.fromEntries(after.map((r) => [r.status, r.n]))).toEqual({ coded: 4, rejected: 3 });
    // Every first-pass coding has been replaced by a full reading.
    expect((db.prepare("SELECT COUNT(*) AS n FROM escalation_articles WHERE model = 'headline-rules'").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM escalation_reports r JOIN escalation_articles a ON a.id = r.article_id WHERE a.text_basis = 'headline'").get() as { n: number }).n).toBe(0);
    const flagged = await getFlaggedIncidents(env);
    expect(flagged.map((i) => i.countryCode).sort()).toEqual(["ET", "SO"]);
    expect(flagged.every((i) => !i.preliminary && i.analystWritten)).toBe(true);
  });

  it("works on the Cloudflare model alone, including when its JSON mode is refused", async () => {
    db.prepare("DELETE FROM escalation_articles").run();
    db.prepare("DELETE FROM escalation_reports").run();
    db.prepare("DELETE FROM escalation_incidents").run();
    db.prepare("DELETE FROM alerts").run();
    // A large budget here: this test is about the model fallback, not the
    // daily ceiling (which test/aiBudget.test.ts covers) or the pacing of
    // reading through the day, which would make it depend on the clock.
    const noKeyEnv = { ...env, ANTHROPIC_API_KEY: undefined, AI: { run: workersAiRun }, AI_DAILY_NEURON_BUDGET: "1000000" } as unknown as Env;
    await runEscalationPipeline(noKeyEnv);
    const status = await getPipelineStatus(noKeyEnv);
    expect(status.provider.provider).toBe("workers-ai");
    expect(Object.fromEntries(status.last24h.map((s) => [s.status, s.count]))).toEqual({ coded: 4, rejected: 3 });
    expect((await getFlaggedIncidents(noKeyEnv)).map((i) => `${i.countryCode}:${i.locationLabel}`).sort()).toEqual(["ET:Mekelle, Tigray", "SO:Las Anod, Sool"]);
    expect(workersAiJsonModeCalls).toBeGreaterThan(0);
  });

  it("closes the incident and its alert once its reports age out of the window", async () => {
    db.prepare("UPDATE escalation_reports SET event_date = '2026-01-01'").run();
    await runEscalationPipeline(env);
    expect(await getFlaggedIncidents(env)).toHaveLength(0);
    const open = db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").get() as { n: number };
    expect(open.n).toBe(0);
  });
});
