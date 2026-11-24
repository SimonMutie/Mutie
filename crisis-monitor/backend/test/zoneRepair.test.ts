import { describe, expect, it } from "vitest";
import { liveLayersRouter } from "../src/routes/liveLayers";
import type { Env } from "../src/bindings";
import { createSessionToken } from "../src/auth";
import { fakeD1 } from "./fakeD1";

describe("one-time watch zone repair (24 Nov 2026)", () => {
  it("brings back the Middle East zones, resets the Red Sea zone and retires the hand-drawn maritime zones, once", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('u', 'ann');
      CREATE TABLE watch_zone_overrides (zone_id TEXT PRIMARY KEY, geometry TEXT, color TEXT, updated_by TEXT, updated_at TEXT NOT NULL, label TEXT, severity TEXT, description TEXT, units TEXT, units_geometry TEXT, base_dropped INTEGER, retired INTEGER, custom INTEGER, bounds TEXT, pattern TEXT);
      INSERT INTO watch_zone_overrides (zone_id, updated_at, retired, base_dropped, custom) VALUES ('yemen', 'x', 1, 1, 0), ('syria', 'x', 1, 0, 0), ('libya', 'x', 1, 0, 0);
      INSERT INTO watch_zone_overrides (zone_id, updated_at, retired, custom, label, geometry, color) VALUES ('red-sea', 'x', 0, 0, 'AAH RED SEA RISKS', '{"type":"Polygon","coordinates":[]}', '#ff0000');
      INSERT INTO watch_zone_overrides (zone_id, updated_at, retired, custom, label) VALUES ('custom-1', 'x', 0, 1, 'PIRACY RISKS'), ('custom-2', 'x', 0, 1, 'MARSABIT');`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    const headers = { Authorization: `Bearer ${await createSessionToken("u", "client", "s")}` };
    expect((await liveLayersRouter.request("/watch-zones/overrides", { headers }, env)).status).toBe(200);
    const row = (id: string) => d1.db.prepare(`SELECT * FROM watch_zone_overrides WHERE zone_id = ?`).get(id) as Record<string, unknown>;
    expect(row("yemen")).toMatchObject({ retired: 0, base_dropped: 0 });
    expect(row("syria").retired).toBe(0);
    expect(row("libya").retired).toBe(1); // not a Middle East zone: left as it was
    expect(row("red-sea")).toMatchObject({ label: null, geometry: null, color: "#ff0000" });
    expect(row("custom-1").retired).toBe(1);
    expect(row("custom-2").retired).toBe(0);
    // Once only: a later retirement stands.
    d1.db.exec(`UPDATE watch_zone_overrides SET retired = 1 WHERE zone_id = 'yemen'`);
    expect((await liveLayersRouter.request("/watch-zones/overrides", { headers }, env)).status).toBe(200);
    expect(row("yemen").retired).toBe(1);
  });
});
