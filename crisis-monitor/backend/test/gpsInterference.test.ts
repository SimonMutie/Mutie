import { describe, expect, it } from "vitest";
import { cellOf, levelOf, readAircraft, summariseCells } from "../src/lib/gpsInterference";

describe("GPS interference", () => {
  it("keeps ADS-B aircraft with an accuracy figure and marks poor ones", () => {
    const got = readAircraft({ ac: [
      { hex: "ABC123", lat: 15.6, lon: 32.5, type: "adsb_icao", nac_p: 9 },
      { hex: "abc124", lat: 15.6, lon: 32.5, type: "adsb_icao", nac_p: 2 },
      { hex: "abc125", lat: 15.6, lon: 32.5, type: "mlat", nac_p: 0 },
      { hex: "abc126", lat: 15.6, lon: 32.5, type: "adsb_icao" },
      { hex: "abc127", type: "adsb_icao", nac_p: 1 },
    ] });
    expect(got).toEqual([{ hex: "abc123", lat: 15.6, lon: 32.5, poor: false }, { hex: "abc124", lat: 15.6, lon: 32.5, poor: true }]);
    expect(readAircraft(null)).toEqual([]);
  });
  it("puts points in half-degree squares, south and west edges", () => {
    expect(cellOf(15.6, 32.4)).toBe("15.5:32");
    expect(cellOf(-1.2, -0.3)).toBe("-1.5:-0.5");
  });
  it("hides thin squares and grades the rest", () => {
    const cells = summariseCells([{ cell: "15.5:32", aircraft: 10, poor: 3 }, { cell: "1:1", aircraft: 2, poor: 2 }, { cell: "2:2", aircraft: 50, poor: 0 }]);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ lat: 15.75, lon: 32.25, level: "high", share: 0.3 });
    expect(levelOf(0.05)).toBe("medium");
    expect(cells[1].level).toBe("low");
  });
});
