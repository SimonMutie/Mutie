import { beforeEach, describe, expect, it } from "vitest";
import { africaOf, classify, collectStrategicAnalyses, DOMAINS, domainSummary, ensureAnalysisTables, listAnalyses, newAnalysesSince, parseFeed, resetAnalysisTables, SOURCES, themesOf, type DomainId, type Source } from "../src/lib/strategicAnalysis";
import { buildAnalysesNotification } from "../src/lib/alertDelivery";
import { fakeD1 } from "./fakeD1";

const src = (domains: DomainId[], africa = false): Source => ({ name: "Think tank", url: "https://t.example/feed", africa, domains });
const ALL = DOMAINS.map((d) => d.id);
const at = "2026-11-17T08:00:00.000Z";
const base = { url: "https://x/1", published: at, summary: "" };
const domainsOf = (title: string, source: Source, summary = "") => classify({ ...base, title, summary, source }).map((i) => i.domain);

describe("the domains and their taxonomies", () => {
  it("has the seven domains, every source writes on at least one, and no source is listed twice", () => {
    expect(ALL).toEqual(["humanitarian", "geopolitics", "elections", "economy", "trade", "cyber", "conflict"]);
    expect(SOURCES.every((s) => s.domains.length > 0)).toBe(true);
    expect(new Set(SOURCES.map((s) => s.url)).size).toBe(SOURCES.length);
    for (const d of DOMAINS) expect(SOURCES.filter((s) => s.domains.includes(d.id)).length).toBeGreaterThanOrEqual(8);
  });

  it("finds the themes a piece touches within a domain", () => {
    expect(themesOf("humanitarian", "After the USAID funding cuts, is the humanitarian reset enough to shift power to local actors?").map((x) => x.id)).toEqual(expect.arrayContaining(["funding", "reset", "localisation"]));
    expect(themesOf("elections", "Electoral commission under fire over voter registration before the presidential election").map((x) => x.id)).toEqual(expect.arrayContaining(["integrity", "contests"]));
    expect(themesOf("trade", "What AGOA's lapse and new US tariffs mean for the AfCFTA").map((x) => x.id)).toEqual(expect.arrayContaining(["partners", "afcfta"]));
    expect(themesOf("cyber", "Ransomware attack hits Kenya's government systems").map((x) => x.id)).toEqual(expect.arrayContaining(["threats", "infrastructure"]));
  });

  it("places a piece in the right domains, Africa only, and needs two signals from a broad source", () => {
    expect(domainsOf("Al-Shabaab offensive and the ceasefire talks in Somalia", src(ALL, true))).toEqual(["conflict"]);
    expect(domainsOf("Kenya's debt distress deepens as the IMF programme stalls and the shilling slides", src(ALL))).toContain("economy");
    expect(domainsOf("China and Russia compete for influence through the African Union", src(ALL))).toContain("geopolitics");
    expect(domainsOf("Ransomware attack hits Kenya's government systems", src(ALL))).toContain("cyber");
    // Not about Africa: dropped outside New Humanitarianism's system-level themes.
    expect(domainsOf("Ransomware attack hits Germany's government systems", src(ALL))).toEqual([]);
    expect(domainsOf("What the humanitarian reset means for the aid system", src(ALL))).toEqual(["humanitarian"]);
    // A single loose hit from a broad source does not count; from a specialist source it does.
    expect(domainsOf("Nigeria's opposition regroups", src(ALL, true))).toEqual([]);
    expect(domainsOf("Nigeria's opposition regroups", src(["elections"], true))).toEqual(["elections"]);
    // Only the domains the source writes on.
    expect(domainsOf("Al-Shabaab offensive and the ceasefire talks in Somalia", src(["trade"], true))).toEqual([]);
  });

  it("tells which African countries a piece discusses, and keeps the Middle East out", () => {
    expect(africaOf("Aid cuts in South Sudan and Sudan, with Sudanese refugees in Chad")).toEqual({ africa: true, countries: expect.arrayContaining(["SS", "SD", "TD"]) });
    expect(africaOf("Funding cuts hit Syria and Yemen")).toEqual({ africa: false, countries: [] });
  });
});

