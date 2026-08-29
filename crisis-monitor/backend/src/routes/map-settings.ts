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
  default_filters: string | null;
  map_center_lat: number | null;
  map_center_lng: number | null;
  map_zoom: number | null;
  position_locked: number;
  updated_at: string;
}

const FALLBACK = {
  show_incidents_by_default: true,
  default_view_mode: "markers" as const,
  default_basemap: "osm",
  default_filters: {} as Record<string, string>,
  map_center_lat: null as number | null,
  map_center_lng: null as number | null,
  map_zoom: null as number | null,
  position_locked: false,
  updated_at: null as string | null,
};

function rowToSettings(row: MapDefaultSettingsRow) {
  let defaultFilters: Record<string, string> = {};
  try {
    defaultFilters = row.default_filters ? JSON.parse(row.default_filters) : {};
  } catch {
    defaultFilters = {};
  }
  return {
    show_incidents_by_default: !!row.show_incidents_by_default,
    default_view_mode: row.default_view_mode === "heatmap" ? "heatmap" : "markers",
    default_basemap: row.default_basemap,
    default_filters: defaultFilters,
    map_center_lat: row.map_center_lat,
    map_center_lng: row.map_center_lng,
    map_zoom: row.map_zoom,
    position_locked: !!row.position_locked,
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
  try {
    const row = await first<MapDefaultSettingsRow>(c.env.DB, `SELECT * FROM map_default_settings WHERE id = 'default'`);
    return c.json(row ? rowToSettings(row) : FALLBACK);
  } catch {
    return c.json(FALLBACK);
  }
});

const updateSchema = z.object({
  show_incidents_by_default: z.boolean().optional(),
  default_view_mode: z.enum(["markers", "heatmap"]).optional(),
  default_basemap: z.string().min(1).optional(),
  // A JSON blob covering date range plus all 15 categorical fields, rather
  // than one column per field — these are only ever read/written together
  // as a single filter object. Explicitly nullable so it can be cleared
  // back to "no default filter" without needing a separate endpoint.
  default_filters: z.record(z.string()).nullable().optional(),
  map_center_lat: z.number().nullable().optional(),
  map_center_lng: z.number().nullable().optional(),
  map_zoom: z.number().nullable().optional(),
  position_locked: z.boolean().optional(),
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
  if (parsed.data.default_filters !== undefined) {
    updates.push("default_filters = ?");
    params.push(parsed.data.default_filters === null ? null : JSON.stringify(parsed.data.default_filters));
  }
  if (parsed.data.map_center_lat !== undefined) {
    updates.push("map_center_lat = ?");
    params.push(parsed.data.map_center_lat);
  }
  if (parsed.data.map_center_lng !== undefined) {
    updates.push("map_center_lng = ?");
    params.push(parsed.data.map_center_lng);
  }
  if (parsed.data.map_zoom !== undefined) {
    updates.push("map_zoom = ?");
    params.push(parsed.data.map_zoom);
  }
  if (parsed.data.position_locked !== undefined) {
    updates.push("position_locked = ?");
    params.push(parsed.data.position_locked ? 1 : 0);
  }
  if (updates.length === 0) return c.json({ error: "Nothing to update" }, 400);
  updates.push("updated_at = ?");
  params.push(nowIso());
  params.push("default");

  // Two simple, independently-correct steps rather than one combined
  // upsert — INSERT OR IGNORE guarantees the singleton row exists (a no-op
  // if it already does, via the primary key conflict), then a plain UPDATE
  // applies only the fields actually being changed. Far easier to verify
  // as this grows more fields than interleaving INSERT VALUES with an
  // UPDATE SET clause's params in a single statement.
  await run(
    c.env.DB,
    `INSERT OR IGNORE INTO map_default_settings (id, show_incidents_by_default, default_view_mode, default_basemap, updated_at) VALUES ('default', 1, 'markers', 'osm', ?)`,
    [nowIso()]
  );
  await run(c.env.DB, `UPDATE map_default_settings SET ${updates.join(", ")} WHERE id = ?`, params);

  const row = await first<MapDefaultSettingsRow>(c.env.DB, `SELECT * FROM map_default_settings WHERE id = 'default'`);
  return c.json(rowToSettings(row!));
});
