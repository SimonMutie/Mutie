import { describe, expect, it } from "vitest";
import { attachMaps, buildEscalationNotification } from "../src/lib/alertDelivery";
import { toHtml } from "../src/lib/notify";
import type { IncidentView } from "../src/escalationIncidents";

const incident = {
  id: "inc-borno-1", countryCode: "NG", countryName: "Nigeria", locationLabel: "Maiduguri, Borno", lat: 11.85, lon: 13.15, geoPrecision: "place", level: "critical",
  headline: "Attack near Maiduguri", summary: "", assessment: "", outlook: "", caveats: "", preliminary: false, reportCount: 2, updatedAt: "2026-10-10T08:00:00Z", sources: [],
} as unknown as IncidentView;

describe("escalation email map", () => {
  it("attaches a PNG map to the section and points the email at it", async () => {
    const n = await attachMaps(buildEscalationNotification([{ incident, kind: "new" }]), [incident]);
    const map = n.sections[0].map!;
    expect(map.cid).toMatch(/^map-/);
    expect(atob(map.base64).slice(1, 4)).toBe("PNG");
    expect(map.caption).toMatch(/Borno/);
    const html = toHtml(n);
    expect(html).toContain(`src="cid:${map.cid}"`);
  });
  it("leaves a section without a map when its incident is not given", async () => {
    const n = await attachMaps(buildEscalationNotification([{ incident, kind: "new" }]), []);
    expect(n.sections[0].map).toBeUndefined();
  });
});
