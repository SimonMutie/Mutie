import { describe, expect, it } from "vitest";
import { collectSeries, levelFrom, median, readConnectivity, readSignals } from "../src/lib/ioda";

const body = (bgp: number[], ping: number[]) => ({ type: "signals", error: null, data: [[{ entityCode: "ET", datasource: "bgp", values: bgp }, { entityCode: "ET", datasource: "ping-slash24", values: ping }]] });

describe("IODA connectivity", () => {
  it("finds series however they are nested and drops nulls", () => {
    const s = collectSeries({ data: [[{ datasource: "bgp", values: [1, null, 3] }], { datasource: "x", values: [2] }] });
    expect(s).toEqual([{ datasource: "bgp", values: [1, 3] }, { datasource: "x", values: [2] }]);
  });
  it("takes medians and the weakest signal", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
    const signals = readSignals([{ datasource: "bgp", values: [100, 100] }, { datasource: "ping", values: [200] }], [{ datasource: "bgp", values: [95] }, { datasource: "ping", values: [100] }]);
    expect(levelFrom(signals)).toEqual({ level: "severe", ratio: 0.5 });
  });
  it("calls a thin baseline unmeasured", () => {
    expect(levelFrom(readSignals([{ datasource: "bgp", values: [2] }], [{ datasource: "bgp", values: [0] }])).level).toBe("unmeasured");
  });
  it("reads every country, and reports an upstream failure instead of throwing", async () => {
    const fetcher = async (url: string) => {
      if (url.includes("/country/ER")) return new Response("nope", { status: 500 });
      const baseline = url.includes("from=1789430400");
      return Response.json(body(baseline ? [100, 100] : [80], baseline ? [50] : [50]));
    };
    const out = await readConnectivity(new Date("2026-11-16T00:00:00Z"), fetcher);
    expect(out.countries).toHaveLength(7);
    const et = out.countries.find((c) => c.code === "ET")!;
    expect(et.level).toBe("degraded");
    expect(et.ratio).toBeCloseTo(0.8);
    const er = out.countries.find((c) => c.code === "ER")!;
    expect(er.level).toBe("unmeasured");
    expect(er.error).toContain("500");
    expect(out.diagnostics.length).toBe(14);
  });
});
