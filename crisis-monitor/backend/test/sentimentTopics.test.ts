import { describe, it, expect } from "vitest";
import { scoreSentiment, sentimentFor, toneOf } from "../src/lib/sentiment";
import { extractTopics, queryWords } from "../src/lib/topics";

describe("tone from wording", () => {
  it("reads violent news as negative, a peace deal as positive, and a plain notice as neutral", () => {
    expect(toneOf(scoreSentiment("Gunmen kill 12 villagers in overnight attack"))).toBe("negative");
    expect(toneOf(scoreSentiment("Rivals sign peace agreement as hostages are released"))).toBe("positive");
    expect(toneOf(scoreSentiment("Parliament to sit on Tuesday"))).toBe("neutral");
    expect(toneOf(scoreSentiment(""))).toBe("neutral");
  });
  it("stays between -1 and 1 and is stronger the more one-sided the wording", () => {
    const mild = scoreSentiment("Tension reported near the border");
    const strong = scoreSentiment("Massacre: dozens killed, villages burned, thousands flee as fighting spreads");
    expect(strong).toBeLessThan(mild);
    expect(strong).toBeGreaterThanOrEqual(-1);
    expect(scoreSentiment("Peace, reconciliation, recovery and growth celebrated")).toBeLessThanOrEqual(1);
  });
  it("does not count a negated positive as positive", () => {
    expect(scoreSentiment("Talks end with no agreement")).toBeLessThan(scoreSentiment("Talks end with agreement"));
  });
  it("reads French", () => {
    expect(toneOf(scoreSentiment("Onze villageois tués dans une attaque, des milliers de déplacés"))).toBe("negative");
  });
  it("keeps a score the source supplied, and estimates one otherwise", () => {
    expect(sentimentFor(0.6, "Gunmen kill 12", "")).toBe(0.6);
    expect(sentimentFor(null, "Gunmen kill 12 in attack", "")).toBeLessThan(-0.2);
    expect(sentimentFor(7, "x", "")).toBe(1);
  });
});

describe("topics from recurring phrases", () => {
  const doc = (id: string, title: string, text = "", sentiment = 0) => ({ id, title, text, sentiment });
  const docs = [
    doc("1", "Rapid Support Forces shell El Fasher market", "Shelling by the Rapid Support Forces killed nine in El Fasher.", -0.8),
    doc("2", "El Fasher: Rapid Support Forces advance on army base", "", -0.6),
    doc("3", "Rapid Support Forces deny shelling El Fasher", "", -0.4),
    doc("4", "Aid convoy reaches El Fasher after ceasefire talks", "The convoy is the first since ceasefire talks began.", 0.5),
    doc("5", "Ceasefire talks resume in Jeddah", "", 0.4),
    doc("6", "Sudan army says drone strike hit Omdurman", "", -0.5),
    doc("7", "Drone strike kills four in Omdurman, medics say", "", -0.9),
  ];
  const topics = extractTopics(docs, { exclude: queryWords('(Sudan AND (RSF OR "Rapid Support Forces"))') });
  const of = (term: string) => topics.find((t) => t.term === term);

  it("prefers a phrase to the words inside it", () => {
    expect(of("rapid support forces")?.count).toBe(3);
    expect(of("rapid")).toBeUndefined();
    expect(of("support")).toBeUndefined();
    expect(of("forces")).toBeUndefined();
    expect(of("el fasher")?.count).toBe(4);
    expect(of("ceasefire talks")?.count).toBe(2);
    expect(of("drone strike")?.count).toBe(2);
  });
  it("counts an item once however often it repeats the phrase, and labels it as written", () => {
    expect(of("rapid support forces")?.label).toBe("Rapid Support Forces");
    expect(of("el fasher")?.label).toBe("El Fasher");
  });
  it("leaves out the query's own single words, stopwords and one-off phrases", () => {
    expect(of("sudan")).toBeUndefined();
    expect(of("says")).toBeUndefined();
    expect(of("jeddah")).toBeUndefined(); // one item only
  });
  it("reports each topic's average tone", () => {
    expect(of("rapid support forces")!.tone).toBeCloseTo(-0.6, 5);
    expect(of("ceasefire talks")!.tone).toBeGreaterThan(0.2);
  });
  it("orders by how widely a topic is used", () => {
    expect(topics[0].term).toBe("el fasher");
    expect(topics.every((t, i) => i === 0 || topics[i - 1].count * 1.5 >= t.count)).toBe(true);
  });
  it("gives nothing for nothing", () => {
    expect(extractTopics([])).toEqual([]);
  });
});
