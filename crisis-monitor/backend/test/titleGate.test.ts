import { describe, expect, it } from "vitest";
import { titleIsRelevant } from "../src/lib/titleGate";

describe("the headline gate", () => {
  it("passes conflict, security, crime, intercommunal violence and killing", () => {
    for (const t of [
      "RSF drone strike hits El Fasher market",
      "Gunmen kill 12 in Plateau village",
      "Herders and farmers clash in Benue",
      "Al-Shabaab attack on army base near Mogadishu",
      "Bandits abduct 30 students in Zamfara",
      "Police arrest suspects after Nairobi robbery",
      "Kenya: intercommunal violence flares in Marsabit",
      "Mali : une attaque djihadiste fait 20 morts",
      "Moçambique: insurgentes atacam aldeia, vários mortos",
      "مقتل 10 في قصف على الفاشر",
    ])
      expect(titleIsRelevant(t), t).toBe(true);
  });
  it("passes over everything else", () => {
    for (const t of ["Kenya's central bank holds rates steady", "Nigeria wins AFCON qualifier", "New maize variety boosts yields in Malawi", "Ethiopia's airline adds Lagos flights"])
      expect(titleIsRelevant(t), t).toBe(false);
    expect(titleIsRelevant("")).toBe(false);
  });
});
