import { describe, expect, it } from "vitest";
import { hybridKind } from "../src/lib/hybridWarfare";
import { getIncidentHistory } from "../src/lib/countryStatus";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

describe("hybrid warfare", () => {
  it("recognises each kind of hybrid activity", () => {
    expect(hybridKind("Two undersea internet cables cut in the Red Sea, slowing traffic")).toBe("cables");
    expect(hybridKind("Pilots report GPS jamming over the Gulf of Aden")).toBe("jamming");
    expect(hybridKind("Ransomware hits Kenya's port authority systems")).toBe("cyber");
    expect(hybridKind("Hackers took down the electoral commission's website")).toBe("cyber");
    expect(hybridKind("Report exposes Russian disinformation network in the Sahel")).toBe("influence");
    expect(hybridKind("Unidentified drones spotted over the airbase overnight")).toBe("drones");
    expect(hybridKind("Police blame sabotage for the railway fire")).toBe("sabotage");
  });
  it("leaves ordinary violence alone", () => {
    expect(hybridKind("Drone strike kills 12 in El Fasher")).toBeNull();
    expect(hybridKind("Al-Shabaab attacks army base near Mogadishu")).toBeNull();
    expect(hybridKind("Fishermen say the cable car is closed")).toBeNull();
  });
  it("adds the saved feed reports to the incident history and flags hybrid incidents", async () => {
    const d1 = fakeD1();
    d1.db.exec(`CREATE TABLE escalation_incidents (id TEXT PRIMARY KEY, country_code TEXT, country_name TEXT, location_label TEXT, lat REAL, lon REAL, level TEXT, status TEXT, headline TEXT, summary TEXT, detail TEXT, first_event_date TEXT, last_event_date TEXT, updated_at TEXT);
      INSERT INTO escalation_incidents VALUES ('e1', 'SD', 'Sudan', 'Port Sudan', 19.6, 37.2, 'elevated', 'active', 'Drones hit Port Sudan', 'Saboteurs blamed: officials call it sabotage of the fuel depot.', '{}', NULL, '2026-11-20', '2026-11-20'),
                                              ('e2', 'SO', 'Somalia', NULL, 2, 45, 'watch', 'active', 'Clashes in Hiraan', NULL, '{}', NULL, '2026-11-21', '2026-11-21');
      CREATE TABLE hybrid_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, link TEXT, source TEXT, place TEXT, lat REAL NOT NULL, lon REAL NOT NULL, date TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO hybrid_events VALUES ('f1', 'jamming', 'GPS jamming over Djibouti', 'https://x', 'Wire', 'Djibouti', 11.6, 43.1, '2026-11-22', 'now');`);
    const items = await getIncidentHistory({ DB: d1.DB } as unknown as Env, "2026-11-01");
    expect(items.map((i) => i.id)).toEqual(["hybrid:f1", "e2", "e1"]);
    expect(items[0]).toMatchObject({ hybrid: "jamming", place: "Djibouti", link: "https://x" });
    expect(items.find((i) => i.id === "e1")?.hybrid).toBe("sabotage");
    expect(items.find((i) => i.id === "e2")?.hybrid).toBeNull();
  });
});
