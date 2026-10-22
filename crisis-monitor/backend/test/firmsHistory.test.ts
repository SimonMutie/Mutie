import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeD1 } from "./fakeD1";
import { collectFireDetections } from "../src/lib/firmsHistory";

const feature = (lat: number, lon: number, date: string, time: number) => ({
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { acq_date: date, acq_time: time, frp: 12.5, confidence: "n", daynight: "D" },
});

afterEach(() => vi.unstubAllGlobals());

describe("FIRMS fire history collector", () => {
  it("stores detections once, skips a repeat run inside three hours, and records the run", async () => {
    const { DB, db } = fakeD1();
    const env = { DB, FIRMS_MAP_KEY: "k" } as never;
    const fetchMock = vi.fn(async (url: string) => {
      // Only the first page of each job has data; a short page ends paging.
      const first = url.includes("STARTINDEX=0&");
      const features = first ? [feature(-1.2345, 36.5, "2026-10-20", 1056), feature(9.1, 30.2, "2026-10-21", 230)] : [];
      return new Response(JSON.stringify({ features }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const now = new Date("2026-10-22T12:00:00Z");
    const first = await collectFireDetections(env, now);
    expect(first.skipped).toBe(false);
    expect(first.fetched).toBeGreaterThan(0);
    // Each of the 6 region and satellite jobs returns the same two points, so the store keeps 2 per satellite.
    expect(first.inserted).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const stored = db.prepare("SELECT COUNT(*) AS n FROM fire_detections").get() as { n: number };
    expect(stored.n).toBe(6);

    const run = db.prepare("SELECT status, inserted FROM fire_collector_runs WHERE run_key = 'firms'").get() as { status: string; inserted: number };
    expect(run.status).toBe("ok");
    expect(run.inserted).toBe(6);

    const again = await collectFireDetections(env, new Date("2026-10-22T13:00:00Z"));
    expect(again.skipped).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("records a failed run with its error, and keeps going job by job", async () => {
    const { DB, db } = fakeD1();
    const env = { DB, FIRMS_MAP_KEY: "k" } as never;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const result = await collectFireDetections(env, new Date("2026-10-22T12:00:00Z"));
    expect(result.errors.length).toBe(6);
    expect(result.inserted).toBe(0);
    const run = db.prepare("SELECT status, error FROM fire_collector_runs WHERE run_key = 'firms'").get() as { status: string; error: string };
    expect(run.status).toBe("failed");
    expect(run.error).toContain("returned 500");
  });

  it("does nothing without a FIRMS key", async () => {
    const { DB } = fakeD1();
    const result = await collectFireDetections({ DB } as never);
    expect(result.skipped).toBe(true);
  });
});