describe("reading feeds", () => {
  it("reads RSS and Atom", () => {
    const rss = `<rss><channel><item><title><![CDATA[Localisation after the cuts]]></title><link>https://x/a</link><pubDate>Mon, 17 Nov 2026 08:00:00 GMT</pubDate><description>&lt;p&gt;Local NGOs in Somalia&lt;/p&gt;</description></item></channel></rss>`;
    const atom = `<feed><entry><title>The reset, a year on</title><link rel="alternate" href="https://y/b"/><published>2026-11-16T10:00:00Z</published><summary>Humanitarian system reform</summary></entry></feed>`;
    expect(parseFeed(rss)).toEqual([{ title: "Localisation after the cuts", url: "https://x/a", published: at, summary: "Local NGOs in Somalia" }]);
    expect(parseFeed(atom)[0]).toMatchObject({ title: "The reset, a year on", url: "https://y/b" });
  });
});

describe("collecting and alerting", () => {
  beforeEach(() => resetAnalysisTables());

  it("collects new pieces per domain once, in batches, and finds what is new for alerts", async () => {
    const { DB } = fakeD1();
    const env = { DB } as never;
    const feed = `<rss><channel>
      <item><title>Funding cuts and the future of humanitarian action in Sudan</title><link>https://t/1</link><pubDate>Mon, 17 Nov 2026 07:00:00 GMT</pubDate><description>Aid agencies scale back.</description></item>
      <item><title>Coup leaders postpone the presidential election in Mali as jihadist attacks escalate</title><link>https://t/3</link><pubDate>Mon, 17 Nov 2026 07:00:00 GMT</pubDate><description>The junta cites insurgency.</description></item>
      <item><title>Football results</title><link>https://t/2</link><pubDate>Mon, 17 Nov 2026 07:00:00 GMT</pubDate><description>Scores.</description></item>
    </channel></rss>`;
    const ok = SOURCES[0].url; // ISS Africa: every domain
    const discover = async (u: string) => (u === ok ? { status: "ok" as const, feedUrl: "https://feed/ok" } : { status: "no_feed" as const });
    const fetcher = async () => new Response(feed);
    const now = new Date("2026-11-17T09:00:00Z");
    const r1 = await collectStrategicAnalyses(env, { now, fetcher, discover, limit: 5 });
    expect(r1.sources).toBe(5);
    expect(r1.added).toBeGreaterThanOrEqual(3);
    // The next run reads the next batch, not the same sources again.
    const r2 = await collectStrategicAnalyses(env, { now, fetcher, discover, limit: 5 });
    expect(r2).toMatchObject({ ran: true, added: 0, sources: 5 });

    expect((await listAnalyses(DB as never, "humanitarian", { days: 3650 })).map((i) => i.url)).toEqual(["https://t/1"]);
    const election = (await listAnalyses(DB as never, "elections", { days: 3650 }))[0];
    expect(election).toMatchObject({ url: "https://t/3", countries: ["ML"] });
    expect((await listAnalyses(DB as never, "conflict", { days: 3650 })).map((i) => i.url)).toContain("https://t/3");
    expect((await domainSummary(DB as never)).conflict.recent).toBeGreaterThan(0);

    expect(await newAnalysesSince(DB as never, "elections", "2026-11-17T08:59:00Z")).toHaveLength(1);
    expect(await newAnalysesSince(DB as never, "elections", "2026-11-17T09:00:00Z")).toHaveLength(0);
    const msg = buildAnalysesNotification("elections", [election]);
    expect(msg.subject).toContain("New Elections analysis");
    expect(msg.sections[0].links[0].url).toBe("https://t/3");
  });

  it("moves the first version's humanitarian pieces into New Humanitarianism", async () => {
    const { DB } = fakeD1();
    await DB.prepare(`CREATE TABLE hum_analyses (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, source TEXT NOT NULL, published TEXT NOT NULL, themes TEXT NOT NULL, countries TEXT NOT NULL, africa INTEGER NOT NULL, in_scope INTEGER NOT NULL, score INTEGER NOT NULL, first_seen TEXT NOT NULL)`).run();
    await DB.prepare(`INSERT INTO hum_analyses VALUES ('h1','https://old/1','Old piece','', 'TNH', ?, '["funding"]', '["SD"]', 1, 1, 3, ?)`).bind(new Date().toISOString(), new Date().toISOString()).run();
    await ensureAnalysisTables(DB as never);
    expect((await listAnalyses(DB as never, "humanitarian")).map((i) => i.url)).toEqual(["https://old/1"]);
    expect(await DB.prepare(`SELECT name FROM sqlite_master WHERE name = 'hum_analyses'`).first()).toBeNull();
  });
});
