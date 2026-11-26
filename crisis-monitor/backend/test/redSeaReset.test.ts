import { describe, expect, it } from "vitest";
import { liveLayersRouter } from "../src/routes/liveLayers";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("one-time Red Sea reset (26 Nov 2026)", () => {
  it("returns the Red Sea zone to its first form and takes the hand-drawn Red Sea and piracy zones off, once", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('u', 'ann');
      CREATE TABLE watch_zone_overrides (zone_id TEXT PRIMARY KEY, geometry TEXT, color TEXT, updated_by TEXT, updated_at TEXT NOT NULL, label TEXT, severity TEXT, description TEXT, units TEXT, units_geometry TEXT, base_dropped INTEGER, retired INTEGER, custom INTEGER, bounds TEXT, pattern TEXT);
      INSERT INTO watch_zone_overrides (zone_id, updated_at, geometry, pattern, color, custom) VALUES ('red-sea', 'x', '{}', 'net', '#ff9500', 0);
      INSERT INTO watch_zone_overrides (zone_id, updated_at, label, custom, retired) VALUES ('custom-1', 'x', 'Piracy risks', 1, 0), ('custom-2', 'x', 'AAH RED SEA RISKS', 1, 0), ('custom-3', 'x', 'MARSABIT', 1, 0), ('yemen', 'x', NULL, 0, 0), ('somalia', 'x', 'PIRACY RISKS', 0, 0);`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    const headers = { Authorization: `Bearer ${await createSessionToken("u", "client", "s")}` };
    const row = (id: string) => d1.db.prepare(`SELECT * FROM watch_zone_overrides WHERE zone_id = ?`).get(id) as Record<string, unknown> | undefined;
    expect((await liveLayersRouter.request("/watch-zones/overrides", { headers }, env)).status).toBe(200);
    expect(row("red-sea")).toBeUndefined();
    expect(row("custom-1")!.retired).toBe(1);
    expect(row("custom-2")!.retired).toBe(1);
    expect(row("custom-3")!.retired).toBe(0);
    expect(row("yemen")!.retired).toBe(0);
    expect(row("somalia")).toBeUndefined(); // a built-in zone renamed for piracy: back to its own area and name
    d1.db.exec(`UPDATE watch_zone_overrides SET retired = 0 WHERE zone_id = 'custom-1'`);
    await liveLayersRouter.request("/watch-zones/overrides", { headers }, env);
    expect(row("custom-1")!.retired).toBe(0); // brought back later: stays
  });
});
