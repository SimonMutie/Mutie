import { describe, expect, it } from "vitest";
import { conflictProvinces, provinceAt } from "../src/lib/conflictZones";

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
