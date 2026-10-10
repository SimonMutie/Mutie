import type { Env } from "../bindings";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { ensureContactTables } from "./contacts";
import { cleanDestination, sendNotification, type Channel, type Notification } from "./notify";
import { destinationRefusal } from "./alertPolicy";
import { countryName } from "./sourceRegister";

/**
 * Bulk alerting: the platform admin writes one message and sends it to many
 * people at once (every client organisation, chosen ones, and/or a pasted
 * list of extra contacts), by email, Signal or device push.
 *
 * Safeguards, because a mass message is hard to take back:
 *  - admin only; the recipient count is shown and must be confirmed before sending;
 *  - client members are reached only at destinations they registered themselves,
 *    and only if the organisation's own alert-destination rules still allow them;
 *  - a suppression list is honoured on every send (anyone who asked to stop);
 *  - sending is done in small batches that can be resumed, each recipient's outcome is recorded, and the
 *    admin gets a delivery report with the failures;
 *  - every send is written to the audit log.
 */

export const SEVERITIES = ["info", "advisory", "urgent"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const MAX_RECIPIENTS = 1000;
export const MAX_EXTRAS = 500;

export interface AudienceInput {
  /** all_clients: every client organisation; clients: only client_ids; list_only: just the pasted extras. */
  mode: "all_clients" | "clients" | "list_only";
  client_ids?: string[];
  channels: Channel[];
  /** Contact groups to include (see lib/contacts.ts). */
  group_ids?: string[];
  /** Pasted addresses and numbers, separated by commas, semicolons, spaces or new lines. */
  extras?: string;
}

export interface Recipient {
  channel: Channel;
  destination: string;
  client_id: string | null;
  source: "subscriber" | "extra" | "group";
}

export interface Resolved {
  recipients: Recipient[];
  skipped: { destination: string; reason: string }[];
  counts: Record<Channel, number>;
}

const CHANNEL_ORDER: Channel[] = ["email", "sms", "signal", "push"];

let ready: Promise<unknown> | null = null;
export function resetBroadcastCheck() {
  ready = null;
}

export async function ensureBroadcastTables(env: Env): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await run(env.DB, `CREATE TABLE IF NOT EXISTS broadcasts (
        id TEXT PRIMARY KEY, created_by TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, severity TEXT NOT NULL,
        country TEXT, link TEXT, channels TEXT NOT NULL, audience TEXT NOT NULL, status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, completed_at TEXT)`);
      await run(env.DB, `CREATE TABLE IF NOT EXISTS broadcast_recipients (
        id TEXT PRIMARY KEY, broadcast_id TEXT NOT NULL, channel TEXT NOT NULL, destination TEXT NOT NULL, client_id TEXT,
        source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, claimed_at TEXT, sent_at TEXT)`);
      await run(env.DB, "CREATE INDEX IF NOT EXISTS idx_broadcast_recipients ON broadcast_recipients (broadcast_id, status)");
      await run(env.DB, "CREATE TABLE IF NOT EXISTS broadcast_suppressions (destination TEXT PRIMARY KEY, note TEXT, added_at TEXT NOT NULL)");
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  await ready;
}

const norm = (channel: string, destination: string) => (channel === "push" ? destination : destination.toLowerCase());

