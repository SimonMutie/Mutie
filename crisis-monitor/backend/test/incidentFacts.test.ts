import { beforeEach, describe, expect, it } from "vitest";
import { advanceFactsBackfill, FACT_COLUMNS, incidentTable, resetIncidentFactsState } from "../src/lib/incidentFacts";
import { fakeD1 } from "./fakeD1";

const ALL = [...FACT_COLUMNS, "details", "raw_row"];
function setup() {
  const { DB } = fakeD1();
  const db = DB as unknown as D1Database;
  return { db, create: () => db.prepare(`CREATE TABLE incidents (${ALL.map((c) => (c === "id" ? "id TEXT PRIMARY KEY" : c)).join(", ")})`).run() };
}
const insert = (db: D1Database, id: string, sector: string) =>
  db.prepare(`INSERT INTO incidents (id, sector, country, details, raw_row) VALUES (?, ?, 'Kenya', 'long free text', '{"a":1}')`).bind(id, sector).run();

describe("the slim counting table", () => {
  beforeEach(() => resetIncidentFactsState());

  it("copies existing incidents in chunks, then switches dashboards over to it", async () => {
    const { db, create } = setup();
    await create();
    for (let i = 0; i < 5; i++) await insert(db, `old${i}`, "Criminal");
    expect(await incidentTable(db)).toBe("incidents");
    expect(await advanceFactsBackfill(db, 2)).toEqual({ copied: 2, ready: false });
    await advanceFactsBackfill(db, 2);
    await advanceFactsBackfill(db, 2);
    expect((await advanceFactsBackfill(db, 2)).ready).toBe(true);
    expect(await incidentTable(db)).toBe("incident_facts");
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM incident_facts`).first<{ n: number }>();
    expect(n?.n).toBe(5);
  });

  it("stays identical to the incident table on insert, edit and delete, without the bulky columns", async () => {
    const { db, create } = setup();
    await create();
    await advanceFactsBackfill(db);
    await insert(db, "a", "Criminal");
    await insert(db, "b", "AOG");
    await db.prepare(`UPDATE incidents SET sector = 'Terrorism' WHERE id = 'a'`).run();
    await db.prepare(`DELETE FROM incidents WHERE id = 'b'`).run();
    const rows = await db.prepare(`SELECT id, sector, country FROM incident_facts ORDER BY id`).all<{ id: string; sector: string; country: string }>();
    expect(rows.results).toEqual([{ id: "a", sector: "Terrorism", country: "Kenya" }]);
    const cols = await db.prepare(`SELECT name FROM pragma_table_info('incident_facts')`).all<{ name: string }>();
    expect(cols.results?.map((c) => c.name)).not.toContain("raw_row");
    expect(cols.results?.map((c) => c.name)).not.toContain("details");
  });
});
