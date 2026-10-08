import { describe, expect, it } from "vitest";
import { distanceKm, incidentsNear, partsOf } from "../../frontend/src/studio/proximity";

const line: GeoJSON.Feature = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[36, 0], [38, 0]] } };
const square: GeoJSON.Feature = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[36, -1], [38, -1], [38, 1], [36, 1], [36, -1]]] } };

describe("incidentsNear", () => {
  it("measures distance to a line", () => {
    expect(distanceKm(37, 0.09, partsOf(line))).toBeCloseTo(10, 0);
    expect(distanceKm(35, 0, partsOf(line))).toBeCloseTo(111.3, 0);
  });
  it("finds incidents within the radius, nearest first, and ignores ones without coordinates", () => {
    const rows = [
      { id: "far", latitude: 0.5, longitude: 37 },
      { id: "near", latitude: 0.05, longitude: 37.5 },
      { id: "mid", latitude: 0.2, longitude: 36.2 },
      { id: "none", latitude: null, longitude: null },
    ];
    const r = incidentsNear(rows, line, 30);
    expect(r.map((x) => x.row.id)).toEqual(["near", "mid"]);
  });
  it("counts everything inside an area as distance 0", () => {
    expect(distanceKm(37, 0.3, partsOf(square))).toBe(0);
    expect(incidentsNear([{ latitude: 0.3, longitude: 37 }, { latitude: 3, longitude: 37 }], square, 5)).toHaveLength(1);
  });
  it("handles a point and a collection", () => {
    const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [line, { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [30, 10] } }] };
    expect(incidentsNear([{ latitude: 10.05, longitude: 30 }], fc, 10)).toHaveLength(1);
  });
});

import { classifyActor } from "../../frontend/src/components/actorTheme";
describe("actor theme", () => {
  it("uses the chosen colours", () => {
    expect(classifyActor("AOG").color).toBe("#dc2626"); // red
    expect(classifyActor("Criminal gang").color).toBe("#2563eb"); // blue
    expect(classifyActor("Security Forces").color).toBe("#166534"); // dark green
    expect(classifyActor("Tribal clash").color).toBe("#eab308"); // yellow
    expect(classifyActor("Terrorist group").color).toBe("#dc2626"); // terrorism is red too
    expect(classifyActor("Tribal clash").label).toBe("Tribal");
  });
});
