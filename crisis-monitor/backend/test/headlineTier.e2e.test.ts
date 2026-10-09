/**
 * The headline first pass, end to end: with no AI available at all, the
 * pipeline must still put a marker — with a level, a quick summary and its
 * sources — wherever outlets' headlines meet the written criteria, and
 * nowhere else. Then, once a model is available, a full reading must
 * replace the first pass: confirming it, or taking the marker down.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { runEscalationPipeline, getFlaggedIncidents, getPipelineStatus, getAuditLog, resetHeadlinePass, canonicalUrl } from "../src/escalationIncidents";
import { hashId } from "../src/lib/osintFeed";
import { resetAiBudgetTableCheck } from "../src/lib/aiBudget";
import type { Env } from "../src/bindings";
import type { RawCoding } from "../src/lib/escalationCoder";
import { fakeD1 } from "./fakeD1";

const NOW = new Date();
const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const today = NOW.toISOString().slice(0, 10);

interface Item {
  url: string;
  title: string;
  description: string;
}

const ITEMS: Item[] = [
  // One outlet, twelve deaths stated: flagged on its own.
  { url: "https://jos-herald.example/plateau-attack", title: "Gunmen kill 12 villagers in Barkin Ladi, Plateau", description: "Gunmen killed 12 villagers in an overnight attack on a farming community in Barkin Ladi, Plateau State, residents said." },
  // Two independent outlets, the same strike, no deaths stated: flagged only because there are two.
  { url: "https://addis-news.example/mekelle-market-strike", title: "Drone strike hits Mekelle market, officials say", description: "A drone strike hit a market in Mekelle today, Tigray officials said." },
  { url: "https://horn-wire.example/tigray-mekelle", title: "Tigray: air strike on Mekelle reported by residents", description: "Residents reported an air strike on the outskirts of Mekelle." },
  // One outlet, no deaths stated: on record, not flagged.
  { url: "https://sahel-daily.example/kidal-clashes", title: "Clashes erupt in Kidal between army and rebels", description: "Clashes erupted in Kidal overnight." },
  // A warning is not an event.
  { url: "https://borno-post.example/army-warning", title: "Army warns of attack on Maiduguri", description: "The army warned of a possible attack on Maiduguri." },
  // One outlet, a strike with seven deaths: flagged.
  { url: "https://darfur-monitor.example/el-fasher-strike", title: "Drone strike kills seven near El Fasher", description: "A drone strike killed seven people near El Fasher, North Darfur, medics said." },
  // Forty deaths from one outlet: flagged, but not Critical on one unread headline...
  { url: "https://north-west-news.example/zamfara-raid", title: "Bandits kill 40 villagers in Zamfara raid", description: "Bandits killed 40 villagers in a raid on a community in Zamfara State." },
  // ...thirty-one deaths from two independent outlets: Critical.
  { url: "https://goma-info.example/ituri-attack", title: "ADF rebels kill 31 civilians in Ituri village attack", description: "ADF rebels killed 31 civilians in an attack on a village in Ituri province, local officials said." },
  { url: "https://kinshasa-times.example/ituri", title: "Dozens dead after rebels attack village in Ituri", description: "At least 31 people were killed when rebels attacked a village in Ituri province overnight, a civil society leader said." },
  // Major, but not new: dated to last week in its own summary. Not flagged.
  { url: "https://kaduna-voice.example/last-week", title: "Gunmen kill 14 villagers in Kaduna village attack", description: "Gunmen killed 14 villagers in an attack on a village in Kaduna State last week, police confirmed." },
  // One outlet's strike report, and an aggregator's copy of it under a prefixed headline with a longer summary: one source, no deaths — not flagged.
  { url: "https://nile-radio.example/dilling-strike", title: "Doctors' network: drone attack on Dilling homes, South Kordofan", description: "Homes in Dilling, South Kordofan, were hit in a drone attack overnight, a doctors' network said..." },
  { url: "https://all-continent.example/sudan-dilling", title: "Sudan: Doctors' Network - Drone Attack On Dilling Homes, South Kordofan", description: "Homes in Dilling, South Kordofan, were hit in a drone attack overnight, a doctors' network said, citing residents." },
  // The same Plateau story syndicated word for word on another site: not a second source.
  { url: "https://naija-aggregator.example/plateau-attack-copy", title: "Gunmen kill 12 villagers in Barkin Ladi, Plateau", description: "Gunmen killed 12 villagers in an overnight attack on a farming community in Barkin Ladi, Plateau State, residents said." },
];

const candidates = ITEMS.map((it, i) => ({ id: `c${i}`, title: it.title, description: it.description, textEn: null, link: it.url, published: iso(1 + i), domain: new URL(it.url).hostname, sourceCountry: "XX", priority: 5 }));
// Major and undated, but published sixty hours ago: outside the window. Not flagged.
candidates.push({ id: "old", title: "Gunmen kill 19 villagers in Katsina village attack", description: "Gunmen killed 19 villagers in an attack on a village in Katsina State, residents said.", textEn: null, link: "https://katsina-post.example/thirty-hours-ago", published: iso(60), domain: "katsina-post.example", sourceCountry: "XX", priority: 5 });

const body = (s: string) =>
  `${s} The report could not be independently verified. Communications in the area remain intermittent and aid agencies said access was restricted. Local officials said further details would be released, and residents described the situation as tense through the night.`;

/** What a careful reader returns for each article once it is read in full. */
const FULL: Record<string, { body: string; coding: RawCoding }> = {
  // The headline was about a memorial service for an attack years ago: not a new event.
  "https://jos-herald.example/plateau-attack": {
    body: body("Families in Barkin Ladi gathered on Sunday to mark the day gunmen killed 12 villagers in the community in 2019. Speakers at the service called for the suspects' trial to resume."),
    coding: { is_event_report: false, rejection_reason: "retrospective", rejection_note: "A memorial for an attack in 2019.", events: [] },
  },
  "https://naija-aggregator.example/plateau-attack-copy": {
    body: body("Families in Barkin Ladi gathered on Sunday to mark the day gunmen killed 12 villagers in the community in 2019. Speakers at the service called for the suspects' trial to resume."),
    coding: { is_event_report: false, rejection_reason: "retrospective", rejection_note: "A memorial for an attack in 2019.", events: [] },
  },
  "https://addis-news.example/mekelle-market-strike": {
    body: body("A drone strike hit a market in Mekelle on Tuesday, killing nine people, Tigray interim administration officials said. It was the first strike on the regional capital since the Pretoria agreement."),
    coding: {
      is_event_report: true, rejection_reason: null,
      events: [{
        country: "Ethiopia", country_iso2: "ET", place: "Mekelle", admin1: "Tigray", lat: null, lon: null, event_date: today, novelty: "new_event", actors: ["Tigray interim administration"],
        indicators: [{ id: "air_or_drone_strike", quote: "A drone strike hit a market in Mekelle on Tuesday" }],
        fatalities: 9, fatalities_quote: "killing nine people", trajectory: "escalation", trajectory_reason: "First strike on the regional capital since the Pretoria agreement.",
        what_happened: "A drone strike hit a market in Mekelle, killing nine people according to Tigray officials.", significance: "First strike on Mekelle since the Pretoria agreement.", confidence: "high",
      }],
    },
  },
};

