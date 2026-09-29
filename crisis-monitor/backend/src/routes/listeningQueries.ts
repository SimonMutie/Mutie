import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

/**
 * Named, saved Social Listening searches — the persistence layer behind the
 * "dashboard for listening" the user asked for: a dashboard is a set of
 * saved queries checked at a glance, not one ad-hoc search at a time. Same
 * CRUD shape as mapShapes.ts/mapRoutes.ts (owner-scoped, admin sees all).
 */
export const listeningQueriesRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

listeningQueriesRouter.use("*", requireAuth);

function rowToQuery(row: Record<string, unknown>) {
  return { ...row, pinned: !!row.pinned };
}

listeningQueriesRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const rows = isAdmin
    ? await all(c.env.DB, `SELECT * FROM listening_queries ORDER BY created_at DESC`)
    : await all(c.env.DB, `SELECT * FROM listening_queries WHERE owner_id = ? ORDER BY created_at DESC`, [ownerId]);
  return c.json(rows.map(rowToQuery));
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  query: z.string().min(1).max(300),
  pinned: z.boolean().optional().default(false),
});

listeningQueriesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO listening_queries (id, owner_id, name, query, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`
  )
    .bind(id, c.get("userId"), parsed.data.name, parsed.data.query, parsed.data.pinned ? 1 : 0, now, now)
    .run();

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM listening_queries WHERE id = ?`, [id]);
  return c.json(rowToQuery(row!));
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  query: z.string().min(1).max(300).optional(),
  pinned: z.boolean().optional(),
});

listeningQueriesRouter.patch("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM listening_queries WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && existing.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.name !== undefined) {
    updates.push("name = ?");
    params.push(parsed.data.name);
  }
  if (parsed.data.query !== undefined) {
    updates.push("query = ?");
    params.push(parsed.data.query);
  }
  if (parsed.data.pinned !== undefined) {
    updates.push("pinned = ?");
    params.push(parsed.data.pinned ? 1 : 0);
  }
  updates.push("updated_at = ?");
  params.push(nowIso());
  params.push(id);

  await c.env.DB.prepare(`UPDATE listening_queries SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM listening_queries WHERE id = ?`, [id]);
  return c.json(rowToQuery(row!));
});

listeningQueriesRouter.delete("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM listening_queries WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && existing.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(`DELETE FROM listening_queries WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});
