/**
 * The readings the query dashboard takes from headlines and openings with
 * ordinary code: stories (reports of one event grouped), names, rising
 * terms, and where the outlets are based.
 */
import { describe, it, expect } from "vitest";
import { groupStories, headlineWords, type StoryDoc } from "../src/lib/stories";
import { extractNames, namesIn, risingTerms, type NameDoc } from "../src/lib/names";
import { outletBase, sourceMix, countryOfPlace } from "../src/lib/outlets";

const doc = (id: string, title: string, source: string, at: string, place: string | null = null): StoryDoc => ({ id, title, url: `https://${source}/${id}`, source, published_at: at, sentiment: -0.4, place });

describe("stories", () => {
  const docs: StoryDoc[] = [
    doc("a1", "Drone strike kills 14 at El Fasher displacement camp", "dabangasudan.org", "2026-10-05T06:00:00Z", "El Fasher, Sudan"),
    doc("a2", "Sudan: drone strike on El Fasher camp kills at least 14", "bbc.com", "2026-10-05T08:00:00Z", "El Fasher, Sudan"),
    doc("a3", "At least 14 killed in drone strike on displacement camp in El Fasher", "aljazeera.com", "2026-10-05T09:30:00Z", "El Fasher, Sudan"),
    doc("a4", "Drone strike kills 14 at El Fasher displacement camp", "sudantribune.com", "2026-10-05T11:00:00Z", "El Fasher, Sudan"),
    doc("a5", "El Fasher camp drone strike: death toll rises as medics appeal for help", "dabangasudan.org", "2026-10-06T07:00:00Z", "El Fasher, Sudan"),
    doc("b1", "Ceasefire talks resume in Jeddah as mediators press both sides", "reuters.com", "2026-10-05T10:00:00Z"),
    doc("b2", "Jeddah ceasefire talks resume, mediators press both sides for truce", "france24.com", "2026-10-05T12:00:00Z"),
    doc("c1", "Fuel prices rise again in Port Sudan", "sudantribune.com", "2026-10-06T09:00:00Z", "Port Sudan, Sudan"),
    // The same words three weeks on are a different event.
    doc("d1", "Drone strike kills 14 at El Fasher displacement camp", "bbc.com", "2026-10-28T06:00:00Z", "El Fasher, Sudan"),
  ];
  const stories = groupStories(docs);

  it("groups reports of one event and ranks by how many outlets carried it", () => {
    expect(stories[0].members.map((m) => m.id).sort()).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(stories[0]).toMatchObject({ outlets: 4, items: 5, place: "El Fasher, Sudan", title: "Drone strike kills 14 at El Fasher displacement camp" });
    expect(stories[0].firstAt).toBe("2026-10-05T06:00:00.000Z");
    expect(stories[0].lastAt).toBe("2026-10-06T07:00:00.000Z");
    expect(stories[1].members.map((m) => m.id).sort()).toEqual(["b1", "b2"]);
    expect(stories[1].outlets).toBe(2);
  });
  it("keeps the same headline about a different town apart", () => {
    const two = groupStories([
      doc("k1", "Last working hospital hit by shelling, medics say", "bbc.com", "2026-10-05T06:00:00Z", "El Fasher, Sudan"),
      doc("k2", "Last working hospital hit by shelling, medics say", "reuters.com", "2026-10-05T09:00:00Z", "El Fasher, Sudan"),
      doc("k3", "Last working hospital hit by shelling, medics say", "aljazeera.com", "2026-10-05T10:00:00Z", "Kadugli, Sudan"),
      doc("k4", "Last working hospital hit by shelling, medics say", "apnews.com", "2026-10-05T11:00:00Z", "Sudan"), // names only the country: fits
    ]);
    expect(two.map((s) => s.members.map((m) => m.id).join("+")).sort()).toEqual(["k1+k2+k4", "k3"]);
  });
  it("keeps unrelated reports, and the same headline weeks later, apart", () => {
    const single = stories.filter((s) => s.items === 1).map((s) => s.members[0].id).sort();
    expect(single).toEqual(["c1", "d1"]);
  });
  it("reads a headline's meaningful words", () => {
    expect(headlineWords("Sudan's army says 9 killed in the El Fasher attack").sort()).toEqual(["9", "army", "attack", "fasher", "sudan"].sort());
  });
});

