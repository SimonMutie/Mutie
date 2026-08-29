import { Hono, type Context } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { hashPassword } from "../auth";
import { rowToUser } from "../mappers";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const clientsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
clientsRouter.use("*", requireAuth);

type ClientsContext = Context<{ Bindings: Env; Variables: AuthedVariables }>;

/** True if the caller can manage accounts under `clientId` — either the
 *  platform admin, or a login that belongs to that same client and has been
 *  marked as able to manage its own client's other logins. Looked up fresh
 *  from the database on every call rather than trusted from the session
 *  token (which is long-lived and stateless — see auth.ts), so revoking
 *  someone's client-admin rights takes effect on their very next request
 *  instead of staying valid for up to the token's full 30-day lifetime. */
async function canManageClient(c: ClientsContext, clientId: string): Promise<boolean> {
  if (c.get("role") === "admin") return true;
  const caller = await first<{ client_id: string | null; is_client_admin: number }>(
    c.env.DB,
    `SELECT client_id, is_client_admin FROM users WHERE id = ?`,
    [c.get("userId")]
  );
  return !!caller && caller.client_id === clientId && !!caller.is_client_admin;
}

function requireAdmin(c: ClientsContext): boolean {
  return c.get("role") === "admin";
}

/** Platform-admin only: list every client org with its current account count. */
clientsRouter.get("/", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  const clients = await all<Record<string, unknown>>(c.env.DB, `SELECT * FROM clients ORDER BY created_at DESC`);
  const counts = await all<{ client_id: string; count: number }>(
    c.env.DB,
    `SELECT client_id, COUNT(*) AS count FROM users WHERE client_id IS NOT NULL GROUP BY client_id`
  );
  const countByClient = new Map(counts.map((r) => [r.client_id, r.count]));
  return c.json(
    clients.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      max_accounts: Number(row.max_accounts),
      can_view_all_incidents: !!row.can_view_all_incidents,
      account_count: countByClient.get(String(row.id)) ?? 0,
      created_at: String(row.created_at),
    }))
  );
});

const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  max_accounts: z.number().int().min(1).max(50).default(3),
  username: z.string().min(3).max(64),
  password: z.string().min(8),
  display_name: z.string().max(120).optional(),
});

/** Platform-admin only: create a client org plus its first login in one step. */
clientsRouter.post("/", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  const body = await c.req.json().catch(() => null);
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const existingUsername = await first<{ id: string }>(c.env.DB, `SELECT id FROM users WHERE username = ?`, [parsed.data.username]);
  if (existingUsername) return c.json({ error: "Username already taken" }, 409);

  const clientId = newId();
  const now = nowIso();
  await run(c.env.DB, `INSERT INTO clients (id, name, max_accounts, created_by, created_at) VALUES (?,?,?,?,?)`, [
    clientId,
    parsed.data.name,
    parsed.data.max_accounts,
    c.get("userId"),
    now,
  ]);

  const userId = newId();
  const passwordHash = await hashPassword(parsed.data.password);
  // The first login under a fresh client org is automatically its own
  // client-admin — someone has to be able to invite teammates, and handing
  // over a brand-new account that can't manage its own team without
  // immediately looping back to the platform admin would be an odd first
  // experience for exactly the capability this feature exists to provide.
  await run(
    c.env.DB,
    `INSERT INTO users (id, username, password_hash, display_name, role, client_id, is_client_admin, created_at) VALUES (?,?,?,?,'client',?,1,?)`,
    [userId, parsed.data.username, passwordHash, parsed.data.display_name ?? null, clientId, now]
  );

  const userRow = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM users WHERE id = ?`, [userId]);
  return c.json(
    {
      id: clientId,
      name: parsed.data.name,
      max_accounts: parsed.data.max_accounts,
      account_count: 1,
      created_at: now,
      first_account: rowToUser(userRow!),
    },
    201
  );
});

const updateClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  max_accounts: z.number().int().min(1).max(50).optional(),
  can_view_all_incidents: z.boolean().optional(),
});

/** Platform-admin only: rename a client, change its account limit, or
 *  toggle whether its accounts can see the full shared incidents pool
 *  (not just what they've personally uploaded) — read-only visibility, see
 *  effectiveReadScope in incidents.ts for exactly what this does and
 *  doesn't grant. Lowering max_accounts below the current account count is
 *  allowed — it just blocks *new* accounts until some are removed, rather
 *  than force-deleting existing ones as a side effect of a limit change. */
clientsRouter.patch("/:id", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  const id = c.req.param("id");
  const existing = await first<{ id: string }>(c.env.DB, `SELECT id FROM clients WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = updateClientSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.name !== undefined) {
    updates.push("name = ?");
    params.push(parsed.data.name);
  }
  if (parsed.data.max_accounts !== undefined) {
    updates.push("max_accounts = ?");
    params.push(parsed.data.max_accounts);
  }
  if (parsed.data.can_view_all_incidents !== undefined) {
    updates.push("can_view_all_incidents = ?");
    params.push(parsed.data.can_view_all_incidents ? 1 : 0);
  }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);
  params.push(id);
  await run(c.env.DB, `UPDATE clients SET ${updates.join(", ")} WHERE id = ?`, params);

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM clients WHERE id = ?`, [id]);
  return c.json({
    id: String(row!.id),
    name: String(row!.name),
    max_accounts: Number(row!.max_accounts),
    can_view_all_incidents: !!row!.can_view_all_incidents,
    logo_data: row!.logo_data != null ? String(row!.logo_data) : null,
  });
});

/** Platform-admin only: delete a client org — removes its logins too, since
 *  an orphaned login with no client and no elevated rights would be a dead
 *  end rather than a meaningful standalone account worth keeping. */
clientsRouter.delete("/:id", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  const id = c.req.param("id");
  const existing = await first<{ id: string }>(c.env.DB, `SELECT id FROM clients WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  await run(c.env.DB, `DELETE FROM users WHERE client_id = ?`, [id]);
  await run(c.env.DB, `DELETE FROM clients WHERE id = ?`, [id]);
  return c.json({ ok: true });
});

