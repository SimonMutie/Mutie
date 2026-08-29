import { Hono } from "hono";
import { z } from "zod";
import { first, run, nowIso } from "../db";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const mapSettingsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
mapSettingsRouter.use("*", requireAuth);

interface MapDefaultSettingsRow {
  show_incidents_by_default: number;
  default_view_mode: string;
  default_basemap: string;
  updated_at: string;
}

function rowToSettings(row: MapDefaultSettingsRow) {
  return {
    show_incidents_by_default: !!row.show_incidents_by_default,
    default_view_mode: row.default_view_mode === "heatmap" ? "heatmap" : "markers",
    default_basemap: row.default_basemap,
    updated_at: row.updated_at,
  };
}

/** Any authenticated user — admin or client — reads the same single,
 *  platform-wide row. This has to be readable by everyone, not just the
 *  admin who sets it, since the whole point is that it's what a client's
 *  Mapping view starts with too. */
mapSettingsRouter.get("/", async (c) => {
  // Falls back to sensible defaults rather than 500 whenever this can't be
  // read cleanly — whether the row is missing (query succeeds, finds
  // nothing) or the table itself doesn't exist yet because this migration
  // hasn't run on this database (query throws outright). This endpoint
  // feeds the map's initial state directly, so an error here would break
  // Mapping entirely rather than just leaving it un-configured.
  const fallback = { show_incidents_by_default: true, default_view_mode: "markers" as const, default_basemap: "osm", updated_at: null };
  try {
    const row = await first<MapDefaultSettingsRow>(c.env.DB, `SELECT * FROM map_default_settings WHERE id = 'default'`);
    return c.json(row ? rowToSettings(row) : fallback);
  } catch {
    return c.json(fallback);
  }
});

const updateSchema = z.object({
  show_incidents_by_default: z.boolean().optional(),
  default_view_mode: z.enum(["markers", "heatmap"]).optional(),
  default_basemap: z.string().min(1).optional(),
});

/** Platform-admin only — deliberately not extended to client-admins the way
 *  team management was; this is a platform-wide default everyone inherits,
 *  not something scoped to any one client's own team. */
mapSettingsRouter.patch("/", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.show_incidents_by_default !== undefined) {
    updates.push("show_incidents_by_default = ?");
    params.push(parsed.data.show_incidents_by_default ? 1 : 0);
  }
  if (parsed.data.default_view_mode !== undefined) {
    updates.push("default_view_mode = ?");
    params.push(parsed.data.default_view_mode);
  }
  if (parsed.data.default_basemap !== undefined) {
    updates.push("default_basemap = ?");
    params.push(parsed.data.default_basemap);
  }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);
  updates.push("updated_at = ?");
  params.push(nowIso());

  // Upsert rather than a plain UPDATE — guards against the singleton row
  // somehow not existing yet (a fresh database that hasn't run the seed
  // insert from the migration for whatever reason) rather than silently
  // updating zero rows and reporting success.
  await run(
    c.env.DB,
    `INSERT INTO map_default_settings (id, show_incidents_by_default, default_view_mode, default_basemap, updated_at)
     VALUES ('default', ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ${updates.join(", ")}`,
    [
      parsed.data.show_incidents_by_default !== undefined ? (parsed.data.show_incidents_by_default ? 1 : 0) : 1,
      parsed.data.default_view_mode ?? "markers",
      parsed.data.default_basemap ?? "osm",
      nowIso(),
      ...params,
    ]
  );

  const row = await first<MapDefaultSettingsRow>(c.env.DB, `SELECT * FROM map_default_settings WHERE id = 'default'`);
  return c.json(rowToSettings(row!));
});
