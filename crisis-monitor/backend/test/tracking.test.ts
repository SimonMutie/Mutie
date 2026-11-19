import { describe, expect, it } from "vitest";
import { parseFixes } from "../src/routes/tracking";

describe("vehicle positions from trackers", () => {
  it("reads the OsmAnd query form (older Traccar Client, DIY boards)", () => {
    const [f] = parseFixes({ id: "lens-abc", lat: "-1.2921", lon: "36.8219", speed: "10", bearing: "90", batt: "77", timestamp: "1763560000" }, null, null);
    expect(f.token).toBe("lens-abc");
    expect(f.lat).toBeCloseTo(-1.2921);
    expect(f.lng).toBeCloseTo(36.8219);
    expect(f.speedKmh).toBeCloseTo(18.52);
    expect(f.heading).toBe(90);
    expect(f.battery).toBe(77);
  });
  it("reads the JSON body newer Traccar Client versions send, with speed in metres a second", () => {
    const [f] = parseFixes({}, null, { device_id: "lens-abc", location: { timestamp: new Date().toISOString(), coords: { latitude: -1.3, longitude: 36.8, speed: 10, heading: -1, accuracy: 5 }, battery: { level: 0.5 } } });
    expect(f.speedKmh).toBeCloseTo(36);
    expect(f.heading).toBeNull();
    expect(f.battery).toBe(50);
  });
  it("reads several stored positions sent together", () => {
    const fixes = parseFixes({}, null, { device_id: "x", location: [{ coords: { latitude: 1, longitude: 2 } }, { coords: { latitude: 3, longitude: 4 } }] });
    expect(fixes).toHaveLength(2);
  });
  it("dates positions from a wrong clock as now", () => {
    const [f] = parseFixes({ id: "x", lat: "1", lon: "2", timestamp: "4102444800" }, null, null);
    expect(Math.abs(Date.parse(f.at) - Date.now())).toBeLessThan(5000);
  });
});

import { beforeAll } from "vitest";
import { trackingRouter } from "../src/routes/tracking";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("the tracking routes", () => {
  let env: Env;
  let admin: Record<string, string>;
  let other: Record<string, string>;
  beforeAll(async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('a', 'admin'), ('u1', 'ann');`);
    env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "Content-Type": "application/json" };
    other = { Authorization: `Bearer ${await createSessionToken("u1", "client", "s")}`, "Content-Type": "application/json" };
  });
  const call = (path: string, init: RequestInit) => trackingRouter.request(path, init, env);

  it("takes positions from a phone with the vehicle's token, and shows them only to those allowed", async () => {
    expect((await call("/vehicles", { method: "POST", headers: other, body: JSON.stringify({ name: "X" }) })).status).toBe(403);
    const made = await call("/vehicles", { method: "POST", headers: admin, body: JSON.stringify({ name: "Land Cruiser", color: "#22c55e" }) });
    expect(made.status).toBe(201);
    const { vehicle, token } = (await made.json()) as { vehicle: { id: string }; token: string };
    // No sign-in needed to send a position; an unknown device id is refused.
    expect((await call(`/osmand?id=nope&lat=-1.29&lon=36.82`, { method: "POST" })).status).toBe(401);
    expect((await call(`/osmand?id=${token}&lat=-1.29&lon=36.82&speed=20&bearing=45`, { method: "POST" })).status).toBe(200);
    const body = { device_id: token, location: { timestamp: new Date(Date.now() + 1000).toISOString(), coords: { latitude: -1.3, longitude: 36.83, speed: 5, heading: 90 } } };
    expect((await call(`/osmand`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status).toBe(200);
    const list = (await (await call("/vehicles", { headers: admin })).json()) as { vehicles: { last: { lat: number; heading: number } }[] };
    expect(list.vehicles[0].last.lat).toBeCloseTo(-1.3);
    expect(list.vehicles[0].last.heading).toBe(90);
    const track = (await (await call(`/vehicles/${vehicle.id}/track?hours=1`, { headers: admin })).json()) as { points: unknown[] };
    expect(track.points).toHaveLength(2);
    // Another user does not see it; signed-out requests are refused.
    expect(((await (await call("/vehicles", { headers: other })).json()) as { vehicles: unknown[] }).vehicles).toHaveLength(0);
    expect((await call("/vehicles", {})).status).toBe(401);
    // JSON sent without saying so is still read, and every attempt is in the log without the full token.
    expect((await call(`/osmand`, { method: "POST", body: JSON.stringify({ ...body, location: { ...body.location, timestamp: new Date(Date.now() + 2000).toISOString() } }) })).status).toBe(200);
    const log = (await (await call("/log", { headers: admin })).json()) as { log: { outcome: string; sample: string }[] };
    expect(log.log[0].outcome).toMatch(/^Saved/);
    expect(log.log.some((l) => l.outcome.startsWith("Unknown device id"))).toBe(true);
    expect(JSON.stringify(log)).not.toContain(token);
  });
});
