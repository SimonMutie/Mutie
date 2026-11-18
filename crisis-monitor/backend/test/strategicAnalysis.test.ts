import { beforeEach, describe, expect, it } from "vitest";
import { africaOf, classify, collectStrategicAnalyses, DOMAINS, domainSummary, ensureAnalysisTables, gnewsQueries, listAnalyses, newAnalysesSince, parseFeed, resetAnalysisTables, SOURCES, themesOf, type DomainId, type Source } from "../src/lib/strategicAnalysis";
import { buildAnalysesNotification } from "../src/lib/alertDelivery";
import { fakeD1 } from "./fakeD1";

const src = (domains: DomainId[], africa = false): Source => ({ name: "Think tank", url: "https://t.example/feed", africa, kind: "international", domains });
const ALL = DOMAINS.map((d) => d.id);
const at = "2026-11-17T08:00:00.000Z";
const base = { url: "https://x/1", published: at, summary: "" };
const domainsOf = (title: string, source: Source, summary = "") => classify({ ...base, title, summary, source }).map((i) => i.domain);

describe("the domains and their taxonomies", () => {
  it("has the seven domains, every source writes on at least one, and no source is listed twice", () => {
    expect(ALL).toEqual(["humanitarian", "geopolitics", "elections", "economy", "trade", "cyber", "conflict"]);
    expect(SOURCES.every((s) => s.domains.length > 0)).toBe(true);
    expect(new Set(SOURCES.map((s) => s.url)).size).toBe(SOURCES.length);
    for (const d of DOMAINS) expect(SOURCES.filter((s) => s.domains.includes(d.id)).length).toBeGreaterThanOrEqual(20);
    expect(SOURCES.filter((s) => s.kind === "african").length).toBeGreaterThanOrEqual(90);
    expect(SOURCES.filter((s) => s.kind === "analyst").length).toBeGreaterThanOrEqual(15);
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

  it("tells which African countries, places, regions and blocs a piece discusses, and keeps the Middle East out", () => {
    expect(africaOf("Aid cuts in South Sudan and Sudan, with Sudanese refugees in Chad")).toMatchObject({ africa: true, countries: expect.arrayContaining(["SS", "SD", "TD"]) });
    expect(africaOf("Funding cuts hit Syria and Yemen")).toMatchObject({ africa: false, countries: [] });
    const w = africaOf("RSF drones strike El Fasher as the African Union and IGAD push for talks");
    expect(w).toMatchObject({ africa: true, countries: ["SD"], places: expect.arrayContaining(["El Fasher"]), regions: ["Horn of Africa"], blocs: expect.arrayContaining(["AU", "IGAD"]) });
    expect(africaOf("La CEDEAO face aux juntes du Sahel").regions).toEqual(expect.arrayContaining(["Sahel"]));
    expect(africaOf("L'Alliance des États du Sahel quitte la CEDEAO").blocs).toEqual(expect.arrayContaining(["AES", "ECOWAS"]));
  });

  it("reads French and Portuguese, and ignores accents and hyphens", () => {
    expect(domainsOf("Présidentielle en Côte d'Ivoire : la CENI et la fraude électorale au cœur du scrutin", src(ALL))).toContain("elections");
    expect(domainsOf("Sahel : le JNIM étend ses attaques djihadistes vers les pays côtiers", src(ALL))).toContain("conflict");
    expect(domainsOf("Dette souveraine : le Sénégal face au FMI et à l'inflation", src(ALL))).toContain("economy");
    expect(domainsOf("Moçambique: insurgência em Cabo Delgado e a guerra", src(ALL))).toContain("conflict");
    expect(themesOf("conflict", "Farmer-herder clashes in Benue")).toEqual(expect.arrayContaining([expect.objectContaining({ id: "communal" })]));
  });

  it("does not count a crisis mention alone as new-humanitarianism analysis from a broad source", () => {
    expect(domainsOf("Aid convoys reach Darfur", src(ALL))).toEqual([]);
    expect(domainsOf("Aid cuts leave local NGOs in Darfur without funding", src(ALL))).toEqual(["humanitarian"]);
  });

  it("takes everything a humanitarian specialist publishes, and keeps general reflections in scope", () => {
    const hs = src(["humanitarian"]);
    // No humanitarian keyword in the title: kept, tagged with the general theme.
    const [piece] = classify({ ...base, title: "The reset is dead, long live the reset?", summary: "", source: hs });
    expect(piece).toMatchObject({ domain: "humanitarian", inScope: true });
    const [general] = classify({ ...base, title: "Notes from the field", summary: "", source: hs });
    expect(general.themes).toEqual(["general"]);
    // A general reflection tied to no place, from a broad source: in scope.
    expect(classify({ ...base, title: "Rethinking risk sharing between aid donors and local partners", summary: "", source: src(ALL) })[0]).toMatchObject({ inScope: true });
    // About a crisis elsewhere only: stored, but out of scope (shown under "Everything").
    expect(classify({ ...base, title: "Humanitarian access in Gaza under siege", summary: "", source: hs })[0]).toMatchObject({ inScope: false });
    expect(classify({ ...base, title: "Humanitarian access in Gaza and Sudan", summary: "", source: hs })[0]).toMatchObject({ inScope: true });
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
    const lanes = { backfill: 0, gnews: 0 };
    const r1 = await collectStrategicAnalyses(env, { now, fetcher, discover, limit: 5, ...lanes });
    expect(r1.sources).toBe(5);
    expect(r1.added).toBeGreaterThanOrEqual(3);
    // The next run reads the next batch, not the same sources again.
    const r2 = await collectStrategicAnalyses(env, { now, fetcher, discover, limit: 5, ...lanes });
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

  it("backfills a year from older feed pages, a Substack archive and Google News, without alerting on old pieces", async () => {
    const { DB } = fakeD1();
    const env = { DB } as never;
    const now = new Date("2026-11-17T09:00:00Z");
    const item = (t: string, u: string, d: string) => `<item><title>${t}</title><link>${u}</link><pubDate>${new Date(d).toUTCString()}</pubDate><description>Humanitarian aid analysis.</description></item>`;
    const rss = (...items: string[]) => `<rss><channel>${items.join("")}</channel></rss>`;
    const tnh = SOURCES.find((s) => s.name === "The New Humanitarian")!;
    const sub = SOURCES.find((s) => s.url.includes("kenopalo.substack.com"))!;
    const calls: string[] = [];
    const fetcher = async (u: string) => {
      calls.push(u);
      if (u.startsWith("https://news.google.com/")) return new Response(rss(item("Localisation in Somalia after the cuts - The New Humanitarian", "https://news.google.com/rss/articles/x", "2026-03-01")));
      if (u === tnh.url) return new Response(rss(item("Aid cuts bite in Sudan", "https://tnh/1", "2026-11-16")));
      if (u === `${tnh.url}?paged=2`) return new Response(rss(item("The humanitarian reset, six months on", "https://tnh/2", "2026-05-01")));
      if (u === `${tnh.url}?paged=3`) return new Response("", { status: 404 });
      if (u.startsWith("https://kenopalo.substack.com/api/v1/archive")) {
        return new Response(u.includes("offset=0") ? JSON.stringify([{ title: "Why Africa needs to rethink aid dependency", canonical_url: "https://kenopalo.substack.com/p/aid", post_date: "2026-02-10T00:00:00Z", subtitle: "Aid cuts, sovereign debt and the IMF programme in Kenya" }]) : "[]");
      }
      if (u === sub.url) return new Response(rss(item("Kenya's debt and the IMF", "https://kenopalo.substack.com/p/debt", "2026-11-15")));
      return new Response("", { status: 404 });
    };
    const discover = async (u: string) => ({ status: "ok" as const, feedUrl: u });
    // Backfill exactly these two sources.
    await DB.prepare(`SELECT 1`).run();
    resetAnalysisTables();
    await ensureAnalysisTables(DB as never);
    for (const s of SOURCES) if (s !== tnh && s !== sub) await DB.prepare(`INSERT INTO strategic_sources (url, name, checked_at, backfilled_at, gnews_at) VALUES (?,?,?,?,?)`).bind(s.url, s.name, now.toISOString(), now.toISOString(), now.toISOString()).run();
    const r = await collectStrategicAnalyses(env, { now, fetcher, discover, limit: 0, backfill: 5, gnews: 0 });
    expect(r.backfilled).toBe(2);
    const hum = await listAnalyses(DB as never, "humanitarian", { days: 400 });
    expect(hum.map((i) => i.title).sort()).toEqual(["Aid cuts bite in Sudan", "Localisation in Somalia after the cuts", "The humanitarian reset, six months on"].sort());
    expect((await listAnalyses(DB as never, "economy", { days: 400 })).map((i) => i.title)).toContain("Why Africa needs to rethink aid dependency");
    // Backfilled pieces are dated by publication, so only a genuinely recent one could alert.
    const old = hum.find((i) => i.title.startsWith("The humanitarian reset"))!;
    expect(old.firstSeen).toBe(old.published);
    expect((await newAnalysesSince(DB as never, "humanitarian", "2026-11-17T08:00:00Z")).map((i) => i.title)).toEqual(["Aid cuts bite in Sudan"]);
    // Google News: searched once per domain for broad sources, once for the whole site for specialists.
    expect(calls.filter((u) => u.startsWith("https://news.google.com/") && u.includes("thenewhumanitarian.org")).length).toBe(1);
    // Not backfilled twice.
    const again = await collectStrategicAnalyses(env, { now, fetcher, discover, limit: 0, backfill: 5, gnews: 0 });
    expect(again.backfilled).toBe(0);
  });

  it("builds Google News searches per domain for broad sources", () => {
    const iss = SOURCES.find((s) => s.name.startsWith("Institute for Security Studies"))!;
    expect(gnewsQueries(iss, "1y")).toHaveLength(iss.domains.length);
    expect(decodeURIComponent(gnewsQueries(iss, "1y")[0])).toContain("site:issafrica.org");
    const chatham = SOURCES.find((s) => s.name === "Chatham House")!;
    const q = gnewsQueries(chatham, "3d").map(decodeURIComponent);
    expect(q.find((x) => x.includes("humanitarian"))).not.toContain("(Africa OR African OR Afrique)");
    expect(q.find((x) => x.includes("election"))).toContain("(Africa OR African OR Afrique)");
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
