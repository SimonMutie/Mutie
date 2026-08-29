import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const mapShapesRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

mapShapesRouter.use("*", requireAuth);

const styleSchema = z.object({
  color: z.string().optional(),
  fillColor: z.string().optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  weight: z.number().optional(),
  dashArray: z.string().nullish(),
});

const createSchema = z.object({
  name: z.string().min(1),
  source: z.enum(["drawn", "shapefile", "geojson"]),
  // A single GeoJSON Feature or FeatureCollection — validated loosely (just that
  // it has a `type`) since fully validating arbitrary GeoJSON geometry trees
  // isn't worth the cost here; a malformed geometry just won't render on the map.
  geometry: z.object({ type: z.string() }).passthrough(),
  style: styleSchema.default({}),
});

function rowToShape(row: Record<string, unknown>) {
  return {
    ...row,
    geometry: JSON.parse(String(row.geometry ?? "{}")),
    style: JSON.parse(String(row.style ?? "{}")),
    visible: !!row.visible,
  };
}

mapShapesRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const rows = isAdmin
    ? await all(c.env.DB, `SELECT * FROM map_shapes ORDER BY created_at DESC`)
    : await all(c.env.DB, `SELECT * FROM map_shapes WHERE owner_id = ? ORDER BY created_at DESC`, [ownerId]);
  return c.json(rows.map(rowToShape));
});

mapShapesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO map_shapes (id, owner_id, name, source, geometry, style, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`
  )
    .bind(id, c.get("userId"), parsed.data.name, parsed.data.source, JSON.stringify(parsed.data.geometry), JSON.stringify(parsed.data.style), now, now)
    .run();

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM map_shapes WHERE id = ?`, [id]);
  return c.json(rowToShape(row!));
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  style: styleSchema.optional(),
  geometry: z.object({ type: z.string() }).passthrough().optional(),
  visible: z.boolean().optional(),
});

mapShapesRouter.patch("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null; style: string }>(c.env.DB, `SELECT owner_id, style FROM map_shapes WHERE id = ?`, [id]);
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
  if (parsed.data.style !== undefined) {
    const mergedStyle = { ...JSON.parse(existing.style || "{}"), ...parsed.data.style };
    updates.push("style = ?");
    params.push(JSON.stringify(mergedStyle));
  }
  if (parsed.data.geometry !== undefined) {
    updates.push("geometry = ?");
    params.push(JSON.stringify(parsed.data.geometry));
  }
  if (parsed.data.visible !== undefined) {
    updates.push("visible = ?");
    params.push(parsed.data.visible ? 1 : 0);
  }
  updates.push("updated_at = ?");
  params.push(nowIso());
  params.push(id);

  await c.env.DB.prepare(`UPDATE map_shapes SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM map_shapes WHERE id = ?`, [id]);
  return c.json(rowToShape(row!));
});

mapShapesRouter.delete("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM map_shapes WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && existing.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(`DELETE FROM map_shapes WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});