/** Works out exactly who would receive the message, without sending anything. */
export async function resolveAudience(env: Env, a: AudienceInput): Promise<Resolved> {
  await ensureBroadcastTables(env);
  const skipped: Resolved["skipped"] = [];
  const out = new Map<string, Recipient>();
  const suppressed = new Set((await all<{ destination: string }>(env.DB, "SELECT destination FROM broadcast_suppressions")).map((r) => r.destination.toLowerCase()));
  const add = (r: Recipient) => {
    if (suppressed.has(r.destination.toLowerCase())) return skipped.push({ destination: r.channel === "push" ? "a device" : r.destination, reason: "On the do-not-send list" });
    const key = `${r.channel}|${norm(r.channel, r.destination)}`;
    if (!out.has(key)) out.set(key, r);
  };

  if (a.mode !== "list_only") {
    const ids = a.mode === "clients" ? (a.client_ids ?? []).filter(Boolean) : [];
    if (a.mode === "clients" && ids.length === 0) return { recipients: [], skipped, counts: { email: 0, sms: 0, signal: 0, push: 0 } };
    const where = a.mode === "clients" ? `u.client_id IN (${ids.map(() => "?").join(",")})` : "u.client_id IS NOT NULL";
    // Members register email, Signal and device destinations for alerts; SMS is never sent to a number given for something else.
    const memberChannels = a.channels.filter((ch) => ch !== "sms");
    const rows = await all<{ owner_id: string; channel: "email" | "signal" | "push"; destination: string; client_id: string; disabled: number | null }>(
      env.DB,
      `SELECT s.owner_id AS owner_id, s.channel AS channel, s.destination AS destination, u.client_id AS client_id, u.disabled AS disabled
         FROM alert_subscriptions s JOIN users u ON u.id = s.owner_id
        WHERE s.enabled = 1 AND ${where} AND s.channel IN (${memberChannels.map(() => "?").join(",") || "''"})`,
      [...ids, ...memberChannels]
    ).catch(() => []);
    for (const r of rows) {
      if (r.disabled) continue;
      const refused = await destinationRefusal(env, r.owner_id, "client", r.channel, r.destination);
      if (refused) {
        skipped.push({ destination: r.channel === "push" ? "a device" : r.destination, reason: "Outside the organisation's approved alert destinations" });
        continue;
      }
      add({ channel: r.channel, destination: r.destination, client_id: r.client_id, source: "subscriber" });
    }
  }

  const groupIds = (a.group_ids ?? []).filter(Boolean);
  if (groupIds.length) {
    await ensureContactTables(env);
    const people = await all<{ id: string; name: string; email: string | null; phone: string | null }>(
      env.DB,
      `SELECT DISTINCT c.id AS id, c.name AS name, c.email AS email, c.phone AS phone FROM contacts c JOIN contact_group_members m ON m.contact_id = c.id
        WHERE c.active = 1 AND m.group_id IN (${groupIds.map(() => "?").join(",")})`,
      groupIds
    );
    for (const p of people) {
      let reached = false;
      for (const ch of a.channels) {
        const dest = ch === "email" ? p.email : ch === "sms" || ch === "signal" ? p.phone : null;
        if (!dest) continue;
        reached = true;
        add({ channel: ch, destination: dest, client_id: null, source: "group" });
      }
      if (!reached) skipped.push({ destination: p.name, reason: "Has no address for the selected channels" });
    }
  }

  const tokens = String(a.extras ?? "").split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length > MAX_EXTRAS) skipped.push({ destination: `${tokens.length - MAX_EXTRAS} more`, reason: `Only the first ${MAX_EXTRAS} pasted contacts are used per send` });
  for (const t of tokens.slice(0, MAX_EXTRAS)) {
    // An address goes by email; a number goes by every phone channel that is selected (SMS, Signal).
    const targets: Channel[] = t.includes("@") ? (a.channels.includes("email") ? ["email"] : []) : a.channels.filter((ch) => ch === "sms" || ch === "signal");
    if (targets.length === 0) {
      skipped.push({ destination: t, reason: t.includes("@") ? "Email is not selected" : "SMS and Signal are not selected" });
      continue;
    }
    for (const channel of targets) {
      const cleaned = cleanDestination(channel, t);
      if (!cleaned) {
        skipped.push({ destination: t, reason: channel === "email" ? "Not a valid email address" : "Not a valid number (use +country code)" });
        break;
      }
      add({ channel, destination: cleaned, client_id: null, source: "extra" });
    }
  }

  const recipients = [...out.values()];
  const counts: Record<Channel, number> = { email: 0, sms: 0, signal: 0, push: 0 };
  for (const r of recipients) counts[r.channel]++;
  return { recipients, skipped, counts };
}