/** Admin, or that client's own client-admin: this one client's own metadata
 *  (name, limit, current count) — the list endpoint above is platform-admin
 *  only, so a client-admin managing their own team needs this instead. */
clientsRouter.get("/:id", async (c) => {
  const clientId = c.req.param("id");
  if (!(await canManageClient(c, clientId))) return c.json({ error: "Not found" }, 404);
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM clients WHERE id = ?`, [clientId]);
  if (!row) return c.json({ error: "Not found" }, 404);
  const countRow = await first<{ count: number }>(c.env.DB, `SELECT COUNT(*) AS count FROM users WHERE client_id = ?`, [clientId]);
  return c.json({
    id: String(row.id),
    name: String(row.name),
    max_accounts: Number(row.max_accounts),
    can_view_all_incidents: !!row.can_view_all_incidents,
    logo_data: row.logo_data != null ? String(row.logo_data) : null,
    account_count: countRow?.count ?? 0,
    created_at: String(row.created_at),
  });
});

/** Admin, or that client's own client-admin: list this client's accounts.
 *  404 rather than 403 for an unauthorized client-scoped caller — same
 *  reasoning used throughout this app's other ownership checks: a client
 *  shouldn't be able to distinguish "exists but isn't yours" from "doesn't
 *  exist" by probing arbitrary ids. */
clientsRouter.get("/:id/accounts", async (c) => {
  const clientId = c.req.param("id");
  if (!(await canManageClient(c, clientId))) return c.json({ error: "Not found" }, 404);
  const rows = await all<Record<string, unknown>>(c.env.DB, `SELECT * FROM users WHERE client_id = ? ORDER BY created_at ASC`, [clientId]);
  return c.json(rows.map(rowToUser));
});

const accountSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8),
  display_name: z.string().max(120).optional(),
});

/** Admin, or that client's own client-admin: add a teammate login, capped at
 *  the client's max_accounts. */
clientsRouter.post("/:id/accounts", async (c) => {
  const clientId = c.req.param("id");
  if (!(await canManageClient(c, clientId))) return c.json({ error: "Not found" }, 404);

  const client = await first<{ max_accounts: number }>(c.env.DB, `SELECT max_accounts FROM clients WHERE id = ?`, [clientId]);
  if (!client) return c.json({ error: "Not found" }, 404);
  const countRow = await first<{ count: number }>(c.env.DB, `SELECT COUNT(*) AS count FROM users WHERE client_id = ?`, [clientId]);
  if ((countRow?.count ?? 0) >= client.max_accounts) {
    return c.json({ error: `This client is already at its limit of ${client.max_accounts} account${client.max_accounts === 1 ? "" : "s"}.` }, 409);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const existingUsername = await first<{ id: string }>(c.env.DB, `SELECT id FROM users WHERE username = ?`, [parsed.data.username]);
  if (existingUsername) return c.json({ error: "Username already taken" }, 409);

  const id = newId();
  const passwordHash = await hashPassword(parsed.data.password);
  await run(
    c.env.DB,
    `INSERT INTO users (id, username, password_hash, display_name, role, client_id, is_client_admin, created_at) VALUES (?,?,?,?,'client',?,0,?)`,
    [id, parsed.data.username, passwordHash, parsed.data.display_name ?? null, clientId, nowIso()]
  );
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM users WHERE id = ?`, [id]);
  return c.json(rowToUser(row!), 201);
});

