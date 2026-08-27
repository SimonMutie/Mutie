import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const customDashboardsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
customDashboardsRouter.use("*", requireAuth);

/** Not gated by requireAuth — reachable by anyone with the link, which is the
 *  entire point of "share for live viewing". Only returns data for dashboards
 *  their owner has explicitly flagged public. */
export const publicDashboardsRouter = new Hono<{ Bindings: Env }>();

const layoutSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const widgetSchema = z.object({
  id: z.string(),
  type: z.enum(["stat", "bar", "line", "pie", "map", "radar", "funnel", "choropleth", "calendar"]),
  title: z.string(),
  label: z.string().optional(),
  dataField: z.enum(["total", "by_sector", "by_actor", "by_tactic", "by_province", "by_country", "time_series", "deaths", "injuries", "kidnappings_ngo"]).optional(),
  size: z.enum(["small", "medium", "large"]).default("medium"),
  showDataLabels: z.boolean().optional(),
  color: z.string().optional(),
  palette: z.array(z.string()).optional(),
  showLegend: z.boolean().optional(),
  topN: z.number().int().positive().optional(),
  layout: layoutSchema.optional(),
  locked: z.boolean().optional(),
  showSparkline: z.boolean().optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  widgets: z.array(widgetSchema).default([]),
});

function rowToDashboard(row: Record<string, unknown>) {
  return { ...row, widgets: JSON.parse(String(row.widgets ?? "[]")), is_public: !!row.is_public, is_auto: !!row.is_auto, locked: !!row.locked };
}

customDashboardsRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const rows = isAdmin
    ? await all(c.env.DB, `SELECT * FROM custom_dashboards ORDER BY updated_at DESC`)
    : await all(c.env.DB, `SELECT * FROM custom_dashboards WHERE owner_id = ? ORDER BY updated_at DESC`, [ownerId]);
  return c.json(rows.map(rowToDashboard));
});

customDashboardsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO custom_dashboards (id, owner_id, name, widgets, is_public, share_token, created_at, updated_at) VALUES (?,?,?,?,0,NULL,?,?)`
  )
    .bind(id, c.get("userId"), parsed.data.name, JSON.stringify(parsed.data.widgets), now, now)
    .run();

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM custom_dashboards WHERE id = ?`, [id]);
  return c.json(rowToDashboard(row!));
});

/** Seeded the first time a user opens "Auto Dashboard" — mirrors what used to
 *  be hardcoded there, but now as real, editable widgets like everything else. */
function defaultAutoWidgets() {
  return [
    { id: newId(), type: "stat", title: "Total incidents", dataField: "total", size: "small", layout: { x: 0, y: 0, w: 3, h: 4 } },
    { id: newId(), type: "stat", title: "Civilian deaths", dataField: "deaths", size: "small", color: "#d1352b", layout: { x: 3, y: 0, w: 3, h: 4 } },
    { id: newId(), type: "stat", title: "Civilian injuries", dataField: "injuries", size: "small", color: "#b3690b", layout: { x: 6, y: 0, w: 3, h: 4 } },
    { id: newId(), type: "stat", title: "NGO kidnappings", dataField: "kidnappings_ngo", size: "small", layout: { x: 9, y: 0, w: 3, h: 4 } },
    { id: newId(), type: "bar", title: "Incidents by sector", dataField: "by_sector", size: "medium", layout: { x: 0, y: 4, w: 6, h: 8 } },
    { id: newId(), type: "bar", title: "Incidents by actor", dataField: "by_actor", size: "medium", color: "#2f66f0", layout: { x: 6, y: 4, w: 6, h: 8 } },
    { id: newId(), type: "bar", title: "Incidents by tactic", dataField: "by_tactic", size: "medium", color: "#b3690b", layout: { x: 0, y: 12, w: 6, h: 8 } },
    { id: newId(), type: "bar", title: "Incidents by province", dataField: "by_province", size: "medium", color: "#d1352b", layout: { x: 6, y: 12, w: 6, h: 8 } },
    { id: newId(), type: "bar", title: "Incidents by country", dataField: "by_country", size: "medium", color: "#7c3aed", layout: { x: 0, y: 20, w: 6, h: 8 } },
    { id: newId(), type: "line", title: "Incidents over time", dataField: "time_series", size: "large", layout: { x: 6, y: 20, w: 6, h: 8 } },
  ];
}

