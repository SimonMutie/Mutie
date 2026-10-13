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

describe("opening paragraph", () => {
  it("returns the first substantial paragraph, not the whole article", () => {
    const text = "Short.\n\nThis is the opening paragraph that names the place and the event in detail, long enough to count as the lead.\n\nThe rest of the article goes on about reactions and background.";
    expect(openingParagraph(text)).toMatch(/^This is the opening paragraph/);
    expect(openingParagraph(text)).not.toMatch(/reactions/);
  });
  it("caps very long paragraphs", () => {
    expect(openingParagraph("word. ".repeat(500)).length).toBeLessThanOrEqual(1200);
  });
});
