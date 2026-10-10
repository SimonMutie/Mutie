import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { hashPassword, verifyPassword, createSessionToken } from "../auth";
import { rowToUser } from "../mappers";
import { requireAuth, requireAdmin, forgetGate, type AuthedVariables } from "../middleware";
import { sendEmail, sendRawEmail } from "../lib/notify";
import { accessReplyEmail, ACCESS_INBOX } from "../lib/accessEmail";
import { audit, clientIp, readAudit } from "../lib/audit";
import { passwordSchema } from "../lib/passwordPolicy";
import type { Env } from "../bindings";

export const authRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const credentialsSchema = z.object({
  username: z.string().min(3).max(64),
  password: passwordSchema,
  display_name: z.string().max(120).optional(),
});

/** Public: lets the frontend show a one-time "set up admin account" screen instead of a login screen. */
authRouter.get("/status", async (c) => {
  const row = await first<{ count: number }>(c.env.DB, "SELECT COUNT(*) AS count FROM users");
  return c.json({ bootstrapNeeded: (row?.count ?? 0) === 0 });
});

/** Public, but self-disabling: only succeeds while the users table is empty. Creates the first admin account. */
authRouter.post("/bootstrap", async (c) => {
  const existing = await first<{ count: number }>(c.env.DB, "SELECT COUNT(*) AS count FROM users");
  if ((existing?.count ?? 0) > 0) {
    return c.json({ error: "An admin account already exists" }, 409);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  const passwordHash = await hashPassword(parsed.data.password);
  await run(
    c.env.DB,
    `INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?,?,?,?,'admin',?)`,
    [id, parsed.data.username, passwordHash, parsed.data.display_name ?? null, nowIso()]
  );

  const token = await createSessionToken(id, "admin", c.env.SESSION_SECRET);
  return c.json(
    {
      token,
      user: { id, username: parsed.data.username, display_name: parsed.data.display_name ?? null, role: "admin" as const },
    },
    201
  );
});

/** Attaches the current user's client logo, if any — bundled directly into
 *  the login/me responses rather than requiring a separate fetch, since the
 *  frontend needs this on essentially every page load (to show it in the
 *  top bar) and a client's logo changes rarely enough that fetching it
 *  fresh on every single request elsewhere isn't worth the extra round trip
 *  this avoids. */
async function userWithClientLogo(db: D1Database, row: Record<string, unknown>) {
  const user = rowToUser(row);
  let clientLogo: string | null = null;
  let canShare = user.role === "admin";
  if (user.client_id) {
    const client = await first<{ logo_data: string | null; can_share_publicly: number | null }>(db, "SELECT logo_data, can_share_publicly FROM clients WHERE id = ?", [user.client_id]);
    clientLogo = client?.logo_data ?? null;
    if (user.role !== "admin") canShare = !!client?.can_share_publicly && !user.read_only;
  }
  return { ...user, client_logo: clientLogo, can_share_publicly: canShare };
}

/** Five wrong passwords in a row lock a login for 15 minutes. A right password resets the count. */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

function lockedMinutesLeft(row: Record<string, unknown>): number {
  const until = row.locked_until ? Date.parse(String(row.locked_until)) : 0;
  return until > Date.now() ? Math.ceil((until - Date.now()) / 60_000) : 0;
}

async function recordFailedLogin(env: Env, row: Record<string, unknown>, ip: string | null) {
  const failures = Number(row.failed_logins ?? 0) + 1;
  const lock = failures >= MAX_FAILED_LOGINS;
  await run(env.DB, "UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", [
    failures,
    lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
    row.id,
  ]);
  await audit(env, { userId: String(row.id), username: String(row.username), action: lock ? "login.locked" : "login.failed", detail: `${failures} in a row`, ip });
}

async function clearFailedLogins(env: Env, row: Record<string, unknown>) {
  if (Number(row.failed_logins ?? 0) > 0 || row.locked_until) await run(env.DB, "UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", [row.id]);
}

authRouter.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body as { username?: string; password?: string };
  if (!username || !password) return c.json({ error: "username and password are required" }, 400);

  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE username = ?", [username]);
  const row = rows[0];
  const ip = clientIp(c.req);
  if (!row) {
    await audit(c.env, { username: String(username).slice(0, 64), action: "login.unknown", ip });
    return c.json({ error: "Invalid username or password" }, 401);
  }

  const wait = lockedMinutesLeft(row);
  if (wait > 0) {
    await audit(c.env, { userId: String(row.id), username: String(row.username), action: "login.blocked", detail: "locked", ip });
    return c.json({ error: `Too many wrong passwords. This login is locked for about ${wait} more minute${wait === 1 ? "" : "s"}.` }, 429);
  }

  const valid = await verifyPassword(password, String(row.password_hash));
  if (!valid) {
    await recordFailedLogin(c.env, row, ip);
    return c.json({ error: "Invalid username or password" }, 401);
  }
  if (row.disabled) {
    await audit(c.env, { userId: String(row.id), username: String(row.username), action: "login.disabled", ip });
    return c.json({ error: "This account has been disabled. Contact your Afrilens representative." }, 403);
  }
  await clearFailedLogins(c.env, row);
  await audit(c.env, { userId: String(row.id), username: String(row.username), action: "login.ok", ip });

  const user = await userWithClientLogo(c.env.DB, row);
  const token = await createSessionToken(user.id, user.role, c.env.SESSION_SECRET);
  return c.json({ token, user });
});