customDashboardsRouter.get("/auto", async (c) => {
  const ownerId = c.get("userId");
  const existing = await first<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM custom_dashboards WHERE owner_id = ? AND is_auto = 1`,
    [ownerId]
  );
  if (existing) return c.json(rowToDashboard(existing));

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO custom_dashboards (id, owner_id, name, widgets, is_public, share_token, is_auto, created_at, updated_at) VALUES (?,?,?,?,0,NULL,1,?,?)`
  )
    .bind(id, ownerId, "Auto Dashboard", JSON.stringify(defaultAutoWidgets()), now, now)
    .run();

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM custom_dashboards WHERE id = ?`, [id]);
  return c.json(rowToDashboard(row!));
});

customDashboardsRouter.get("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM custom_dashboards WHERE id = ?`, [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && row.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);
  return c.json(rowToDashboard(row));
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  widgets: z.array(widgetSchema).optional(),
  is_public: z.boolean().optional(),
  locked: z.boolean().optional(),
});

customDashboardsRouter.patch("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null; share_token: string | null }>(
    c.env.DB,
    `SELECT owner_id, share_token FROM custom_dashboards WHERE id = ?`,
    [id]
  );
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
  if (parsed.data.widgets !== undefined) {
    updates.push("widgets = ?");
    params.push(JSON.stringify(parsed.data.widgets));
  }
  if (parsed.data.is_public !== undefined) {    updates.push("is_public = ?");
    params.push(parsed.data.is_public ? 1 : 0);
    // Mint a share token the first time a dashboard goes public; keep the
    // same token across future toggles so a previously-shared link keeps working.
    if (parsed.data.is_public && !existing.share_token) {
      updates.push("share_token = ?");
      params.push(newId());
    }
  }
  if (parsed.data.locked !== undefined) {
    updates.push("locked = ?");
    params.push(parsed.data.locked ? 1 : 0);
  }
  updates.push("updated_at = ?");
  params.push(nowIso());
  params.push(id);

  await c.env.DB.prepare(`UPDATE custom_dashboards SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM custom_dashboards WHERE id = ?`, [id]);
  return c.json(rowToDashboard(row!));
});

