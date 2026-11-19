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
    expect(token).toMatch(/^[A-Za-z0-9]{24}$/);
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

describe("tokens from before the change", () => {
  it("are accepted with or without their 'lens-' start", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    // The module made its tables in the earlier test's database; this one gets them by hand.
    d1.db.exec(`CREATE TABLE vehicles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#f5a524', token_hash TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL, speed_limit_kmh REAL, created_at TEXT NOT NULL, last_at TEXT, last_lat REAL, last_lng REAL, last_speed_kmh REAL, last_heading REAL, last_ignition INTEGER, last_battery REAL, last_accuracy REAL, zone_lat REAL, zone_lng REAL, zone_radius_m REAL, quiet_from INTEGER, quiet_to INTEGER, silent_minutes INTEGER, alert_state TEXT);
      CREATE TABLE vehicle_positions (vehicle_id TEXT NOT NULL, at TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, speed_kmh REAL, heading REAL, accuracy_m REAL, altitude_m REAL, ignition INTEGER, battery REAL, PRIMARY KEY (vehicle_id, at));
      CREATE TABLE tracking_log (at TEXT NOT NULL, outcome TEXT NOT NULL, method TEXT, content_type TEXT, user_agent TEXT, device TEXT, sample TEXT);
      CREATE TABLE vehicle_alerts (id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL, lat REAL, lng REAL, acknowledged_at TEXT);`);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lens-3hLnh92DQIT4B91dwcT3X69T")))].map((b) => b.toString(16).padStart(2, "0")).join("");
    d1.db.exec(`INSERT INTO vehicles (id, name, token_hash, owner_user_id, created_at) VALUES ('v', 'Car', '${hash}', 'a', '2026-01-01')`);
    for (const id of ["3hLnh92DQIT4B91dwcT3X69T", "lens-3hLnh92DQIT4B91dwcT3X69T", " 3hLnh92DQIT4B91dwcT3X69T "]) {
      expect((await trackingRouter.request(`/osmand?id=${encodeURIComponent(id)}&lat=-1.2339&lon=36.7136`, { method: "POST" }, env)).status).toBe(200);
    }
  });
});

