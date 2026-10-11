import { describe, it, expect } from "vitest";
import { codeSouthSudan, SS_CATEGORIES, SS_LABELS } from "../src/lib/southSudanWatch";

const code = (title: string, summary = "") => codeSouthSudan(title, summary, "radiotamazuj.org")?.category ?? null;

describe("humanitarian and critical infrastructure coding", () => {
  it("every new category has a label", () => {
    for (const c of SS_CATEGORIES) expect(SS_LABELS[c]).toBeTruthy();
  });
  it("aid workers abducted, killed and injured", () => {
    expect(code("Gunmen abduct two aid workers in Akobo")).toBe("aid_worker_abducted");
    expect(code("Aid worker killed in crossfire in Malakal", "One humanitarian worker was killed.")).toBe("aid_worker_killed");
    expect(code("Humanitarian staff injured as shelling hits a compound in Bentiu")).toBe("aid_worker_injured");
  });
  it("arrests and denied access against humanitarian work", () => {
    expect(code("Authorities arrest UN staff in Juba")).toBe("aid_obstruction");
    expect(code("Access denied to humanitarian convoy in Jonglei")).toBe("aid_obstruction");
  });
  it("aid facilities looted", () => {
    expect(code("Armed men loot WFP warehouse in Yei")).toBe("aid_looted");
  });
  it("attacks on health care, schools and utilities", () => {
    expect(code("Shelling hits hospital in Leer, two killed")).toBe("health_attack");
    expect(code("Soldiers burn school in Torit")).toBe("school_attack");
    expect(code("Militia attack water pump station in Nasir")).toBe("utility_attack");
  });
  it("counts deaths for aid worker and health attacks", () => {
    const c = codeSouthSudan("Shelling hits hospital in Leer, three killed", "Three civilians were killed when shells hit the hospital.", "radiotamazuj.org");
    expect(c?.category).toBe("health_attack");
    expect(c?.fatalities).toBe(3);
  });
  it("leaves unrelated South Sudan news alone", () => {
    expect(code("Kiir opens new road in Juba")).not.toBe("aid_worker_killed");
    expect(codeSouthSudan("Premier League weekend preview", "Football fixtures.", "example.uk")).toBeNull();
  });
});
