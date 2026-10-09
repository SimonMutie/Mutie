import { describe, expect, it } from "vitest";
import { conflictZones } from "../src/lib/conflictZones";

describe("conflict zones", () => {
  it("draws a cell where several separate reports cluster on land", () => {
    // Around El Fasher, Sudan: four distinct coordinates in one half-degree cell.
    const pts = [[13.63, 25.35], [13.65, 25.3], [13.7, 25.4], [13.6, 25.45]].map(([lat, lon]) => ({ lat, lon }));
    const z = conflictZones(pts);
    expect(z.boxes).toHaveLength(1);
    const [s, w, n, e] = z.boxes[0];
    expect(13.63).toBeGreaterThanOrEqual(s);
    expect(13.63).toBeLessThan(n);
    expect(25.35).toBeGreaterThanOrEqual(w);
    expect(25.35).toBeLessThan(e);
  });
  it("ignores a single report, reports piled on one coordinate, and the open sea", () => {
    expect(conflictZones([{ lat: 13.63, lon: 25.35 }]).boxes).toHaveLength(0);
    expect(conflictZones(Array.from({ length: 30 }, () => ({ lat: 13.63, lon: 25.35 }))).boxes).toHaveLength(0);
    expect(conflictZones(Array.from({ length: 10 }, (_, i) => ({ lat: 0 + i * 0.01, lon: -20 }))).boxes).toHaveLength(0);
  });
  it("lets a verified incident stand on its own and joins neighbouring cells", () => {
    const z = conflictZones([{ lat: 13.6, lon: 25.2, verified: true }, { lat: 13.6, lon: 25.7, verified: true }]);
    expect(z.cells).toBe(2);
    expect(z.boxes).toHaveLength(1);
  });
});