describe("vehicle alerts", () => {
  it("raise once when a rule is broken, judge the zone on precise fixes only, and keep the car on its precise position", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('a', 'admin');
      CREATE TABLE vehicles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#f5a524', token_hash TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL, speed_limit_kmh REAL, created_at TEXT NOT NULL, last_at TEXT, last_lat REAL, last_lng REAL, last_speed_kmh REAL, last_heading REAL, last_ignition INTEGER, last_battery REAL, last_accuracy REAL, zone_lat REAL, zone_lng REAL, zone_radius_m REAL, quiet_from INTEGER, quiet_to INTEGER, silent_minutes INTEGER, alert_state TEXT);
      CREATE TABLE vehicle_positions (vehicle_id TEXT NOT NULL, at TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, speed_kmh REAL, heading REAL, accuracy_m REAL, altitude_m REAL, ignition INTEGER, battery REAL, PRIMARY KEY (vehicle_id, at));
      CREATE TABLE tracking_log (at TEXT NOT NULL, outcome TEXT NOT NULL, method TEXT, content_type TEXT, user_agent TEXT, device TEXT, sample TEXT);
      CREATE TABLE vehicle_alerts (id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL, lat REAL, lng REAL, acknowledged_at TEXT);`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    const admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "Content-Type": "application/json" };
    const call = (path: string, init: RequestInit = {}) => trackingRouter.request(path, init, env);
    const made = (await (await call("/vehicles", { method: "POST", headers: admin, body: JSON.stringify({ name: "Car", speedLimitKmh: 80 }) })).json()) as { vehicle: { id: string }; token: string };
    expect((await call(`/vehicles/${made.vehicle.id}`, { method: "PATCH", headers: admin, body: JSON.stringify({ zone: { lat: -1.2339, lng: 36.7136, radiusM: 300 } }) })).status).toBe(200);
    let t = Date.now() - 600_000;
    const send = (lat: number, lng: number, knots: number, accuracy: number) => call(`/osmand?id=${made.token}&lat=${lat}&lon=${lng}&speed=${knots}&accuracy=${accuracy}&timestamp=${Math.floor((t += 20_000) / 1000)}`, { method: "POST" });
    await send(-1.2339, 36.7136, 0, 8); // home, precise
    await send(-1.2400, 36.7300, 0, 900); // rough fix far away: neither moves the car nor counts as leaving the zone
    let car = ((await (await call("/vehicles", { headers: admin })).json()) as { vehicles: { last: { lat: number; accuracyM: number } }[] }).vehicles[0];
    expect(car.last.lat).toBeCloseTo(-1.2339, 4);
    expect(car.last.accuracyM).toBe(8);
    await send(-1.2500, 36.7300, 50, 6); // precise, 2.5 km away at 92.6 km/h: speeding and out of the zone
    await send(-1.2510, 36.7310, 52, 6); // still both: no new alerts
    const alerts = ((await (await call("/alerts", { headers: admin })).json()) as { alerts: { kind: string; message: string; id: string }[] }).alerts;
    expect(alerts.map((a) => a.kind).sort()).toEqual(["speed", "zone"]);
    expect(((await (await call("/vehicles", { headers: admin })).json()) as { vehicles: { alerting: boolean }[] }).vehicles[0].alerting).toBe(true);
    await call(`/alerts/${alerts[0].id}/ack`, { method: "POST", headers: admin });
    expect(((await (await call("/alerts", { headers: admin })).json()) as { alerts: unknown[] }).alerts).toHaveLength(1);
  });
});

describe("placing a parked car", () => {
  it("averages its wander and ignores impossible jumps", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('a', 'admin');
      CREATE TABLE vehicles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#f5a524', token_hash TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL, speed_limit_kmh REAL, created_at TEXT NOT NULL, last_at TEXT, last_lat REAL, last_lng REAL, last_speed_kmh REAL, last_heading REAL, last_ignition INTEGER, last_battery REAL, last_accuracy REAL, zone_lat REAL, zone_lng REAL, zone_radius_m REAL, quiet_from INTEGER, quiet_to INTEGER, silent_minutes INTEGER, alert_state TEXT);
      CREATE TABLE vehicle_positions (vehicle_id TEXT NOT NULL, at TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, speed_kmh REAL, heading REAL, accuracy_m REAL, altitude_m REAL, ignition INTEGER, battery REAL, PRIMARY KEY (vehicle_id, at));
      CREATE TABLE tracking_log (at TEXT NOT NULL, outcome TEXT NOT NULL, method TEXT, content_type TEXT, user_agent TEXT, device TEXT, sample TEXT);
      CREATE TABLE vehicle_alerts (id TEXT PRIMARY KEY, vehicle_id TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL, lat REAL, lng REAL, acknowledged_at TEXT);`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    const admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "Content-Type": "application/json" };
    const call = (path: string, init: RequestInit = {}) => trackingRouter.request(path, init, env);
    const made = (await (await call("/vehicles", { method: "POST", headers: admin, body: JSON.stringify({ name: "Car" }) })).json()) as { vehicle: { id: string }; token: string };
    let t = Date.now() - 120_000;
    const send = (lat: number, lng: number, accuracy: number) => call(`/osmand?id=${made.token}&lat=${lat}&lon=${lng}&speed=0&accuracy=${accuracy}&timestamp=${Math.floor((t += 10_000) / 1000)}`, { method: "POST" });
    // A parked car whose fixes wander about 10 m around -1.233900, 36.713600.
    for (const [dLat, dLng] of [[0.00009, 0], [-0.00009, 0], [0, 0.00009], [0, -0.00009]]) await send(-1.2339 + dLat, 36.7136 + dLng, 6);
    const last = async () => ((await (await call("/vehicles", { headers: admin })).json()) as { vehicles: { last: { lat: number; lng: number } }[] }).vehicles[0].last;
    let p = await last();
    expect(p.lat).toBeCloseTo(-1.2339, 4);
    expect(p.lng).toBeCloseTo(36.7136, 4);
    // A glitch 50 km away 10 seconds later is ignored.
    await send(-1.68, 36.71, 5);
    p = await last();
    expect(p.lat).toBeCloseTo(-1.2339, 3);
    // All 30 fixes as sent are there to check, the glitch included.
    const recent = (await (await call(`/vehicles/${made.vehicle.id}/recent`, { headers: admin })).json()) as { points: unknown[] };
    expect(recent.points).toHaveLength(5);
  });
});