describe("names", () => {
  it("finds names by their capitals in running text, without ranks, places or nationalities", () => {
    const text =
      "Fighters from the Rapid Support Forces entered the town on Monday, residents said. Gen. Abdel Fattah al-Burhan, who leads the Sudanese army, met the UN envoy in Port Sudan. The World Food Programme said aid was blocked.";
    const names = namesIn(text);
    expect(names).toContain("Rapid Support Forces");
    expect(names).toContain("Abdel Fattah al-Burhan");
    expect(names).toContain("UN");
    expect(names).toContain("World Food Programme");
    expect(names).not.toContain("Fighters"); // opens a sentence
    expect(names).not.toContain("Monday");
    expect(names).not.toContain("Sudanese");
    expect(names).not.toContain("Gen");
    // The ordinary word a sentence opens with is not part of the name that follows it.
    expect(namesIn("Residents of Nyala said the Rapid Support Forces had withdrawn. Fighters from the Sudan Liberation Movement arrived.")).toEqual(["Nyala", "Rapid Support Forces", "Sudan Liberation Movement"]);
  });

  const at = (d: number) => `2026-10-${String(d).padStart(2, "0")}T08:00:00Z`;
  const docs: NameDoc[] = [
    { id: "1", title: "Fighting reaches the edge of El Fasher", text: "Fighters from the Rapid Support Forces advanced on Tuesday, residents said.", published_at: at(1) },
    { id: "2", title: "Army chief visits the front", text: "The army chief Abdel Fattah al-Burhan visited troops, the Sudanese army said.", published_at: at(2) },
    { id: "3", title: "Aid convoy held at checkpoint", text: "A convoy from the World Food Programme was stopped by the Rapid Support Forces near the town.", published_at: at(3) },
    { id: "4", title: "Talks announced", text: "Mediators said the Rapid Support Forces had agreed to attend, and that al-Burhan would send a delegation.", published_at: at(4) },
    { id: "5", title: "Cholera cases rise in camps", text: "Health workers said cholera cases were rising and the World Food Programme warned of shortages.", published_at: at(8) },
    { id: "6", title: "Cholera outbreak spreads", text: "The cholera outbreak has spread to three camps, the World Health Organization said.", published_at: at(9) },
    { id: "7", title: "Cholera vaccines arrive", text: "A shipment of cholera vaccines arrived as the cholera outbreak worsened, the World Health Organization said.", published_at: at(9) },
    { id: "8", title: "Cholera outbreak: clinics overwhelmed", text: "Clinics treating the cholera outbreak are overwhelmed, medics said. El Fasher has no clean water.", published_at: at(10) },
    { id: "9", title: "Rains worsen cholera outbreak", text: "Heavy rains are worsening the cholera outbreak, the World Health Organization said.", published_at: at(10) },
    { id: "10", title: "Shelling resumes", text: "Shelling resumed overnight, residents said, blaming the Rapid Support Forces.", published_at: at(5) },
  ];

  it("counts each name once per item, most widely used first, and leaves places out", () => {
    const names = extractNames(docs, { limit: 10 });
    expect(names[0]).toMatchObject({ label: "Rapid Support Forces", count: 4 });
    expect(names.map((n) => n.label)).toContain("World Health Organization");
    expect(names.map((n) => n.label)).toContain("World Food Programme");
    expect(names.map((n) => n.label)).not.toContain("El Fasher");
    const who = names.find((n) => n.label === "World Health Organization")!;
    expect(who).toMatchObject({ count: 3, recent: 3, earlier: 0 });
  });

  it("finds the terms that rose in the later half of the period", () => {
    const rising = risingTerms(docs, { limit: 5 });
    expect(rising[0]).toMatchObject({ term: "cholera outbreak", recent: 4, earlier: 0, fresh: true });
    expect(rising.map((r) => r.term)).not.toContain("rapid support forces");
  });

  it("does not call a term new because of a full stop, and reports overlapping pieces of one headline once", () => {
    const at2 = (d: number) => `2026-10-${String(d).padStart(2, "0")}T08:00:00Z`;
    const early: NameDoc[] = [1, 2, 3, 4, 5, 6].map((d) => ({ id: `e${d}`, title: "Town quiet", text: "Residents said the violence began before dawn. Markets stayed shut.", published_at: at2(d) }));
    const late: NameDoc[] = [20, 21, 22, 23, 24, 25].map((d) => ({ id: `l${d}`, title: "Satellite images suggest mass graves near the town", text: "Researchers said the violence began before dawn.", published_at: at2(d) }));
    const rising = risingTerms([...early, ...late], { limit: 10 });
    expect(rising.map((r) => r.term)).not.toContain("dawn"); // in both halves; "dawn." is the same word
    const graves = rising.filter((r) => /mass|graves|satellite|images/.test(r.term));
    expect(graves.length).toBeLessThanOrEqual(2);
    expect(graves[0]).toMatchObject({ fresh: true, recent: 6 });
  });

  it("offers nothing when there is too little earlier reporting to compare with", () => {
    expect(risingTerms(docs.slice(4), { limit: 5 })).toEqual([]);
  });
});

describe("where outlets are based", () => {
  it("knows the platform's own sources, well-known outlets and national addresses, and guesses nothing else", () => {
    expect(outletBase("bbc.com")).toEqual({ kind: "international" });
    expect(outletBase("news.bbc.co.uk")).toEqual({ kind: "international" });
    expect(outletBase("allafrica.com")).toEqual({ kind: "panafrican" });
    expect(outletBase("dabangasudan.org")).toEqual({ kind: "country", code: "SD" });
    expect(outletBase("nation.co.ke")).toMatchObject({ kind: "country", code: "KE" });
    expect(outletBase("some-blog.example")).toBeNull();
    expect(outletBase("bit.ly")).toBeNull();
  });
  it("splits a period's reporting by where its outlets are, against the countries it is about", () => {
    expect(countryOfPlace("El Fasher, Sudan")).toBe("SD");
    const mix = sourceMix([
      { source: "dabangasudan.org", place: "El Fasher, Sudan" },
      { source: "dabangasudan.org", place: "Khartoum, Sudan" },
      { source: "sudantribune.com", place: "Sudan" },
      { source: "nation.co.ke", place: "Sudan" },
      { source: "bbc.com", place: "El Fasher, Sudan" },
      { source: "some-blog.example", place: null },
    ]);
    expect(mix).toMatchObject({ countries: ["Sudan"], inCountry: 3, elsewhereInAfrica: 1, international: 1, unclassified: 1, outlets: 5 });
    expect(mix.largest).toEqual({ label: "dabangasudan.org", share: 0.333 });
  });
});
