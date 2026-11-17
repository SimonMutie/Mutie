import { describe, expect, it } from "vitest";
import { incidentCacheKey, incidentVersion } from "../src/lib/incidentCache";
import { fakeD1 } from "./fakeD1";

describe("remembered dashboard answers", () => {
  it("the data version goes up on every insert, edit and delete of an incident", async () => {
    const db = fakeD1().DB as unknown as D1Database;
    await db.prepare(`CREATE TABLE incidents (id TEXT PRIMARY KEY, sector TEXT)`).run();
    const v0 = await incidentVersion(db);
    await db.prepare(`INSERT INTO incidents (id, sector) VALUES ('a', 'Criminal'), ('b', 'AOG')`).run();
    const v1 = await incidentVersion(db);
    expect(v1).toBe(v0 + 2);
    await db.prepare(`UPDATE incidents SET sector = 'Terrorism' WHERE id = 'a'`).run();
    const v2 = await incidentVersion(db);
    expect(v2).toBe(v1 + 1);
    await db.prepare(`DELETE FROM incidents WHERE id = 'b'`).run();
    expect(await incidentVersion(db)).toBe(v2 + 1);
  });

  it("keys answers by path, parameters in any order, user, role and data version", () => {
    const a = incidentCacheKey("https://x/api/incidents/breakdown?field=actor&from=2026-01-01", "u1", "user", 7);
    const b = incidentCacheKey("https://x/api/incidents/breakdown?from=2026-01-01&field=actor", "u1", "user", 7);
    expect(a).toBe(b);
    expect(incidentCacheKey("https://x/api/incidents/breakdown?field=actor&from=2026-01-01", "u2", "user", 7)).not.toBe(a);
    expect(incidentCacheKey("https://x/api/incidents/breakdown?field=actor&from=2026-01-01", "u1", "user", 8)).not.toBe(a);
  });
});
