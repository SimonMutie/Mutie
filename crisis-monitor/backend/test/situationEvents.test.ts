import { describe, expect, it } from "vitest";
import { groupSituationRows, situationSeverity, type SituationRow } from "../src/lib/situationEvents";

const row = (id: string, p: Partial<SituationRow> = {}): SituationRow => ({
  id, articleId: id, url: `https://a.com/${id}`, domain: "a.com", title: `T ${id}`, type: "displacement", category: "humanitarian", severity: 1,
  countryCode: "SD", countryName: "Sudan", place: "Tawila", lat: 13.6, lon: 25.0, precision: "place", eventDate: "2026-11-14",
  deaths: null, affected: 5000, summary: "s", quote: "q", confidence: "medium", ...p,
});

describe("humanitarian and political events", () => {
  it("grades severity by type and numbers", () => {
    expect(situationSeverity("displacement", null, 150_000)).toBe(3);
    expect(situationSeverity("disaster", 30, null)).toBe(3);
    expect(situationSeverity("government_change", null, null)).toBe(3);
    expect(situationSeverity("displacement", null, 12_000)).toBe(2);
    expect(situationSeverity("election", null, null)).toBe(2);
    expect(situationSeverity("displacement", null, 800)).toBe(1);
  });
  it("folds the same event from several outlets and marks it confirmed", () => {
    const out = groupSituationRows([
      row("1"),
      row("2", { domain: "b.com", eventDate: "2026-11-15", affected: 40_000 }),
      row("3", { place: "El Fasher", eventDate: "2026-11-15" }),
      row("4", { eventDate: "2026-11-25" }),
    ]);
    expect(out).toHaveLength(3);
    const tawila = out.find((e) => e.sources.length === 2)!;
    expect(tawila).toMatchObject({ outlets: 2, confidence: "confirmed", affected: 40_000, severity: 2, firstDate: "2026-11-14", lastDate: "2026-11-15" });
    expect(out.filter((e) => e.confidence === "single source")).toHaveLength(2);
  });
});

import { verifySituation } from "../src/lib/escalationCoder";
describe("verifying a non-armed event from the coder", () => {
  const article = { url: "https://a.com/x", title: "Cholera spreads in Sudan", text: "Health officials in Sudan said cholera has killed 40 people in Kassala this week, and more than 2,000 cases have been recorded since the outbreak began.", textBasis: "full_text" as const, publishedAt: "2026-11-15T10:00:00Z", domain: "a.com" };
  const raw = (ev: Record<string, unknown>, reason = "humanitarian_only") => ({ is_event_report: false, rejection_reason: reason, events: [], situation_event: { type: "disease_outbreak", country_iso2: "SD", place: "Kassala", event_date: "2026-11-14", deaths: 40, deaths_quote: "cholera has killed 40 people in Kassala", people_affected: 2000, people_affected_quote: "more than 2,000 cases have been recorded", quote: "cholera has killed 40 people in Kassala this week", summary: "Cholera killed 40 in Kassala.", confidence: "high", ...ev } });
  const now = new Date("2026-11-16T00:00:00Z");
  it("accepts a quoted, recent event and grades it", () => {
    expect(verifySituation(raw({}), article, now)).toMatchObject({ type: "disease_outbreak", category: "humanitarian", countryCode: "SD", deaths: 40, affected: 2000, severity: 3 });
  });
  it("rejects an invented quote, a wrong reason, or an old date, and drops an unquoted figure", () => {
    expect(verifySituation(raw({ quote: "an epidemic swept across the whole country overnight" }), article, now)).toBeNull();
    expect(verifySituation(raw({}, "not_security_related"), article, now)).toBeNull();
    expect(verifySituation(raw({ event_date: "2026-10-01" }), article, now)).toBeNull();
    expect(verifySituation(raw({ deaths_quote: "nothing like this" }), article, now)?.deaths).toBeNull();
  });
});
