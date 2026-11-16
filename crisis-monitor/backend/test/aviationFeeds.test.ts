import { describe, expect, it } from "vitest";
import { AIRCRAFT_POINTS, fetchAdsbLolAircraft, readAdsbLol } from "../src/lib/aviationFeeds";

describe("adsb.lol aircraft", () => {
  it("keeps airborne aircraft and reads the military flag", () => {
    const got = readAdsbLol({ ac: [
      { hex: "ABC123", flight: "ETH500  ", lat: 9, lon: 38.8, alt_baro: 35000, gs: 460, dbFlags: 0, t: "B788" },
      { hex: "~ae1234", lat: 12, lon: 43, alt_baro: 20000, dbFlags: 1 },
      { hex: "abc999", lat: 9, lon: 38.8, alt_baro: "ground" },
      { hex: "abc998" },
    ] });
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ hex: "abc123", callsign: "ETH500", military: false, speedKts: 460, aircraftType: "B788" });
    expect(got[1]).toMatchObject({ hex: "ae1234", callsign: null, military: true });
  });
  it("reads every circle, counts each aircraft once, and survives failures", async () => {
    let calls = 0;
    const fetcher = async (url: string) => {
      calls++;
      if (url.includes("/point/9/39/")) return new Response("busy", { status: 503 });
      if (url.endsWith("/mil")) return Response.json({ ac: [{ hex: "aaa111", lat: 12, lon: 43, alt_baro: 9000, dbFlags: 1 }] });
      return Response.json({ ac: [{ hex: "aaa111", lat: 12, lon: 43, alt_baro: 9000 }, { hex: "bbb222", lat: 1, lon: 1, alt_baro: 9000 }] });
    };
    const out = await fetchAdsbLolAircraft(fetcher);
    expect(calls).toBe(AIRCRAFT_POINTS.length + 1);
    expect(out.pointsFailed).toBe(1);
    expect(out.aircraft).toHaveLength(2);
    expect(out.aircraft.find((a) => a.hex === "aaa111")?.military).toBe(true);
  });
});
