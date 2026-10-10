import { describe, expect, it } from "vitest";
import { buildMapScene, sceneToPng, sceneToSvg, MAP_H, MAP_W, mapCaption } from "../src/lib/staticMap";

describe("static map", () => {
  it("centres on the province an incident is in and pins the place", () => {
    const s = buildMapScene({ lat: 11.85, lon: 13.15, level: "critical", precision: "place" }); // Maiduguri
    expect(s.provinceName).toBe("Borno");
    expect(s.countryCode).toBe("NG");
    expect(s.pin).not.toBeNull();
    expect(s.pin!.x).toBeGreaterThan(0);
    expect(s.pin!.x).toBeLessThan(MAP_W);
    expect(s.polys.length).toBeGreaterThan(1);
  });
  it("tints the whole country and shows no pin when only the country was named", () => {
    const s = buildMapScene({ lat: 9.1, lon: 8.7, level: "elevated", precision: "country", countryCode: "NG" });
    expect(s.pin).toBeNull();
    expect(s.polys.filter((p) => p.fill.startsWith("rgba(224,110")).length).toBeGreaterThan(20);
  });
  it("writes an SVG with no script and no text", () => {
    const svg = sceneToSvg(buildMapScene({ lat: -1.68, lon: 29.22, level: "elevated", precision: "approximate" }));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<script|<text/);
  });
  it("writes a valid PNG of the right size with the incident colour in it", async () => {
    const png = await sceneToPng(buildMapScene({ lat: 13.4967, lon: 39.4753, level: "critical", precision: "place" }));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect(dv.getUint32(16)).toBe(MAP_W);
    expect(dv.getUint32(20)).toBe(MAP_H);
    expect(png.length).toBeGreaterThan(2000);
  });
  it("words the caption by how precise the location is", () => {
    const s = buildMapScene({ lat: 13.4967, lon: 39.4753, level: "critical", precision: "place" });
    expect(mapCaption({ locationLabel: "Mekelle", countryName: "Ethiopia", precision: "place" }, s)).toMatch(/Tigray, Ethiopia/);
    expect(mapCaption({ locationLabel: null, countryName: "Ethiopia", precision: "country" }, s)).toMatch(/whole country/);
  });
});
