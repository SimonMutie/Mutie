import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { clientsRouter } from "../src/routes/clients";
import { createSessionToken } from "../src/auth";
import { forgetGate, gateRefusal, requireAuth } from "../src/middleware";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

let env: Env;
let admin: Record<string, string>;
let member: Record<string, string>;

// A stand-in app: the real login check in front of one path from each part of the Lens.
const app = new Hono<{ Bindings: Env }>();
app.use("/api/*", requireAuth as never);
for (const p of ["/api/auth/me", "/api/live-layers/fires", "/api/incidents/stats", "/api/afrintel/runs", "/api/spotlight/x"]) app.get(p, (c) => c.json({ ok: true }));
const get = (path: string, h: Record<string, string>) => app.request(path, { headers: h }, env);
const cl = (path: string, method: string, body?: unknown) => clientsRouter.request(path, { method, headers: admin, body: body === undefined ? undefined : JSON.stringify(body) }, env);

beforeAll(async () => {
  const d1 = fakeD1();
  d1.db.exec(`
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT, max_accounts INTEGER DEFAULT 3, created_at TEXT, can_view_all_incidents INTEGER DEFAULT 0,
      can_share_publicly INTEGER DEFAULT 0, can_screen_people INTEGER DEFAULT 0, can_view_spotlight INTEGER DEFAULT 0, alert_email_domains TEXT, alert_signal_numbers TEXT, logo_data TEXT,
      paused INTEGER NOT NULL DEFAULT 0, paused_at TEXT, pause_reason TEXT, contact_name TEXT, contact_email TEXT, contact_phone TEXT, notes TEXT,
      can_live_osint INTEGER NOT NULL DEFAULT 1, can_trends INTEGER NOT NULL DEFAULT 1, can_afrintel INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, role TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
    INSERT INTO clients (id, name, created_at) VALUES ('acme', 'Acme', '2026-11-01');
    INSERT INTO users (id, username, role, client_id) VALUES ('a', 'admin', 'admin', NULL), ('m', 'mary', 'client', 'acme');
  `);
  env = { DB: d1.DB, SESSION_SECRET: "s" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "Content-Type": "application/json" };
  member = { Authorization: `Bearer ${await createSessionToken("m", "client", "s")}`, "Content-Type": "application/json" };
});

describe("client access controls", () => {
  it("lets a client's logins into every section by default", async () => {
    forgetGate();
    for (const p of ["/api/live-layers/fires", "/api/incidents/stats", "/api/afrintel/runs"]) expect((await get(p, member)).status).toBe(200);
  });

  it("edits a client's details and sections", async () => {
    const r = (await (await cl("/acme", "PATCH", { contact_name: "Jane Doe", contact_email: "jane@acme.org", notes: "Pilot to March", can_afrintel: false })).json()) as Record<string, unknown>;
    expect(r).toMatchObject({ contact_name: "Jane Doe", contact_email: "jane@acme.org", notes: "Pilot to March", can_afrintel: false, can_live_osint: true });
    expect((await get("/api/afrintel/runs", member)).status).toBe(403);
    expect((await get("/api/incidents/stats", member)).status).toBe(200);
    // The admin is never limited.
    expect((await get("/api/afrintel/runs", admin)).status).toBe(200);
  });

  it("pausing stops every request except the login's own session, and resuming restores it", async () => {
    const p = (await (await cl("/acme/pause", "POST", { paused: true, reason: "Invoice overdue" })).json()) as Record<string, unknown>;
    expect(p).toMatchObject({ paused: true, pause_reason: "Invoice overdue" });
    const refused = await get("/api/live-layers/fires", member);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ paused: true });
    expect((await get("/api/auth/me", member)).status).toBe(200);
    expect((await get("/api/live-layers/fires", admin)).status).toBe(200);
    await cl("/acme/pause", "POST", { paused: false });
    expect((await get("/api/live-layers/fires", member)).status).toBe(200);
  });

  it("maps each path to the right section", () => {
    expect(gateRefusal({ paused: false, blocked: ["trends"] }, "/api/custom-dashboards/1")).not.toBeNull();
    expect(gateRefusal({ paused: false, blocked: ["trends"] }, "/api/live-layers/x")).toBeNull();
    expect(gateRefusal({ paused: false, blocked: ["live_osint"] }, "/api/queries")).not.toBeNull();
    expect(gateRefusal({ paused: false, blocked: ["live_osint"] }, "/api/spotlight/x")).toBeNull();
  });
});
