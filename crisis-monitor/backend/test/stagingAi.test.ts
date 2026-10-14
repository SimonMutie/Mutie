import { describe, expect, it } from "vitest";
import { planForRow } from "../src/lib/stagingAi";

const row = { date: "2026-10-12", country: "Sudan", city: "Nbi", sector: "" };

describe("AI command plan for one row", () => {
  it("rejects an article that is not a security or conflict incident", () => {
    const p = planForRow(row, { relevant: false, incidents: [] });
    expect(p.kind).toBe("reject");
  });
  it("updates the row with the first incident and adds a row for each further incident", () => {
    const p = planForRow(row, {
      relevant: true,
      incidents: [
        { fields: [{ field: "city", value: "Omdurman" }, { field: "sector", value: "Security" }] },
        { fields: [{ field: "city", value: "Khartoum" }, { field: "tactic", value: "Drone strike" }] },
        { fields: [{ field: "city", value: "Wad Madani" }] },
      ],
    });
    expect(p.kind).toBe("update");
    expect(p.nextRow).toMatchObject({ city: "Omdurman", sector: "Security", country: "Sudan" });
    expect(p.changes).toEqual([
      { field: "city", before: "Nbi", after: "Omdurman" },
      { field: "sector", before: "", after: "Security" },
    ]);
    expect(p.extra).toEqual([{ city: "Khartoum", tactic: "Drone strike" }, { city: "Wad Madani" }]);
  });
  it("drops fields that are not allowed, invented coordinates and empty values", () => {
    const p = planForRow(row, {
      relevant: true,
      incidents: [{ fields: [{ field: "latitude", value: "15.5" }, { field: "password", value: "x" }, { field: "details", value: "   " }, { field: "actor", value: "RSF" }] }],
    });
    expect(p.changes).toEqual([{ field: "actor", before: "", after: "RSF" }]);
    expect(p.nextRow).not.toHaveProperty("latitude");
  });
  it("leaves a row alone when the article adds nothing new", () => {
    const p = planForRow(row, { relevant: true, incidents: [{ fields: [{ field: "city", value: "Nbi" }] }] });
    expect(p.kind).toBe("none");
    expect(p.changes).toEqual([]);
  });
  it("converts counts to numbers", () => {
    const p = planForRow(row, { relevant: true, incidents: [{ fields: [{ field: "civilian_death_male", value: "12" }] }] });
    expect(p.changes[0]).toMatchObject({ field: "civilian_death_male", after: "12" });
    expect(p.nextRow.civilian_death_male).toBe(12);
  });
});
