import { Hono } from "hono";
import { z } from "zod";
import { all, first, batchRun, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const incidentsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

incidentsRouter.use("*", requireAuth);

// Loose on purpose: real-world spreadsheet exports are messy (blank cells, stray
// whitespace, numbers-as-strings). Everything is optional except that a row with
// truly nothing in it is rejected client-side before it ever gets here.
const incidentRowSchema = z.object({
  date: z.string().nullish(),
  time: z.string().nullish(),
  country: z.string().nullish(),
  province: z.string().nullish(),
  county: z.string().nullish(),
  district: z.string().nullish(),
  city: z.string().nullish(),
  suburb: z.string().nullish(),
  precise_location: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  sector: z.string().nullish(),
  actor: z.string().nullish(),
  operation: z.string().nullish(),
  tactic: z.string().nullish(),
  severity: z.string().nullish(),
  details: z.string().nullish(),
  target: z.string().nullish(),
  interest_group: z.string().nullish(),
  actual_main_victim: z.string().nullish(),
  intended_primary_target: z.string().nullish(),
  civilian_death_child: z.number().nullish(),
  civilian_death_female: z.number().nullish(),
  civilian_death_male: z.number().nullish(),
  civilian_death_unknown: z.number().nullish(),
  civilian_injury_female: z.number().nullish(),
  civilian_injury_male: z.number().nullish(),
  civilian_injury_unknown: z.number().nullish(),
  kidnappings_ngo: z.number().nullish(),
  raw: z.record(z.unknown()).default({}),
});

const bulkUploadSchema = z.object({
  rows: z.array(incidentRowSchema).min(1).max(2000),
  batch_label: z.string().optional(),
  // Client-supplied and reused across every chunk of one upload, so a >500-row
  // file (sent as several bulk-insert calls) still shares one identity end to
  // end — without this, each chunk would get its own random batch, and a
  // large file could never be deleted as a single unit.
  batch_id: z.string().optional(),
});

/** Best-effort combine of the spreadsheet's separate Date/Time text into one ISO
 *  timestamp for sorting/charting. Tries a handful of common export formats and
 *  gives up cleanly (returns null) rather than guessing wrong — a null just means
 *  the row won't count towards the time-series chart, it's still stored and
 *  shown on the map/table either way. */
function combineDateTime(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date) return null;
  const datePart = date.trim();
  const timePart = (time ?? "").trim();
  const candidates = [`${datePart}T${timePart || "00:00:00"}`, `${datePart} ${timePart}`.trim(), datePart];
  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

incidentsRouter.post("/bulk", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = bulkUploadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const ownerId = c.get("userId");
  const batchId = parsed.data.batch_id ?? newId();
  const now = nowIso();

  const statements = parsed.data.rows.map((row) => {
    const occurredAt = combineDateTime(row.date, row.time);
    return {
      sql: `INSERT INTO incidents (
        id, owner_id, occurred_date, occurred_time, occurred_at,
        country, province, county, district, city, suburb, precise_location, latitude, longitude,
        sector, actor, operation, tactic, severity, details, target, interest_group,
        actual_main_victim, intended_primary_target,
        civilian_death_child, civilian_death_female, civilian_death_male, civilian_death_unknown,
        civilian_injury_female, civilian_injury_male, civilian_injury_unknown, kidnappings_ngo,
        raw_row, upload_batch_id, created_at
      ) VALUES (?,?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?,?, ?,?,?)`,
      params: [
        newId(),
        ownerId,
        row.date ?? null,
        row.time ?? null,
        occurredAt,
        row.country ?? null,
        row.province ?? null,
        row.county ?? null,
        row.district ?? null,
        row.city ?? null,
        row.suburb ?? null,
        row.precise_location ?? null,
        row.latitude ?? null,
        row.longitude ?? null,
        row.sector ?? null,
        row.actor ?? null,
        row.operation ?? null,
        row.tactic ?? null,
        row.severity ?? null,
        row.details ?? null,
        row.target ?? null,
        row.interest_group ?? null,
        row.actual_main_victim ?? null,
        row.intended_primary_target ?? null,
        row.civilian_death_child ?? null,
        row.civilian_death_female ?? null,
        row.civilian_death_male ?? null,
        row.civilian_death_unknown ?? null,
        row.civilian_injury_female ?? null,
        row.civilian_injury_male ?? null,
        row.civilian_injury_unknown ?? null,
        row.kidnappings_ngo ?? null,
        JSON.stringify(row.raw ?? {}),
        batchId,
        now,
      ],
    };
  });

  // A single D1 batch() call is atomic (all statements succeed or none do);
  // *separate* batch() calls are not atomic with each other — if this were
  // split into several batch() calls and a later one failed, the earlier
  // ones' rows would already be committed. Sending the whole request as one
  // batch means a failed request is guaranteed to have inserted nothing,
  // which is what makes the frontend's retry-the-same-chunk-on-failure logic
  // safe from creating duplicates. D1 comfortably supports batches well
  // above the 500-statement chunks the frontend sends.
  await batchRun(c.env.DB, statements);

  // Track this as an "upload" the user can later see and delete as one unit —
  // except single-row manual entries, which would otherwise clutter that list
  // with one entry per incident someone typed in by hand. Upsert so repeated
  // chunk calls sharing the same batch_id accumulate row_count on one row
  // instead of creating duplicates (created_at/label stay from the first chunk).
  if (parsed.data.batch_label !== "Manual entry") {
    await c.env.DB.prepare(
      `INSERT INTO incident_uploads (id, owner_id, label, row_count, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET row_count = row_count + excluded.row_count`
    )
      .bind(batchId, ownerId, parsed.data.batch_label ?? "Untitled upload", statements.length, now)
      .run();
  }

  return c.json({ inserted: statements.length, batch_id: batchId, batch_label: parsed.data.batch_label ?? null });
});

