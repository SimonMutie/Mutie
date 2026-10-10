import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { canAccessQuery } from "../ownership";
import { requireAuth, type AuthedVariables } from "../middleware";
import { channelsAvailable, cleanDestination } from "../lib/notify";
import { baselineEscalationSubscription, DEFAULT_FREQUENCY, ensureAlertTables, FREQUENCIES, newSubscriptionId, sendTestMessage, type Subscription } from "../lib/alertDelivery";
import { destinationRefusal } from "../lib/alertPolicy";
import { getVapid } from "../lib/webpush";
import type { Env } from "../bindings";

/**
 * A person's alert subscriptions — where they want to hear about new
 * developments in a monitoring query or in the Conflict Escalation feed.
 * Every route is scoped to the signed-in user's own subscriptions; the
 * escalation feed itself is platform-wide (as the map layer is), so anyone
 * may subscribe to it, while a query subscription needs access to the query.
 */
export const alertSubscriptionsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

alertSubscriptionsRouter.use("*", requireAuth);

const MAX_PER_TARGET = 6;
/** Devices are counted apart from email and Signal addresses: a person may have several phones and computers. */
const MAX_DEVICES = 15;

const frequency = z.number().int().refine((n) => (FREQUENCIES as readonly number[]).includes(n), "frequency_minutes must be 5, 15, 60, 360 or 1440");

const createSchema = z.object({
  scope: z.enum(["query", "escalations"]),
  query_id: z.string().min(1).optional(),
  channel: z.enum(["email", "signal", "push"]),
  destination: z.string().min(1).max(2000),
  min_level: z.enum(["any", "alert", "elevated", "critical"]).optional(),
  frequency_minutes: frequency.optional(),
});

const patchSchema = z.object({
  destination: z.string().min(1).max(2000).optional(),
  min_level: z.enum(["any", "alert", "elevated", "critical"]).optional(),
  frequency_minutes: frequency.optional(),
  enabled: z.boolean().optional(),
});

/** Escalation alerts are for Elevated/Critical incidents; a query's are either every development or only once an alert has opened. */
const levelFits = (scope: string, level: string) => (scope === "escalations" ? level === "elevated" || level === "critical" : level === "any" || level === "alert");
const LEVEL_ERROR = "That alert level does not apply here.";

const present = (s: Subscription) => ({
  id: s.id,
  scope: s.scope,
  query_id: s.query_id,
  channel: s.channel,
  destination: s.destination,
  min_level: s.min_level,
  frequency_minutes: s.frequency_minutes,
  enabled: !!s.enabled,
  last_sent_at: s.last_sent_at,
  last_status: s.last_status,
  last_error: s.last_error,
  created_at: s.created_at,
});

async function ownSubscription(c: { env: Env; get: (k: "userId") => string }, id: string): Promise<Subscription | null> {
  return first<Subscription>(c.env.DB, "SELECT * FROM alert_subscriptions WHERE id = ? AND owner_id = ?", [id, c.get("userId")]);
}

/** The key a browser needs to subscribe this server to push messages. */
alertSubscriptionsRouter.get("/push-key", async (c) => c.json({ publicKey: (await getVapid(c.env)).publicKey }));

/** ?scope=escalations, or ?scope=query&query_id=… */
alertSubscriptionsRouter.get("/", async (c) => {
  await ensureAlertTables(c.env);
  const scope = c.req.query("scope");
  const queryId = c.req.query("query_id");
  if (scope !== "query" && scope !== "escalations") return c.json({ error: "scope must be 'query' or 'escalations'" }, 400);
  if (scope === "query") {
    if (!queryId) return c.json({ error: "query_id is required" }, 400);
    if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) return c.json({ error: "Not found" }, 404);
  }
  const rows =
    scope === "query"
      ? await all<Subscription>(c.env.DB, "SELECT * FROM alert_subscriptions WHERE owner_id = ? AND scope = 'query' AND query_id = ? ORDER BY created_at", [c.get("userId"), queryId])
      : await all<Subscription>(c.env.DB, "SELECT * FROM alert_subscriptions WHERE owner_id = ? AND scope = 'escalations' ORDER BY created_at", [c.get("userId")]);
  return c.json({ channels: channelsAvailable(c.env), subscriptions: rows.map(present) });
});