authRouter.get("/me", requireAuth, async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE id = ?", [c.get("userId")]);
  if (!rows[0]) return c.json({ error: "User not found" }, 404);
  return c.json(await userWithClientLogo(c.env.DB, rows[0]));
});

/** Sign out everywhere: every session issued before now stops working,
 *  on every device. Useful after a lost laptop or a shared computer. */
authRouter.post("/logout-all", requireAuth, async (c) => {
  const userId = c.get("userId");
  await run(c.env.DB, "UPDATE users SET tokens_valid_after = ? WHERE id = ?", [Math.floor(Date.now() / 1000) + 1, userId]);
  forgetGate(userId);
  await audit(c.env, { userId, action: "logout.all", ip: clientIp(c.req) });
  return c.json({ ok: true });
});

/** Admin-only: the activity log, newest first. ?action=login filters by prefix, ?username= by person. */
authRouter.get("/audit", requireAuth, requireAdmin, async (c) => {
  const entries = await readAudit(c.env, {
    limit: Number(c.req.query("limit") ?? 100) || 100,
    action: c.req.query("action") || undefined,
    username: c.req.query("username") || undefined,
  });
  return c.json(entries);
});

/** Admin-only: list every client account (for the admin panel). */
authRouter.get("/users", requireAuth, requireAdmin, async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users ORDER BY created_at DESC");
  return c.json(rows.map(rowToUser));
});

/** Admin-only: create a client login. This is the whole "give a client access" flow — no public signup. */
authRouter.post("/users", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const roleRaw = (body as Record<string, unknown>).role;
  const role = roleRaw === "admin" ? "admin" : "client";
  const readOnly = role === "client" && (body as Record<string, unknown>).read_only === true ? 1 : 0;

  const existing = await all<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE username = ?", [parsed.data.username]);
  if (existing[0]) return c.json({ error: "Username already taken" }, 409);

  const id = newId();
  const passwordHash = await hashPassword(parsed.data.password);
  await run(
    c.env.DB,
    `INSERT INTO users (id, username, password_hash, display_name, role, read_only, created_at) VALUES (?,?,?,?,?,?,?)`,
    [id, parsed.data.username, passwordHash, parsed.data.display_name ?? null, role, readOnly, nowIso()]
  );

  await audit(c.env, { userId: c.get("userId"), action: "user.created", detail: `${parsed.data.username} (${role}${readOnly ? ", viewer" : ""})`, ip: clientIp(c.req) });
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE id = ?", [id]);
  return c.json(rowToUser(rows[0]), 201);
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: passwordSchema,
});

/** Any authenticated user — platform admin or client, including a client's
 *  own teammates — changing their own password. Requires the current
 *  password, not just a valid session: without that check, anyone who got
 *  hold of an unattended, still-logged-in browser tab could silently lock
 *  the real owner out by setting a new password without ever knowing the
 *  old one. This is deliberately separate from the admin-only user-creation
 *  endpoint above — that one sets an initial password without needing to
 *  know a previous one, which is correct there but would be a real gap
 *  here. */
authRouter.post("/change-password", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const userId = c.get("userId");
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE id = ?", [userId]);
  const row = rows[0];
  if (!row) return c.json({ error: "User not found" }, 404);

  const valid = await verifyPassword(parsed.data.current_password, String(row.password_hash));
  if (!valid) return c.json({ error: "Current password is incorrect" }, 401);

  const newHash = await hashPassword(parsed.data.new_password);
  await run(c.env.DB, "UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);
  await audit(c.env, { userId, username: String(row.username), action: "password.changed", ip: clientIp(c.req) });
  return c.json({ ok: true });
});

const publicChangePasswordSchema = z.object({
  username: z.string().min(1),
  current_password: z.string().min(1),
  new_password: passwordSchema,
});

/** Public — no session required — but security-equivalent to the
 *  authenticated version above: knowing the current password IS the
 *  authentication here, the same way a "change password" step during a
 *  first-login or recovery flow works elsewhere. Exists for the sign-in
 *  screen's "Change Password" tab, for someone who isn't currently logged
 *  in (or has forgotten whether they still are) but does know their current
 *  credentials. Deliberately returns the same generic error for "no such
 *  username" and "wrong password" — distinguishing them would let this
 *  endpoint be used to enumerate valid usernames. */