const MAX_LIST_LIMIT = 250000; // effectively uncapped for any realistic dataset size here — was 5000, which silently truncated real exports

incidentsRouter.get("/", async (c) => {
  const scopeOwnerId = await effectiveReadScope(c.env.DB, c.get("role"), c.get("userId"));

  const country = c.req.query("country");
  const province = c.req.query("province");
  const sector = c.req.query("sector");
  const actor = c.req.query("actor");
  const tactic = c.req.query("tactic");
  const severity = c.req.query("severity");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const limit = Math.min(Number(c.req.query("limit") ?? 2000) || 2000, MAX_LIST_LIMIT);

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (scopeOwnerId) {
    conditions.push("owner_id = ?");
    params.push(scopeOwnerId);
  }
  if (country) {
    conditions.push("country = ?");
    params.push(country);
  }
  if (province) {
    conditions.push("province = ?");
    params.push(province);
  }
  if (sector) {
    conditions.push("sector = ?");
    params.push(sector);
  }
  if (actor) {
    conditions.push("actor = ?");
    params.push(actor);
  }
  if (tactic) {
    conditions.push("tactic = ?");
    params.push(tactic);
  }
  if (severity) {
    conditions.push("severity = ?");
    params.push(severity);
  }
  if (from) {
    conditions.push("occurred_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("occurred_at <= ?");
    params.push(to);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = await all(
    c.env.DB,
    `SELECT * FROM incidents ${whereSql} ORDER BY occurred_at DESC NULLS LAST LIMIT ?`,
    params
  );
  return c.json(rows.map((row) => ({ ...row, raw_row: JSON.parse(String(row.raw_row ?? "{}")) })));
});

/** Distinct values for each filterable field, so the frontend can populate filter
 *  dropdowns from real data rather than a hardcoded guess at what values exist. */
incidentsRouter.get("/filters", async (c) => {
  const scopeOwnerId = await effectiveReadScope(c.env.DB, c.get("role"), c.get("userId"));
  const ownerClause = scopeOwnerId ? "WHERE owner_id = ?" : "";
  const ownerParams = scopeOwnerId ? [scopeOwnerId] : [];

  const fields = ["country", "province", "sector", "actor", "tactic", "severity"] as const;
  const results: Record<string, string[]> = {};
  for (const field of fields) {
    const rows = await all<{ value: string }>(
      c.env.DB,
      `SELECT DISTINCT ${field} AS value FROM incidents ${ownerClause} ${ownerClause ? "AND" : "WHERE"} ${field} IS NOT NULL AND ${field} != '' ORDER BY ${field}`,
      ownerParams
    );
    results[field] = rows.map((r) => r.value);
  }
  return c.json(results);
});

// Only ever interpolated into SQL after being checked against this allowlist
// — column names can't be bound parameters, so a strict allowlist (not just
// "looks like an identifier") is what keeps this safe from injection.
// Deliberately excludes `details` (long free-text description) — grouping by
// it would produce near-100%-unique buckets, not a usable category breakdown.
export const PIVOTABLE_FIELDS = [
  "sector",
  "actor",
  "tactic",
  "province",
  "country",
  "severity",
  "county",
  "district",
  "city",
  "suburb",
  "operation",
  "target",
  "interest_group",
  "actual_main_victim",
  "intended_primary_target",
] as const;
export type PivotableField = (typeof PIVOTABLE_FIELDS)[number];
/** Builds consistent owner + date-range conditions once, for every incidents
 *  query that needs them — a dashboard-wide date filter touches roughly a
 *  dozen separate queries across /stats, /breakdown, and /crosstab (plus
 *  their public-route equivalents in customDashboards.ts), and building this
 *  by hand in each one is exactly how they'd quietly drift apart over time.
 *  `andClause` is for queries that already have their own WHERE (e.g.
 *  `sector IS NOT NULL`); `whereClause` is for ones that don't. */
/** The "ownerId" to scope a READ query by — null means "see everything",
 *  same convention as the existing isAdmin checks throughout this file.
 *  Used ONLY by this file's GET endpoints (list, stats, breakdown,
 *  crosstab, uploads) — never by anything that writes or deletes. A client
 *  granted visibility into the shared incidents pool must still only be
 *  able to edit or delete their *own* incidents; conflating "can view
 *  everything" with "can modify everything" here would be a genuine
 *  access-control bug, not just a UX inconsistency, so this is
 *  deliberately not a drop-in replacement for every isAdmin check in this
 *  file — only the read ones. */
export async function effectiveReadScope(db: D1Database, role: string, userId: string): Promise<string | null> {
  if (role === "admin") return null;
  const row = await first<{ client_id: string | null; can_view_all_incidents: number | null }>(
    db,
    `SELECT u.client_id AS client_id, c.can_view_all_incidents AS can_view_all_incidents
     FROM users u LEFT JOIN clients c ON u.client_id = c.id
     WHERE u.id = ?`,
    [userId]
  );
  return row?.client_id && row.can_view_all_incidents ? null : userId;
}

export function buildScopeClause(ownerId: string | null, dateFrom?: string, dateTo?: string): { whereClause: string; andClause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (ownerId) {
    conditions.push("owner_id = ?");
    params.push(ownerId);
  }
  if (dateFrom) {
    conditions.push("occurred_at >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push("occurred_at <= ?");
    params.push(dateTo);
  }
  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    andClause: conditions.length ? `AND ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function isPivotable(v: string | undefined): v is PivotableField {
  return !!v && (PIVOTABLE_FIELDS as readonly string[]).includes(v);
}

/** Single-field version of /crosstab — a plain category breakdown for any of
 *  the (now much larger) pivotable field list, on demand rather than
 *  precomputed. The five original fields (sector/actor/tactic/province/
 *  country) still also exist as always-precomputed by_X fields on /stats for
 *  backward compatibility; this covers those five too plus the newer ones,
 *  through one general mechanism instead of a hardcoded query per field. */
/** Reusable, already-validated single-field breakdown for any pivotable
 *  field, scoped to a specific owner (not the calling admin/user — the
 *  public dashboard route needs the *dashboard's* owner's data, not the
 *  anonymous viewer's, since there isn't one). Exported so that route and
 *  the authed /breakdown endpoint below share one query path instead of two
 *  that could quietly drift apart. */
export async function fetchIncidentsBreakdown(db: D1Database, ownerId: string | null, field: string | undefined, dateFrom?: string, dateTo?: string): Promise<{ value: string; count: number }[]> {
  if (!isPivotable(field)) return [];
  const { andClause, params } = buildScopeClause(ownerId, dateFrom, dateTo);
  return all<{ value: string; count: number }>(
    db,
    `SELECT ${field} AS value, COUNT(*) AS count FROM incidents WHERE ${field} IS NOT NULL AND ${field} != '' ${andClause} GROUP BY ${field} ORDER BY count DESC LIMIT 30`,
    params
  );
}

export async function fetchIncidentsCrosstab(
  db: D1Database,
  ownerId: string | null,
  primary: string | undefined,
  secondary: string | undefined,
  dateFrom?: string,
  dateTo?: string
): Promise<{ primary_value: string; secondary_value: string; count: number }[]> {
  if (!isPivotable(primary) || !isPivotable(secondary)) return [];
  const { andClause, params } = buildScopeClause(ownerId, dateFrom, dateTo);
  return all<{ primary_value: string; secondary_value: string; count: number }>(
    db,
    `SELECT ${primary} AS primary_value, ${secondary} AS secondary_value, COUNT(*) AS count
     FROM incidents
     WHERE ${primary} IS NOT NULL AND ${primary} != '' AND ${secondary} IS NOT NULL AND ${secondary} != '' ${andClause}
     GROUP BY ${primary}, ${secondary}
     ORDER BY count DESC
     LIMIT 300`,
    params
  );
}

incidentsRouter.get("/breakdown", async (c) => {
  const field = c.req.query("field");
  if (!isPivotable(field)) {
    return c.json({ error: "field must be one of: " + PIVOTABLE_FIELDS.join(", ") }, 400);
  }
  const scopeOwnerId = await effectiveReadScope(c.env.DB, c.get("role"), c.get("userId"));
  return c.json(await fetchIncidentsBreakdown(c.env.DB, scopeOwnerId, field, c.req.query("from"), c.req.query("to")));
});

/** Genuine joint counts for any two of the pivotable fields — the general
 *  version of the one-off actor×tactic cross-tab already computed for
 *  Sankey/network widgets, now usable for any pair a chart actually needs. */
incidentsRouter.get("/crosstab", async (c) => {
  const primary = c.req.query("primary");
  const secondary = c.req.query("secondary");
  if (!isPivotable(primary) || !isPivotable(secondary)) {
    return c.json({ error: "primary and secondary must each be one of: " + PIVOTABLE_FIELDS.join(", ") }, 400);
  }
  const scopeOwnerId = await effectiveReadScope(c.env.DB, c.get("role"), c.get("userId"));
  return c.json(await fetchIncidentsCrosstab(c.env.DB, scopeOwnerId, primary, secondary, c.req.query("from"), c.req.query("to")));
});

incidentsRouter.get("/stats", async (c) => {
  const dateFrom = c.req.query("from");
  const dateTo = c.req.query("to");
  const scopeOwnerId = await effectiveReadScope(c.env.DB, c.get("role"), c.get("userId"));
  const { whereClause, andClause, params: scopeParams } = buildScopeClause(scopeOwnerId, dateFrom, dateTo);

  const [total, bySector, byActor, byTactic, bySeverity, byProvince, byCountry, timeSeries, daily, actorTactic, casualties] = await Promise.all([
    first<{ count: number }>(c.env.DB, `SELECT COUNT(*) AS count FROM incidents ${whereClause}`, scopeParams),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT sector AS value, COUNT(*) AS count FROM incidents WHERE sector IS NOT NULL AND sector != '' ${andClause} GROUP BY sector ORDER BY count DESC LIMIT 12`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT actor AS value, COUNT(*) AS count FROM incidents WHERE actor IS NOT NULL AND actor != '' ${andClause} GROUP BY actor ORDER BY count DESC LIMIT 12`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT tactic AS value, COUNT(*) AS count FROM incidents WHERE tactic IS NOT NULL AND tactic != '' ${andClause} GROUP BY tactic ORDER BY count DESC LIMIT 12`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT severity AS value, COUNT(*) AS count FROM incidents WHERE severity IS NOT NULL AND severity != '' ${andClause} GROUP BY severity ORDER BY count DESC LIMIT 12`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT province AS value, COUNT(*) AS count FROM incidents WHERE province IS NOT NULL AND province != '' ${andClause} GROUP BY province ORDER BY count DESC LIMIT 20`,
      scopeParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT country AS value, COUNT(*) AS count FROM incidents WHERE country IS NOT NULL AND country != '' ${andClause} GROUP BY country ORDER BY count DESC LIMIT 20`,
      scopeParams
    ),
    all<{ bucket: string; count: number }>(
      c.env.DB,
      `SELECT substr(occurred_at, 1, 7) AS bucket, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL ${andClause} GROUP BY bucket ORDER BY bucket ASC`,
      scopeParams
    ),
    // Day-level granularity. When a dashboard-wide date range is set, that
    // range drives the calendar directly (it's what was explicitly asked
    // for); otherwise this stays bounded to the last ~13 months, since a
    // calendar heatmap over a whole dataset's unfiltered history would be an
    // enormous, mostly-empty grid.
    dateFrom || dateTo
      ? all<{ date: string; count: number }>(
          c.env.DB,
          `SELECT substr(occurred_at, 1, 10) AS date, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL ${andClause} GROUP BY date ORDER BY date ASC`,
          scopeParams
        )
      : all<{ date: string; count: number }>(
          c.env.DB,
          `SELECT substr(occurred_at, 1, 10) AS date, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL AND occurred_at >= date('now', '-400 days') ${andClause} GROUP BY date ORDER BY date ASC`,
          scopeParams
        ),
    // Genuine joint counts (not independent marginals like the by_X fields
    // above) — how often each actor/tactic combination actually co-occurs in
    // the same incident. Powers Sankey and network/relationship widgets with
    // real data, not an invented "who's connected to whom" narrative.
    all<{ actor: string; tactic: string; count: number }>(
      c.env.DB,
      `SELECT actor, tactic, COUNT(*) AS count FROM incidents WHERE actor IS NOT NULL AND actor != '' AND tactic IS NOT NULL AND tactic != '' ${andClause} GROUP BY actor, tactic ORDER BY count DESC LIMIT 30`,
      scopeParams
    ),
    first<Record<string, number>>(
      c.env.DB,
      `SELECT
         COALESCE(SUM(civilian_death_child), 0) AS deaths_child,
         COALESCE(SUM(civilian_death_female), 0) AS deaths_female,
         COALESCE(SUM(civilian_death_male), 0) AS deaths_male,
         COALESCE(SUM(civilian_death_unknown), 0) AS deaths_unknown,
         COALESCE(SUM(civilian_injury_female), 0) AS injuries_female,
         COALESCE(SUM(civilian_injury_male), 0) AS injuries_male,
         COALESCE(SUM(civilian_injury_unknown), 0) AS injuries_unknown,
         COALESCE(SUM(kidnappings_ngo), 0) AS kidnappings_ngo
       FROM incidents ${whereClause}`,
      scopeParams
    ),
  ]);

  return c.json({
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
    casualties: casualties ?? {},
  });
});

const bulkDeleteSchema = z.object({ ids: z.array(z.string()).min(1).max(2000) });

/** POST, not DELETE-with-body — sending a body on a DELETE request is
 *  inconsistently supported across HTTP clients/proxies, so a dedicated bulk
 *  action route is more reliable than fighting that. */
incidentsRouter.post("/bulk-delete", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  const parsed = bulkDeleteSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  // Chunked (rather than one giant IN clause) to stay safely under D1's bound
  // parameter limit per statement even for a large selection.
  const CHUNK = 100;
  const statements: { sql: string; params: unknown[] }[] = [];
  for (let i = 0; i < parsed.data.ids.length; i += CHUNK) {
    const chunk = parsed.data.ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(
      isAdmin
        ? { sql: `DELETE FROM incidents WHERE id IN (${placeholders})`, params: chunk }
        : { sql: `DELETE FROM incidents WHERE id IN (${placeholders}) AND owner_id = ?`, params: [...chunk, ownerId] }
    );
  }
  await batchRun(c.env.DB, statements);
  return c.json({ ok: true, deleted: parsed.data.ids.length });
});

const SIMPLE_INCIDENT_FIELDS = [
  "country",
  "province",
  "county",
  "district",
  "city",
  "suburb",
  "precise_location",
  "latitude",
  "longitude",
  "sector",
  "actor",
  "operation",
  "tactic",
  "severity",
  "details",
  "target",
  "interest_group",
  "actual_main_victim",
  "intended_primary_target",
  "civilian_death_child",
  "civilian_death_female",
  "civilian_death_male",
  "civilian_death_unknown",
  "civilian_injury_female",
  "civilian_injury_male",
  "civilian_injury_unknown",
  "kidnappings_ngo",
] as const;

const updateIncidentSchema = z.object({
  date: z.string().nullish(),
  time: z.string().nullish(),
  country: z.string().nullish(),
  province: z.string().nullish(),
  county: z.string().nullish(),
  district: z.string().nullish(),
  city: z.string().nullish(),
  suburb: z.string().nullish(),
  precise_location: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  sector: z.string().nullish(),
  actor: z.string().nullish(),
  operation: z.string().nullish(),
  tactic: z.string().nullish(),
  severity: z.string().nullish(),
  details: z.string().nullish(),
  target: z.string().nullish(),
  interest_group: z.string().nullish(),
  actual_main_victim: z.string().nullish(),
  intended_primary_target: z.string().nullish(),
  civilian_death_child: z.number().nullish(),
  civilian_death_female: z.number().nullish(),
  civilian_death_male: z.number().nullish(),
  civilian_death_unknown: z.number().nullish(),
  civilian_injury_female: z.number().nullish(),
  civilian_injury_male: z.number().nullish(),
  civilian_injury_unknown: z.number().nullish(),
  kidnappings_ngo: z.number().nullish(),
});

incidentsRouter.patch("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null; occurred_date: string | null; occurred_time: string | null }>(
    c.env.DB,
    `SELECT owner_id, occurred_date, occurred_time FROM incidents WHERE id = ?`,
    [id]
  );
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && existing.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = updateIncidentSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  const data = parsed.data as Record<string, unknown>;

  for (const field of SIMPLE_INCIDENT_FIELDS) {
    if (data[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(data[field]);
    }
  }

  // date/time map to differently-named columns and jointly recompute
  // occurred_at, so they're handled separately from the simple 1:1 fields above.
  if (parsed.data.date !== undefined || parsed.data.time !== undefined) {
    const newDate = parsed.data.date !== undefined ? parsed.data.date : existing.occurred_date;
    const newTime = parsed.data.time !== undefined ? parsed.data.time : existing.occurred_time;
    if (parsed.data.date !== undefined) {
      updates.push("occurred_date = ?");
      params.push(parsed.data.date);
    }
    if (parsed.data.time !== undefined) {
      updates.push("occurred_time = ?");
      params.push(parsed.data.time);
    }
    updates.push("occurred_at = ?");
    params.push(combineDateTime(newDate, newTime));
  }

  if (updates.length > 0) {
    params.push(id);
    await c.env.DB.prepare(`UPDATE incidents SET ${updates.join(", ")} WHERE id = ?`).bind(...params).run();
  }

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM incidents WHERE id = ?`, [id]);
  return c.json({ ...row, raw_row: JSON.parse(String(row?.raw_row ?? "{}")) });
});

/** Lists past uploads (real files, not manual single-row entries) so the user
 *  can see and delete a whole file in one click, regardless of how many rows
 *  it contained or how many chunk calls it took to insert. */
incidentsRouter.get("/uploads", async (c) => {
  const scopeOwnerId = await effectiveReadScope(c.env.DB, c.get("role"), c.get("userId"));
  const rows = scopeOwnerId
    ? await all(c.env.DB, `SELECT * FROM incident_uploads WHERE owner_id = ? ORDER BY created_at DESC`, [scopeOwnerId])
    : await all(c.env.DB, `SELECT * FROM incident_uploads ORDER BY created_at DESC`);
  return c.json(rows);
});

incidentsRouter.delete("/batch/:batchId", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const batchId = c.req.param("batchId");
  if (isAdmin) {
    await c.env.DB.prepare(`DELETE FROM incidents WHERE upload_batch_id = ?`).bind(batchId).run();
    await c.env.DB.prepare(`DELETE FROM incident_uploads WHERE id = ?`).bind(batchId).run();
  } else {
    await c.env.DB.prepare(`DELETE FROM incidents WHERE upload_batch_id = ? AND owner_id = ?`).bind(batchId, ownerId).run();
    await c.env.DB.prepare(`DELETE FROM incident_uploads WHERE id = ? AND owner_id = ?`).bind(batchId, ownerId).run();
  }
  return c.json({ ok: true });
});

incidentsRouter.delete("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const row = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM incidents WHERE id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && row.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);
  await c.env.DB.prepare(`DELETE FROM incidents WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});
