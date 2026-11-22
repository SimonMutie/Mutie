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