let db: ReturnType<typeof fakeD1>["db"];
let env: Env;
const fetched: string[] = [];
let aiCalls = 0;

beforeAll(() => {
  resetHeadlinePass();
  resetAiBudgetTableCheck();
  const d1 = fakeD1();
  db = d1.db;
  db.exec(`CREATE TABLE alerts (id TEXT PRIMARY KEY, query_id TEXT, level TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
            metric_snapshot TEXT NOT NULL DEFAULT '{}', geo_label TEXT, geo_lat REAL, geo_lng REAL, created_at TEXT NOT NULL, acknowledged_at TEXT, resolved_at TEXT);
           CREATE TABLE gdelt_bulk_events (id TEXT PRIMARY KEY, event_date TEXT, date_added TEXT, lat REAL, lon REAL, place_name TEXT, goldstein REAL, num_mentions INTEGER, avg_tone REAL,
            event_code TEXT, quad_class INTEGER, source_url TEXT, ingested_at TEXT);`);
  env = {
    DB: d1.DB,
    AFRICA_WIRE_ACTOR: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ candidates }) }) },
    LIVE_FEED: { idFromName: () => "id", get: () => ({ fetch: async () => new Response("ok") }) },
    AI: {
      run: async () => {
        aiCalls++;
        return { response: null };
      },
    },
    // No paid key, and the free allowance switched off: no model can be called.
    AI_DAILY_NEURON_BUDGET: "0",
  } as unknown as Env;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetched.push(url);
    if (url.startsWith("https://api.anthropic.com/")) {
      const req = JSON.parse(String(init?.body)) as { tools: { name: string }[]; messages: { content: string }[] };
      const user = req.messages[0].content;
      if (req.tools[0].name === "record_incident_assessment") {
        const where = /INCIDENT LOCATION: (.+)/.exec(user)![1];
        return Response.json({ content: [{ type: "tool_use", name: "record_incident_assessment", input: { headline: `Strike on ${where}`, summary: `A strike is reported at ${where} [1].`, assessment: "A shift [1].", outlook: "Watch.", caveats: null } }] });
      }
      const item = ITEMS.find((it) => user.includes(`Headline: ${it.title}`) && user.includes(new URL(it.url).hostname));
      const full = item ? FULL[item.url] : undefined;
      if (!full) return new Response("no canned coding", { status: 500 });
      return Response.json({ content: [{ type: "tool_use", name: "record_article_coding", input: full.coding }] });
    }
    const full = FULL[url];
    if (full) return new Response(`<html><head><meta property="article:published_time" content="${iso(4)}"></head><body><article><p>${full.body.replace(/\. /g, ".</p><p>")}</p></article></body></html>`, { headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404 });
  });
});

