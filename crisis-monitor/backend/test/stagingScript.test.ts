import { describe, it, expect } from "vitest";
import { parseScript } from "../src/lib/stagingScript";

describe("review script parser", () => {
  it("reads a filtered block with each step", () => {
    const r = parseScript(`# Sudan rows first
for row in pending where country = "Sudan":
    open(row)
    code(row, taxonomy="Incident coding 2026")
    fill(row, severity="High", civilian_death_male=2)
    approve(row)
    print("done")`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].filter).toEqual({ field: "country", value: "Sudan" });
    expect(r.blocks[0].steps.map((s) => s.step.op)).toEqual(["open", "code", "fill", "approve", "print"]);
    const fill = r.blocks[0].steps[2].step;
    expect(fill).toEqual({ op: "fill", values: { severity: "High", civilian_death_male: 2 } });
  });

  it("accepts a block with no filter", () => {
    const r = parseScript(`for row in pending:\n    open(row)\n    reject(row)`);
    expect(r.ok && r.blocks[0].filter).toBeNull();
  });

  it("names the line of an unknown step", () => {
    const r = parseScript(`for row in pending:\n    open(row)\n    delete(row)`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.line).toBe(3);
      expect(r.message).toMatch(/Unknown step "delete"/);
    }
  });

  it("refuses to fill a field that does not exist", () => {
    const r = parseScript(`for row in pending:\n    fill(row, weather="rain")`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not a field/);
  });

  it("requires a taxonomy name for code", () => {
    const r = parseScript(`for row in pending:\n    code(row)`);
    expect(r.ok).toBe(false);
  });

  it("rejects a step outside a block and an empty block", () => {
    expect(parseScript(`    open(row)`).ok).toBe(false);
    const empty = parseScript(`for row in pending:\nfor row in pending:\n    open(row)`);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.line).toBe(1);
  });

  it("rejects a bad block header", () => {
    expect(parseScript(`for each row:\n    open(row)`).ok).toBe(false);
    expect(parseScript(`for row in pending where weather = "x":\n    open(row)`).ok).toBe(false);
  });
});
