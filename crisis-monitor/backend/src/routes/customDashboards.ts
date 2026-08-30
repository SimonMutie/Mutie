import { Hono } from "hono";
import { z } from "zod";
import { all, first, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { isPivotable, buildScopeClause, fetchIncidentsBreakdown, fetchIncidentsCrosstab, teamOwnerIds } from "./incidents";
import { loadDatasetSchema, fetchDatasetBreakdown, fetchDatasetCrosstab, fetchDatasetSummary, fetchDatasetDaily } from "./datasets";

export const customDashboardsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
customDashboardsRouter.use("*", requireAuth);

/** Widgets store their primary breakdown as e.g. "by_province" (matching the
 *  by_X stats fields), but crosstabs are keyed by the bare column name
 *  ("province") to match /crosstab and the pivotable-fields allowlist. */
const DATA_FIELD_TO_COLUMN: Partial<Record<string, string>> = {
  by_sector: "sector",
  by_actor: "actor",
  by_tactic: "tactic",
  by_province: "province",
  by_country: "country",
  by_severity: "severity",
  by_county: "county",
  by_district: "district",
  by_city: "city",
  by_suburb: "suburb",
  by_operation: "operation",
  by_target: "target",
  by_interest_group: "interest_group",
  by_actual_main_victim: "actual_main_victim",
  by_intended_primary_target: "intended_primary_target",
};

/** Not gated by requireAuth — reachable by anyone with the link, which is the
 *  entire point of "share for live viewing". Only returns data for dashboards
 *  their owner has explicitly flagged public. */
export const publicDashboardsRouter = new Hono<{ Bindings: Env }>();

const layoutSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const widgetSchema = z.object({
  id: z.string(),
  type: z.enum(["stat", "bar", "line", "pie", "map", "radar", "funnel", "choropleth", "calendar", "sankey", "network", "bubble", "globe", "heatmap_table", "bullet"]),
  title: z.string(),
  label: z.string().optional(),
  /** For incidents-sourced widgets, one of the fixed by_X/total/etc. values
   *  (not re-validated as a strict enum here — an invalid value just yields
   *  an empty series on the frontend rather than breaking anything, same
   *  tolerance already extended to secondaryField/datasetId). For a
   *  dataset-sourced widget (datasetId set), this holds that dataset's own
   *  raw column name instead, which can't be constrained to a fixed list
   *  since every dataset defines its own columns. */
  dataField: z.string().optional(),
  /** Bar/line only — a second dimension to break the primary field down by
   *  (stacked/grouped bars, multi-series lines), turning a single-variable
   *  chart into a genuine two-variable pivot. For incidents-sourced widgets
   *  this is one of the /crosstab allowlist's columns; for dataset-sourced
   *  widgets, any of that dataset's own column names. Not re-validated as a
   *  strict enum here for the same reason as dataField above — the actual
   *  SQL-facing endpoints (/crosstab, /datasets/:id/crosstab) do their own
   *  allowlist checks against real column names at query time regardless. */
  secondaryField: z.string().optional(),
  size: z.enum(["small", "medium", "large"]).default("medium"),
  showDataLabels: z.boolean().optional(),
  color: z.string().optional(),
  palette: z.array(z.string()).optional(),
  showLegend: z.boolean().optional(),
  topN: z.number().int().positive().optional(),
  layout: layoutSchema.optional(),
  locked: z.boolean().optional(),
  showSparkline: z.boolean().optional(),
  /** When set, this widget charts an uploaded dataset instead of incidents —
   *  dataField/secondaryField then hold that dataset's own raw column names
   *  directly, not the incidents by_X convention. */
  datasetId: z.string().optional(),
  /** Choropleth/globe only — user-typed country values, bypassing
   *  Incidents/dataset entirely. Free-text country names, not re-validated
   *  against a fixed list — an unmatched name just renders unshaded on the
   *  frontend rather than breaking anything. */
  manualCountryData: z.array(z.object({ country: z.string(), value: z.number(), color: z.string().optional() })).optional(),
  mapView: z.object({ lat: z.number(), lng: z.number(), zoom: z.number() }).optional(),
  mapViewMode: z.enum(["markers", "heatmap"]).optional(),
  /** Globe only — free-standing text labels (checkpoints, ports, chokepoints,
   *  anything worth naming directly on the map) at a country name or precise
   *  "lat,lng", independent of country shading and routes. */
  manualLabels: z
    .array(
      z.object({
        location: z.string(),
        text: z.string(),
        color: z.string().optional(),
        type: z
          .enum(["checkpoint", "chokepoint", "port", "airport", "military", "school", "health", "government", "town", "dam", "investment", "border_point", "other"])
          .optional(),
      })
    )
    .optional(),
  labelFontFamily: z.string().optional(),
  labelFontSize: z.number().positive().optional(),
  labelOffsets: z.record(z.object({ dx: z.number(), dy: z.number() })).optional(),
  manualRoutes: z
    .array(
      z.object({
        waypoints: z.array(z.string()).min(2),
        label: z.string().optional(),
        color: z.string().optional(),
        vehicle: z.enum(["plane", "commercial-ship", "warship", "drone", "none"]).optional(),
        strokeWidth: z.number().positive().optional(),
      })
    )
    .optional(),
  bulletWarningThreshold: z.number().optional(),
  bulletCriticalThreshold: z.number().optional(),
  bulletTarget: z.number().optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  widgets: z.array(widgetSchema).default([]),
});

function rowToDashboard(row: Record<string, unknown>) {
  return { ...row, widgets: JSON.parse(String(row.widgets ?? "[]")), is_public: !!row.is_public, is_auto: !!row.is_auto, locked: !!row.locked };
}

/** Which dashboard ids the caller's client organization has been explicitly
 *  granted access to — empty for the platform admin (who already sees
 *  everything via the isAdmin branches below) and for any caller not part
 *  of a client org. Read-only visibility only, same principle as
 *  effectiveReadScope in incidents.ts: being granted access to view a
 *  shared dashboard never implies any right to edit or delete it — those
 *  endpoints below are untouched by this and still check ownership alone. */
async function grantedDashboardIds(db: D1Database, userId: string): Promise<string[]> {
  const user = await first<{ client_id: string | null }>(db, `SELECT client_id FROM users WHERE id = ?`, [userId]);
  if (!user?.client_id) return [];
  const rows = await all<{ dashboard_id: string }>(db, `SELECT dashboard_id FROM client_dashboard_access WHERE client_id = ?`, [user.client_id]);
  return rows.map((r) => r.dashboard_id);
}

customDashboardsRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  if (isAdmin) {
    const rows = await all(c.env.DB, `SELECT * FROM custom_dashboards ORDER BY updated_at DESC`);
    return c.json(rows.map(rowToDashboard));
  }
  const team = await teamOwnerIds(c.env.DB, ownerId);
  const granted = await grantedDashboardIds(c.env.DB, ownerId);
  const teamPlaceholders = team.map(() => "?").join(",");
  const rows =
    granted.length > 0
      ? await all(
          c.env.DB,
          `SELECT * FROM custom_dashboards WHERE owner_id IN (${teamPlaceholders}) OR id IN (${granted.map(() => "?").join(",")}) ORDER BY updated_at DESC`,
          [...team, ...granted]
        )
      : await all(c.env.DB, `SELECT * FROM custom_dashboards WHERE owner_id IN (${teamPlaceholders}) ORDER BY updated_at DESC`, team);
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
  if (!isAdmin) {
    const team = await teamOwnerIds(c.env.DB, ownerId);
    const isTeammatesOwn = team.includes(String(row.owner_id));
    if (!isTeammatesOwn) {
      const granted = await grantedDashboardIds(c.env.DB, ownerId);
      if (!granted.includes(c.req.param("id"))) return c.json({ error: "Not found" }, 404);
    }
  }
  return c.json(rowToDashboard(row));
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  widgets: z.array(widgetSchema).optional(),
  is_public: z.boolean().optional(),
  locked: z.boolean().optional(),
  // Nullable (not just optional) so the filter can be explicitly cleared —
  // undefined means "don't touch this field", null means "remove the date
  // filter and show all time".
  date_range_from: z.string().nullable().optional(),
  date_range_to: z.string().nullable().optional(),
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
  if (parsed.data.is_public !== undefined) {
    updates.push("is_public = ?");
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
  if (parsed.data.date_range_from !== undefined) {
    updates.push("date_range_from = ?");
    params.push(parsed.data.date_range_from);
  }
  if (parsed.data.date_range_to !== undefined) {
    updates.push("date_range_to = ?");
    params.push(parsed.data.date_range_to);
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
 *  dashboard's owner (not any viewer — there isn't one, this is public).
 *  Uses the exact same clause-building helper as the authenticated route, so
 *  the two can't quietly drift into different date-filtering behavior. */
async function computeStatsForOwner(db: D1Database, ownerId: string | null, dateFrom?: string | null, dateTo?: string | null) {
  const { whereClause, andClause, params: scopeParams } = buildScopeClause(ownerId ? [ownerId] : null, dateFrom ?? undefined, dateTo ?? undefined);

  const [total, bySector, byActor, byTactic, bySeverity, byProvince, byCountry, timeSeries, daily, actorTactic, casualties] = await Promise.all([
    first<{ count: number }>(db, `SELECT COUNT(*) AS count FROM incidents ${whereClause}`, scopeParams),
    all<{ value: string; count: number }>(
      db,
      `SELECT sector AS value, COUNT(*) AS count FROM incidents WHERE sector IS NOT NULL AND sector != '' ${andClause} GROUP BY sector ORDER BY count DESC LIMIT 12`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT actor AS value, COUNT(*) AS count FROM incidents WHERE actor IS NOT NULL AND actor != '' ${andClause} GROUP BY actor ORDER BY count DESC LIMIT 12`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT tactic AS value, COUNT(*) AS count FROM incidents WHERE tactic IS NOT NULL AND tactic != '' ${andClause} GROUP BY tactic ORDER BY count DESC LIMIT 12`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT severity AS value, COUNT(*) AS count FROM incidents WHERE severity IS NOT NULL AND severity != '' ${andClause} GROUP BY severity ORDER BY count DESC LIMIT 12`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT province AS value, COUNT(*) AS count FROM incidents WHERE province IS NOT NULL AND province != '' ${andClause} GROUP BY province ORDER BY count DESC LIMIT 20`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      db,
      `SELECT country AS value, COUNT(*) AS count FROM incidents WHERE country IS NOT NULL AND country != '' ${andClause} GROUP BY country ORDER BY count DESC LIMIT 20`,
      scopeParams
    ),
    all<{ bucket: string; count: number }>(
      db,
      `SELECT substr(occurred_at, 1, 7) AS bucket, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL ${andClause} GROUP BY bucket ORDER BY bucket ASC`,
      scopeParams
    ),
    dateFrom || dateTo
      ? all<{ date: string; count: number }>(
          db,
          `SELECT substr(occurred_at, 1, 10) AS date, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL ${andClause} GROUP BY date ORDER BY date ASC`,
          scopeParams
        )
      : all<{ date: string; count: number }>(
          db,
          `SELECT substr(occurred_at, 1, 10) AS date, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL AND occurred_at >= date('now', '-400 days') ${andClause} GROUP BY date ORDER BY date ASC`,
          scopeParams
        ),
    all<{ actor: string; tactic: string; count: number }>(
      db,
      `SELECT actor, tactic, COUNT(*) AS count FROM incidents WHERE actor IS NOT NULL AND actor != '' AND tactic IS NOT NULL AND tactic != '' ${andClause} GROUP BY actor, tactic ORDER BY count DESC LIMIT 30`,
      scopeParams
    ),
    first<Record<string, number>>(
      db,
      `SELECT
         COALESCE(SUM(civilian_death_child), 0) + COALESCE(SUM(civilian_death_female), 0) + COALESCE(SUM(civilian_death_male), 0) + COALESCE(SUM(civilian_death_unknown), 0) AS deaths,
         COALESCE(SUM(civilian_injury_female), 0) + COALESCE(SUM(civilian_injury_male), 0) + COALESCE(SUM(civilian_injury_unknown), 0) AS injuries,
         COALESCE(SUM(kidnappings_ngo), 0) AS kidnappings_ngo
       FROM incidents ${whereClause}`,
      scopeParams
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
    actor_tactic: actorTactic,
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

  const dateFrom = dashboard.date_range_from as string | null;
  const dateTo = dashboard.date_range_to as string | null;
  const stats = await computeStatsForOwner(c.env.DB, dashboard.owner_id as string | null, dateFrom, dateTo);
  const ownerId = dashboard.owner_id as string | null;

  // Only fetched if a map widget is actually present — no point pulling
  // thousands of rows for a purely chart-based dashboard.
  const widgets = JSON.parse(String(dashboard.widgets ?? "[]")) as { type?: string; dataField?: string; secondaryField?: string; datasetId?: string }[];
  const hasMapWidget = Array.isArray(widgets) && widgets.some((w) => w.type === "map");
  let incidents: Record<string, unknown>[] = [];
  if (hasMapWidget) {
    incidents = ownerId
      ? await all(
          c.env.DB,
          `SELECT id, latitude, longitude, severity, actor, sector, tactic, occurred_date, city, province FROM incidents WHERE owner_id = ? AND latitude IS NOT NULL LIMIT 5000`,
          [ownerId]
        )
      : [];
  }

  // Only the specific (primary, secondary) pairs and single fields this
  // dashboard's own widgets actually use — not every possible combination.
  // A "ds:<id>:..." key, matching the frontend's crosstabKeyFor /
  // breakdownKeyFor exactly, routes to that dataset's own crosstab/breakdown
  // instead of the incidents one — but only once schemaFor() below confirms
  // the dataset actually belongs to *this dashboard's* owner. A tampered
  // widget referencing someone else's dataset id must not leak it here; the
  // public route has no login to fall back on for that check.
  const crosstabs: Record<string, { primary_value: string; secondary_value: string; count: number }[]> = {};
  const breakdowns: Record<string, { value: string; count: number }[]> = {};
  const dailyBreakdowns: Record<string, { date: string; count: number }[]> = {};
  const datasetSummaries: Record<string, { total: number; sums: Record<string, number> }> = {};
  const datasetSchemaCache = new Map<string, { name: string; type: string }[] | null>();

  async function schemaFor(datasetId: string): Promise<{ name: string; type: string }[] | null> {
    if (datasetSchemaCache.has(datasetId)) return datasetSchemaCache.get(datasetId)!;
    const loaded = await loadDatasetSchema(c.env.DB, datasetId);
    const schema = loaded && loaded.owner_id === ownerId ? loaded.schema : null;
    datasetSchemaCache.set(datasetId, schema);
    return schema;
  }

  for (const w of widgets) {
    if (w.datasetId) {
      const schema = await schemaFor(w.datasetId);
      if (!schema) continue; // dataset missing, or doesn't belong to this dashboard's owner
      if (w.type === "stat" && !(w.datasetId in datasetSummaries)) {
        datasetSummaries[w.datasetId] = await fetchDatasetSummary(c.env.DB, w.datasetId, schema);
      }
      if (w.type === "calendar" && w.dataField) {
        const key = `ds:${w.datasetId}:${w.dataField}`;
        if (!(key in dailyBreakdowns)) dailyBreakdowns[key] = await fetchDatasetDaily(c.env.DB, w.datasetId, schema, w.dataField);
      } else if (w.dataField && w.secondaryField) {
        const key = `ds:${w.datasetId}:${w.dataField}|${w.secondaryField}`;
        if (!(key in crosstabs)) crosstabs[key] = await fetchDatasetCrosstab(c.env.DB, w.datasetId, schema, w.dataField, w.secondaryField);
      } else if (w.dataField) {
        const key = `ds:${w.datasetId}:${w.dataField}`;
        if (!(key in breakdowns)) breakdowns[key] = await fetchDatasetBreakdown(c.env.DB, w.datasetId, schema, w.dataField);
      }
      continue;
    }

    const primary = w.dataField ? DATA_FIELD_TO_COLUMN[w.dataField] : undefined;
    if (primary && isPivotable(primary) && isPivotable(w.secondaryField)) {
      const key = `${primary}|${w.secondaryField}`;
      if (!(key in crosstabs)) crosstabs[key] = await fetchIncidentsCrosstab(c.env.DB, ownerId ? [ownerId] : null, primary, w.secondaryField, dateFrom ?? undefined, dateTo ?? undefined);
    } else if (primary && isPivotable(primary) && !("by_" + primary in stats)) {
      if (!(primary in breakdowns)) breakdowns[primary] = await fetchIncidentsBreakdown(c.env.DB, ownerId ? [ownerId] : null, primary, dateFrom ?? undefined, dateTo ?? undefined);
    }
  }

  return c.json({
    name: dashboard.name,
    widgets,
    stats,
    date_range_from: dateFrom,
    date_range_to: dateTo,
    crosstabs,
    breakdowns,
    dailyBreakdowns,
    datasetSummaries,
    incidents,
    updated_at: dashboard.updated_at,
  });
});
