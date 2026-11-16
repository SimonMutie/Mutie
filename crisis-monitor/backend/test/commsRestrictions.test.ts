import { describe, expect, it } from "vitest";
import { restrictedCountries, restrictionFor } from "../src/lib/commsRestrictions";
import { isLive, lateReportNotes, setDegradedCountries } from "../src/escalationIncidents";

const now = new Date("2026-11-16T12:00:00Z");
const fiveDaysAgo = "2026-11-11";

describe("events reported late from areas under internet restrictions", () => {
  it("knows the restricted regions by region or by town", () => {
    expect(restrictionFor({ countryCode: "ET", admin1: "Amhara", place: null }, new Set())).toBe("internet restrictions in Amhara");
    expect(restrictionFor({ countryCode: "ET", admin1: null, place: "Debre Markos" }, new Set())).toBe("internet restrictions in Amhara");
    expect(restrictionFor({ countryCode: "SD", admin1: null, place: null, geoLabel: "El Fasher, North Darfur" }, new Set())).toBe("internet restrictions in Darfur");
    expect(restrictionFor({ countryCode: "ET", admin1: "Oromia", place: "Nekemte" }, new Set())).toBeNull();
    expect(restrictionFor({ countryCode: "ET", admin1: "Oromia", place: "Nekemte" }, new Set(["ET"]))).toMatch(/IODA/);
  });

  it("keeps a five-day-old event in Amhara live while the report is fresh, but not one in Oromia", () => {
    setDegradedCountries([]);
    const fresh = "2026-11-16T06:00:00Z";
    expect(isLive({ eventDate: fiveDaysAgo, publishedAt: fresh, countryCode: "ET", admin1: "Amhara", place: "Gondar" }, now)).toBe(true);
    expect(isLive({ eventDate: fiveDaysAgo, publishedAt: fresh, countryCode: "ET", admin1: "Oromia", place: "Nekemte" }, now)).toBe(false);
    // The report itself must still be recent.
    expect(isLive({ eventDate: fiveDaysAgo, publishedAt: "2026-11-13T06:00:00Z", countryCode: "ET", admin1: "Amhara" }, now)).toBe(false);
    // Older than a week: never.
    expect(isLive({ eventDate: "2026-11-07", publishedAt: fresh, countryCode: "ET", admin1: "Amhara" }, now)).toBe(false);
    // A whole country IODA measures as degraded.
    setDegradedCountries(["ET"]);
    expect(isLive({ eventDate: fiveDaysAgo, publishedAt: fresh, countryCode: "ET", admin1: "Oromia" }, now)).toBe(true);
    setDegradedCountries([]);
  });

  it("notes why a late event counts", () => {
    const notes = lateReportNotes({ countryCode: "ET", admin1: "Amhara", place: "Bahir Dar", eventDate: fiveDaysAgo, notes: [] }, null, now);
    expect(notes[0]).toBe("Reported late from an area under internet restrictions in Amhara: the event is older than the usual two days and still counts.");
    expect(lateReportNotes({ countryCode: "ET", admin1: "Amhara", place: null, eventDate: "2026-11-16", notes: [] }, null, now)).toEqual([]);
  });

  it("reads IODA at most hourly and keeps the last reading if IODA fails", async () => {
    const store = new Map<string, string>();
    const env = { DB: { prepare: (sql: string) => ({ bind: (...a: string[]) => ({ first: async () => (store.has(a[0]) ? { value: store.get(a[0]) } : null), run: async () => void store.set(a[0], a[1]) }) }) } } as never;
    let calls = 0;
    const read = async () => (calls++, { countries: [{ code: "ET", level: "degraded" }, { code: "KE", level: "normal" }] }) as never;
    expect([...(await restrictedCountries(env, now, read))]).toEqual(["ET"]);
    await restrictedCountries(env, new Date(now.getTime() + 600_000), read);
    expect(calls).toBe(1);
    const failing = async () => { throw new Error("down"); };
    expect([...(await restrictedCountries(env, new Date(now.getTime() + 2 * 3600_000), failing as never))]).toEqual(["ET"]);
  });
});
