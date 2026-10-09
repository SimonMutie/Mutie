import { describe, it, expect } from "vitest";
import { verifyCoding, type ArticleForCoding, type RawCodedEvent, type RawCoding } from "../src/lib/escalationCoder";

const NOW = new Date("2026-10-03T06:00:00Z");

function article(text: string, over: Partial<ArticleForCoding> = {}): ArticleForCoding {
  return { url: "https://example.com/a", title: "Headline", text, textBasis: "full_text", publishedAt: "2026-10-02T09:00:00Z", domain: "example.com", ...over };
}
function event(over: Partial<RawCodedEvent>): RawCodedEvent {
  return {
    country: "Ethiopia", country_iso2: "ET", place: null, admin1: null, lat: null, lon: null, event_date: "2026-10-01", novelty: "new_event",
    actors: [], indicators: [], fatalities: null, fatalities_quote: null, trajectory: "unclear", trajectory_reason: null,
    what_happened: "Something specific happened.", significance: null, confidence: "high", ...over,
  };
}
const coding = (...events: RawCodedEvent[]): RawCoding => ({ is_event_report: true, rejection_reason: null, events });

const TIGRAY = "Ethiopian federal forces carried out a drone strike near Mekelle on Wednesday, killing seven people, Tigray officials said. Fuel convoys from Djibouti were delayed.";

