import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { hashPassword, verifyPassword, createSessionToken } from "../auth";
import { rowToUser } from "../mappers";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const authRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const credentialsSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8),
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
  if (user.client_id) {
    const client = await first<{ logo_data: string | null }>(db, "SELECT logo_data FROM clients WHERE id = ?", [user.client_id]);
    clientLogo = client?.logo_data ?? null;
  }
  return { ...user, client_logo: clientLogo };
}

authRouter.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body as { username?: string; password?: string };
  if (!username || !password) return c.json({ error: "username and password are required" }, 400);

  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE username = ?", [username]);
  const row = rows[0];
  if (!row) return c.json({ error: "Invalid username or password" }, 401);

  const valid = await verifyPassword(password, String(row.password_hash));
  if (!valid) return c.json({ error: "Invalid username or password" }, 401);

  const user = await userWithClientLogo(c.env.DB, row);
  const token = await createSessionToken(user.id, user.role, c.env.SESSION_SECRET);
  return c.json({ token, user });
});

authRouter.get("/me", requireAuth, async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE id = ?", [c.get("userId")]);
  if (!rows[0]) return c.json({ error: "User not found" }, 404);
  return c.json(await userWithClientLogo(c.env.DB, rows[0]));
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

  const existing = await all<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE username = ?", [parsed.data.username]);
  if (existing[0]) return c.json({ error: "Username already taken" }, 409);

  const id = newId();
  const passwordHash = await hashPassword(parsed.data.password);
  await run(
    c.env.DB,
    `INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?,?,?,?,?,?)`,
    [id, parsed.data.username, passwordHash, parsed.data.display_name ?? null, role, nowIso()]
  );

  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE id = ?", [id]);
  return c.json(rowToUser(rows[0]), 201);
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
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
  return c.json({ ok: true });
});

const publicChangePasswordSchema = z.object({
  username: z.string().min(1),
  current_password: z.string().min(1),
  new_password: z.string().min(8),
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
  const valid = row ? await verifyPassword(parsed.data.current_password, String(row.password_hash)) : false;
  if (!row || !valid) return c.json({ error: "Username or current password is incorrect" }, 401);

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
authRouter.post("/request-access", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = requestAccessSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  await run(
    c.env.DB,
    `INSERT INTO access_requests (id, name, email, organization, reason, status, created_at) VALUES (?,?,?,?,?,'pending',?)`,
    [id, parsed.data.name, parsed.data.email, parsed.data.organization ?? null, parsed.data.reason ?? null, nowIso()]
  );
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