alertSubscriptionsRouter.post("/", async (c) => {
  await ensureAlertTables(c.env);
  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const d = parsed.data;

  const destination = cleanDestination(d.channel, d.destination);
  if (!destination) return c.json({ error: d.channel === "email" ? "That is not a valid email address." : d.channel === "push" ? "This device could not be registered for alerts." : "Signal numbers are written with the country code, like +254712345678." }, 400);

  const refused = await destinationRefusal(c.env, c.get("userId"), c.get("role"), d.channel, destination);
  if (refused) return c.json({ error: refused }, 403);

  const minLevel = d.min_level ?? (d.scope === "escalations" ? "elevated" : "any");
  if (!levelFits(d.scope, minLevel)) return c.json({ error: LEVEL_ERROR }, 400);
  if (d.scope === "query") {
    if (!d.query_id) return c.json({ error: "query_id is required" }, 400);
    if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), d.query_id))) return c.json({ error: "Not found" }, 404);
  }

  const queryId = d.scope === "query" ? d.query_id! : null;
  const existing = await first<{ n: number; dup: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS n, SUM(CASE WHEN channel = ? AND destination = ? THEN 1 ELSE 0 END) AS dup
     FROM alert_subscriptions WHERE owner_id = ? AND scope = ? AND COALESCE(query_id,'') = ? AND (channel = 'push') = (? = 'push')`,
    [d.channel, destination, c.get("userId"), d.scope, queryId ?? "", d.channel]
  );
  if (Number(existing?.dup ?? 0) > 0) return c.json({ error: "You already get these alerts there." }, 409);
  if (Number(existing?.n ?? 0) >= (d.channel === "push" ? MAX_DEVICES : MAX_PER_TARGET)) return c.json({ error: d.channel === "push" ? `Up to ${MAX_DEVICES} devices can get alerts.` : `You can have up to ${MAX_PER_TARGET} delivery destinations here.` }, 400);

  const id = newSubscriptionId();
  const now = nowIso();
  await run(
    c.env.DB,
    `INSERT INTO alert_subscriptions (id, owner_id, scope, query_id, channel, destination, min_level, frequency_minutes, enabled, cursor_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
    [id, c.get("userId"), d.scope, queryId, d.channel, destination, minLevel, d.frequency_minutes ?? (d.channel === "push" && d.scope === "escalations" ? 5 : DEFAULT_FREQUENCY[d.scope]), d.scope === "query" ? now : null, now]
  );
  // So the first alert is about what happens next, not a replay of what is on the map now.
  if (d.scope === "escalations") await baselineEscalationSubscription(c.env, id);
  const row = await first<Subscription>(c.env.DB, "SELECT * FROM alert_subscriptions WHERE id = ?", [id]);
  return c.json(present(row!), 201);
});

alertSubscriptionsRouter.patch("/:id", async (c) => {
  await ensureAlertTables(c.env);
  const sub = await ownSubscription(c, c.req.param("id"));
  if (!sub) return c.json({ error: "Not found" }, 404);
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const d = parsed.data;

  let destination = sub.destination;
  if (d.destination !== undefined) {
    const cleaned = cleanDestination(sub.channel, d.destination);
    if (!cleaned) return c.json({ error: sub.channel === "email" ? "That is not a valid email address." : "Signal numbers are written with the country code, like +254712345678." }, 400);
    const refused = await destinationRefusal(c.env, c.get("userId"), c.get("role"), sub.channel as "email" | "signal" | "push", cleaned);
    if (refused) return c.json({ error: refused }, 403);
    destination = cleaned;
  }
  const minLevel = d.min_level ?? sub.min_level;
  if (!levelFits(sub.scope, minLevel)) return c.json({ error: LEVEL_ERROR }, 400);

  await run(c.env.DB, "UPDATE alert_subscriptions SET destination = ?, min_level = ?, frequency_minutes = ?, enabled = ?, last_error = CASE WHEN ? THEN NULL ELSE last_error END WHERE id = ?", [
    destination,
    minLevel,
    d.frequency_minutes ?? sub.frequency_minutes,
    d.enabled === undefined ? sub.enabled : d.enabled ? 1 : 0,
    d.destination !== undefined || d.enabled === true ? 1 : 0,
    sub.id,
  ]);
  const row = await first<Subscription>(c.env.DB, "SELECT * FROM alert_subscriptions WHERE id = ?", [sub.id]);
  return c.json(present(row!));
});

alertSubscriptionsRouter.delete("/:id", async (c) => {
  await ensureAlertTables(c.env);
  const sub = await ownSubscription(c, c.req.param("id"));
  if (!sub) return c.json({ error: "Not found" }, 404);
  await run(c.env.DB, "DELETE FROM alert_subscription_seen WHERE subscription_id = ?", [sub.id]);
  await run(c.env.DB, "DELETE FROM alert_subscriptions WHERE id = ?", [sub.id]);
  return c.body(null, 204);
});

/** Sends the real message format now, so the person can see what they will get. */
alertSubscriptionsRouter.post("/:id/test", async (c) => {
  await ensureAlertTables(c.env);
  const sub = await ownSubscription(c, c.req.param("id"));
  if (!sub) return c.json({ error: "Not found" }, 404);
  const result = await sendTestMessage(c.env, sub);
  if (!result.ok) {
    await run(c.env.DB, "UPDATE alert_subscriptions SET last_status = 'error', last_error = ? WHERE id = ?", [result.error ?? "send failed", sub.id]);
    return c.json({ error: result.error ?? "The test message could not be sent." }, 502);
  }
  await run(c.env.DB, "UPDATE alert_subscriptions SET last_status = 'ok', last_error = NULL WHERE id = ?", [sub.id]);
  return c.json({ ok: true, note: result.note ?? null });
});
