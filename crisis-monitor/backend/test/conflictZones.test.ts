import { describe, expect, it } from "vitest";
import { conflictProvinces, provinceAt } from "../src/lib/conflictZones";

const spread = (lat: number, lon: number, n: number) => Array.from({ length: n }, (_, i) => ({ lat: lat + i * 0.03, lon: lon + i * 0.03 }));

describe("conflict provinces", () => {
  it("finds the province a point is in", () => {
    expect(provinceAt(13.4967, 39.4753)).toMatchObject({ country: "ET", name: "Tigray" }); // Mekelle
    expect(provinceAt(-1.68, 29.22)).toMatchObject({ country: "CD" }); // Goma
    expect(provinceAt(9.9, 32.7)).toMatchObject({ country: "SS", name: "Upper Nile" });
    expect(provinceAt(49.99, 36.23)).toBeNull(); // Kharkiv
  });
  it("shades the whole province once enough separate reports fall in it", () => {
    const z = conflictProvinces(spread(13.4, 39.4, 7)).filter((p) => p.tier === "active");
    expect(z.map((p) => p.id)).toEqual(["ET:Tigray"]);
    expect(z[0].rings.length).toBeGreaterThan(0);
  });
  it("lets one verified incident stand on its own", () => {
    expect(conflictProvinces([{ lat: 9.9, lon: 32.7, verified: true }]).filter((p) => p.tier === "active").map((p) => p.name)).toEqual(["Upper Nile"]);
  });
  it("ignores a few reports, and reports piled on one coordinate", () => {
    const act = (pts: Parameters<typeof conflictProvinces>[0]) => conflictProvinces(pts).filter((p) => p.tier === "active");
    expect(act(spread(13.4, 39.4, 3))).toHaveLength(0);
    expect(act(Array.from({ length: 40 }, () => ({ lat: 13.4967, lon: 39.4753 })))).toHaveLength(0);
    expect(act([{ lat: 13.4967, lon: 39.4753, weight: 500 }])).toHaveLength(0);
  });
  it("shades nothing when there is no fresh fighting, however long a war has lasted", () => {
    expect(conflictProvinces([])).toHaveLength(0);
  });
  it("shows a province with fresh fighting once, as active, with its note", () => {
    const z = conflictProvinces([{ lat: 11.8, lon: 13.15, verified: true }]);
    expect(z.map((p) => p.id)).toEqual(["NG:Borno"]);
    expect(z[0].tier).toBe("active");
  });
});
