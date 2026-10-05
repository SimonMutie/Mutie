import { describe, it, expect } from "vitest";
import { decideLevel, type ScoringReport } from "../src/lib/escalationCodebook";

const r = (over: Partial<ScoringReport>): ScoringReport => ({ sourceKey: "a.example", indicators: [], fatalities: null, trajectory: "continuation", confidence: "medium", ...over });

describe("level rules", () => {
  it("gives no level without a verified indicator", () => {
    expect(decideLevel([]).level).toBe("none");
    expect(decideLevel([r({ indicators: [] })]).level).toBe("none");
  });
  it("Elevated on a single confident military-posture indicator, and says why", () => {
    const d = decideLevel([r({ indicators: ["air_or_drone_strike"] })]);
    expect(d.level).toBe("elevated");
    expect(d.criteriaMet.join(" ")).toMatch(/Air or drone strike reported \(1 source\)/);
  });
  it("does not count a lone low-confidence report until it is corroborated", () => {
    expect(decideLevel([r({ indicators: ["armed_clash"], confidence: "low" })]).level).toBe("watch");
    const d = decideLevel([r({ indicators: ["armed_clash"], confidence: "low" }), r({ indicators: ["armed_clash"], confidence: "low", sourceKey: "b.example" })]);
    expect(d.level).toBe("elevated");
  });
  it("two articles from the same outlet are one source", () => {
    expect(decideLevel([r({ indicators: ["armed_clash"], confidence: "low" }), r({ indicators: ["armed_clash"], confidence: "low" })]).level).toBe("watch");
  });
  it("Critical on a critical-tier indicator", () => {
    const d = decideLevel([r({ indicators: ["major_territorial_change"] })]);
    expect(d.level).toBe("critical");
  });
  it("Critical on mass casualties, with the figure stated", () => {
    const d = decideLevel([r({ indicators: ["attack_on_civilians"], fatalities: 31 })]);
    expect(d.level).toBe("critical");
    expect(d.criteriaMet.join(" ")).toMatch(/31 deaths/);
  });
  it("mass casualties from one low-confidence source are Elevated until corroborated", () => {
    const one = decideLevel([r({ indicators: ["attack_on_civilians"], fatalities: 31, confidence: "low" })]);
    expect(one.level).toBe("elevated");
    expect(one.criteriaMet.join(" ")).toMatch(/31 deaths reported by one source at low confidence/);
    const two = decideLevel([r({ indicators: ["attack_on_civilians"], fatalities: 31, confidence: "low" }), r({ indicators: ["attack_on_civilians"], fatalities: 28, confidence: "low", sourceKey: "b.example" })]);
    expect(two.level).toBe("critical");
  });
  it("an uncorroborated low-confidence strike is raised by a death toll or a second source, not otherwise", () => {
    expect(decideLevel([r({ indicators: ["air_or_drone_strike"], confidence: "low" })]).level).toBe("watch");
    const withDeaths = decideLevel([r({ indicators: ["air_or_drone_strike"], confidence: "low", fatalities: 7 })]);
    expect(withDeaths.level).toBe("elevated");
    expect(withDeaths.criteriaMet.join(" ")).toMatch(/Air or drone strike reported by one source not yet corroborated, with 7 deaths reported/);
    expect(decideLevel([r({ indicators: ["air_or_drone_strike"], confidence: "low" }), r({ indicators: ["attack_on_civilians"], confidence: "low", sourceKey: "b.example" })]).level).toBe("elevated");
    // The same outlet twice is still one source.
    expect(decideLevel([r({ indicators: ["air_or_drone_strike"], confidence: "low" }), r({ indicators: ["heavy_weapons"], confidence: "low" })]).level).toBe("watch");
  });
  it("Critical on three corroborated posture indicators across two sources", () => {
    const d = decideLevel([
      r({ indicators: ["air_or_drone_strike", "heavy_weapons"] }),
      r({ indicators: ["offensive_or_advance", "heavy_weapons"], sourceKey: "b.example" }),
    ]);
    expect(d.level).toBe("critical");
  });
  it("a routine single-source attack with few deaths stays below Elevated", () => {
    const d = decideLevel([r({ indicators: ["ied_or_bombing"], fatalities: 2 })]);
    expect(d.level).toBe("watch");
    expect(d.notes.join(" ")).toMatch(/below the Elevated threshold/);
  });
  it("the same attack is Elevated with 5+ deaths, corroboration, or escalation framing", () => {
    expect(decideLevel([r({ indicators: ["ied_or_bombing"], fatalities: 6 })]).level).toBe("elevated");
    expect(decideLevel([r({ indicators: ["ied_or_bombing"] }), r({ indicators: ["ied_or_bombing"], sourceKey: "b.example" })]).level).toBe("elevated");
    expect(decideLevel([r({ indicators: ["ied_or_bombing"], trajectory: "escalation" })]).level).toBe("elevated");
  });
  it("de-escalation reports contribute nothing", () => {
    expect(decideLevel([r({ indicators: ["mobilisation_or_reinforcement"], trajectory: "de-escalation" })]).level).toBe("none");
  });
});