const updateAccountSchema = z.object({
  is_client_admin: z.boolean().optional(),
  display_name: z.string().max(120).optional(),
});

/** Admin, or that client's own client-admin: toggle whether a teammate can
 *  also manage the client's other logins, or update their display name. */
clientsRouter.patch("/:id/accounts/:userId", async (c) => {
  const clientId = c.req.param("id");
  if (!(await canManageClient(c, clientId))) return c.json({ error: "Not found" }, 404);

  const targetId = c.req.param("userId");
  const target = await first<{ client_id: string | null }>(c.env.DB, `SELECT client_id FROM users WHERE id = ?`, [targetId]);
  if (!target || target.client_id !== clientId) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = updateAccountSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.is_client_admin !== undefined) {
    updates.push("is_client_admin = ?");
    params.push(parsed.data.is_client_admin ? 1 : 0);
  }
  if (parsed.data.display_name !== undefined) {
    updates.push("display_name = ?");
    params.push(parsed.data.display_name);
  }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);
  params.push(targetId);
  await run(c.env.DB, `UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM users WHERE id = ?`, [targetId]);
  return c.json(rowToUser(row!));
});

/** Admin, or that client's own client-admin: remove a teammate login. Can't
 *  remove your own login through this endpoint — that's a more deliberate
 *  action than routine team management, and not something to fold into the
 *  same click. Can't leave a client with zero accounts either, since
 *  there'd be nothing left to log in as and no way back in without the
 *  platform admin stepping in. */
clientsRouter.delete("/:id/accounts/:userId", async (c) => {
  const clientId = c.req.param("id");
  if (!(await canManageClient(c, clientId))) return c.json({ error: "Not found" }, 404);

  const targetId = c.req.param("userId");
  if (targetId === c.get("userId")) return c.json({ error: "You can't remove your own login from here." }, 400);

  const target = await first<{ client_id: string | null }>(c.env.DB, `SELECT client_id FROM users WHERE id = ?`, [targetId]);
  if (!target || target.client_id !== clientId) return c.json({ error: "Not found" }, 404);

  const countRow = await first<{ count: number }>(c.env.DB, `SELECT COUNT(*) AS count FROM users WHERE client_id = ?`, [clientId]);
  if ((countRow?.count ?? 0) <= 1) return c.json({ error: "Can't remove the last account on a client — delete the client instead." }, 400);

  await run(c.env.DB, `DELETE FROM users WHERE id = ?`, [targetId]);
  return c.json({ ok: true });
});

/** Platform-admin only: which dashboards a client has been explicitly
 *  granted access to. Sharing is a platform-level decision, not something
 *  a client's own client-admin can do for themselves — unlike the
 *  team-management endpoints above, these use requireAdmin directly rather
 *  than canManageClient. */
clientsRouter.get("/:id/dashboards", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  const clientId = c.req.param("id");
  const rows = await all<{ dashboard_id: string; name: string; created_at: string }>(
    c.env.DB,
    `SELECT a.dashboard_id, d.name, a.created_at
     FROM client_dashboard_access a JOIN custom_dashboards d ON a.dashboard_id = d.id
     WHERE a.client_id = ? ORDER BY a.created_at DESC`,
    [clientId]
  );
  return c.json(rows);
});

