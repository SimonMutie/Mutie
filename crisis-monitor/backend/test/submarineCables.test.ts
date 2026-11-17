import { describe, expect, it } from "vitest";
import { isPowerCable, SUBMARINE_CABLE_QUERY } from "../src/routes/liveLayers";

describe("submarine cables from OpenStreetMap", () => {
  it("asks for every way telecom cables are tagged, not only the nautical one", () => {
    for (const tag of ['"seamark:type"="cable_submarine"', '"telecom"="line"', '"communication"="line"', '"cable"="submarine"', 'relation["seamark:type"="cable_submarine"]', '"telecom"="cable_landing_station"']) {
      expect(SUBMARINE_CABLE_QUERY).toContain(tag);
    }
  });
  it("keeps power cables out", () => {
    expect(isPowerCable({ "seamark:cable_submarine:category": "power" })).toBe(true);
    expect(isPowerCable({ power: "cable", location: "underwater" })).toBe(true);
    expect(isPowerCable({ cable: "submarine", name: "NorNed HVDC" })).toBe(true);
    expect(isPowerCable({ telecom: "line", location: "underwater", name: "2Africa" })).toBe(false);
    expect(isPowerCable({ "seamark:type": "cable_submarine", name: "PEACE Cable" })).toBe(false);
  });
});
