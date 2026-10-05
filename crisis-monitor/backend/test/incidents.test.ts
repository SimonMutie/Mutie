import { describe, it, expect } from "vitest";
import { assignIncident, canonicalUrl, computeIncident, isLive, locationLabel, pickBatch, type Candidate, type IncidentAnchor, type StoredReport } from "../src/escalationIncidents";

let seq = 0;
function report(over: Partial<StoredReport>): StoredReport {
  seq++;
  return {
    id: `r${seq}`, articleId: `a${seq}`, incidentId: null, countryCode: "ET", countryName: "Ethiopia", place: "Mekelle", admin1: "Tigray",
    lat: 13.4967, lon: 39.4753, geoPrecision: "place", geoMethod: "curated", geoLabel: "Mekelle", eventDate: "2026-10-02", dateBasis: "stated",
    actors: ["ENDF"], indicators: [{ id: "air_or_drone_strike", label: "Air or drone strike", quote: `a drone strike hit the outskirts of Mekelle on Wednesday morning (${seq})` }],
    fatalities: null, trajectory: "escalation", trajectoryReason: null, whatHappened: "A drone strike hit Mekelle.", significance: null, confidence: "high",
    notes: [], excerpt: "", url: `https://site${seq}.example/a`, title: `Title ${seq}`, domain: `site${seq}.example`, publishedAt: "2026-10-02T10:00:00Z", textBasis: "full_text", ...over,
  };
}
const anchor = (over: Partial<IncidentAnchor>): IncidentAnchor => ({ id: "i1", countryCode: "ET", regionKey: "tigray", lat: 13.4967, lon: 39.4753, geoPrecision: "place", reportCount: 1, ...over });

describe("incident assignment never crosses a border", () => {
  it("joins a nearby incident in the same country", () => {
    expect(assignIncident(report({ lat: 13.6, lon: 39.5 }), [anchor({})])).toBe("i1");
  });
  it("does not join an incident in another country, however close", () => {
    // Zalambessa (ET) is a few km from Eritrea; an Eritrea incident right there must not absorb it.
    expect(assignIncident(report({ lat: 14.52, lon: 39.38 }), [anchor({ id: "er", countryCode: "ER", lat: 14.6, lon: 39.4 })])).toBeNull();
  });
  it("opens a new incident for a distant place in the same region", () => {
    expect(assignIncident(report({ place: "Humera", geoLabel: "Humera", lat: 14.299, lon: 36.6136 }), [anchor({})])).toBeNull();
  });
  it("a region-only report joins that region's incident; a country-only one does not", () => {
    expect(assignIncident(report({ place: null, geoLabel: "Tigray", geoPrecision: "region", lat: 13.9, lon: 39.0 }), [anchor({})])).toBe("i1");
    expect(assignIncident(report({ place: null, admin1: null, geoLabel: null, geoPrecision: "country", lat: 9.1, lon: 40.5 }), [anchor({})])).toBeNull();
  });
});

describe("computeIncident", () => {
  it("lists each indicator with its quote and the numbered source it came from", () => {
    const a = report({});
    const b = report({ indicators: [{ id: "air_or_drone_strike", label: "Air or drone strike", quote: "a second strike was reported by residents of the city late on Wednesday" }, { id: "mass_displacement", label: "Mass displacement", quote: "thousands fled toward Adigrat after the strike" }], publishedAt: "2026-10-02T12:00:00Z" });
    const c = computeIncident([a, b]);
    expect(c.sources.map((s) => s.n)).toEqual([1, 2]);
    expect(c.sources[0].url).toBe(b.url); // newest first
    const strike = c.indicators.find((i) => i.id === "air_or_drone_strike")!;
    expect(strike.evidence).toHaveLength(2);
    expect(strike.evidence.every((e) => c.sources.some((s) => s.n === e.source))).toBe(true);
    expect(c.level).toBe("elevated");
    expect(c.criteriaMet.length).toBeGreaterThan(0);
  });
  it("places the marker at the most specific location reported", () => {
    const regionOnly = report({ place: null, geoLabel: "Tigray", geoPrecision: "region", geoMethod: "region-centroid", lat: 13.9, lon: 39.0 });
    const c = computeIncident([regionOnly, report({})]);
    expect(c.location.precision).toBe("place");
    expect(locationLabel(c.location)).toBe("Mekelle, Tigray");
  });
  it("counts syndicated copies of one wire story as a single source", () => {
    const quote = "Rapid Support Forces shelled the Abu Shouk displacement camp on Thursday, killing at least four people";
    const mk = () => report({ countryCode: "SD", confidence: "low", indicators: [{ id: "heavy_weapons", label: "Heavy weapons use", quote }] });
    // Same quote on two sites, both low confidence: still one source, so not corroborated.
    expect(computeIncident([mk(), mk()]).level).toBe("watch");
    // A genuinely different report corroborates it.
    const other = report({ countryCode: "SD", confidence: "low", indicators: [{ id: "heavy_weapons", label: "Heavy weapons use", quote: "artillery fire struck the camp for a second day, according to the local resistance committee" }] });
    expect(computeIncident([mk(), other]).level).toBe("elevated");
  });
  it("labels a country-level location as unspecified", () => {
    const c = computeIncident([report({ place: null, admin1: null, geoLabel: null, geoPrecision: "country", geoMethod: "country-centroid", lat: 9.1, lon: 40.5 })]);
    expect(locationLabel(c.location)).toBeNull();
  });
});

describe("helpers", () => {
  it("canonicalUrl ignores tracking parameters, www and trailing slashes", () => {
    expect(canonicalUrl("https://www.Example.com/news/story/?utm_source=x&id=5#top")).toBe(canonicalUrl("https://example.com/news/story?id=5"));
  });
  it("isLive keeps only what was reported in the last 24 hours as happening today or yesterday", () => {
    const now = new Date("2026-10-03T06:00:00Z");
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    expect(isLive({ eventDate: "2026-10-03", publishedAt: hoursAgo(2) }, now)).toBe(true);
    expect(isLive({ eventDate: "2026-10-02", publishedAt: hoursAgo(20) }, now)).toBe(true);
    // Reported an hour ago, but about something three days back.
    expect(isLive({ eventDate: "2026-09-30", publishedAt: hoursAgo(1) }, now)).toBe(false);
    // Dated yesterday, but the article itself is more than 24 hours old.
    expect(isLive({ eventDate: "2026-10-02", publishedAt: hoursAgo(25) }, now)).toBe(false);
    // No publication time known: the event date alone decides.
    expect(isLive({ eventDate: "2026-10-02", publishedAt: null }, now)).toBe(true);
    expect(isLive({ eventDate: "2026-10-01", publishedAt: null }, now)).toBe(false);
  });
  it("pickBatch alternates between origins and de-duplicates", () => {
    const c = (id: string, origin: Candidate["origin"]): Candidate => ({ id, url: `https://x/${id}`, domain: "x", origin, title: null, feedText: null, publishedAt: null, priority: 0 });
    const batch = pickBatch([[c("a1", "africa-wire"), c("a2", "africa-wire"), c("a3", "africa-wire")], [c("w1", "wire-feed")], [c("a1", "gdelt"), c("g2", "gdelt")]], 5);
    expect(batch.map((b) => b.id)).toEqual(["a1", "w1", "g2", "a2", "a3"]);
  });
});
