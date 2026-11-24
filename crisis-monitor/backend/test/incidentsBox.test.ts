import { describe, expect, it } from "vitest";
import { incidentsRouter } from "../src/routes/incidents";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("listing incidents inside a map box", () => {
  it("returns only the incidents placed inside the box, and all of them without one", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
      INSERT INTO users (id, username) VALUES ('a', 'admin');
      CREATE TABLE incidents (id TEXT PRIMARY KEY, owner_id TEXT, occurred_at TEXT, occurred_date TEXT, country TEXT, latitude REAL, longitude REAL, raw_row TEXT);
      INSERT INTO incidents (id, occurred_at, country, latitude, longitude) VALUES
        ('juba', '2026-11-01', 'South Sudan', 4.85, 31.6), ('nimule', '2026-11-02', 'South Sudan', 3.6, 32.06),
        ('nairobi', '2026-11-03', 'Kenya', -1.29, 36.82), ('nowhere', '2026-11-04', 'Kenya', NULL, NULL);`);
    const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
    const headers = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}` };
    const ids = async (qs: string) => ((await (await incidentsRouter.request(`/?${qs}`, { headers }, env)).json()) as { id: string }[]).map((r) => r.id).sort();
    expect(await ids("min_lat=3&max_lat=5.5&min_lng=31&max_lng=33")).toEqual(["juba", "nimule"]);
    expect(await ids("limit=10")).toEqual(["juba", "nairobi", "nimule", "nowhere"]);
    expect(await ids("min_lat=3&max_lat=5.5")).toHaveLength(4); // half a box is ignored
  });
});
