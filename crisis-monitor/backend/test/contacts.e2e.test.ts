import { describe, it, expect, beforeAll, vi } from "vitest";
import { contactsRouter } from "../src/routes/contacts";
import { broadcastsRouter } from "../src/routes/broadcasts";
import { createSessionToken } from "../src/auth";
import { resetBroadcastCheck } from "../src/lib/broadcast";
import { resetContactsCheck } from "../src/lib/contacts";
import { toSms } from "../src/lib/notify";
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
    INSERT INTO users (id, username) VALUES ('a', 'admin'), ('u1', 'ann');
  `);
  env = { DB: d1.DB, SESSION_SECRET: "s", AT_USERNAME: "afrilens", AT_API_KEY: "key", RESEND_API_KEY: "k", ALERT_EMAIL_FROM: "a@x.org" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("a", "admin", "s")}`, "Content-Type": "application/json" };
  client = { Authorization: `Bearer ${await createSessionToken("u1", "client", "s")}`, "Content-Type": "application/json" };
  resetBroadcastCheck();
  resetContactsCheck();
});

const c = (path: string, method: string, headers: Record<string, string>, body?: unknown) => contactsRouter.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
const b = (path: string, method: string, headers: Record<string, string>, body?: unknown) => broadcastsRouter.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);

describe("contact groups and SMS", () => {
  let groupId = "";

  it("is admin only", async () => {
    expect((await c("/groups", "GET", client)).status).toBe(403);
  });

  it("creates a group, imports contacts into it, and avoids duplicates", async () => {
    const g = (await (await c("/groups", "POST", admin, { name: "Nairobi security managers" })).json()) as { id: string };
    groupId = g.id;
    expect((await c("/groups", "POST", admin, { name: "nairobi security managers" })).status).toBe(409);
    const text = "Name,Email,Phone,Organisation\nWanjiru, wanjiru@acme.org, +254 712 345 678, Acme\nOtieno,, +254700111222, Beta\nBad Person, nope, 12, X\nWanjiru again, WANJIRU@acme.org,,";
    const r = (await (await c("/import", "POST", admin, { text, group_id: groupId })).json()) as { added: number; reused: number; rejected_total: number };
    expect(r).toMatchObject({ added: 2, reused: 1, rejected_total: 1 });
    const groups = (await (await c("/groups", "GET", admin)).json()) as { members: number }[];
    expect(groups[0].members).toBe(2);
    const members = (await (await c(`/?group_id=${groupId}`, "GET", admin)).json()) as { phone: string | null }[];
    expect(members.map((m) => m.phone).sort()).toEqual(["+254700111222", "+254712345678"]);
  });

  it("uses a group as the audience, sending each person on the channels they have", async () => {
    const pv = (await (await b("/preview", "POST", admin, { mode: "list_only", group_ids: [groupId], channels: ["email", "sms"] })).json()) as { total: number; counts: Record<string, number> };
    expect(pv.counts).toMatchObject({ email: 1, sms: 2 }); // Wanjiru has both; Otieno only a phone
    expect(pv.total).toBe(3);
    // A pasted number goes to every selected phone channel.
    const both = (await (await b("/preview", "POST", admin, { mode: "list_only", channels: ["sms", "signal"], extras: "+254722000111" })).json()) as { counts: Record<string, number> };
    expect(both.counts).toMatchObject({ sms: 1, signal: 1 });
  });

  it("sends SMS through the provider and records the outcome", async () => {
    const msg = { subject: "Curfew in Mekelle", message: "Curfew from 18:00.\n\nAvoid movement.", severity: "urgent", country: "ET", link: "https://example.org/x" };
    const created = (await (await b("/", "POST", admin, { mode: "list_only", group_ids: [groupId], channels: ["sms"], confirm_total: 2, ...msg })).json()) as { id: string };
    const sent: { to: string; message: string; username: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string; headers: Record<string, string> }) => {
      expect(url).toBe("https://api.africastalking.com/version1/messaging");
      expect(init.headers.apiKey).toBe("key");
      const f = new URLSearchParams(init.body);
      sent.push({ to: f.get("to")!, message: f.get("message")!, username: f.get("username")! });
      const ok = f.get("to") === "+254712345678";
      return new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: ok ? 101 : 403, status: ok ? "Success" : "InvalidPhoneNumber" }] } }), { status: 201 });
    });
    try {
      const r = (await (await b(`/${created.id}/send`, "POST", admin)).json()) as { sent: number; failed: number; status: string };
      expect(r).toMatchObject({ sent: 1, failed: 1, status: "complete" });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sent[0].message).toContain("URGENT · Ethiopia: Curfew in Mekelle");
    expect(sent[0].message).toContain("Avoid movement.");
    expect(sent[0].message.length).toBeLessThan(460);
    const rep = (await (await b(`/${created.id}`, "GET", admin)).json()) as { failures: { error: string }[] };
    expect(rep.failures[0].error).toMatch(/InvalidPhoneNumber/);
  });

  it("keeps SMS short", () => {
    const long = toSms({ subject: "S", overview: "word ".repeat(400), sections: [], links: [{ title: "x", url: "https://example.org/report" }] });
    expect(long.length).toBeLessThanOrEqual(480);
    expect(long).toContain("https://example.org/report");
  });
});
