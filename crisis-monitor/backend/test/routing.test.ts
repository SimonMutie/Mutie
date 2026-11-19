import { describe, expect, it } from "vitest";
import { decodePolyline6, roadRoute } from "../src/lib/routing";

const nairobi: [number, number] = [-1.29, 36.82];
const mombasa: [number, number] = [-4.04, 39.66];
const osrmOk = () => new Response(JSON.stringify({ code: "Ok", routes: [{ geometry: { coordinates: [[36.82, -1.29], [39.66, -4.04]] }, distance: 480000, duration: 28800 }] }));

describe("road routes", () => {
  it("uses the OpenStreetMap community's OSRM with the right profile per mode", async () => {
    const calls: string[] = [];
    const f = async (u: string) => (calls.push(u), osrmOk());
    const r = await roadRoute([nairobi, mombasa], "walking", f);
    expect(r).toMatchObject({ distanceMeters: 480000, provider: "OpenStreetMap routing (OSRM)" });
    expect(calls[0]).toBe("https://routing.openstreetmap.de/routed-foot/route/v1/foot/36.82,-1.29;39.66,-4.04?overview=full&geometries=geojson");
  });

  it("falls back to Valhalla, then to OSRM's demo, when servers refuse", async () => {
    const shape = "_c`|@_c`|@_c`|@_c`|@"; // two points
    const f = async (u: string) => {
      if (u.includes("routing.openstreetmap.de")) return new Response("", { status: 403 });
      if (u.includes("valhalla")) return new Response(JSON.stringify({ trip: { legs: [{ shape }], summary: { length: 480, time: 28800 } } }));
      return osrmOk();
    };
    const r = await roadRoute([nairobi, mombasa], "driving", f);
    expect(r.provider).toBe("OpenStreetMap routing (Valhalla)");
    expect(r.distanceMeters).toBe(480000);
    const demo = await roadRoute([nairobi, mombasa], "driving", async (u: string) => (u.includes("project-osrm") ? osrmOk() : new Response("", { status: 503 })));
    expect(demo.provider).toBe("OSRM demo");
  });

  it("explains every failure when no server can route", async () => {
    await expect(roadRoute([nairobi, mombasa], "cycling", async () => new Response("", { status: 403 }))).rejects.toThrow(/OSRM\) returned 403.*Valhalla\) returned 403/);
  });

  it("decodes Valhalla's polyline6 shapes", () => {
    expect(decodePolyline6("_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI")).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  });
});