export function buildNotification(b: { subject: string; message: string; severity: string; country: string | null; link: string | null }): Notification {
  const tag = b.severity === "urgent" ? "URGENT" : b.severity === "advisory" ? "ADVISORY" : null;
  const place = b.country ? countryName(b.country) : null;
  const prefix = [tag, place].filter(Boolean).join(" · ");
  return {
    subject: `${prefix ? `${prefix}: ` : ""}${b.subject}`,
    overview: b.message,
    sections: [],
    links: b.link ? [{ title: b.link, url: b.link }] : [],
    footer: "Sent by Afrilens Consulting to clients and contacts who receive our advisories. To stop receiving these messages, reply to this email or write to info@afrilensconsulting.com.",
  };
}

/** Sends the next batch of a broadcast. Safe to call repeatedly, even from two places at once. */
export async function sendNextBatch(env: Env, id: string, limit = 20): Promise<{ sent: number; failed: number; remaining: number; status: string }> {
  await ensureBroadcastTables(env);
  const b = await first<{ subject: string; message: string; severity: string; country: string | null; link: string | null; status: string }>(env.DB, "SELECT * FROM broadcasts WHERE id = ?", [id]);
  if (!b) throw new Error("Not found");
  if (b.status === "cancelled") return { sent: 0, failed: 0, remaining: 0, status: "cancelled" };
  // Recipients claimed by a call that died are released after five minutes.
  const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await run(env.DB, "UPDATE broadcast_recipients SET status = 'pending' WHERE broadcast_id = ? AND status = 'sending' AND claimed_at < ?", [id, stale]);
  const claimed = await all<{ id: string; channel: Channel; destination: string }>(
    env.DB,
    "UPDATE broadcast_recipients SET status = 'sending', claimed_at = ? WHERE id IN (SELECT id FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending' LIMIT ?) RETURNING id, channel, destination",
    [nowIso(), id, limit]
  );
  const n = buildNotification(b);
  const results = await Promise.all(
    claimed.map(async (r) => {
      const res = await sendNotification(env, r.channel, r.destination, n).catch((err) => ({ ok: false, error: err instanceof Error ? err.message : "send failed" }) as { ok: boolean; error?: string });
      return { id: r.id, ok: res.ok, error: res.ok ? null : (res.error ?? "send failed").slice(0, 300) };
    })
  );
  const now = nowIso();
  for (let i = 0; i < results.length; i += 50) {
    await env.DB.batch(results.slice(i, i + 50).map((r) => env.DB.prepare("UPDATE broadcast_recipients SET status = ?, error = ?, sent_at = ? WHERE id = ?").bind(r.ok ? "sent" : "failed", r.error, now, r.id)));
  }
  const tally = await first<{ sent: number; failed: number; pending: number }>(
    env.DB,
    "SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed, SUM(status IN ('pending','sending')) AS pending FROM broadcast_recipients WHERE broadcast_id = ?",
    [id]
  );
  const remaining = Number(tally?.pending ?? 0);
  const status = remaining === 0 ? "complete" : "sending";
  await run(env.DB, "UPDATE broadcasts SET sent = ?, failed = ?, status = ?, completed_at = ? WHERE id = ?", [Number(tally?.sent ?? 0), Number(tally?.failed ?? 0), status, remaining === 0 ? now : null, id]);
  return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, remaining, status };
}

export async function createBroadcast(env: Env, userId: string, input: { subject: string; message: string; severity: Severity; country: string | null; link: string | null }, audience: AudienceInput, recipients: Recipient[]): Promise<string> {
  await ensureBroadcastTables(env);
  const id = newId();
  const now = nowIso();
  await run(env.DB, "INSERT INTO broadcasts (id, created_by, subject, message, severity, country, link, channels, audience, status, total, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
    id, userId, input.subject, input.message, input.severity, input.country, input.link, audience.channels.join(","), JSON.stringify({ mode: audience.mode, client_ids: audience.client_ids ?? [], group_ids: audience.group_ids ?? [], extras: (audience.extras ?? "").length ? "pasted" : "" }), "sending", recipients.length, now,
  ]);
  const stmts = recipients.map((r) => env.DB.prepare("INSERT INTO broadcast_recipients (id, broadcast_id, channel, destination, client_id, source) VALUES (?,?,?,?,?,?)").bind(newId(), id, r.channel, r.destination, r.client_id, r.source));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return id;
}
