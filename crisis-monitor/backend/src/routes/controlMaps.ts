import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

/**
 * Territorial control maps. Admins draw areas held or contested by armed groups on Live OSINT, often by tracing over
 * an image (another map, a screenshot) placed on the map as an overlay. Each group is a layer with its own colour;
 * each area has a status (control, contested, influence, claimed), a label and an "as of" date. Everyone with Live
 * OSINT sees the layers and their legend; only admins change them.
 */

export const controlMapsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
controlMapsRouter.use("*", requireAuth);

let ready = false;
async function ensureTables(db: D1Database) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS control_layers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, description TEXT, sort INTEGER NOT NULL DEFAULT 0,
      created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS control_areas (
      id TEXT PRIMARY KEY, layer_id TEXT NOT NULL, status TEXT NOT NULL, label TEXT, notes TEXT, as_of TEXT,
      geometry TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS control_overlays (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, image TEXT NOT NULL, north REAL NOT NULL, south REAL NOT NULL, east REAL NOT NULL, west REAL NOT NULL,
      opacity REAL NOT NULL DEFAULT 0.6, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
  ]);
  ready = true;
}

export const STATUSES = ["control", "contested", "influence", "claimed"] as const;

interface LayerRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
}
interface AreaRow {
  id: string;
  layer_id: string;
  status: string;
  label: string | null;
  notes: string | null;
  as_of: string | null;
  geometry: string;
  created_at: string;
  updated_at: string;
}

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const layerSchema = z.object({ name: z.string().trim().min(1).max(80), color, description: z.string().trim().max(500).nullable().optional(), sort: z.number().int().optional() });

/** A drawn polygon (or several): GeoJSON Polygon or MultiPolygon, with real coordinates. */
const ring = z.array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).or(z.array(z.number()).min(2).max(3))).min(4).max(20000);
const geometry = z.union([
  z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1).max(200) }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ring).min(1)).min(1).max(200) }),
]);
const areaSchema = z.object({
  layerId: z.string().min(1),
  status: z.enum(STATUSES),
  label: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  geometry,
});

const shapeLayer = (l: LayerRow) => ({ id: l.id, name: l.name, color: l.color, description: l.description, sort: l.sort, updatedAt: l.updated_at });
const shapeArea = (a: AreaRow) => ({ id: a.id, layerId: a.layer_id, status: a.status, label: a.label, notes: a.notes, asOf: a.as_of, geometry: JSON.parse(a.geometry), updatedAt: a.updated_at });

/* ── Layers and areas ─────────────────────────────────────────────────────── */

controlMapsRouter.get("/", async (c) => {
  await ensureTables(c.env.DB);
  const [layers, areas] = await Promise.all([
    all<LayerRow>(c.env.DB, `SELECT * FROM control_layers ORDER BY sort, name`),
    all<AreaRow>(c.env.DB, `SELECT * FROM control_areas ORDER BY created_at`),
  ]);
  return c.json({ layers: layers.map(shapeLayer), areas: areas.map(shapeArea) });
});

controlMapsRouter.post("/layers", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const p = layerSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Invalid layer" }, 400);
  const id = crypto.randomUUID();
  const now = nowIso();
  const sort = p.data.sort ?? ((await first<{ n: number }>(c.env.DB, `SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM control_layers`))?.n ?? 0);
  await run(c.env.DB, `INSERT INTO control_layers (id, name, color, description, sort, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    id,
    p.data.name,
    p.data.color,
    p.data.description ?? null,
    sort,
    c.get("userId"),
    now,
    now,
  ]);
  const row = await first<LayerRow>(c.env.DB, `SELECT * FROM control_layers WHERE id = ?`, [id]);
  return c.json({ layer: shapeLayer(row!) }, 201);
});

controlMapsRouter.patch("/layers/:id", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const p = layerSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Invalid layer" }, 400);
  const row = await first<LayerRow>(c.env.DB, `SELECT * FROM control_layers WHERE id = ?`, [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  await run(c.env.DB, `UPDATE control_layers SET name = ?, color = ?, description = ?, sort = ?, updated_at = ? WHERE id = ?`, [
    p.data.name ?? row.name,
    p.data.color ?? row.color,
    p.data.description === undefined ? row.description : p.data.description,
    p.data.sort ?? row.sort,
    nowIso(),
    row.id,
  ]);
  return c.json({ layer: shapeLayer((await first<LayerRow>(c.env.DB, `SELECT * FROM control_layers WHERE id = ?`, [row.id]))!) });
});

controlMapsRouter.delete("/layers/:id", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const id = c.req.param("id");
  await c.env.DB.batch([c.env.DB.prepare(`DELETE FROM control_areas WHERE layer_id = ?`).bind(id), c.env.DB.prepare(`DELETE FROM control_layers WHERE id = ?`).bind(id)]);
  return c.json({ ok: true });
});

controlMapsRouter.post("/areas", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const p = areaSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Invalid area" }, 400);
  if (!(await first(c.env.DB, `SELECT id FROM control_layers WHERE id = ?`, [p.data.layerId]))) return c.json({ error: "That group no longer exists" }, 400);
  const id = crypto.randomUUID();
  const now = nowIso();
  await run(c.env.DB, `INSERT INTO control_areas (id, layer_id, status, label, notes, as_of, geometry, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id,
    p.data.layerId,
    p.data.status,
    p.data.label ?? null,
    p.data.notes ?? null,
    p.data.asOf ?? null,
    JSON.stringify(p.data.geometry),
    c.get("userId"),
    now,
    now,
  ]);
  return c.json({ area: shapeArea((await first<AreaRow>(c.env.DB, `SELECT * FROM control_areas WHERE id = ?`, [id]))!) }, 201);
});

