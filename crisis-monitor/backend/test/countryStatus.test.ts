import { describe, expect, it } from "vitest";
import { liveLayersRouter } from "../src/routes/liveLayers";
import { createSessionToken } from "../src/auth";
import { trendFrom } from "../src/lib/countryStatus";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

// The Workers edge cache, which routes use for their answers, is not there in tests.
(globalThis as unknown as { caches: unknown }).caches ??= { default: { match: async () => undefined, put: async () => undefined } };

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function setup() {
  const d1 = fakeD1();
  d1.db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
    INSERT INTO users (id, username) VALUES ('a', 'admin'), ('v', 'viewer');
    CREATE TABLE escalation_incidents (id TEXT PRIMARY KEY, country_code TEXT, country_name TEXT, location_label TEXT, lat REAL, lon REAL, level TEXT, status TEXT, headline TEXT, detail TEXT, first_event_date TEXT, last_event_date TEXT, updated_at TEXT);`);
  const ins = d1.db.prepare(`INSERT INTO escalation_incidents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const terror = JSON.stringify({ actors: ["Islamic State West Africa Province"], indicators: [{ id: "armed_clash" }] });
  const plain = JSON.stringify({ actors: ["Bandits"], indicators: [{ id: "armed_clash" }] });
  // Nigeria: heavier in the last 30 days (worsening); one of them a terrorist attack.
  for (let i = 0; i < 4; i++) ins.run(`ng${i}`, "NG", "Nigeria", "Maiduguri", 11.8, 13.1, "elevated", "active", "h", i === 0 ? terror : plain, null, day(5 + i), day(5));
  ins.run("ng-old", "NG", "Nigeria", null, 9, 8, "watch", "expired", "h", plain, null, day(40), day(40));
  // Mali: lighter now than before (improving).
  for (let i = 0; i < 4; i++) ins.run(`ml${i}`, "ML", "Mali", null, 14, -4, "elevated", "expired", "h", plain, null, day(35 + i), day(35));
  ins.run("ml-new", "ML", "Mali", null, 14, -4, "watch", "active", "h", plain, null, day(3), day(3));
  ins.run("gone", "NG", "Nigeria", null, 9, 8, "critical", "dismissed", "h", plain, null, day(2), day(2));
  const env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  return { d1, env };
}
const auth = async (id: string, role: "admin" | "client") => ({ Authorization: `Bearer ${await createSessionToken(id, role, "s")}`, "Content-Type": "application/json" });

describe("country conflict status", () => {
  it("rates countries by default, with a trend from the incidents of the last 30 days against the 30 before", async () => {
    const { env } = setup();
    const r = (await (await liveLayersRouter.request("/country-status", { headers: await auth("v", "client") }, env)).json()) as { countries: { code: string; status: string; trend: string | null; incidents30: number; terror30: number }[] };
    const by = Object.fromEntries(r.countries.map((x) => [x.code, x]));
    expect(by.NG).toMatchObject({ status: "active", trend: "worsening", incidents30: 4, terror30: 1 });
    expect(by.ML).toMatchObject({ status: "active", trend: "improving" });
    expect(by.TD).toMatchObject({ status: "risk-high", trend: null });
  });

  it("lets an admin set a status, a trend and a note, and go back to the default", async () => {
    const { env } = setup();
    const admin = await auth("a", "admin");
    expect((await liveLayersRouter.request("/country-status/ng", { method: "PUT", headers: await auth("v", "client"), body: JSON.stringify({ status: "none" }) }, env)).status).toBe(403);
    expect((await liveLayersRouter.request("/country-status/td", { method: "PUT", headers: admin, body: JSON.stringify({ status: "active", trend: "worsening", note: "Rebel offensive" }) }, env)).status).toBe(200);
    const get = async () => Object.fromEntries(((await (await liveLayersRouter.request("/country-status", { headers: admin }, env)).json()) as { countries: { code: string }[] }).countries.map((x) => [x.code, x])) as Record<string, Record<string, unknown>>;
    expect((await get()).TD).toMatchObject({ status: "active", trend: "worsening", trendAuto: "steady", note: "Rebel offensive", edited: true });
    await liveLayersRouter.request("/country-status/TD", { method: "PUT", headers: admin, body: JSON.stringify({ trend: null }) }, env);
    expect((await get()).TD).toMatchObject({ status: "active", trend: "steady", note: "Rebel offensive" });
    await liveLayersRouter.request("/country-status/TD", { method: "DELETE", headers: admin }, env);
    expect((await get()).TD).toMatchObject({ status: "risk-high", edited: false });
  });

  it("lists the incident history, dismissed ones left out, terrorist attacks marked", async () => {
    const { env } = setup();
    const r = (await (await liveLayersRouter.request(`/conflict-escalation/history?since=${day(50)}`, { headers: await auth("v", "client") }, env)).json()) as { items: { id: string; terror: boolean }[] };
    const ids = r.items.map((x) => x.id);
    expect(ids).toContain("ng-old");
    expect(ids).toContain("ml0");
    expect(ids).not.toContain("gone");
    expect(r.items.find((x) => x.id === "ng0")?.terror).toBe(true);
    expect(r.items.find((x) => x.id === "ng1")?.terror).toBe(false);
  });

  it("only calls a trend with enough incidents and a clear change", () => {
    expect(trendFrom(1, 0)).toBe("steady");
    expect(trendFrom(10, 9)).toBe("steady");
    expect(trendFrom(13, 5)).toBe("worsening");
    expect(trendFrom(2, 10)).toBe("improving");
  });
});