describe("verifyCoding", () => {
  it("keeps an indicator only when its quote is really in the article", () => {
    const out = verifyCoding(
      coding(event({ place: "Mekelle", admin1: "Tigray", indicators: [{ id: "air_or_drone_strike", quote: "carried out a drone strike near Mekelle" }, { id: "major_territorial_change", quote: "federal forces captured the regional capital" }] })),
      article(TIGRAY), NOW
    );
    expect(out.reports).toHaveLength(1);
    expect(out.reports[0].indicators.map((i) => i.id)).toEqual(["air_or_drone_strike"]);
    expect(out.reports[0].notes.join(" ")).toMatch(/Major territorial change.*dropped/);
  });

  it("rejects the whole event when no indicator survives", () => {
    const out = verifyCoding(coding(event({ indicators: [{ id: "armed_clash", quote: "heavy clashes erupted across the city centre" }] })), article(TIGRAY), NOW);
    expect(out.reports).toHaveLength(0);
    expect(out.rejectionReason).toBe("unverified");
  });

  it("drops a place the article never names, and a fatality figure with no quote", () => {
    const out = verifyCoding(
      coding(event({ place: "Adigrat", fatalities: 40, fatalities_quote: "at least 40 people were killed", indicators: [{ id: "air_or_drone_strike", quote: "carried out a drone strike near Mekelle" }] })),
      article(TIGRAY), NOW
    );
    expect(out.reports[0].place).toBeNull();
    expect(out.reports[0].fatalities).toBeNull();
  });

  it("rejects events outside Africa and the Middle East", () => {
    const text = "Russian drones struck apartment blocks in Kharkiv on Thursday, Ukrainian officials said, as talks in Istanbul stalled.";
    const out = verifyCoding(coding(event({ country: "Ukraine", country_iso2: "UA", place: "Kharkiv", indicators: [{ id: "heavy_weapons", quote: "Russian drones struck apartment blocks in Kharkiv" }] })), article(text), NOW);
    expect(out.reports).toHaveLength(0);
    expect(out.rejectionReason).toBe("outside_africa");
  });

  it("accepts a Middle East event (the Taiz case)", () => {
    const text = "Houthi forces shelled government positions in Taiz on Thursday, Yemeni officials said, as Saudi mediators in Riyadh pressed for talks.";
    const out = verifyCoding(coding(event({ country: "Yemen", country_iso2: "YE", place: "Taiz", indicators: [{ id: "heavy_weapons", quote: "Houthi forces shelled government positions in Taiz" }] })), article(text), NOW);
    expect(out.reports).toHaveLength(1);
    expect(out.reports[0].countryCode).toBe("YE");
  });

  it("corrects the country when the named place belongs to another one (Hargeisa is not in Ethiopia)", () => {
    const text = "Somaliland troops and SSC-Khatumo fighters exchanged artillery fire outside Las Anod on Thursday, residents said. Ethiopian officials in Addis Ababa called for calm.";
    const out = verifyCoding(coding(event({ country: "Ethiopia", country_iso2: "ET", place: "Las Anod", indicators: [{ id: "heavy_weapons", quote: "exchanged artillery fire outside Las Anod" }] })), article(text), NOW);
    expect(out.reports[0].countryCode).toBe("SO");
    expect(out.reports[0].notes.join(" ")).toMatch(/Country corrected from Ethiopia to Somalia/);
  });

  it("does not confuse Mali with Somalia/Somaliland when resolving the country", () => {
    const text = "Somaliland troops and SSC-Khatumo fighters exchanged artillery fire outside Las Anod on Thursday, residents said.";
    const out = verifyCoding(coding(event({ country: "Somaliland", country_iso2: "SO", place: "Las Anod", indicators: [{ id: "heavy_weapons", quote: "exchanged artillery fire outside Las Anod" }] })), article(text), NOW);
    expect(out.reports[0].countryCode).toBe("SO");
    expect(out.reports[0].countryName).toBe("Somalia");
  });

  it("lowers confidence when the article never grounds the stated country", () => {
    const text = "Gunmen attacked a convoy on the main road on Thursday, killing three soldiers, a military spokesman said in a statement.";
    const out = verifyCoding(coding(event({ country: "Kenya", country_iso2: "KE", indicators: [{ id: "attack_on_security_forces", quote: "Gunmen attacked a convoy on the main road" }] })), article(text), NOW);
    expect(out.reports[0].confidence).toBe("low");
    expect(out.reports[0].notes.join(" ")).toMatch(/country attribution unconfirmed/);
  });

  it("caps confidence when only the feed summary could be read", () => {
    const out = verifyCoding(coding(event({ place: "Mekelle", indicators: [{ id: "air_or_drone_strike", quote: "carried out a drone strike near Mekelle" }] })), article(TIGRAY, { textBasis: "feed_summary" }), NOW);
    expect(out.reports[0].confidence).toBe("medium");
  });

  it("rejects background and week-old events", () => {
    const ind = [{ id: "air_or_drone_strike", quote: "carried out a drone strike near Mekelle" }];
    expect(verifyCoding(coding(event({ novelty: "background", indicators: ind })), article(TIGRAY), NOW).rejectionReason).toBe("retrospective");
    expect(verifyCoding(coding(event({ event_date: "2026-09-10", indicators: ind })), article(TIGRAY), NOW).rejectionReason).toBe("retrospective");
  });

  it("accepts a place written in another script when the model also gives its Latin name", () => {
    const text = "قصفت قوات الدعم السريع مدينة الفاشر بالمدفعية الثقيلة يوم الخميس، ما أسفر عن مقتل تسعة مدنيين بحسب لجان المقاومة في السودان.";
    const out = verifyCoding(
      coding(event({ country: "Sudan", country_iso2: "SD", place: "El Fasher", place_in_text: "الفاشر", admin1: "North Darfur", indicators: [{ id: "heavy_weapons", quote: "قصفت قوات الدعم السريع مدينة الفاشر بالمدفعية الثقيلة" }] })),
      article(text), NOW
    );
    expect(out.reports[0].place).toBe("El Fasher");
    expect(out.reports[0].countryCode).toBe("SD");
    expect(out.reports[0].confidence).toBe("high");
  });

  it("passes the model's own rejection through", () => {
    const out = verifyCoding({ is_event_report: false, rejection_reason: "commentary_or_analysis", rejection_note: "An opinion piece on the Pretoria agreement.", events: [] }, article(TIGRAY), NOW);
    expect(out.reports).toHaveLength(0);
    expect(out.rejectionReason).toBe("commentary_or_analysis");
  });
});
