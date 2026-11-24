import { describe, it, expect } from "vitest";
import { isTerrorism, terrorGroupsIn } from "../src/lib/terrorism";

describe("terrorist attack flag", () => {
  it("names UN-listed groups among the actors", () => {
    expect(terrorGroupsIn(["Al-Shabaab militants"])).toEqual(["al-Shabaab"]);
    expect(terrorGroupsIn(["ISWAP fighters", "Nigerian Army"])).toEqual(["ISWAP"]);
    expect(terrorGroupsIn(["JNIM (al-Qaeda affiliate)"])).toEqual(["JNIM"]);
    expect(terrorGroupsIn(["Islamic State Mozambique"])).toEqual(["IS Mozambique (Ahlu Sunna wal Jama'a)"]);
  });
  it("does not flag ordinary armed actors", () => {
    expect(isTerrorism(["armed_clash"], ["Rapid Support Forces", "Sudanese Armed Forces"]).terrorism).toBe(false);
    expect(isTerrorism([], ["Fano militia", "ENDF"]).terrorism).toBe(false);
    expect(terrorGroupsIn(["Shabelle region elders", "Adfal traders"])).toEqual([]);
  });
  it("flags a coded terrorist attack even when the group is unnamed", () => {
    expect(isTerrorism(["terrorist_attack"], ["unidentified gunmen"]).terrorism).toBe(true);
    expect(isTerrorism(["major_terror_attack"], []).terrorism).toBe(true);
  });
});
