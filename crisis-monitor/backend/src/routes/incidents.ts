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
  const batchId = newId();
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

  // D1 batches are capped well above 2000 statements, but chunk generously
  // anyway so one oversized upload can't blow past any per-batch limit.
  const CHUNK = 200;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await batchRun(c.env.DB, statements.slice(i, i + CHUNK));
  }

  return c.json({ inserted: statements.length, batch_id: batchId, batch_label: parsed.data.batch_label ?? null });
});

const MAX_LIST_LIMIT = 5000;

incidentsRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");

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
  if (!isAdmin) {
    conditions.push("owner_id = ?");
    params.push(ownerId);
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
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const ownerClause = isAdmin ? "" : "WHERE owner_id = ?";
  const ownerParams = isAdmin ? [] : [ownerId];

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

incidentsRouter.get("/stats", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const ownerClause = isAdmin ? "" : "WHERE owner_id = ?";
  const ownerParams = isAdmin ? [] : [ownerId];
  const andOwner = isAdmin ? "" : "AND owner_id = ?";

  const [total, bySector, byActor, byTactic, bySeverity, byProvince, byCountry, timeSeries, casualties] = await Promise.all([
    first<{ count: number }>(c.env.DB, `SELECT COUNT(*) AS count FROM incidents ${ownerClause}`, ownerParams),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT sector AS value, COUNT(*) AS count FROM incidents WHERE sector IS NOT NULL AND sector != '' ${andOwner} GROUP BY sector ORDER BY count DESC LIMIT 12`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT actor AS value, COUNT(*) AS count FROM incidents WHERE actor IS NOT NULL AND actor != '' ${andOwner} GROUP BY actor ORDER BY count DESC LIMIT 12`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT tactic AS value, COUNT(*) AS count FROM incidents WHERE tactic IS NOT NULL AND tactic != '' ${andOwner} GROUP BY tactic ORDER BY count DESC LIMIT 12`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT severity AS value, COUNT(*) AS count FROM incidents WHERE severity IS NOT NULL AND severity != '' ${andOwner} GROUP BY severity ORDER BY count DESC LIMIT 12`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT province AS value, COUNT(*) AS count FROM incidents WHERE province IS NOT NULL AND province != '' ${andOwner} GROUP BY province ORDER BY count DESC LIMIT 20`,
      ownerParams
    ),
    all<{ value: string; count: number }>(
      c.env.DB,
      `SELECT country AS value, COUNT(*) AS count FROM incidents WHERE country IS NOT NULL AND country != '' ${andOwner} GROUP BY country ORDER BY count DESC LIMIT 20`,
      ownerParams
    ),
    all<{ bucket: string; count: number }>(
      c.env.DB,
      `SELECT substr(occurred_at, 1, 7) AS bucket, COUNT(*) AS count FROM incidents WHERE occurred_at IS NOT NULL ${andOwner} GROUP BY bucket ORDER BY bucket ASC`,
      ownerParams
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
       FROM incidents ${ownerClause}`,
      ownerParams
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
    casualties: casualties ?? {},
  });
});

incidentsRouter.delete("/batch/:batchId", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const batchId = c.req.param("batchId");
  if (isAdmin) {
    await c.env.DB.prepare(`DELETE FROM incidents WHERE upload_batch_id = ?`).bind(batchId).run();
  } else {
    await c.env.DB.prepare(`DELETE FROM incidents WHERE upload_batch_id = ? AND owner_id = ?`).bind(batchId, ownerId).run();
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
