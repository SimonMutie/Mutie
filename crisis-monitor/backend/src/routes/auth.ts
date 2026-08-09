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

authRouter.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { username, password } = body as { username?: string; password?: string };
  if (!username || !password) return c.json({ error: "username and password are required" }, 400);

  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE username = ?", [username]);
  const row = rows[0];
  if (!row) return c.json({ error: "Invalid username or password" }, 401);

  const valid = await verifyPassword(password, String(row.password_hash));
  if (!valid) return c.json({ error: "Invalid username or password" }, 401);

  const user = rowToUser(row);
  const token = await createSessionToken(user.id, user.role, c.env.SESSION_SECRET);
  return c.json({ token, user });
});

authRouter.get("/me", requireAuth, async (c) => {
  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM users WHERE id = ?", [c.get("userId")]);
  if (!rows[0]) return c.json({ error: "User not found" }, 404);
  return c.json(rowToUser(rows[0]));
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
