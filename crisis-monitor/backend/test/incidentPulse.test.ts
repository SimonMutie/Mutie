import { describe, expect, it } from "vitest";
import { incidentPulses, type PulseIncident } from "../src/lib/incidentPulse";

const now = new Date("2026-11-16T12:00:00Z");
const inc = (id: string, patch: Partial<PulseIncident> = {}): PulseIncident => ({
  id, lat: 13.49, lon: 39.47, level: "elevated", locationLabel: "Mekelle, Tigray", countryName: "Ethiopia", headline: `Incident ${id}`,
  fatalitiesMax: null, preliminary: false, indicators: [], sources: [{ domain: "a.com" }], lastEventDate: "2026-11-15", updatedAt: "2026-11-15T10:00:00Z", ...patch,
});

describe("incident pulses", () => {
  it("pulses a square with a surge, and says how unusual it is", () => {
    const p = incidentPulses([inc("1"), inc("2", { sources: [{ domain: "b.com" }] }), inc("3")], [], now);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: "concentration", incidents: 3, outlets: 2, confirmed: true, size: 1 });
    expect(p[0].reason).toContain("normally fewer than one");
  });
  it("stays quiet where that many incidents is normal", () => {
    const history = Array.from({ length: 27 }, (_, d) => ({ lat: 13.49, lon: 39.47, when: new Date(Date.UTC(2026, 9, 17 + d)).toISOString().slice(0, 10) }));
    expect(incidentPulses([inc("1"), inc("2"), inc("3")], history, now)).toHaveLength(0);
  });
  it("ignores old incidents and squares with too few", () => {
    expect(incidentPulses([inc("1"), inc("2"), inc("3", { lastEventDate: "2026-11-01" })], [], now)).toHaveLength(0);
  });
  it("pulses one serious incident and marks a single-source claim as unconfirmed", () => {
    const p = incidentPulses([inc("1", { fatalitiesMax: 40 }), inc("2", { lat: 9, lon: 38.7, indicators: [{ id: "major_territorial_change", label: "Major territorial change" }], sources: [{ domain: "a.com" }, { domain: "b.com" }] })], [], now);
    expect(p.map((x) => x.kind)).toEqual(["impact", "impact"]);
    const mass = p.find((x) => x.id === "impact:1")!;
    expect(mass.confirmed).toBe(false);
    expect(mass.size).toBe(2);
    expect(mass.reason).toContain("40 deaths reported");
    expect(p.find((x) => x.id === "impact:2")!.confirmed).toBe(true);
  });
  it("does not call a headline-only incident confirmed", () => {
    const p = incidentPulses([inc("1", { level: "critical", preliminary: true, sources: [{ domain: "a.com" }, { domain: "b.com" }] })], [], now);
    expect(p[0]).toMatchObject({ kind: "impact", confirmed: false });
  });
});
