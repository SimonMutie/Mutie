import { describe, it, expect } from "vitest";
import { limitFor, rateLimited, REQUESTS_PER_MINUTE, DEFAULT_MONTHLY_LIMITS, monthKey } from "../src/lib/quota";

describe("allowances", () => {
  it("uses the default unless the client has its own limit", () => {
    expect(limitFor({ key: "c", clientId: "c", limits: {} }, "ai_summary")).toBe(DEFAULT_MONTHLY_LIMITS.ai_summary);
    expect(limitFor({ key: "c", clientId: "c", limits: { ai_summary: 5 } }, "ai_summary")).toBe(5);
    expect(limitFor({ key: "c", clientId: "c", limits: { ai_summary: 0 } }, "ai_summary")).toBe(0);
  });
  it("keys months as YYYY-MM", () => {
    expect(monthKey(new Date("2026-10-31T23:00:00Z"))).toBe("2026-10");
  });
  it("limits request bursts per login but never the admin", () => {
    const t = 1_000_000;
    let blocked = false;
    for (let i = 0; i <= REQUESTS_PER_MINUTE + 1; i++) blocked = rateLimited("rate-user", "client", t);
    expect(blocked).toBe(true);
    expect(rateLimited("rate-user", "client", t + 61_000)).toBe(false);
    for (let i = 0; i < REQUESTS_PER_MINUTE + 50; i++) expect(rateLimited("boss", "admin", t)).toBe(false);
  });
});