authRouter.post("/change-password-public", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = publicChangePasswordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE username = ?", [parsed.data.username]);
  const row = rows[0];
  const ip = clientIp(c.req);
  if (row && lockedMinutesLeft(row) > 0) return c.json({ error: "Too many wrong passwords. Try again in a few minutes." }, 429);
  const valid = row ? await verifyPassword(parsed.data.current_password, String(row.password_hash)) : false;
  if (!row || !valid) {
    if (row) await recordFailedLogin(c.env, row, ip);
    return c.json({ error: "Username or current password is incorrect" }, 401);
  }
  await clearFailedLogins(c.env, row);
  await audit(c.env, { userId: String(row.id), username: String(row.username), action: "password.changed", detail: "from sign-in screen", ip });

  const newHash = await hashPassword(parsed.data.new_password);
  await run(c.env.DB, "UPDATE users SET password_hash = ? WHERE id = ?", [newHash, row.id]);
  return c.json({ ok: true });
});

const requestAccessSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  organization: z.string().max(200).optional(),
  reason: z.string().max(2000).optional(),
});

/** Public — the sign-in screen's "Request Access" tab, for someone who
 *  doesn't have an account at all yet. Just queues the request for the
 *  admin to review below; doesn't create an account or send any
 *  notification email (this app has no email-sending infrastructure), so
 *  the admin needs to actually check the queue rather than being paged. */
const accessAttempts = new Map<string, { start: number; n: number }>();

authRouter.post("/request-access", async (c) => {
  // Public form: allow a handful per hour from one address so it can't be used to flood the inbox.
  const ip = clientIp(c.req) ?? "unknown";
  const slot = accessAttempts.get(ip);
  if (!slot || Date.now() - slot.start > 3_600_000) {
    if (accessAttempts.size > 2000) accessAttempts.clear();
    accessAttempts.set(ip, { start: Date.now(), n: 1 });
  } else if (++slot.n > 5) {
    return c.json({ error: "Too many requests from this connection. Please try again later." }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = requestAccessSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  await run(
    c.env.DB,
    `INSERT INTO access_requests (id, name, email, organization, reason, status, created_at) VALUES (?,?,?,?,?,'pending',?)`,
    [id, parsed.data.name, parsed.data.email, parsed.data.organization ?? null, parsed.data.reason ?? null, nowIso()]
  );
  // Tell Afrilens straight away. The request is already saved, so a mail failure doesn't lose it.
  const d = parsed.data;
  const sent = await sendEmail(c.env, ACCESS_INBOX, {
    subject: `Access request: ${d.name}${d.organization ? ` (${d.organization})` : ""}`.replace(/[\r\n]+/g, " "),
    overview: `${d.name} <${d.email}> has asked for access to The Lens.`,
    sections: [
      {
        heading: "REQUEST DETAILS",
        changed: `Name: ${d.name}\nEmail: ${d.email}\nOrganisation: ${d.organization ?? "not given"}`,
        analysis: d.reason ? `Reason given: ${d.reason}` : "No reason given.",
        links: [],
      },
    ],
    links: [],
    footer: "Reply to the email address above. The request is also in the admin Access Requests queue.",
  });
  if (!sent.ok) console.error("[access-request] notification email failed:", sent.error);
  // The requester's own confirmation, signed by the Managing Director.
  const reply = await sendRawEmail(c.env, d.email, accessReplyEmail(d.name));
  if (!reply.ok) console.error("[access-request] confirmation email failed:", reply.error);
  await audit(c.env, { username: d.email, action: "access.requested", detail: sent.ok ? "emailed" : "email failed", ip });
  return c.json({ ok: true }, 201);
});

/** Admin-only: the review queue for requests submitted above. */
authRouter.get("/access-requests", requireAuth, requireAdmin, async (c) => {
  const rows = await all(c.env.DB, "SELECT * FROM access_requests ORDER BY created_at DESC");
  return c.json(rows);
});

const reviewAccessRequestSchema = z.object({ status: z.enum(["approved", "denied"]) });

/** Admin-only: marks a request reviewed. Deliberately doesn't create an
 *  account itself — approving here just means "the admin has seen and
 *  agreed to this", the actual account still gets created through the
 *  normal client-management flow, which needs a username/password/client
 *  assignment this request doesn't carry. */
authRouter.patch("/access-requests/:id", requireAuth, requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = reviewAccessRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await run(c.env.DB, "UPDATE access_requests SET status = ?, reviewed_at = ? WHERE id = ?", [parsed.data.status, nowIso(), id]);
  return c.json({ ok: true });
});
