import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import { audit, clientIp } from "../lib/audit";
import { channelsAvailable, cleanDestination, sendNotification, type Channel } from "../lib/notify";
import { buildNotification, createBroadcast, ensureBroadcastTables, MAX_RECIPIENTS, resolveAudience, sendNextBatch, SEVERITIES, type AudienceInput } from "../lib/broadcast";
import type { Env } from "../bindings";

/** Bulk alerting. Platform admin only: see lib/broadcast.ts for the safeguards. */
export const broadcastsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
broadcastsRouter.use("*", requireAuth, requireAdmin);

const audienceSchema = z.object({
  mode: z.enum(["all_clients", "clients", "list_only"]),
  client_ids: z.array(z.string()).max(500).optional(),
  channels: z.array(z.enum(["email", "signal", "push"])).min(1),
  extras: z.string().max(60_000).optional(),
});

const messageSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  message: z.string().trim().min(5).max(4000),
  severity: z.enum(SEVERITIES),
  country: z.string().trim().min(2).max(5).transform((s) => s.toUpperCase()).nullable().optional(),
  link: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), "Use a link starting with http:// or https://").nullable().optional(),
});

const sendSchema = audienceSchema.merge(messageSchema).extend({ confirm_total: z.number().int().min(1) });

broadcastsRouter.get("/", async (c) => {
  await ensureBroadcastTables(c.env);
  const rows = await all(c.env.DB, "SELECT id, subject, severity, country, channels, status, total, sent, failed, created_at, completed_at FROM broadcasts ORDER BY created_at DESC LIMIT 100");
  return c.json({ channels: channelsAvailable(c.env), broadcasts: rows });
});

/** Who would get it, before anything is sent. */
broadcastsRouter.post("/preview", async (c) => {
  const parsed = audienceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Choose who to send to and at least one channel." }, 400);
  const r = await resolveAudience(c.env, parsed.data as AudienceInput);
  return c.json({ total: r.recipients.length, counts: r.counts, skipped: r.skipped.slice(0, 30), skipped_total: r.skipped.length, over_limit: r.recipients.length > MAX_RECIPIENTS, limit: MAX_RECIPIENTS });
});

/** One test message to one address, so the admin can see exactly what recipients will get. */
broadcastsRouter.post("/test", async (c) => {
  const parsed = messageSchema.extend({ channel: z.enum(["email", "signal"]), destination: z.string().min(3).max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the message and the address." }, 400);
  const d = parsed.data;
  const dest = cleanDestination(d.channel, d.destination);
  if (!dest) return c.json({ error: d.channel === "email" ? "That is not a valid email address." : "Signal numbers need the country code, like +254712345678." }, 400);
  const n = buildNotification({ subject: d.subject, message: d.message, severity: d.severity, country: d.country ?? null, link: d.link ?? null });
  n.subject = `[TEST] ${n.subject}`;
  const res = await sendNotification(c.env, d.channel as Channel, dest, n);
  if (!res.ok) return c.json({ error: res.error ?? "The test could not be sent." }, 502);
  return c.json({ ok: true });
});

broadcastsRouter.post("/", async (c) => {
  const parsed = sendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Check the subject, message, audience and channels." }, 400);
  const d = parsed.data;
  const audience: AudienceInput = { mode: d.mode, client_ids: d.client_ids, channels: d.channels, extras: d.extras };
  const r = await resolveAudience(c.env, audience);
  if (r.recipients.length === 0) return c.json({ error: "Nobody would receive this. Check the audience and channels." }, 400);
  if (r.recipients.length > MAX_RECIPIENTS) return c.json({ error: `That is ${r.recipients.length} recipients; the limit is ${MAX_RECIPIENTS} per send. Split it into smaller groups.` }, 400);
  if (r.recipients.length !== d.confirm_total) return c.json({ error: `The audience changed (now ${r.recipients.length} recipients). Preview it again before sending.` }, 409);
  const id = await createBroadcast(c.env, c.get("userId"), { subject: d.subject, message: d.message, severity: d.severity, country: d.country ?? null, link: d.link ?? null }, audience, r.recipients);
  await audit(c.env, { userId: c.get("userId"), action: "broadcast.created", detail: `${d.severity}: ${d.subject} → ${r.recipients.length} recipients`, ip: clientIp(c.req) });
  return c.json({ id, total: r.recipients.length }, 201);
});

/** Sends the next small batch; the page calls this until "remaining" is 0. */
broadcastsRouter.post("/:id/send", async (c) => {
  try {
    return c.json(await sendNextBatch(c.env, c.req.param("id"), 20));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Could not send." }, 404);
  }
});

broadcastsRouter.post("/:id/cancel", async (c) => {
  await ensureBroadcastTables(c.env);
  await run(c.env.DB, "UPDATE broadcasts SET status = 'cancelled', completed_at = ? WHERE id = ? AND status = 'sending'", [nowIso(), c.req.param("id")]);
  await audit(c.env, { userId: c.get("userId"), action: "broadcast.cancelled", detail: c.req.param("id"), ip: clientIp(c.req) });
  return c.json({ ok: true });
});

broadcastsRouter.get("/suppressions", async (c) => {
  await ensureBroadcastTables(c.env);
  return c.json(await all(c.env.DB, "SELECT destination, note, added_at FROM broadcast_suppressions ORDER BY added_at DESC LIMIT 500"));
});

broadcastsRouter.post("/suppressions", async (c) => {
  await ensureBroadcastTables(c.env);
  const parsed = z.object({ destination: z.string().trim().min(3).max(200), note: z.string().trim().max(200).optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Enter an email address or Signal number." }, 400);
  const dest = parsed.data.destination.toLowerCase();
  await run(c.env.DB, "INSERT INTO broadcast_suppressions (destination, note, added_at) VALUES (?,?,?) ON CONFLICT(destination) DO UPDATE SET note = excluded.note", [dest, parsed.data.note ?? null, nowIso()]);
  return c.json({ ok: true }, 201);
});

broadcastsRouter.delete("/suppressions/:destination", async (c) => {
  await ensureBroadcastTables(c.env);
  await run(c.env.DB, "DELETE FROM broadcast_suppressions WHERE destination = ?", [decodeURIComponent(c.req.param("destination")).toLowerCase()]);
  return c.json({ ok: true });
});

broadcastsRouter.get("/:id", async (c) => {
  await ensureBroadcastTables(c.env);
  const b = await first(c.env.DB, "SELECT * FROM broadcasts WHERE id = ?", [c.req.param("id")]);
  if (!b) return c.json({ error: "Not found" }, 404);
  const failures = await all(c.env.DB, "SELECT channel, destination, error FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'failed' LIMIT 200", [c.req.param("id")]);
  return c.json({ broadcast: b, failures });
});