const grantDashboardSchema = z.object({ dashboard_id: z.string().min(1) });

clientsRouter.post("/:id/dashboards", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  const clientId = c.req.param("id");
  const client = await first<{ id: string }>(c.env.DB, `SELECT id FROM clients WHERE id = ?`, [clientId]);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = grantDashboardSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const dashboard = await first<{ id: string }>(c.env.DB, `SELECT id FROM custom_dashboards WHERE id = ?`, [parsed.data.dashboard_id]);
  if (!dashboard) return c.json({ error: "That dashboard doesn't exist" }, 404);

  await run(
    c.env.DB,
    `INSERT INTO client_dashboard_access (client_id, dashboard_id, created_at) VALUES (?,?,?)
     ON CONFLICT (client_id, dashboard_id) DO NOTHING`,
    [clientId, parsed.data.dashboard_id, nowIso()]
  );
  return c.json({ ok: true }, 201);
});

clientsRouter.delete("/:id/dashboards/:dashboardId", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  await run(c.env.DB, `DELETE FROM client_dashboard_access WHERE client_id = ? AND dashboard_id = ?`, [c.req.param("id"), c.req.param("dashboardId")]);
  return c.json({ ok: true });
});

/** Platform-admin only: which datasets a client has been explicitly granted
 *  access to — same reasoning as the dashboard endpoints above. */
clientsRouter.get("/:id/datasets", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  const clientId = c.req.param("id");
  const rows = await all<{ dataset_id: string; name: string; created_at: string }>(
    c.env.DB,
    `SELECT a.dataset_id, d.name, a.created_at
     FROM client_dataset_access a JOIN datasets d ON a.dataset_id = d.id
     WHERE a.client_id = ? ORDER BY a.created_at DESC`,
    [clientId]
  );
  return c.json(rows);
});

const grantDatasetSchema = z.object({ dataset_id: z.string().min(1) });

clientsRouter.post("/:id/datasets", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  const clientId = c.req.param("id");
  const client = await first<{ id: string }>(c.env.DB, `SELECT id FROM clients WHERE id = ?`, [clientId]);
  if (!client) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = grantDatasetSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const dataset = await first<{ id: string }>(c.env.DB, `SELECT id FROM datasets WHERE id = ?`, [parsed.data.dataset_id]);
  if (!dataset) return c.json({ error: "That dataset doesn't exist" }, 404);

  await run(
    c.env.DB,
    `INSERT INTO client_dataset_access (client_id, dataset_id, created_at) VALUES (?,?,?)
     ON CONFLICT (client_id, dataset_id) DO NOTHING`,
    [clientId, parsed.data.dataset_id, nowIso()]
  );
  return c.json({ ok: true }, 201);
});

clientsRouter.delete("/:id/datasets/:datasetId", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "Admin access required" }, 403);
  await run(c.env.DB, `DELETE FROM client_dataset_access WHERE client_id = ? AND dataset_id = ?`, [c.req.param("id"), c.req.param("datasetId")]);
  return c.json({ ok: true });
});

// A data: URL this size caps the underlying image at roughly 300KB, which
// keeps a base64-in-D1 logo (see migration_016) comfortably practical
// without needing real object storage for something this small.
const MAX_LOGO_DATA_URL_LENGTH = 400_000;
const logoSchema = z.object({
  logo_data: z
    .string()
    .max(MAX_LOGO_DATA_URL_LENGTH, "That image is too large — try a smaller file (roughly 300KB or less).")
    .regex(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/, "Must be a PNG, JPEG, GIF, WebP, or SVG image.")
    .nullable(),
});

/** Admin, or that client's own client-admin: set or remove this client's
 *  logo. Unlike renaming a client or changing its account limit — kept
 *  platform-admin-only earlier, since those are platform-level decisions —
 *  a client's own branding is naturally theirs to set for themselves. */
clientsRouter.patch("/:id/logo", async (c) => {
  const clientId = c.req.param("id");
  if (!(await canManageClient(c, clientId))) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = logoSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await run(c.env.DB, `UPDATE clients SET logo_data = ? WHERE id = ?`, [parsed.data.logo_data, clientId]);
  return c.json({ ok: true });
});