customDashboardsRouter.delete("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM custom_dashboards WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && existing.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare(`DELETE FROM custom_dashboards WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

// --- public, no-auth viewing ---

/** Same aggregate shape as /api/incidents/stats, computed here directly rather
 *  than calling that authed route internally, and explicitly scoped to the
 *  dashboard's owner (not any viewer — there isn't one, this is public). */
async function computeStatsForOwner(db: D1Database, ownerId: string | null) {
  const ownerClause = ownerId ? "WHERE owner_id = ?" : "";
  const andOwner = ownerId ? "AND owner_id = ?" : "";
  const ownerParams = ownerId ? [ownerId] : [];

  const [total, bySector, byActor, byTactic, bySeverity, byProvince, byCountry, timeSeries, daily, casualties] = await Promise.all([
    first<{ count: number }>(db, `SELECT COUNT(*) AS count FROM incidents ${ownerClause}`, ownerParams),
    all<{ value: string; count: number }>(
      db,
      `SELECT sector AS value, COUNT(*) AS count FROM incidents WHERE sector IS NOT NULL AND sector != '' ${andOwner} GROUP BY sector ORDER BY count DESC LIMIT 12`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT actor AS value, COUNT(*) AS count FROM incidents WHERE actor IS NOT NULL AND actor != '' ${andOwner} GROUP BY actor ORDER BY count DESC LIMIT 12`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT tactic AS value, COUNT(*) AS count FROM incidents WHERE tactic IS NOT NULL AND tactic != '' ${andOwner} GROUP BY tactic ORDER BY count DESC LIMIT 12`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT severity AS value, COUNT(*) AS count FROM incidents WHERE severity IS NOT NULL AND severity != '' ${andOwner} GROUP BY severity ORDER BY count DESC LIMIT 12`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT province AS value, COUNT(*) AS count FROM incidents WHERE province IS NOT NULL AND province != '' ${andOwner} GROUP BY province ORDER BY count DESC LIMIT 20`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT country AS value, COUNT(*) AS count FROM incidents WHERE country IS NOT NULL AND country != '' ${andOwner} GROUP BY country ORDER BY count DESC LIMIT 20`,
      ownerParams
    ),
    all<{ bucket: string; count: number }>(
      db,
      `SELECT substr(occurred_at, 1, 7) AS bucket, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL ${andOwner} GROUP BY bucket ORDER BY bucket ASC`,
      ownerParams
    ),
    all<{ date: string; count: number }>(
      db,
      `SELECT substr(occurred_at, 1, 10) AS date, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL AND occurred_at >= date('now', '-400 days') ${andOwner} GROUP BY date ORDER BY date ASC`,
      ownerParams
    ),
    first<Record<string, number>>(
      db,
      `SELECT
         COALESCE(SUM(civilian_death_child), 0) + COALESCE(SUM(civilian_death_female), 0) + COALESCE(SUM(civilian_death_male), 0) + COALESCE(SUM(civilian_death_unknown), 0) AS deaths,
         COALESCE(SUM(civilian_injury_female), 0) + COALESCE(SUM(civilian_injury_male), 0) + COALESCE(SUM(civilian_injury_unknown), 0) AS injuries,
         COALESCE(SUM(kidnappings_ngo), 0) AS kidnappings_ngo
       FROM incidents ${ownerClause}`,
      ownerParams
    ),
  ]);

  return {
    total: total?.count ?? 0,
    by_sector: bySector,
    by_actor: byActor,
    by_tactic: byTactic,
    by_severity: bySeverity,
    by_province: byProvince,
    by_country: byCountry,
    time_series: timeSeries,
    daily,
    deaths: casualties?.deaths ?? 0,
    injuries: casualties?.injuries ?? 0,
    kidnappings_ngo: casualties?.kidnappings_ngo ?? 0,
  };
}

publicDashboardsRouter.get("/:token", async (c) => {
  const token = c.req.param("token");
  const dashboard = await first<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM custom_dashboards WHERE share_token = ? AND is_public = 1`,
    [token]
  );
  if (!dashboard) return c.json({ error: "Not found" }, 404);

  const stats = await computeStatsForOwner(c.env.DB, dashboard.owner_id as string | null);

  // Only fetched if a map widget is actually present — no point pulling
  // thousands of rows for a purely chart-based dashboard.
  const widgets = JSON.parse(String(dashboard.widgets ?? "[]"));
  const hasMapWidget = Array.isArray(widgets) && widgets.some((w: { type?: string }) => w.type === "map");
  let incidents: Record<string, unknown>[] = [];
  if (hasMapWidget) {
    const ownerId = dashboard.owner_id as string | null;
    incidents = ownerId
      ? await all(
          c.env.DB,
          `SELECT id, latitude, longitude, severity, actor, sector, occurred_date, city, province FROM incidents WHERE owner_id = ? AND latitude IS NOT NULL LIMIT 5000`,
          [ownerId]
        )
      : [];
  }

  return c.json({
    name: dashboard.name,
    widgets,
    stats,
    incidents,
    updated_at: dashboard.updated_at,
  });
});
