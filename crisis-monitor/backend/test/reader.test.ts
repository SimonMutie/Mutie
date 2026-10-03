import { describe, it, expect } from "vitest";
import { extractArticle, normalizeForMatch, quoteAppearsIn } from "../src/lib/articleReader";
import { isGeocodeContradictedBySlug } from "../src/lib/gdeltGeoSanity";
import { isCandidateText } from "../src/lib/escalationKeywords";

const body = "Federal forces carried out a drone strike on the outskirts of Mekelle on Tuesday, killing at least seven people, regional officials said. ".repeat(4);

describe("article extraction", () => {
  it("prefers the article body and ignores navigation", () => {
    const html = `<html><head><title>Site</title><meta property="og:title" content="Drone strike hits Mekelle"><meta property="article:published_time" content="2026-10-02T08:00:00Z"></head>
      <body><nav><p>Home News Sport Business and a very long menu entry that is not the article at all</p></nav>
      <article><h2>Drone strike hits Mekelle outskirts</h2><p>${body}</p><p>Short.</p></article>
      <footer><p>Copyright notice and other things that are certainly long enough to be a paragraph.</p></footer></body></html>`;
    const a = extractArticle(html)!;
    expect(a.title).toBe("Drone strike hits Mekelle");
    expect(a.publishedAt).toBe("2026-10-02T08:00:00.000Z");
    expect(a.text).toContain("drone strike on the outskirts of Mekelle");
    expect(a.text).not.toContain("very long menu entry");
    expect(a.text).not.toContain("Copyright notice");
  });
  it("uses JSON-LD articleBody when present", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "NewsArticle", headline: "H", datePublished: "2026-10-01T10:00:00Z", articleBody: body }] })}</script></head><body><div>app shell</div></body></html>`;
    const a = extractArticle(html)!;
    expect(a.text).toContain("regional officials said");
    expect(a.publishedAt).toBe("2026-10-01T10:00:00.000Z");
  });
  it("treats a page with no real body as unreadable", () => {
    expect(extractArticle("<html><body><p>Subscribe to continue reading.</p></body></html>")).toBeNull();
  });
});

describe("quote verification", () => {
  const text = normalizeForMatch("Les Forces armées maliennes ont mené des frappes aériennes près de Kidal, selon l’état-major. Seven people were killed, “officials said”.");
  it("accepts verbatim quotes regardless of punctuation, case and accents", () => {
    expect(quoteAppearsIn("ont mené des frappes aériennes près de Kidal", text)).toBe(true);
    expect(quoteAppearsIn("Seven people were killed, \"officials said\"", text)).toBe(true);
    expect(quoteAppearsIn("ont mené des frappes ... selon l'état-major", text)).toBe(true);
  });
  it("rejects invented or too-short quotes", () => {
    expect(quoteAppearsIn("troops shelled the central market in Kidal", text)).toBe(false);
    expect(quoteAppearsIn("Kidal", text)).toBe(false);
    expect(quoteAppearsIn(null, text)).toBe(false);
  });
});

describe("raw GDELT layer sanity filter", () => {
  it("drops the reported mis-geolocations", () => {
    expect(isGeocodeContradictedBySlug("Riyadh, Ar Riyad, Saudi Arabia", "https://example.com/news/2026/10/houthi-forces-shell-taiz-yemen-frontline")).toBe(true);
    expect(isGeocodeContradictedBySlug("Riyadh, Ar Riyad, Saudi Arabia", "https://example.com/saudi-arabia-backed-forces-clash-in-taiz")).toBe(true);
    expect(isGeocodeContradictedBySlug("Djibouti, Djibouti (general), Djibouti", "https://example.com/ethiopia-drone-strike-near-mekelle-tigray")).toBe(true);
    expect(isGeocodeContradictedBySlug("Bamako, Bamako, Mali", "https://example.com/somaliland-forces-clash-in-las-anod")).toBe(true);
    expect(isGeocodeContradictedBySlug("Pretoria, Gauteng, South Africa", "https://example.com/ghana-parliament-passes-budget")).toBe(true);
  });
  it("keeps points that are consistent or that say nothing about location", () => {
    expect(isGeocodeContradictedBySlug("Mekele, Tigray, Ethiopia", "https://example.com/ethiopia-drone-strike-near-mekelle-tigray")).toBe(false);
    expect(isGeocodeContradictedBySlug("Khartoum, Al Khartum, Sudan", "https://example.com/article/1234567")).toBe(false);
    expect(isGeocodeContradictedBySlug("Juba, Central Equatoria, South Sudan", "https://example.com/south-sudan-army-clashes-near-juba")).toBe(false);
    expect(isGeocodeContradictedBySlug("Khartoum, Al Khartum, Sudan", "https://example.com/south-sudan-army-clashes-near-juba")).toBe(true);
    expect(isGeocodeContradictedBySlug("Lagos, Lagos, Nigeria", "https://example.com/nigeria-and-niger-reopen-border")).toBe(false);
    expect(isGeocodeContradictedBySlug("Somewhere, Unknownland", "https://example.com/yemen-news")).toBe(false);
  });
});

describe("candidate pre-filter is loose and multilingual", () => {
  it("passes conflict reporting in the crawl's languages", () => {
    for (const t of [
      "Drone strike kills seven near Mekelle",
      "Au moins dix soldats tués dans une embuscade près de Djibo",
      "Insurgentes atacam aldeia em Cabo Delgado",
      "قصف مدفعي على الفاشر ومقتل مدنيين",
      "RSF says it controls Babanusa",
    ]) expect(isCandidateText(t), t).toBe(true);
  });
  it("skips plainly unrelated items", () => {
    for (const t of ["Central bank holds interest rate at 12%", "National team names squad for qualifier", "Minister opens new hospital wing on Tuesday"]) expect(isCandidateText(t), t).toBe(false);
  });
});
