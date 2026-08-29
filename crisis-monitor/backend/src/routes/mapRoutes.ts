import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const mapRoutesRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

mapRoutesRouter.use("*", requireAuth);

const latLng = z.tuple([z.number(), z.number()]);

const createSchema = z.object({
  name: z.string().min(1),
  mode: z.enum(["road", "freehand"]),
  waypoints: z.array(latLng).min(2),
  geometry: z.array(latLng).min(2),
  distance_km: z.number().nullish(),
  duration_min: z.number().nullish(),
  color: z.string().nullish(),
});

function rowToRoute(row: Record<string, unknown>) {
  return {
    ...row,
    waypoints: JSON.parse(String(row.waypoints ?? "[]")),
    geometry: JSON.parse(String(row.geometry ?? "[]")),
    visible: !!row.visible,
  };
}

mapRoutesRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const rows = isAdmin
    ? await all(c.env.DB, `SELECT * FROM map_routes ORDER BY created_at DESC`)
    : await all(c.env.DB, `SELECT * FROM map_routes WHERE owner_id = ? ORDER BY created_at DESC`, [ownerId]);
  return c.json(rows.map(rowToRoute));
});

mapRoutesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  const now = nowIso();
  const ownerId = c.get("userId");

  await c.env.DB.prepare(
    `INSERT INTO map_routes (id, owner_id, name, mode, waypoints, geometry, distance_km, duration_min, color, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
    .bind(
      id,
      ownerId,
      parsed.data.name,
      parsed.data.mode,
      JSON.stringify(parsed.data.waypoints),
      JSON.stringify(parsed.data.geometry),
      parsed.data.distance_km ?? null,
      parsed.data.duration_min ?? null,
      parsed.data.color ?? null,
      now,
      now
    )
    .run();

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM map_routes WHERE id = ?`, [id]);
  return c.json(rowToRoute(row!));
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  visible: z.boolean().optional(),
});

mapRoutesRouter.patch("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM map_routes WHERE id = ?`, [id]);
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
  if (parsed.data.color !== undefined) {
    updates.push("color = ?");
    params.push(parsed.data.color);
  }
  if (parsed.data.visible !== undefined) {
    updates.push("visible = ?");
    params.push(parsed.data.visible ? 1 : 0);
  }
  updates.push("updated_at = ?");
  params.push(nowIso());
  params.push(id);

  await c.env.DB.prepare(`UPDATE map_routes SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM map_routes WHERE id = ?`, [id]);
  return c.json(rowToRoute(row!));
});

mapRoutesRouter.delete("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM map_routes WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && existing.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(`DELETE FROM map_routes WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});
