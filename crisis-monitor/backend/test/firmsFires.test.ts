import { describe, expect, it } from "vitest";
import { fireFeatures, mergePasses, storedFires } from "../src/routes/liveLayers";

const det = (lat: number, lon: number, source: string, time: string, frp: number, date = "2026-11-17") => ({ lat, lon, source, date, time, frp, confidence: "n", daynight: "D" });

describe("fire detections", () => {
  it("draws one point per spot per day, the strongest pass, noting how many passes saw it", () => {
    const raw = [det(8.5, 20.1, "noaa20", "1130", 5), det(8.5005, 20.1003, "snpp", "1210", 12), det(8.5, 20.1, "noaa21", "0050", 3), det(9.0, 21.0, "noaa20", "1130", 7)];
    const { raw: kept, total } = mergePasses(raw);
    expect(total).toBe(2);
    expect(kept[0].frp).toBe(12);
    const f = fireFeatures(raw);
    expect(f).toHaveLength(2);
    expect(String(f[0].properties.detail)).toContain("seen on 3 satellite passes");
  });

  it("reads the last 24 hours from the stored collection when it is fresh, not when it is stale", async () => {
    const now = new Date("2026-11-17T12:00:00Z");
    let sql = "";
    const db = (finished: string) =>
      ({
        batch: async () => [],
        prepare: (q: string) => ({
          first: async () => ({ finished_at: finished, status: "ok" }),
          bind: (...a: string[]) => ((sql = `${q} ${a.join(",")}`), { all: async () => ({ results: [{ acq_date: "2026-11-17", acq_time: "0130", lat: 8.5, lon: 20.1, satellite: "noaa20", frp: 4, confidence: "n", daynight: "N" }] }) }),
          run: async () => ({}),
        }),
      }) as never;
    const fresh = await storedFires(db("2026-11-17T10:00:00Z"), now);
    expect(fresh?.raw).toHaveLength(1);
    expect(sql).toContain("2026-11-16,2026-11-16,1200");
    expect(await storedFires(db("2026-11-17T02:00:00Z"), now)).toBeNull();
  });
});
