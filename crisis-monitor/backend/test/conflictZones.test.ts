import { describe, expect, it } from "vitest";
import { activeCountries, activeIntensityOf, codeForUcdpCountry } from "../src/lib/ucdpActive";
import { conflictCountries, conflictProvinces, escalationWaves, intensityOf, provinceAt, trendOf } from "../src/lib/conflictZones";

describe("conflict provinces", () => {
  it("finds the province a point is in", () => {
    expect(provinceAt(13.4967, 39.4753)).toMatchObject({ country: "ET", name: "Tigray" }); // Mekelle
    expect(provinceAt(-1.68, 29.22)).toMatchObject({ country: "CD" }); // Goma
    expect(provinceAt(9.9, 32.7)).toMatchObject({ country: "SS", name: "Upper Nile" });
    expect(provinceAt(49.99, 36.23)).toBeNull(); // Kharkiv
  });
  it("shades nothing when nothing is flagged", () => {
    expect(conflictProvinces([])).toHaveLength(0);
  });
  it("shades the whole province an escalation is in, and only that one", () => {
    const z = conflictProvinces([{ lat: 11.8, lon: 13.15, level: "elevated" }]);
    expect(z.map((p) => p.id)).toEqual(["NG:Borno"]);
    expect(z[0].rings.length).toBeGreaterThan(0);
  });
  it("counts incidents in a province and keeps the highest level, critical first", () => {
    const z = conflictProvinces([
      { lat: 9.9, lon: 32.7, level: "elevated" },
      { lat: 13.4967, lon: 39.4753, level: "critical" },
      { lat: 9.95, lon: 32.75, level: "critical" },
    ]);
    expect(z.find((p) => p.id === "SS:Upper Nile")).toMatchObject({ incidents: 2, level: "critical" });
    expect(z.find((p) => p.id === "ET:Tigray")).toMatchObject({ incidents: 1, level: "critical" });
  });
  it("ignores a point outside Africa and the Middle East", () => {
    expect(conflictProvinces([{ lat: 49.99, lon: 36.23, level: "critical" }])).toHaveLength(0);
  });
});

describe("intensity of a province", () => {
  const c = (watch: number, elevated: number, critical: number) => intensityOf({ watch, elevated, critical });

  it("is low for a few watch-level incidents only", () => {
    expect(c(1, 0, 0).intensity).toBe(1);
    expect(c(2, 0, 0).intensity).toBe(1);
  });

  it("is moderate for one elevated incident or three watch-level ones", () => {
    expect(c(0, 1, 0).intensity).toBe(2);
    expect(c(3, 0, 0).intensity).toBe(2);
  });

  it("is high for one critical incident or two elevated ones", () => {
    expect(c(0, 0, 1).intensity).toBe(3);
    expect(c(0, 2, 0).intensity).toBe(3);
  });

  it("is severe for two critical incidents or a score of twelve", () => {
    expect(c(0, 0, 2).intensity).toBe(4);
    expect(c(0, 4, 0).intensity).toBe(4);
  });

  it("sorts the most intense provinces first", () => {
    const z = conflictProvinces([
      { lat: 9.9, lon: 32.7, level: "watch" },
      { lat: 13.4967, lon: 39.4753, level: "critical" },
      { lat: 13.5, lon: 39.5, level: "critical" },
    ]);
    expect(z[0]).toMatchObject({ id: "ET:Tigray", intensity: 4, intensityLabel: "Severe" });
    expect(z.find((p) => p.id === "SS:Upper Nile")).toMatchObject({ intensity: 1, level: "watch" });
  });
});

describe("conflict countries", () => {
  it("codes nothing when nothing is flagged", () => {
    expect(conflictCountries([])).toHaveLength(0);
  });
  it("counts escalations under their own country, whether or not they can be placed", () => {
    const z = conflictCountries([
      { code: "SD", name: "Sudan", level: "critical" },
      { code: "SD", name: "Sudan", level: "critical" },
      { code: "UA", name: "Ukraine", level: "watch" },
      { code: "ua", name: "Ukraine", level: "elevated" },
      { code: "", name: "Nowhere", level: "critical" },
    ]);
    expect(z.map((c) => c.code)).toEqual(["SD", "UA"]);
    expect(z[0]).toMatchObject({ code: "SD", intensity: 4, intensityLabel: "Severe", level: "critical", incidents: 2 });
    expect(z[1]).toMatchObject({ code: "UA", intensity: 2, intensityLabel: "Moderate", level: "elevated", incidents: 2 });
  });
  it("uses the same tiers as provinces", () => {
    const one = conflictCountries([{ code: "LB", name: "Lebanon", level: "watch" }]);
    expect(one[0]).toMatchObject({ intensity: 1, intensityLabel: "Low", level: "watch" });
    const crit = conflictCountries([{ code: "YE", name: "Yemen", level: "critical" }]);
    expect(crit[0]).toMatchObject({ intensity: 3, intensityLabel: "High" });
  });
});

