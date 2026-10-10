import { describe, it, expect, beforeAll, vi } from "vitest";
import { broadcastsRouter } from "../src/routes/broadcasts";
import { createSessionToken } from "../src/auth";
import { resetBroadcastCheck } from "../src/lib/broadcast";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

let env: Env;
let admin: Record<string, string>;
let client: Record<string, string>;

beforeAll(async () => {
  const d1 = fakeD1();
  d1.db.exec(`
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT, alert_email_domains TEXT, alert_signal_numbers TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, client_id TEXT, read_only INTEGER DEFAULT 0, disabled INTEGER DEFAULT 0, tokens_valid_after INTEGER DEFAULT 0);
    CREATE TABLE alert_subscriptions (id TEXT PRIMARY KEY, owner_id TEXT, scope TEXT, channel TEXT, destination TEXT, enabled INTEGER DEFAULT 1);
    INSERT INTO clients VALUES ('c1','Acme','acme.org',NULL), ('c2','Beta','beta.org',NULL);
    INSERT INTO users (id, username, client_id) VALUES ('a', 'admin', NULL), ('u1', 'ann', 'c1'), ('u2', 'bob', 'c1'), ('u3', 'cy', 'c2');
    INSERT INTO alert_subscriptions VALUES
      ('s1','u1','escalations','email','ann@acme.org',1), ('s2','u2','escalations','email','bob@acme.org',1),
      ('s3','u2','escalations','email','bob@gmail.com',1),   -- outside Acme's approved domain
      ('s4','u3','escalations','email','cy@beta.org',1), ('s5','u1','escalations','email','ann@acme.org',1);
  `);
  env = { DB: d1.DB, SESSION_SECRET: "s", RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "alerts@x.org" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "Content-Type": "application/json" };
  client = { Authorization: `Bearer ${await createSessionToken("u1", "client", "s")}`, "Content-Type": "application/json" };
  resetBroadcastCheck();
});

const call = (path: string, method: string, headers: Record<string, string>, body?: unknown) =>
  broadcastsRouter.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);

const msg = { subject: "Curfew declared in Mekelle", message: "A curfew starts at 18:00 local time.\n\nAvoid movement.", severity: "urgent", country: "ET", link: "https://example.org/x" };

describe("bulk alerting", () => {
  it("is for the admin only", async () => {
    expect((await call("/", "GET", client)).status).toBe(403);
    expect((await call("/preview", "POST", client, { mode: "all_clients", channels: ["email"] })).status).toBe(403);
  });

  it("previews the audience: members' own destinations, within each organisation's rules, deduplicated", async () => {
    const r = (await (await call("/preview", "POST", admin, { mode: "all_clients", channels: ["email"] })).json()) as { total: number; skipped: { reason: string }[] };
    expect(r.total).toBe(3); // ann, bob, cy — bob@gmail.com is outside Acme's domain, ann's duplicate counts once
    expect(r.skipped.some((s) => /approved alert destinations/.test(s.reason))).toBe(true);
    const only = (await (await call("/preview", "POST", admin, { mode: "clients", client_ids: ["c2"], channels: ["email"] })).json()) as { total: number };
    expect(only.total).toBe(1);
  });

  it("adds pasted contacts, rejects bad ones and honours the do-not-send list", async () => {
    await call("/suppressions", "POST", admin, { destination: "Stop@Partner.org", note: "asked to stop" });
    const r = (await (await call("/preview", "POST", admin, { mode: "list_only", channels: ["email", "signal"], extras: "a@partner.org, stop@partner.org\n+254700111222; nonsense, b@partner.org" })).json()) as { total: number; counts: { email: number; signal: number }; skipped: { destination: string; reason: string }[] };
    expect(r.counts).toMatchObject({ email: 2, signal: 1 });
    expect(r.skipped.map((s) => s.reason).join("|")).toMatch(/do-not-send/);
    expect(r.skipped.map((s) => s.destination)).toContain("nonsense");
  });

  it("sends in batches, records each outcome and a delivery report", async () => {
    const bad = { mode: "list_only", channels: ["email"], extras: "ok1@partner.org ok2@partner.org fail@partner.org", ...msg };
    expect((await call("/", "POST", admin, { ...bad, confirm_total: 5 })).status).toBe(409); // must match the previewed count
    const created = (await (await call("/", "POST", admin, { ...bad, confirm_total: 3 })).json()) as { id: string; total: number };
    expect(created.total).toBe(3);

    const sentTo: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: { body: string }) => {
      const b = JSON.parse(init.body) as { to: string[]; subject: string; text: string };
      if (b.to[0].startsWith("fail")) return new Response("rejected", { status: 422 });
      sentTo.push(b.to[0]);
      expect(b.subject).toBe("URGENT · Ethiopia: Curfew declared in Mekelle");
      expect(b.text).toContain("Avoid movement.");
      return new Response("{}", { status: 200 });
    });
    try {
      const r = (await (await call(`/${created.id}/send`, "POST", admin)).json()) as { sent: number; failed: number; remaining: number; status: string };
      expect(r).toMatchObject({ sent: 2, failed: 1, remaining: 0, status: "complete" });
      expect(sentTo.sort()).toEqual(["ok1@partner.org", "ok2@partner.org"]);
      // Calling again sends nothing twice.
      const again = (await (await call(`/${created.id}/send`, "POST", admin)).json()) as { sent: number };
      expect(again.sent).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
    const report = (await (await call(`/${created.id}`, "GET", admin)).json()) as { broadcast: { sent: number; failed: number; status: string }; failures: { destination: string; error: string }[] };
    expect(report.broadcast).toMatchObject({ sent: 2, failed: 1, status: "complete" });
    expect(report.failures[0].destination).toBe("fail@partner.org");
  });

  it("refuses an empty audience", async () => {
    const r = await call("/", "POST", admin, { mode: "clients", client_ids: [], channels: ["email"], confirm_total: 1, ...msg });
    expect(r.status).toBe(400);
  });
});