afterAll(() => vi.unstubAllGlobals());

describe("headline first pass, with no AI available", () => {
  it("flags what the criteria support and nothing else — without calling a model or opening an article", async () => {
    await runEscalationPipeline(env);
    const incidents = await getFlaggedIncidents(env);
    expect(incidents.map((i) => `${i.level}:${i.countryCode}:${i.locationLabel}`).sort()).toEqual(["critical:CD:Ituri", "elevated:ET:Mekelle, Tigray", "elevated:NG:Barkin Ladi, Plateau", "elevated:NG:Zamfara", "elevated:SD:El Fasher, North Darfur"]);
    expect(aiCalls).toBe(0);
    expect(fetched.filter((u) => ITEMS.some((it) => it.url === u))).toEqual([]);
    expect(fetched.some((u) => u.includes("anthropic") || u.includes("nominatim"))).toBe(false);
  });

  it("gives every marker a quick summary, the rule that flagged it, and its sources — marked preliminary", async () => {
    const incidents = await getFlaggedIncidents(env);
    for (const i of incidents) {
      expect(i.preliminary).toBe(true);
      expect(i.analystWritten).toBe(false);
      expect(i.caveats).toMatch(/^Preliminary\./);
      expect(i.criteriaMet.length).toBeGreaterThan(0);
      expect(i.assessment).toMatch(/^Flagged (Elevated|Critical) because: /);
      expect(i.sources.every((s) => s.textBasis === "headline")).toBe(true);
      expect(i.summary).toMatch(/\[1\]/);
    }
    const mekelle = incidents.find((i) => i.countryCode === "ET")!;
    expect(mekelle.sources).toHaveLength(2);
    expect(mekelle.summary).toBe("2 outlets report air or drone strike in Mekelle, Tigray, Ethiopia. “Drone strike hits Mekelle market, officials say” [1]; “Tigray: air strike on Mekelle reported by residents” [2].");
    const plateau = incidents.find((i) => i.locationLabel?.startsWith("Barkin Ladi"))!;
    expect(plateau.fatalitiesMax).toBe(12);
    expect(plateau.headline).toBe("Gunmen kill 12 villagers in Barkin Ladi, Plateau");
    // Two sites carry it, but word for word: that is one source, and the level rests on the death toll.
    expect(plateau.criteriaMet.join(" ")).toMatch(/12 deaths reported/);
    expect(plateau.criteriaMet.join(" ")).not.toMatch(/2 (independent )?sources/);
    // One unread headline cannot make an incident Critical, whatever toll it states...
    const zamfara = incidents.find((i) => i.locationLabel === "Zamfara")!;
    expect(zamfara.level).toBe("elevated");
    expect(zamfara.criteriaMet.join(" ")).toMatch(/40 deaths reported by one source at low confidence/);
    // ...two independent outlets can. The figure is the one stated, not "dozens".
    const ituri = incidents.find((i) => i.level === "critical")!;
    expect(ituri.sources).toHaveLength(2);
    expect(ituri.fatalitiesMax).toBe(31);
    expect(ituri.criteriaMet.join(" ")).toMatch(/31 deaths reported in a single event/);
  });

  it("keeps a single uncorroborated report without a death toll on record, unflagged", async () => {
    const audit = await getAuditLog(env, { q: "Kidal" });
    expect(audit).toHaveLength(1);
    expect(audit[0].status).toBe("coded");
    expect(audit[0].reports[0].confidence).toBe("low");
    expect((await getFlaggedIncidents(env)).some((i) => i.countryCode === "ML")).toBe(false);
    // An aggregator's copy of a story is not a second outlet, even with a prefix on its headline.
    const dilling = await getAuditLog(env, { q: "Dilling" });
    expect(dilling.map((a) => a.status)).toEqual(["coded", "coded"]);
    expect((await getFlaggedIncidents(env)).some((i) => i.locationLabel?.includes("South Kordofan"))).toBe(false);
    // Old events are not put on record from their headlines, however serious.
    expect(await getAuditLog(env, { q: "Kaduna" })).toHaveLength(0);
    expect(await getAuditLog(env, { q: "Katsina" })).toHaveLength(0);
    // The warning was never stored: it is left for a full reading.
    expect(await getAuditLog(env, { q: "Maiduguri" })).toHaveLength(0);
  });

  it("raises one alert per marker, and a second tick changes nothing", async () => {
    const snapshot = () => JSON.stringify([db.prepare("SELECT id, level, title, resolved_at FROM alerts ORDER BY id").all(), db.prepare("SELECT id, level, updated_at FROM escalation_incidents ORDER BY id").all(), db.prepare("SELECT COUNT(*) AS n FROM escalation_reports").get()]);
    const alerts = db.prepare("SELECT level, title FROM alerts WHERE resolved_at IS NULL").all() as { level: string; title: string }[];
    expect(alerts).toHaveLength(5);
    expect(alerts.filter((a) => a.level === "critical")).toHaveLength(1);
    const before = snapshot();
    await runEscalationPipeline(env);
    expect(snapshot()).toBe(before);
    expect(aiCalls).toBe(0);
  });

  it("reports the first pass separately from articles read in full", async () => {
    const status = await getPipelineStatus(env);
    expect(status.headline24h).toBe(11);
    expect(status.last24h).toEqual([]);
  });
});