controlMapsRouter.patch("/areas/:id", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const p = areaSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Invalid area" }, 400);
  const row = await first<AreaRow>(c.env.DB, `SELECT * FROM control_areas WHERE id = ?`, [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  const d = p.data;
  await run(c.env.DB, `UPDATE control_areas SET layer_id = ?, status = ?, label = ?, notes = ?, as_of = ?, geometry = ?, updated_at = ? WHERE id = ?`, [
    d.layerId ?? row.layer_id,
    d.status ?? row.status,
    d.label === undefined ? row.label : d.label,
    d.notes === undefined ? row.notes : d.notes,
    d.asOf === undefined ? row.as_of : d.asOf,
    d.geometry ? JSON.stringify(d.geometry) : row.geometry,
    nowIso(),
    row.id,
  ]);
  return c.json({ area: shapeArea((await first<AreaRow>(c.env.DB, `SELECT * FROM control_areas WHERE id = ?`, [row.id]))!) });
});

controlMapsRouter.delete("/areas/:id", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  await run(c.env.DB, `DELETE FROM control_areas WHERE id = ?`, [c.req.param("id")]);
  return c.json({ ok: true });
});

/* ── Image overlays to trace over ─────────────────────────────────────────── */

const bounds = { north: z.number().min(-90).max(90), south: z.number().min(-90).max(90), east: z.number().min(-540).max(540), west: z.number().min(-540).max(540) };
const overlaySchema = z.object({
  name: z.string().trim().min(1).max(120),
  // A data address (the browser shrinks the image first); D1 keeps a row up to 2 MB.
  image: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(1_900_000),
  opacity: z.number().min(0.05).max(1).default(0.6),
  ...bounds,
});

controlMapsRouter.get("/overlays", async (c) => {
  await ensureTables(c.env.DB);
  const rows = await all<{ id: string; name: string; north: number; south: number; east: number; west: number; opacity: number; updated_at: string }>(
    c.env.DB,
    `SELECT id, name, north, south, east, west, opacity, updated_at FROM control_overlays ORDER BY created_at`
  );
  return c.json({ overlays: rows.map((r) => ({ id: r.id, name: r.name, north: r.north, south: r.south, east: r.east, west: r.west, opacity: r.opacity, updatedAt: r.updated_at })) });
});

/** The image itself, served as an image (cached by the browser until it changes). */
controlMapsRouter.get("/overlays/:id/image", async (c) => {
  await ensureTables(c.env.DB);
  const row = await first<{ image: string }>(c.env.DB, `SELECT image FROM control_overlays WHERE id = ?`, [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(row.image);
  if (!m) return c.json({ error: "Bad image" }, 500);
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  return new Response(bytes, { headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=86400" } });
});

controlMapsRouter.post("/overlays", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const p = overlaySchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Invalid image" }, 400);
  const id = crypto.randomUUID();
  const now = nowIso();
  const d = p.data;
  await run(c.env.DB, `INSERT INTO control_overlays (id, name, image, north, south, east, west, opacity, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id,
    d.name,
    d.image,
    d.north,
    d.south,
    d.east,
    d.west,
    d.opacity,
    c.get("userId"),
    now,
    now,
  ]);
  return c.json({ overlay: { id, name: d.name, north: d.north, south: d.south, east: d.east, west: d.west, opacity: d.opacity, updatedAt: now } }, 201);
});

controlMapsRouter.patch("/overlays/:id", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  const p = z.object({ name: z.string().trim().min(1).max(120), opacity: z.number().min(0.05).max(1), ...bounds }).partial().safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: p.error.issues[0]?.message ?? "Invalid change" }, 400);
  const row = await first<{ id: string; name: string; north: number; south: number; east: number; west: number; opacity: number }>(c.env.DB, `SELECT id, name, north, south, east, west, opacity FROM control_overlays WHERE id = ?`, [
    c.req.param("id"),
  ]);
  if (!row) return c.json({ error: "Not found" }, 404);
  const n = { ...row, ...p.data };
  const now = nowIso();
  await run(c.env.DB, `UPDATE control_overlays SET name = ?, north = ?, south = ?, east = ?, west = ?, opacity = ?, updated_at = ? WHERE id = ?`, [n.name, n.north, n.south, n.east, n.west, n.opacity, now, row.id]);
  return c.json({ overlay: { id: row.id, name: n.name, north: n.north, south: n.south, east: n.east, west: n.west, opacity: n.opacity, updatedAt: now } });
});

controlMapsRouter.delete("/overlays/:id", requireAdmin, async (c) => {
  await ensureTables(c.env.DB);
  await run(c.env.DB, `DELETE FROM control_overlays WHERE id = ?`, [c.req.param("id")]);
  return c.json({ ok: true });
});