describe("country trend", () => {
  it("reads the lean of recent reports against the earlier period", () => {
    expect(trendOf({ net: 2, recent: 2, prior: 0 })).toBe("new");
    expect(trendOf({ net: 2, recent: 3, prior: 4 })).toBe("worsening");
    expect(trendOf({ net: -1, recent: 2, prior: 4 })).toBe("improving");
    expect(trendOf({ net: 0, recent: 2, prior: 4 })).toBe("steady");
    expect(trendOf(undefined)).toBe("steady");
  });
  it("attaches the trend to each country", () => {
    const trends = new Map([
      ["SD", { net: 3, recent: 3, prior: 2 }],
      ["UA", { net: -2, recent: 2, prior: 5 }],
    ]);
    const z = conflictCountries(
      [
        { code: "SD", name: "Sudan", level: "critical" },
        { code: "UA", name: "Ukraine", level: "watch" },
      ],
      trends
    );
    expect(z.find((c) => c.code === "SD")).toMatchObject({ trend: "worsening" });
    expect(z.find((c) => c.code === "UA")).toMatchObject({ trend: "improving" });
  });
});

describe("escalation waves", () => {
  it("draws waves only where recent reports lean towards escalation", () => {
    const trends = new Map([
      ["a", { net: 2, recent: 2, prior: 3 }],
      ["b", { net: -1, recent: 1, prior: 3 }],
    ]);
    const w = escalationWaves(
      [
        { id: "a", lat: 15, lon: 32, level: "critical", locationLabel: "Khartoum", countryName: "Sudan" },
        { id: "b", lat: 9, lon: 38, level: "elevated", locationLabel: null, countryName: "Ethiopia" },
        { id: "c", lat: 2, lon: 45, level: "watch", locationLabel: null, countryName: "Somalia" },
      ],
      trends
    );
    expect(w.map((x) => x.id)).toEqual(["a"]);
  });
});


describe("active conflicts from UCDP", () => {
  it("matches UCDP's country names, including old names in brackets", () => {
    expect(codeForUcdpCountry("Myanmar (Burma)")).toBe("MM");
    expect(codeForUcdpCountry("DR Congo (Zaire)")).toBe("CD");
    expect(codeForUcdpCountry("Yemen (North Yemen)")).toBe("YE");
    expect(codeForUcdpCountry("Sudan")).toBe("SD");
    expect(codeForUcdpCountry("Atlantis")).toBeNull();
  });
  it("counts events and fatalities per country and lists names it cannot match", () => {
    const r = activeCountries([
      { country: "Sudan", best: 10, date_end: "2026-10-01" },
      { country: "Sudan", best: 5, date_end: "2026-10-09" },
      { country: "Ethiopia", best: 3, date_end: "2026-09-20" },
      { country: "Atlantis", best: 1, date_end: "2026-09-20" },
    ]);
    expect(r.countries[0]).toMatchObject({ code: "SD", events: 2, fatalities: 15, latest: "2026-10-09" });
    expect(r.countries.map((c) => c.code)).toEqual(["SD", "ET"]);
    expect(r.unmatched).toEqual(["Atlantis"]);
  });
  it("grades active countries by killed in the window", () => {
    expect(activeIntensityOf(0)).toBe(1);
    expect(activeIntensityOf(19)).toBe(1);
    expect(activeIntensityOf(20)).toBe(2);
    expect(activeIntensityOf(100)).toBe(3);
    expect(activeIntensityOf(500)).toBe(4);
    const r = activeCountries([
      { country: "Sudan", best: 600, date_end: "2026-10-01" },
      { country: "Ethiopia", best: 4, date_end: "2026-09-20" },
    ]);
    expect(r.countries).toMatchObject([
      { code: "SD", intensity: 4, intensityLabel: "Severe" },
      { code: "ET", intensity: 1, intensityLabel: "Low" },
    ]);
  });
});