describe("headline first pass, once a model can read the articles", () => {
  it("replaces the first pass with the full reading: confirms one marker, takes down another, leaves the unread ones", async () => {
    const reading = { ...env, ANTHROPIC_API_KEY: "test-key", ESCALATION_ARTICLES_PER_TICK: "30" } as unknown as Env;
    await runEscalationPipeline(reading);
    const incidents = await getFlaggedIncidents(reading);
    expect(incidents.map((i) => `${i.level}:${i.countryCode}:${i.locationLabel}`).sort()).toEqual(["critical:CD:Ituri", "elevated:ET:Mekelle, Tigray", "elevated:NG:Zamfara", "elevated:SD:El Fasher, North Darfur"]);

    // Plateau: the article was a memorial. The marker is gone and its alert closed.
    const plateau = await getAuditLog(reading, { q: "Barkin Ladi" });
    expect(plateau.map((a) => a.status)).toEqual(["rejected", "rejected"]);
    expect(plateau.every((a) => a.reports.length === 0)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").get() as { n: number }).n).toBe(4);

    // Mekelle: one article read in full (nine deaths), the other could not be opened and keeps its headline reading.
    const mekelle = incidents.find((i) => i.countryCode === "ET")!;
    expect(mekelle.preliminary).toBe(false);
    expect(mekelle.analystWritten).toBe(true);
    expect(mekelle.fatalitiesMax).toBe(9);
    expect(mekelle.sources.map((s) => s.textBasis).sort()).toEqual(["full_text", "headline"]);
    expect(mekelle.caveats ?? "").not.toMatch(/Preliminary/);

    // El Fasher and Zamfara: their pages could not be opened, so the headline reading stands.
    const elFasher = incidents.find((i) => i.countryCode === "SD")!;
    expect(elFasher.preliminary).toBe(true);
    // ...and they are not fetched again on later ticks.
    fetched.length = 0;
    await runEscalationPipeline(reading);
    expect(fetched.filter((u) => ITEMS.some((it) => it.url === u))).toEqual([]);
  });
});

describe("headline first pass and articles already on record", () => {
  it("picks up an article whose full reading got nowhere, and never second-guesses one a model has decided on", async () => {
    const add = (slug: string, title: string) => {
      const url = `https://lake-chad-news.example/${slug}`;
      candidates.push({ id: slug, title, description: `${title}.`, textEn: null, link: url, published: iso(2), domain: "lake-chad-news.example", sourceCountry: "XX", priority: 5 });
      return url;
    };
    const stuck = add("stuck", "Gunmen kill eight fishermen near Baga, Borno");
    const unopened = add("unopened", "Suicide bomb blast kills six at Gwoza market, Borno");
    const decided = add("decided", "Gunmen kill nine farmers in Monguno, Borno");
    // The pipeline's own ids are a hash of the address; take them from a first tick, then put the rows in the state under test.
    await runEscalationPipeline(env);
    const idOf = (url: string) => (db.prepare("SELECT id FROM escalation_articles WHERE url = ?").get(url) as { id: string }).id;
    const set = db.prepare("UPDATE escalation_articles SET status = ?, rejection_reason = ?, model = ?, text_basis = NULL, attempts = 3 WHERE id = ?");
    for (const [url, status, reason, model] of [[stuck, "error", "model_unavailable", null], [unopened, "unreadable", "unreadable", null], [decided, "rejected", "retrospective", "some-model"]] as const) {
      db.prepare("DELETE FROM escalation_reports WHERE article_id = ?").run(idOf(url));
      set.run(status, reason, model, idOf(url));
    }

    await runEscalationPipeline(env);
    const row = (url: string) => db.prepare("SELECT status, model, attempts, report_count, rejection_reason FROM escalation_articles WHERE url = ?").get(url) as { status: string; model: string | null; attempts: number; report_count: number; rejection_reason: string | null };
    // No model answered: the headline is read, and a full reading is still wanted.
    expect(row(stuck)).toEqual({ status: "coded", model: "headline-rules", attempts: 0, report_count: 1, rejection_reason: null });
    // The page cannot be opened: the headline is read, and the page is not tried again.
    expect(row(unopened)).toEqual({ status: "coded", model: "headline-rules", attempts: 3, report_count: 1, rejection_reason: null });
    // A model read it and rejected it: left exactly as it was.
    expect(row(decided)).toEqual({ status: "rejected", model: "some-model", attempts: 3, report_count: 1, rejection_reason: "retrospective" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM escalation_reports WHERE article_id = ?").get(idOf(decided)) as { n: number }).n).toBe(0);
  });
});

describe("headline first pass after its rules are tightened", () => {
  it("withdraws codings the rules no longer support — pieces about an event rather than reports of one — and keeps the rest", async () => {
    // Two outlets' reaction pieces about fighting in Baidoa, on record as first-pass "clashes" under the earlier rules.
    const pieces = [
      { url: "https://horn-wire.example/britain-baidoa", title: "Britain urges restraint as fighting flares in Baidoa", description: "Britain expressed concern over renewed fighting in Baidoa, urging rival sides to exercise restraint." },
      { url: "https://juba-valley.example/families-baidoa", title: "Families face renewed violence amid worsening hunger crisis", description: "Children were killed and injured in fresh fighting in Baidoa, where families already face severe hunger." },
    ];
    for (const p of pieces) {
      const id = hashId(canonicalUrl(p.url));
      const domain = new URL(p.url).hostname;
      candidates.push({ id, title: p.title, description: p.description, textEn: null, link: p.url, published: iso(2), domain, sourceCountry: "XX", priority: 5 });
      db.prepare("INSERT INTO escalation_articles (id, url, domain, title, origin, published_at, text_basis, status, report_count, attempts, model, processed_at) VALUES (?,?,?,?, 'africa-wire', ?, 'headline', 'coded', 1, 0, 'headline-rules', ?)").run(id, p.url, domain, p.title, iso(2), iso(1));
      db.prepare(
        `INSERT INTO escalation_reports (id, article_id, incident_id, country_code, country_name, place, lat, lon, geo_precision, geo_method, geo_label, event_date, date_basis, indicators, trajectory, what_happened, confidence, created_at)
         VALUES (?, ?, NULL, 'SO', 'Somalia', 'Baidoa', 3.1167, 43.65, 'place', 'gazetteer', 'Baidoa', ?, 'publication', ?, 'unclear', ?, 'low', ?)`
      ).run(`r-${id}`, id, today, JSON.stringify([{ id: "armed_clash", label: "Armed clash", quote: p.description }]), p.title, iso(1));
    }
    const genuineBefore = (db.prepare("SELECT COUNT(*) AS n FROM escalation_articles WHERE model = 'headline-rules' AND url NOT LIKE '%baidoa%'").get() as { n: number }).n;
    expect(genuineBefore).toBeGreaterThan(3);

    resetHeadlinePass(); // as after a deployment
    await runEscalationPipeline(env);

    expect((db.prepare("SELECT COUNT(*) AS n FROM escalation_articles WHERE url LIKE '%baidoa%'").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM escalation_reports WHERE country_code = 'SO'").get() as { n: number }).n).toBe(0);
    expect((await getFlaggedIncidents(env)).some((i) => i.countryCode === "SO")).toBe(false);
    // Reports of actual events are untouched.
    expect((db.prepare("SELECT COUNT(*) AS n FROM escalation_articles WHERE model = 'headline-rules' AND url NOT LIKE '%baidoa%'").get() as { n: number }).n).toBe(genuineBefore);
  });
});
