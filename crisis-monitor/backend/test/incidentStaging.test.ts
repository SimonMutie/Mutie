import { describe, it, expect } from "vitest";
import { reportToStagedRow } from "../src/incidentStaging";

describe("reportToStagedRow", () => {
  it("lays a coded report out like the incident spreadsheet and leaves unsupported columns blank", () => {
    const row = reportToStagedRow({
      id: "r1", article_id: "a1", country_name: "South Sudan", place: "Nasir", admin1: "Upper Nile", lat: 8.60123456, lon: 33.06789012,
      geo_precision: "place", event_date: "2026-10-07", actors: JSON.stringify(["SPLA-IO", "SSPDF"]),
      indicators: JSON.stringify([{ id: "armed-clash", label: "Armed clash", quote: "q" }, { id: "x", label: "Armed clash", quote: "q" }]),
      fatalities: 4, what_happened: "Fighting broke out.", confidence: "high", excerpt: "q", created_at: "2026-10-07T10:00:00Z",
      url: "https://x", title: "t", domain: "x",
    });
    expect(row.date).toBe("2026-10-07");
    expect(row.country).toBe("South Sudan");
    expect(row.city).toBe("Nasir");
    expect(row.latitude).toBe(8.60123);
    expect(row.actor).toBe("SPLA-IO; SSPDF");
    expect(row.tactic).toBe("Armed clash");
    expect(row.details).toBe("Fighting broke out. Reported fatalities: 4.");
    expect(row.civilian_death_unknown).toBeNull();
    expect(row.sector).toBeNull();
  });
});
