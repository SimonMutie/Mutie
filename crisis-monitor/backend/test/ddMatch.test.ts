import { describe, it, expect } from "vitest";
import { jaroWinkler, nameSimilarity, normalizeName, nameTokens, strengthOf } from "../src/lib/dd/match";

describe("name matching", () => {
  it("normalises accents, punctuation, ampersands and spellings", () => {
    expect(normalizeName("Société Générale & Fils")).toBe("societe generale and fils");
    expect(normalizeName("Muhammad Hussain")).toBe(normalizeName("Mohammed Hussein"));
  });
  it("drops company suffixes for organisations only", () => {
    expect(nameTokens("Acme Trading Ltd", "entity")).toEqual(["acme", "trading"]);
    expect(nameTokens("Co Ltd", "person")).toEqual(["co", "ltd"]);
  });
  it("scores identical, reordered and variant spellings strongly", () => {
    expect(nameSimilarity("Acme Trading Ltd", "ACME TRADING LIMITED", "entity")).toBe(1);
    expect(nameSimilarity("Hussein Ali Mohamed", "Mohammed Hussein Ali", "person")).toBeGreaterThanOrEqual(0.9);
    expect(nameSimilarity("Vladimir Putin", "Vladimir V. Putin", "person")).toBeGreaterThan(0.7);
  });
  it("does not match on one shared common word", () => {
    expect(strengthOf(nameSimilarity("Ali", "Ali Hassan Mohamed Ibrahim", "person"))).toBeNull();
    expect(strengthOf(nameSimilarity("Nile Logistics", "Nile Petroleum Corporation", "entity"))).toBeNull();
  });
  it("tolerates small misspellings but not different names", () => {
    expect(nameSimilarity("Jon Kamau", "John Kamau", "person")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Grace Wanjiru", "Peter Otieno", "person")).toBe(0);
  });
  it("jaro-winkler basics", () => {
    expect(jaroWinkler("martha", "marhta")).toBeGreaterThan(0.95);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });
});
