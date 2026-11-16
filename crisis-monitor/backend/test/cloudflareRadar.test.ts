import { describe, expect, it } from "vitest";
import { mapAttackOrigins, mapOutages, readRadar } from "../src/lib/cloudflareRadar";

describe("Cloudflare Radar", () => {
  it("places outage annotations by country, one per country, and marks ongoing ones", () => {
    const out = mapOutages({ annotations: [{ id: "a1", locations: ["SD", "XX"], locationsDetails: [{ code: "SD", name: "Sudan" }], scope: "Nationwide", outage: { outageCause: "GOVERNMENT_DIRECTED" }, description: "Shutdown", startDate: "2026-11-10T00:00:00Z", endDate: null }] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ country: "SD", countryName: "Sudan", cause: "GOVERNMENT_DIRECTED", ongoing: true });
  });
  it("reads attack origins and says when no token is set", async () => {
    expect(mapAttackOrigins({ top_0: [{ originCountryAlpha2: "YE", originCountryName: "Yemen", value: "1.234" }] })[0]).toMatchObject({ country: "YE", share: 1.23 });
    const r = await readRadar(undefined, {});
    expect(r.configured).toBe(false);
    expect(r.errors[0]).toContain("CLOUDFLARE_RADAR_TOKEN");
  });
});
