import { afterEach, describe, expect, it, vi } from "vitest";
import { boundariesRouter } from "../src/routes/boundaries";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("the boundary library", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fetches a level once from geoBoundaries, trims it, and serves it from the database after", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0); INSERT INTO users (id, username) VALUES ('u', 'ann');`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    const h = { Authorization: `Bearer ${await createSessionToken("u", "client", "s")}` };
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.endsWith("/ALL/ALL/")) return new Response(JSON.stringify([{ boundaryISO: "SDN", boundaryName: "Sudan", boundaryType: "ADM1", boundaryCanonical: "States", admUnitCount: "18" }, { boundaryISO: "SDN", boundaryName: "Sudan", boundaryType: "ADM0", admUnitCount: "1" }]));
      if (url.endsWith("/SDN/ADM1/")) return new Response(JSON.stringify({ boundaryISO: "SDN", boundaryType: "ADM1", boundaryCanonical: "States", simplifiedGeometryGeoJSON: "https://files.example/sdn-adm1.geojson" }));
      if (url.includes("sdn-adm1")) return new Response(JSON.stringify({ type: "FeatureCollection", features: [{ properties: { shapeName: "Khartoum", shapeID: "SDN-ADM1-1", shapeISO: "SD-KH", extra: "x".repeat(50) }, geometry: { type: "Polygon", coordinates: [[[32.123456, 15.123456], [33.000001, 15.1], [33, 16], [33, 16], [32.123456, 15.123456]]] } }] }));
      return new Response("no", { status: 404 });
    });
    const cat = (await (await boundariesRouter.request("/catalogue", { headers: h }, env)).json()) as { countries: { iso: string; levels: { level: string; canonical: string }[] }[] };
    expect(cat.countries[0]).toMatchObject({ iso: "SDN", levels: [{ level: "ADM0" }, { level: "ADM1", canonical: "States" }] });
    const fc = (await (await boundariesRouter.request("/SDN/ADM1", { headers: h }, env)).json()) as { features: { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }[] };
    expect(fc.features[0].properties).toEqual({ id: "SDN-ADM1-1", name: "Khartoum", iso: "SDN", level: "ADM1" });
    expect(fc.features[0].geometry.coordinates[0][0]).toEqual([32.1235, 15.1235]);
    expect(fc.features[0].geometry.coordinates[0]).toHaveLength(4); // the repeated corner dropped
    const before = calls.length;
    await boundariesRouter.request("/SDN/ADM1", { headers: h }, env);
    expect(calls.length).toBe(before); // from the database the second time
    expect((await boundariesRouter.request("/SDN/ADM9", { headers: h }, env)).status).toBe(400);
  });
});
