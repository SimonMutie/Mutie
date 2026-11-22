import { beforeAll, describe, expect, it } from "vitest";
import { liveLayersRouter } from "../src/routes/liveLayers";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("editing watch zones", () => {
  let env: Env;
  let admin: Record<string, string>;
  let viewer: Record<string, string>;
  beforeAll(async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('a', 'admin'), ('u', 'ann');`);
    env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "Content-Type": "application/json" };
    viewer = { Authorization: `Bearer ${await createSessionToken("u", "client", "s")}`, "Content-Type": "application/json" };
  });
  const call = (path: string, init: RequestInit) => liveLayersRouter.request(path, init, env);
  const shape = { type: "Polygon", coordinates: [[[30, 10], [33, 10], [33, 14], [30, 14], [30, 10]]] };

  it("keeps an admin's boundary and colour, shows them to everyone, and resets", async () => {
    expect((await call("/watch-zones/sudan/override", { method: "PUT", headers: viewer, body: JSON.stringify({ color: "#123456" }) })).status).toBe(403);
    expect((await call("/watch-zones/sudan/override", { method: "PUT", headers: admin, body: JSON.stringify({ geometry: shape, color: "#7c3aed" }) })).status).toBe(200);
    expect((await call("/watch-zones/sudan/override", { method: "PUT", headers: admin, body: JSON.stringify({ color: "purple" }) })).status).toBe(400);
    let o = (await (await call("/watch-zones/overrides", { headers: viewer })).json()) as { overrides: { id: string; color: string; geometry: { type: string } }[] };
    expect(o.overrides[0]).toMatchObject({ id: "sudan", color: "#7c3aed", geometry: { type: "Polygon" } });
    // Clearing the colour keeps the boundary; clearing both returns the zone to its default.
    await call("/watch-zones/sudan/override", { method: "PUT", headers: admin, body: JSON.stringify({ color: null }) });
    o = (await (await call("/watch-zones/overrides", { headers: viewer })).json()) as typeof o;
    expect(o.overrides[0].color).toBeNull();
    await call("/watch-zones/sudan/override", { method: "PUT", headers: admin, body: JSON.stringify({ geometry: null }) });
    o = (await (await call("/watch-zones/overrides", { headers: viewer })).json()) as typeof o;
    expect(o.overrides).toHaveLength(0);
  });
});

import { composeZones, matchZone, buildZones } from "../src/lib/watchZones";

describe("watch zones from boundary areas", () => {
  it("adds made zones, retires standing ones, and matches reports by the areas' names", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('a', 'admin');
      CREATE TABLE watch_zone_overrides (zone_id TEXT PRIMARY KEY, geometry TEXT, color TEXT, updated_by TEXT, updated_at TEXT NOT NULL, label TEXT, severity TEXT, description TEXT, units TEXT, units_geometry TEXT, base_dropped INTEGER, retired INTEGER, custom INTEGER, bounds TEXT);`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    const admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "Content-Type": "application/json" };
    const call = (path: string, init: RequestInit) => liveLayersRouter.request(path, init, env);
    const units = [{ key: "KEN:ADM1:K1", iso: "KEN", level: "ADM1", id: "K1", name: "Marsabit" }];
    const made = await call("/watch-zones/custom", { method: "POST", headers: admin, body: JSON.stringify({ label: "Marsabit clashes", severity: "high", units, bounds: { minLat: 1, maxLat: 4.5, minLng: 36, maxLng: 39.5 } }) });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    await call("/watch-zones/libya/override", { method: "PUT", headers: admin, body: JSON.stringify({ retired: true }) });
    await call("/watch-zones/sudan/override", { method: "PUT", headers: admin, body: JSON.stringify({ severity: "high", units: [{ key: "SSD:ADM2:A", iso: "SSD", level: "ADM2", id: "A", name: "Abyei" }] }) });
    const rows = d1.db.prepare(`SELECT * FROM watch_zone_overrides`).all() as never[];
    const zones = composeZones(rows);
    expect(zones.find((z) => z.id === "libya")).toBeUndefined();
    expect(zones.find((z) => z.id === id)).toMatchObject({ label: "MARSABIT CLASHES", severity: "high" });
    expect(zones.find((z) => z.id === "sudan")?.severity).toBe("high");
    expect(matchZone("Gunmen kill six in Marsabit", zones)?.id).toBe(id);
    expect(matchZone("Fighting in Abyei town", zones)?.id).toBe("sudan");
    expect(buildZones([], [], zones).find((z) => z.id === id)?.custom).toBe(true);
    // A made zone can be deleted; a standing one only retired.
    expect((await call(`/watch-zones/${id}`, { method: "DELETE", headers: admin })).status).toBe(200);
    expect((await call(`/watch-zones/libya`, { method: "DELETE", headers: admin })).status).toBe(400);
  });
});
