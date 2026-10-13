import { describe, it, expect } from "vitest";
import { verifyCoding, type RawCoding } from "../src/lib/escalationCoder";

describe("the headline's country outranks a wrong model attribution", () => {
  it("moves an Ethiopia story out of Khartoum when the headline names Ethiopia", () => {
    const raw = {
      is_event_report: true,
      rejection_reason: null,
      events: [
        {
          country: "Sudan", country_iso2: "SD", place: "Khartoum", place_in_text: "Khartoum", admin1: null,
          lat: 15.5, lon: 32.5, event_date: null, novelty: "new", actors: [],
          indicators: [{ id: "armed_clash", quote: "Eritrean incursions" }],
          fatalities: null, fatalities_quote: null, trajectory: "escalation", trajectory_reason: null,
          what_happened: "Eritrean incursions raise fears of a wider regional war in Ethiopia.", significance: null, confidence: "medium",
        },
      ],
    } as unknown as RawCoding;
    const article = {
      url: "https://example.com/a", title: "Eritrean Incursions Raise Fears of a Wider Regional War in Ethiopia",
      text: "Eritrean incursions into Ethiopia's north have raised fears of a wider war. Officials in Khartoum, far to the west, said talks had stalled.",
      textBasis: "full_text" as const, publishedAt: new Date().toISOString(), domain: "example.com",
    };
    const out = verifyCoding(raw, article, new Date());
    const ev = out.reports[0];
    expect(ev).toBeDefined();
    expect(ev.countryCode).toBe("ET");
    expect(ev.place).toBeNull();
  });
});
