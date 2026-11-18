import { beforeEach, describe, expect, it } from "vitest";
import { africaOf, analysisDiagnostics, bingQuery, classify, dateInUrl, isNotAnalysis, collectStrategicAnalyses, DOMAINS, domainSummary, ensureAnalysisTables, gnewsQueries, listAnalyses, pageMeta, parseSitemap, worthOpening, newAnalysesSince, parseFeed, resetAnalysisTables, sourceStatus, SOURCES, themesOf, type DomainId, type Source } from "../src/lib/strategicAnalysis";
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

  it("applies New Humanitarianism's Boolean rules: (group) AND (group), any term in a group", () => {
    const ids = (t: string) => themesOf("humanitarian", t).map((x) => x.id);
    // No listed phrase, but AID AND CUTS.
    expect(ids("Donors slash budgets: what shrinking grants mean for NGOs")).toContain("funding");
    expect(ids("Les bailleurs réduisent leurs financements")).toContain("funding");
    // SYSTEM AND REFORM.
    expect(ids("Can the UN system reinvent itself?")).toContain("reset");
    // LOCAL_ACTORS AND LOCAL_ISSUES.
    expect(ids("Grassroots groups want a seat at the table")).toContain("localisation");
    // NEW_ACTORS AND AID.
    expect(ids("How Türkiye became a major humanitarian donor in Somalia")).toContain("global-south");
    // ACCESS_SUBJECT AND ACCESS_OBSTACLES.
    expect(ids("Convoys blocked at checkpoints for weeks")).toContain("access");
    // WORKERS AND HARM; DISPLACED AND DISPLACEMENT_POLICY; FUTURE AND HUMANITARIANISM.
    expect(ids("Three volunteers abducted in North Kivu")).toContain("security");
    expect(ids("Refugee self-reliance and the right to work in Uganda")).toContain("displacement");
    expect(ids("The legitimacy crisis of humanitarianism")).toContain("future");
    // One group alone is not enough.
    expect(ids("Budget pressures at the ministry of sport")).not.toContain("funding");
  });

  it("keeps only analytical publications (NOT site pages, notices, vacancies, events, calls)", () => {
    const u = "https://x.org/publications/a-long-slug-for-the-piece";
    for (const title of ["About the GDHO", "About us", "Our team", "Publications", "Contact", "Call for proposals: research on localisation", "Vacancy: Senior Policy Adviser", "Webinar: the future of aid", "Press release: new board chair", "Annual report 2025", "Donate"]) expect(isNotAnalysis({ title, summary: "", url: u }), title).toBe(true);
    expect(isNotAnalysis({ title: "A real piece on aid", summary: "Anonymous (not verified) Wed, 07/22/2026 - 10:18", url: u })).toBe(true);
    expect(isNotAnalysis({ title: "Localisation after the cuts", summary: "", url: "https://x.org/about/localisation-after-the-cuts" })).toBe(true);
    for (const title of ["The reset, revisited", "Localisation after the cuts", "Who decides? Power and the humanitarian reset", "About time: why local NGOs must lead"]) expect(isNotAnalysis({ title, summary: "", url: u }), title).toBe(title.startsWith("About time"));
    expect(classify({ ...base, title: "About the GDHO", summary: "", source: src(["humanitarian"]) })).toEqual([]);
    // Spam injected into a hacked humanitarian site.
    const spam = { ...base, url: "https://somalingoconsortium.org/cv66-review-bangladeshi-guide-to-casino-bonuses-payments-and-withdrawals/", title: "Cv66 review: Bangladeshi guide to casino, bonuses, payments and withdrawals", summary: "", source: src(["humanitarian"]) };
    expect(isNotAnalysis(spam)).toBe(true);
    expect(classify(spam)).toEqual([]);
    expect(classify({ ...base, title: "Top ten tips for choosing a new laptop this year", summary: "", source: src(["humanitarian"]) })).toEqual([]);
  });

  it("asks Bing News when Google News returns nothing", () => {
    const g = "https://news.google.com/rss/search?q=" + encodeURIComponent("site:thenewhumanitarian.org when:1y") + "&hl=en-US";
    expect(bingQuery(g)).toBe("https://www.bing.com/news/search?q=site%3Athenewhumanitarian.org&format=rss&setlang=en");
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
    const [general] = classify({ ...base, title: "Notes from the field on relief", summary: "", source: hs });
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
    const lanes = { backfill: 0, gnews: 0, sitemaps: 0, enrich: 0, sections: 0 };
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
    const r = await collectStrategicAnalyses(env, { now, fetcher, discover, limit: 0, backfill: 5, gnews: 0, sitemaps: 0, enrich: 0, sections: 0 });
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
    const again = await collectStrategicAnalyses(env, { now, fetcher, discover, limit: 0, backfill: 5, gnews: 0, sitemaps: 0, enrich: 0, sections: 0 });
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

  it("reads sitemaps, picks the publications worth opening, and reads a page's title, summary and date", () => {
    const idx = `<sitemapindex><sitemap><loc>https://x.org/post-sitemap.xml</loc><lastmod>2026-11-01T00:00:00+00:00</lastmod></sitemap><sitemap><loc>https://x.org/category-sitemap.xml</loc></sitemap></sitemapindex>`;
    expect(parseSitemap(idx)).toMatchObject({ index: true, entries: [{ loc: "https://x.org/post-sitemap.xml", lastmod: "2026-11-01T00:00:00.000Z" }, { loc: "https://x.org/category-sitemap.xml", lastmod: null }] });
    const hs: Source = { name: "Hum", url: "https://alnap.example/", africa: false, kind: "international", domains: ["humanitarian"] };
    expect(worthOpening(hs, "https://alnap.example/publications/the-state-of-the-humanitarian-system-2026")).toBe(true);
    expect(worthOpening(hs, "https://alnap.example/tag/localisation")).toBe(false);
    expect(worthOpening(hs, "https://alnap.example/about")).toBe(false);
    expect(worthOpening(hs, "https://alnap.example/files/report-2026.pdf")).toBe(false);
    expect(worthOpening(hs, "https://other.example/publications/the-state-of-the-humanitarian-system")).toBe(false);
    // A broad international source: only slugs that already look like the domain (and Africa outside humanitarian).
    const broad: Source = { name: "Big", url: "https://big.example/", africa: false, kind: "international", domains: ["humanitarian", "conflict", "geopolitics"] };
    expect(worthOpening(broad, "https://big.example/research/aid-cuts-and-the-future-of-humanitarian-action")).toBe(true);
    expect(worthOpening(broad, "https://big.example/research/war-in-sudan-and-the-limits-of-mediation")).toBe(true);
    expect(worthOpening(broad, "https://big.example/research/war-in-ukraine-and-european-defence-spending")).toBe(false);
    expect(worthOpening(broad, "https://big.example/research/humanitarian-access-in-gaza-under-siege")).toBe(false);
    const html = `<html><head><title>Ignored | Site</title><meta property="og:title" content="Localisation after the cuts &amp; what comes next | ALNAP"><meta name="description" content="How local NGOs in Somalia are adapting."><meta property="article:published_time" content="2026-04-02T10:00:00Z"></head></html>`;
    expect(pageMeta(html)).toEqual({ title: "Localisation after the cuts & what comes next", summary: "How local NGOs in Somalia are adapting.", published: "2026-04-02T10:00:00.000Z" });
    expect(pageMeta(`<title>The reset, a year on</title><script type="application/ld+json">{"datePublished":"2026-01-05"}</script>`)).toMatchObject({ title: "The reset, a year on", published: "2026-01-05T00:00:00.000Z" });
  });

  it("finds a year of publications through a source's sitemap and opens them in batches", async () => {
    const { DB } = fakeD1();
    const env = { DB } as never;
    const now = new Date("2026-11-17T09:00:00Z");
    const alnap = SOURCES.find((s) => s.name === "ALNAP")!;
    const o = new URL(alnap.url).origin;
    const urls = Array.from({ length: 30 }, (_, i) => `${o}/publications/humanitarian-reflection-number-${i + 1}-on-aid`);
    const fetcher = async (u: string) => {
      if (u === `${o}/robots.txt`) return new Response(`User-agent: *\nSitemap: ${o}/sitemap_index.xml`);
      if (u === `${o}/sitemap_index.xml`) return new Response(`<sitemapindex><sitemap><loc>${o}/post-sitemap.xml</loc><lastmod>2026-11-10</lastmod></sitemap><sitemap><loc>${o}/author-sitemap.xml</loc></sitemap></sitemapindex>`);
      if (u === `${o}/post-sitemap.xml`) return new Response(`<urlset>${urls.map((x, i) => `<url><loc>${x}</loc><lastmod>2026-0${(i % 9) + 1}-15</lastmod></url>`).join("")}<url><loc>${o}/publications/whatever-it-takes-a-rapid-increase-in-aid</loc><lastmod>2026-11-10</lastmod></url><url><loc>${o}/publications/too-old-reflection-from-long-ago</loc><lastmod>2024-01-01</lastmod></url><url><loc>${o}/tag/aid</loc></url></urlset>`);
      const i = urls.indexOf(u);
      if (i >= 0) return new Response(`<title>Reflection ${i + 1} on the humanitarian system | ALNAP</title><meta name="description" content="Aid and localisation."><meta property="article:published_time" content="2026-0${(i % 9) + 1}-15T08:00:00Z">`);
      // A 2020 paper the sitemap says was "modified" this month, with no date of its own on the page.
      if (u === `${o}/publications/whatever-it-takes-a-rapid-increase-in-aid`) return new Response(`<title>Whatever It Takes: a rapid increase in aid amid the coronavirus pandemic</title>`);
      return new Response("", { status: 404 });
    };
    resetAnalysisTables();
    await ensureAnalysisTables(DB as never);
    for (const s of SOURCES) if (s !== alnap) await DB.prepare(`INSERT INTO strategic_sources (url, name, checked_at, backfilled_at, gnews_at, sitemap_at) VALUES (?,?,?,?,?,?)`).bind(s.url, s.name, now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString()).run();
    await DB.prepare(`UPDATE strategic_sources SET sitemap_at = NULL WHERE url = ?`).bind(alnap.url).run();
    await DB.prepare(`INSERT INTO strategic_sources (url, name, checked_at, backfilled_at, gnews_at) VALUES (?,?,?,?,?)`).bind(alnap.url, alnap.name, now.toISOString(), now.toISOString(), now.toISOString()).run();
    const lanes = { now, fetcher, discover: async () => ({ status: "no_feed" as const }), limit: 0, backfill: 0, gnews: 0, sections: 0 };
    await collectStrategicAnalyses(env, { ...lanes, sitemaps: 5, enrich: 0 });
    const pending = await DB.prepare(`SELECT COUNT(*) AS n FROM strategic_candidates WHERE status = 'pending'`).first<{ n: number }>();
    expect(pending?.n).toBe(31);
    await collectStrategicAnalyses(env, { ...lanes, sitemaps: 0, enrich: 25 });
    await collectStrategicAnalyses(env, { ...lanes, sitemaps: 0, enrich: 25 });
    // The undated 2020 paper is not stored under the sitemap's "last modified" date.
    expect((await listAnalyses(DB as never, "humanitarian", { days: 400 })).some((x) => x.title.startsWith("Whatever It Takes"))).toBe(false);
    const items = await listAnalyses(DB as never, "humanitarian", { days: 400 });
    expect(items).toHaveLength(30);
    expect(items[0].title).toMatch(/^Reflection \d+ on the humanitarian system$/);
    // Dated by the sitemap, so none of them alerts.
    expect(await newAnalysesSince(DB as never, "humanitarian", "2026-11-17T08:00:00Z")).toHaveLength(0);
    const [status] = (await sourceStatus(DB as never, "humanitarian")).filter((x) => x.name === "ALNAP");
    expect(status.backfill).toContain("31 publications from the past year");
    const diag = (await analysisDiagnostics(DB as never)) as { lastRun: { finishedAt: string | null; lanes: Record<string, number> }; pages: Record<string, number>; stored: Record<string, { inScope: number }> };
    expect(diag.lastRun.finishedAt).not.toBeNull();
    expect(diag.pages.done).toBe(30);
    expect(diag.pages.undated).toBe(1);
    expect(diag.stored.humanitarian.inScope).toBe(30);
  });

  it("finds the publication feeds a WordPress main feed leaves out (HPN), reads them every time and pages back a year", async () => {
    const { DB } = fakeD1();
    const env = { DB } as never;
    const now = new Date("2026-11-17T09:00:00Z");
    const hpn = SOURCES.find((s) => s.name === "Humanitarian Practice Network")!;
    const iss = SOURCES[0];
    const item = (t: string, u: string, d: string) => `<item><title>${t}</title><link>${u}</link><pubDate>${new Date(d).toUTCString()}</pubDate><description>Humanitarian analysis.</description></item>`;
    const rss = (...items: string[]) => `<rss><channel>${items.join("")}</channel></rss>`;
    const fetcher = async (u: string) => {
      if (u === hpn.url) return new Response(rss(item("HPN at the World Humanitarian Forum", "https://odihpn.org/news/forum", "2026-11-10")));
      if (u === "https://odihpn.org/en/publication/feed/") return new Response(rss(item("Aid suspension: who carries the burden?", "https://odihpn.org/en/publication/aid-suspension-who-carries-the-burden/", "2026-11-12")));
      if (u === "https://odihpn.org/en/publication/feed/?paged=2") return new Response(rss(item("Designed to exclude: what pooled funds reveal about localisation in practice", "https://odihpn.org/en/publication/designed-to-exclude/", "2026-08-27")));
      // A section found by probing a broad source.
      if (u === "https://issafrica.org/feed/?post_type=research") return new Response(rss(item("Funding cuts and the humanitarian reset in the Horn of Africa", "https://issafrica.org/research/cuts-horn", "2026-10-01")));
      return new Response("", { status: 404 });
    };
    resetAnalysisTables();
    await ensureAnalysisTables(DB as never);
    for (const s of SOURCES) await DB.prepare(`INSERT INTO strategic_sources (url, name, checked_at, backfilled_at, gnews_at, sitemap_at, sections_at) VALUES (?,?,?,?,?,?,?)`).bind(s.url, s.name, now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString(), s === hpn || s === iss ? null : now.toISOString()).run();
    await DB.prepare(`UPDATE strategic_sources SET feed_url = url WHERE url = ?`).bind(hpn.url).run();
    const base2 = { now, fetcher, discover: async (u: string) => ({ status: "ok" as const, feedUrl: u }), limit: 0, backfill: 0, gnews: 0, sitemaps: 0, enrich: 0 };
    await collectStrategicAnalyses(env, { ...base2, sections: 5 });
    const titles = (await listAnalyses(DB as never, "humanitarian", { days: 400 })).map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(["Aid suspension: who carries the burden?", "Designed to exclude: what pooled funds reveal about localisation in practice", "Funding cuts and the humanitarian reset in the Horn of Africa"]));
    const issState = await DB.prepare(`SELECT extra_feeds FROM strategic_sources WHERE url = ?`).bind(iss.url).first<{ extra_feeds: string }>();
    expect(JSON.parse(issState!.extra_feeds)).toEqual(["https://issafrica.org/feed/?post_type=research"]);
    // On the next hourly read, the section feed is read alongside the main feed.
    await DB.prepare(`DELETE FROM strategic_analyses`).run();
    await DB.prepare(`UPDATE strategic_sources SET checked_at = NULL WHERE url = ?`).bind(hpn.url).run();
    await collectStrategicAnalyses(env, { ...base2, limit: 1, sections: 0 });
    expect((await listAnalyses(DB as never, "humanitarian", { days: 400 })).map((i) => i.title)).toContain("Aid suspension: who carries the burden?");
  });

  it("catches spam however it is worded, and treats a source serving it as compromised", () => {
    const sc = src(["humanitarian"]);
    for (const title of ["BDBajee online overview and options – bonuses, payments & mobile experience", "Krikya app download: login guide, deposits and withdrawals", "Jeetbuzz review for Bangladeshi players: bonuses and payment methods"]) {
      expect(isNotAnalysis({ title, summary: "", url: "https://somalingoconsortium.org/x-y-z" }), title).toBe(true);
    }
    // Real humanitarian writing about cash payments is not spam.
    expect(isNotAnalysis({ title: "Cash payments and withdrawals for refugees in Dadaab", summary: "", url: "https://x.org/a-b-c" })).toBe(false);
    // Compromised: an off-topic page with one stray humanitarian word no longer gets in on the source's name.
    const stray = { ...base, title: "Customer assistance and features of our new platform", summary: "", source: sc };
    expect(classify(stray).length).toBe(1);
    expect(classify({ ...stray, strict: true })).toEqual([]);
    expect(classify({ ...base, title: "Aid cuts leave Somali NGOs without funding", summary: "", source: sc, strict: true }).map((x) => x.domain)).toEqual(["humanitarian"]);
  });

  it("drops events, courses, calls and recruitment wherever the words sit in the title", () => {
    const u = "https://www.humanitarianleadershipacademy.org/resources/x-y-z/";
    for (const title of ["NetHope Connected: HLA applicant information session - November 2026", "Localisation in practice: a free online course for national NGOs", "Webinar recording: the future of aid financing", "Join us for a panel discussion on the humanitarian reset", "Fellowship programme for African humanitarian leaders now open", "Monthly newsletter: aid cuts and localisation"]) {
      expect(isNotAnalysis({ title, summary: "", url: u }), title).toBe(true);
    }
    for (const title of ["What the AU summit means for humanitarian access in Sudan", "Who carries the burden of aid suspension?", "Training local responders is not localisation: why power must shift", "Asylum applicants in Libya face new risks", "The reset agenda one year on", "Recording atrocities in El Fasher"]) {
      expect(isNotAnalysis({ title, summary: "", url: "https://x.org/a-b-c" }), title).toBe(false);
    }
    // Event-heavy sources pass the keyword test instead of being kept wholesale.
    const hla = SOURCES.find((x) => x.name === "Humanitarian Leadership Academy")!;
    expect(hla.strictIntake).toBe(true);
    expect(classify({ ...base, title: "Meet the new members of our global community", summary: "", source: hla })).toEqual([]);
    expect(classify({ ...base, title: "Localisation and the funding cuts: what local leaders told us", summary: "", source: hla }).map((x) => x.domain)).toEqual(["humanitarian"]);
  });

  it("reads publication dates from addresses", () => {
    expect(dateInUrl("https://x.org/2020/04/15/whatever-it-takes")).toBe("2020-04-15T00:00:00.000Z");
    expect(dateInUrl("https://x.org/blog/2025-11-a-piece")).toBe("2025-11-01T00:00:00.000Z");
    expect(dateInUrl("https://x.org/resources/whatever-it-takes-620982/")).toBeNull();
  });

  it("drops navigation and site-name pages", () => {
    const hs = src(["humanitarian"]);
    for (const title of ["Posts pagination", "Page 3 of 125", "Read more", "Submit an Article", "All Publications"]) expect(isNotAnalysis({ title, summary: "", url: "https://x.org/a/b-c-d" }), title).toBe(true);
    expect(classify({ ...base, title: "Think tank", summary: "humanitarian", source: { ...hs, name: "Think tank" } })).toEqual([]);
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
