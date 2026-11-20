import { beforeAll, describe, expect, it } from "vitest";
import { controlMapsRouter } from "../src/routes/controlMaps";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("territorial control maps", () => {
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
  const call = (path: string, init: RequestInit) => controlMapsRouter.request(path, init, env);
  const square = { type: "Polygon", coordinates: [[[32, 15], [33, 15], [33, 16], [32, 16], [32, 15]]] };

  it("lets admins draw groups' areas and everyone signed in see them", async () => {
    expect((await call("/layers", { method: "POST", headers: viewer, body: JSON.stringify({ name: "RSF", color: "#d97706" }) })).status).toBe(403);
    const layer = ((await (await call("/layers", { method: "POST", headers: admin, body: JSON.stringify({ name: "RSF", color: "#d97706" }) })).json()) as { layer: { id: string } }).layer;
    const made = await call("/areas", { method: "POST", headers: admin, body: JSON.stringify({ layerId: layer.id, status: "control", label: "Khartoum North", asOf: "2026-11-20", geometry: square }) });
    expect(made.status).toBe(201);
    expect((await call("/areas", { method: "POST", headers: admin, body: JSON.stringify({ layerId: layer.id, status: "owned", geometry: square }) })).status).toBe(400);
    const seen = (await (await call("/", { headers: viewer })).json()) as { layers: unknown[]; areas: { status: string; geometry: { type: string } }[] };
    expect(seen.layers).toHaveLength(1);
    expect(seen.areas[0].geometry.type).toBe("Polygon");
    // Removing a group removes its areas.
    await call(`/layers/${layer.id}`, { method: "DELETE", headers: admin });
    expect(((await (await call("/", { headers: viewer })).json()) as { areas: unknown[] }).areas).toHaveLength(0);
  });

  it("keeps a placed image to trace over, and serves it as an image", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const o = ((await (await call("/overlays", { method: "POST", headers: admin, body: JSON.stringify({ name: "Sudan control map", image: png, north: 22, south: 9, east: 38, west: 22 }) })).json()) as { overlay: { id: string } }).overlay;
    await call(`/overlays/${o.id}`, { method: "PATCH", headers: admin, body: JSON.stringify({ north: 23, opacity: 0.4 }) });
    const list = (await (await call("/overlays", { headers: viewer })).json()) as { overlays: { north: number; opacity: number }[] };
    expect(list.overlays[0]).toMatchObject({ north: 23, opacity: 0.4 });
    const img = await call(`/overlays/${o.id}/image`, { headers: viewer });
    expect(img.headers.get("content-type")).toBe("image/png");
  });
});
