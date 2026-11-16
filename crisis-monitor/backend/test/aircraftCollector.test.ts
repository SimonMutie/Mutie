import { describe, expect, it } from "vitest";
import { pack } from "../src/lib/aircraftCollector";
import { readingsFrom } from "../src/lib/gpsInterference";

describe("aircraft collector", () => {
  const a = { hex: "abc123", callsign: "ETH500", lat: 9.123456, lon: 38.765432, speedKts: 460.4, military: false, registration: "ET-AUP", aircraftType: "B788", altitudeFt: 35000, trackDeg: 271.6, nacp: 9 };
  it("packs an aircraft compactly", () => {
    expect(pack(a)).toEqual(["abc123", "ETH500", "ET-AUP", "B788", 0, 9.1235, 38.7654, 35000, 460, 272]);
  });
  it("turns accuracy figures into GPS readings and skips aircraft without one", () => {
    expect(readingsFrom([a, { ...a, hex: "b", nacp: 3 }, { ...a, hex: "c", nacp: null }])).toEqual([
      { hex: "abc123", lat: 9.123456, lon: 38.765432, poor: false },
      { hex: "b", lat: 9.123456, lon: 38.765432, poor: true },
    ]);
  });
});
