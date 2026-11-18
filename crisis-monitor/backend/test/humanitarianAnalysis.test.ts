import { beforeEach, describe, expect, it } from "vitest";
import { africaOf, classify, collectHumanitarianAnalyses, HUM_SOURCES, listHumanitarianAnalyses, newHumanitarianSince, parseFeed, resetHumTables, themesOf } from "../src/lib/humanitarianAnalysis";
import { buildHumanitarianNotification } from "../src/lib/alertDelivery";
import { fakeD1 } from "./fakeD1";

const global = { name: "Global think tank", url: "https://g.example/feed", africa: false };
const african = { name: "African think tank", url: "https://a.example/feed", africa: true };
const at = "2026-11-17T08:00:00.000Z";

describe("the humanitarian taxonomy", () => {
  it("finds the themes a piece is about", () => {
    const t = themesOf("After the USAID funding cuts, is the humanitarian reset enough to shift power to local actors?").map((x) => x.id);
    expect(t).toEqual(expect.arrayContaining(["funding", "reset", "localisation"]));
    expect(themesOf("Gulf donors and Turkish aid are reshaping humanitarian financing in the Horn").map((x) => x.id)).toContain("global-south");
    expect(themesOf("Negotiating humanitarian access with armed groups in Darfur").map((x) => x.id)).toContain("access");
  });

  it("tells which African countries a piece discusses, and keeps the Middle East out", () => {
    expect(africaOf("Aid cuts in South Sudan and Sudan, with Sudanese refugees in Chad")).toEqual({ africa: true, countries: expect.arrayContaining(["SS", "SD", "TD"]) });
    expect(africaOf("Localisation lessons from the Sahel").africa).toBe(true);
    expect(africaOf("Funding cuts hit Syria and Yemen")).toEqual({ africa: false, countries: [] });
  });

  it("keeps Africa pieces and system-level reflections, and drops the rest", () => {
    const base = { url: "https://x/1", published: at, summary: "" };
    // System-level: kept even without Africa.
    expect(classify({ ...base, title: "What the humanitarian reset means for the aid system", source: global })?.inScope).toBe(true);
    // Access in a non-African country, from a global source: not this panel's focus.
    expect(classify({ ...base, title: "Humanitarian access constraints in Myanmar", source: global })).toBeNull();
    // The same from an African source, or about Africa: kept.
    expect(classify({ ...base, title: "Humanitarian access constraints in Ethiopia's Amhara", source: global })?.countries).toEqual(["ET"]);
    // Not about humanitarian action at all.
    expect(classify({ ...base, title: "Kenya's central bank holds rates", source: african })).toBeNull();
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
  beforeEach(() => resetHumTables());

  it("collects new pieces once, reports failing sources, and finds what is new for alerts", async () => {
    const { DB } = fakeD1();
    const env = { DB } as never;
    const feed = `<rss><channel>
      <item><title>Funding cuts and the future of humanitarian action in Sudan</title><link>https://t/1</link><pubDate>Mon, 17 Nov 2026 07:00:00 GMT</pubDate><description>Aid agencies scale back.</description></item>
      <item><title>Football results</title><link>https://t/2</link><pubDate>Mon, 17 Nov 2026 07:00:00 GMT</pubDate><description>Scores.</description></item>
    </channel></rss>`;
    const ok = HUM_SOURCES[0].url;
    const discover = async (u: string) => (u === ok ? { status: "ok" as const, feedUrl: "https://feed/ok" } : { status: "no_feed" as const });
    const fetcher = async () => new Response(feed);
    const now = new Date("2026-11-17T09:00:00Z");
    const r1 = await collectHumanitarianAnalyses(env, { force: true, now, fetcher, discover });
    expect(r1.added).toBe(1);
    const r2 = await collectHumanitarianAnalyses(env, { force: true, now, fetcher, discover });
    expect(r2.added).toBe(0);
    const items = await listHumanitarianAnalyses(DB as never, { days: 3650 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ countries: ["SD"], africa: true });
    expect(items[0].lat).not.toBeNull();
    expect(await newHumanitarianSince(DB as never, "2026-11-17T08:59:00Z")).toHaveLength(1);
    expect(await newHumanitarianSince(DB as never, "2026-11-17T09:00:00Z")).toHaveLength(0);
    const msg = buildHumanitarianNotification(items);
    expect(msg.subject).toContain("New humanitarian analysis");
    expect(msg.sections[0].links[0].url).toBe("https://t/1");
  });
});
