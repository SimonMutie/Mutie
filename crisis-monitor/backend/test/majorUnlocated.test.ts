import { describe, it, expect } from "vitest";
import { isMajorUnlocated } from "../src/lib/headlineCoder";
import { openingParagraph } from "../src/escalationIncidents";

const now = new Date();
const h = (title: string) => ({ title, feedText: null, publishedAt: null });

describe("major events that name only a country", () => {
  it("flags an airstrike on the Egypt-Sudan border even with no town named", () => {
    expect(isMajorUnlocated(h("Airstrike hits border area between Egypt and Sudan"), now)).toBe(true);
  });
  it("flags a strike that kills tens, even with no town named", () => {
    expect(isMajorUnlocated(h("Gunmen kill dozens in Nigeria attack"), now)).toBe(true);
    expect(isMajorUnlocated(h("Attack leaves 14 dead in Sudan"), now)).toBe(true);
  });
  it("does not flag a non-event or a headline with a town (those are handled elsewhere)", () => {
    expect(isMajorUnlocated(h("Egypt and Sudan hold talks on the Nile dam"), now)).toBe(false);
    expect(isMajorUnlocated(h("Drone attack in Tigray as fighting resumes near Mekelle"), now)).toBe(false);
  });
});

describe("opening paragraphs", () => {
  it("returns the first seven substantial paragraphs, never the rest of the article", () => {
    const text =
      "Short.\n\nThis is the opening paragraph that names the event and the toll in detail, long enough to count as the lead.\n\n" +
      "The second paragraph gives the exact place where it happened.\n\nThe third paragraph says who is blamed for the attack.\n\nThe fourth paragraph gives what officials said next.\n\nThe fifth paragraph names the weapon used.\n\nThe sixth paragraph gives the date of the attack.\n\nThe seventh paragraph says who claimed it.\n\n" +
      "The rest of the article goes on about reactions and background.";
    const out = openingParagraph(text);
    expect(out).toMatch(/^This is the opening paragraph/);
    expect(out).toMatch(/exact place/);
    expect(out).toMatch(/who is blamed/);
    expect(out).toMatch(/who claimed it/);
    expect(out).toMatch(/officials said next/);
    expect(out).not.toMatch(/reactions/);
  });
  it("reads the place from paragraph two (Sudan Tribune, border airstrikes)", () => {
    const text =
      "PORT SUDAN – Sudan's army chief on Monday ordered a fact-finding committee into airstrikes that killed dozens of gold miners near the Egyptian border.\n\n" +
      "Warplanes struck gold prospecting sites in the Shamal al-Wadi area of far northern Red Sea State on Saturday, the second such incident in three months.\n\n" +
      "The strikes drew condemnation from political and armed groups.\n\n" +
      "Witnesses said several vehicles were destroyed.\n\n" +
      "Residents fled towards the coast.\n\n" +
      "The army did not comment.\n\n" +
      "Aid groups suspended operations.\n\n" +
      "Sudan has been at war since April 2023.";
    const out = openingParagraph(text);
    expect(out).toMatch(/Shamal al-Wadi/);
    expect(out).toMatch(/condemnation/);
    expect(out).toMatch(/vehicles were destroyed/);
    expect(out).not.toMatch(/April 2023/);
  });
  it("caps very long paragraphs", () => {
    expect(openingParagraph("word. ".repeat(500)).length).toBeLessThanOrEqual(1200);
    expect(openingParagraph(`${"word. ".repeat(500)}\n\n${"more. ".repeat(500)}\n\n${"again. ".repeat(500)}\n\n${"fourth. ".repeat(500)}\n\n${"fifth. ".repeat(500)}\n\n${"sixth. ".repeat(500)}\n\n${"seventh. ".repeat(500)}\n\n${"never. ".repeat(500)}`).length).toBeLessThanOrEqual(8400);
  });
});

describe("Egypt-border mining strikes are placed at the border, not mid-state", () => {
  it("knows Shamal al-Wadi in Red Sea State", async () => {
    const { resolvePlaceOffline, distanceKm } = await import("../src/lib/africaGeo");
    const loc = resolvePlaceOffline({ countryCode: "SD", place: "Shamal al-Wadi", admin1: "Red Sea State" } as never);
    expect(loc.label).toMatch(/Shamal al-Wadi/);
    // Well north of the Red Sea State centroid and Port Sudan, within ~100 km of the 22nd parallel border.
    expect(loc.lat).toBeGreaterThan(21);
    expect(distanceKm(loc.lat, loc.lon, 19.6158, 37.2164)).toBeGreaterThan(250);
  });
});
