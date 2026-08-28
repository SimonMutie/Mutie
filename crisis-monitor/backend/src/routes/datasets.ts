import { Hono } from "hono";
import { z } from "zod";
import { all, first, batchRun, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const datasetsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
datasetsRouter.use("*", requireAuth);

const columnSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["text", "number", "date"]),
});
const schemaArraySchema = z.array(columnSchema).min(1).max(100);

/** Column names are only ever interpolated into SQL (via json_extract) after
 *  being checked against the specific dataset's own stored schema below —
 *  never a fixed allowlist, since any dataset can define any columns. This
 *  is the general-purpose version of the same principle behind the
 *  incidents PIVOTABLE_FIELDS allowlist. Exported so the public dashboard
 *  route (which has no auth token to call these routes over HTTP) can reuse
 *  this exact validated logic instead of a second, drift-prone copy of it. */
export function isValidColumn(schema: { name: string; type: string }[], field: string | undefined): field is string {
  return !!field && schema.some((c) => c.name === field);
}

/** Builds a quoted JSON path for json_extract. Column names come from a
 *  detected spreadsheet header, which can realistically contain periods,
 *  spaces, or parentheses (e.g. "Q1.Revenue", "Cases (2024)") — an unquoted
 *  `$.field` path treats a literal period as a nested-key separator, which
 *  silently returns NULL instead of the real value. Quoting the key avoids
 *  that; double-quotes inside the name itself are escaped by doubling, same
 *  as standard SQL string-literal escaping. */
export function jsonPathFor(field: string): string {
  return `$."${field.replace(/"/g, '""')}"`;
}

/** Fetches a dataset row + its parsed schema, or null if it doesn't exist —
 *  callers are responsible for their own ownership check, since the public
 *  route's notion of "authorized" (matches the dashboard's owner) differs
 *  from the authed routes' (matches the logged-in caller). */
export async function loadDatasetSchema(db: D1Database, datasetId: string): Promise<{ owner_id: string | null; schema: { name: string; type: string }[] } | null> {
  const dataset = await first<Record<string, unknown>>(db, `SELECT * FROM datasets WHERE id = ?`, [datasetId]);
  if (!dataset) return null;
  return { owner_id: (dataset.owner_id as string | null) ?? null, schema: JSON.parse(String(dataset.schema_json ?? "[]")) };
}

export async function fetchDatasetBreakdown(
  db: D1Database,
  datasetId: string,
  schema: { name: string; type: string }[],
  field: string | undefined
): Promise<{ value: string; count: number }[]> {
  if (!isValidColumn(schema, field)) return [];
  const path = jsonPathFor(field);
  return all<{ value: string; count: number }>(
    db,
    `SELECT json_extract(row_data, ?) AS value, COUNT(*) AS count
     FROM dataset_rows
     WHERE dataset_id = ? AND json_extract(row_data, ?) IS NOT NULL AND json_extract(row_data, ?) != ''
     GROUP BY value
     ORDER BY count DESC
     LIMIT 30`,
    [path, datasetId, path, path]
  );
}

export async function fetchDatasetCrosstab(
  db: D1Database,
  datasetId: string,
  schema: { name: string; type: string }[],
  primary: string | undefined,
  secondary: string | undefined
): Promise<{ primary_value: string; secondary_value: string; count: number }[]> {
  if (!isValidColumn(schema, primary) || !isValidColumn(schema, secondary)) return [];
  const primaryPath = jsonPathFor(primary);
  const secondaryPath = jsonPathFor(secondary);
  return all<{ primary_value: string; secondary_value: string; count: number }>(
    db,
    `SELECT json_extract(row_data, ?) AS primary_value, json_extract(row_data, ?) AS secondary_value, COUNT(*) AS count
     FROM dataset_rows
     WHERE dataset_id = ?
       AND json_extract(row_data, ?) IS NOT NULL AND json_extract(row_data, ?) != ''
       AND json_extract(row_data, ?) IS NOT NULL AND json_extract(row_data, ?) != ''
     GROUP BY primary_value, secondary_value
     ORDER BY count DESC
     LIMIT 300`,
    [primaryPath, secondaryPath, datasetId, primaryPath, primaryPath, secondaryPath, secondaryPath]
  );
}

export async function fetchDatasetSummary(db: D1Database, datasetId: string, schema: { name: string; type: string }[]): Promise<{ total: number; sums: Record<string, number> }> {
  const total = await first<{ count: number }>(db, `SELECT COUNT(*) AS count FROM dataset_rows WHERE dataset_id = ?`, [datasetId]);
  const numericColumns = schema.filter((s) => s.type === "number");
  const sums: Record<string, number> = {};
  for (const col of numericColumns) {
    const path = jsonPathFor(col.name);
    const result = await first<{ total: number | null }>(
      db,
      `SELECT SUM(CAST(json_extract(row_data, ?) AS REAL)) AS total FROM dataset_rows WHERE dataset_id = ?`,
      [path, datasetId]
    );
    sums[col.name] = result?.total ?? 0;
  }
  return { total: total?.count ?? 0, sums };
}

/** Day-level counts for a genuinely date-typed column — the dataset
 *  equivalent of incidents' own `daily` field, for a calendar heatmap.
 *  Requires `type === "date"` on that column (not just any column), since
 *  grouping text or numbers by their first 10 characters would produce
 *  meaningless buckets. Relies on dataset upload having normalized date
 *  values to ISO (YYYY-MM-DD) — see cellToDatasetValue on the upload side. */
export async function fetchDatasetDaily(db: D1Database, datasetId: string, schema: { name: string; type: string }[], field: string | undefined): Promise<{ date: string; count: number }[]> {
  if (!isValidColumn(schema, field)) return [];
  if (schema.find((c) => c.name === field)?.type !== "date") return [];
  const path = jsonPathFor(field);
  return all<{ date: string; count: number }>(
    db,
    `SELECT substr(json_extract(row_data, ?), 1, 10) AS date, COUNT(*) AS count
     FROM dataset_rows
     WHERE dataset_id = ? AND json_extract(row_data, ?) IS NOT NULL AND json_extract(row_data, ?) != ''
     GROUP BY date
     ORDER BY date ASC`,
    [path, datasetId, path, path]
  );
}

function rowToDataset(row: Record<string, unknown>) {
  return { ...row, schema: JSON.parse(String(row.schema_json ?? "[]")) };
}

datasetsRouter.get("/", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const rows = isAdmin
    ? await all(c.env.DB, `SELECT * FROM datasets ORDER BY updated_at DESC`)
    : await all(c.env.DB, `SELECT * FROM datasets WHERE owner_id = ? ORDER BY updated_at DESC`, [ownerId]);
  return c.json(rows.map(rowToDataset));
});

const createSchema = z.object({
  name: z.string().min(1),
  schema: schemaArraySchema,
});

datasetsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO datasets (id, owner_id, name, schema_json, row_count, created_at, updated_at) VALUES (?,?,?,?,0,?,?)`
  )
    .bind(id, c.get("userId"), parsed.data.name, JSON.stringify(parsed.data.schema), now, now)
    .run();

  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM datasets WHERE id = ?`, [id]);
  return c.json(rowToDataset(row!));
});

datasetsRouter.get("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const row = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM datasets WHERE id = ?`, [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && row.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);
  return c.json(rowToDataset(row));
});

const rowsUploadSchema = z.object({
  rows: z.array(z.record(z.unknown())).min(1).max(2000),
});

/** Bulk-inserts rows as JSON blobs — chunked the same way incident uploads
 *  are, since a large spreadsheet becomes several calls from the client. */
datasetsRouter.post("/:id/rows", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const dataset = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM datasets WHERE id = ?`, [datasetId]);
  if (!dataset) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && dataset.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = rowsUploadSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const now = nowIso();
  const statements = parsed.data.rows.map((row) => ({
    sql: `INSERT INTO dataset_rows (id, dataset_id, owner_id, row_data, created_at) VALUES (?,?,?,?,?)`,
    params: [newId(), datasetId, ownerId, JSON.stringify(row), now],
  }));

  const CHUNK = 200;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await batchRun(c.env.DB, statements.slice(i, i + CHUNK));
  }

  await c.env.DB.prepare(`UPDATE datasets SET row_count = row_count + ?, updated_at = ? WHERE id = ?`)
    .bind(statements.length, now, datasetId)
    .run();

  return c.json({ inserted: statements.length });
});

const MAX_ROWS_PAGE = 200;

/** Paginated listing of a dataset's actual rows — for viewing and editing
 *  them directly, not just charting aggregates over them. Ordered by
 *  creation so pages stay stable as you page through, rather than SQLite's
 *  otherwise-undefined row order potentially shifting between requests. */
datasetsRouter.get("/:id/rows", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const dataset = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM datasets WHERE id = ?`, [datasetId]);
  if (!dataset) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && dataset.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
  const limit = Math.min(MAX_ROWS_PAGE, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));

  const [rows, total] = await Promise.all([
    all<{ id: string; row_data: string; created_at: string }>(
      c.env.DB,
      `SELECT id, row_data, created_at FROM dataset_rows WHERE dataset_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`,
      [datasetId, limit, offset]
    ),
    first<{ count: number }>(c.env.DB, `SELECT COUNT(*) AS count FROM dataset_rows WHERE dataset_id = ?`, [datasetId]),
  ]);

  return c.json({
    rows: rows.map((r) => ({ id: r.id, data: JSON.parse(r.row_data), created_at: r.created_at })),
    total: total?.count ?? 0,
    offset,
    limit,
  });
});

/** A single new row, typed in by hand rather than uploaded in bulk — the
 *  same insert path as /rows, just one row and returning it so the
 *  caller can show it immediately without a full page refetch. */
datasetsRouter.post("/:id/rows/manual", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const dataset = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM datasets WHERE id = ?`, [datasetId]);
  if (!dataset) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && dataset.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.unknown()) }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = newId();
  const now = nowIso();
  await c.env.DB.prepare(`INSERT INTO dataset_rows (id, dataset_id, owner_id, row_data, created_at) VALUES (?,?,?,?,?)`)
    .bind(id, datasetId, ownerId, JSON.stringify(parsed.data.data), now)
    .run();
  await c.env.DB.prepare(`UPDATE datasets SET row_count = row_count + 1, updated_at = ? WHERE id = ?`).bind(now, datasetId).run();

  return c.json({ id, data: parsed.data.data, created_at: now });
});

datasetsRouter.patch("/:id/rows/:rowId", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const rowId = c.req.param("rowId");
  const dataset = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM datasets WHERE id = ?`, [datasetId]);
  if (!dataset) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && dataset.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const existing = await first<{ dataset_id: string }>(c.env.DB, `SELECT dataset_id FROM dataset_rows WHERE id = ?`, [rowId]);
  if (!existing || existing.dataset_id !== datasetId) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ data: z.record(z.unknown()) }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  await c.env.DB.prepare(`UPDATE dataset_rows SET row_data = ? WHERE id = ?`).bind(JSON.stringify(parsed.data.data), rowId).run();
  await c.env.DB.prepare(`UPDATE datasets SET updated_at = ? WHERE id = ?`).bind(nowIso(), datasetId).run();
  return c.json({ id: rowId, data: parsed.data.data });
});

datasetsRouter.delete("/:id/rows/:rowId", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const rowId = c.req.param("rowId");
  const dataset = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM datasets WHERE id = ?`, [datasetId]);
  if (!dataset) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && dataset.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const existing = await first<{ dataset_id: string }>(c.env.DB, `SELECT dataset_id FROM dataset_rows WHERE id = ?`, [rowId]);
  if (!existing || existing.dataset_id !== datasetId) return c.json({ error: "Not found" }, 404);

  await c.env.DB.prepare(`DELETE FROM dataset_rows WHERE id = ?`).bind(rowId).run();
  await c.env.DB.prepare(`UPDATE datasets SET row_count = MAX(0, row_count - 1), updated_at = ? WHERE id = ?`).bind(nowIso(), datasetId).run();
  return c.json({ ok: true });
});

datasetsRouter.delete("/:id", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const id = c.req.param("id");
  const existing = await first<{ owner_id: string | null }>(c.env.DB, `SELECT owner_id FROM datasets WHERE id = ?`, [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && existing.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);
  // Explicit, not relying solely on ON DELETE CASCADE — same defensive
  // approach already used for incident_uploads/incidents elsewhere.
  await c.env.DB.prepare(`DELETE FROM dataset_rows WHERE dataset_id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM datasets WHERE id = ?`).bind(id).run();
  return c.json({ ok: true });
});

/** Single-field breakdown for any column the dataset's own schema declares —
 *  the general-purpose version of /api/incidents/breakdown. json_extract's
 *  path is built from `field` only after isValidColumn confirms it's one of
 *  this specific dataset's real columns. */
datasetsRouter.get("/:id/breakdown", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const loaded = await loadDatasetSchema(c.env.DB, datasetId);
  if (!loaded) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && loaded.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const field = c.req.query("field");
  if (!isValidColumn(loaded.schema, field)) {
    return c.json({ error: "field must be one of this dataset's own columns: " + loaded.schema.map((s) => s.name).join(", ") }, 400);
  }
  return c.json(await fetchDatasetBreakdown(c.env.DB, datasetId, loaded.schema, field));
});

/** Two-field cross-tab, general-purpose version of /api/incidents/crosstab. */
datasetsRouter.get("/:id/crosstab", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const loaded = await loadDatasetSchema(c.env.DB, datasetId);
  if (!loaded) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && loaded.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const primary = c.req.query("primary");
  const secondary = c.req.query("secondary");
  if (!isValidColumn(loaded.schema, primary) || !isValidColumn(loaded.schema, secondary)) {
    return c.json({ error: "primary and secondary must each be one of this dataset's own columns: " + loaded.schema.map((s) => s.name).join(", ") }, 400);
  }
  return c.json(await fetchDatasetCrosstab(c.env.DB, datasetId, loaded.schema, primary, secondary));
});

/** Sum of a numeric column, plus total row count — the dataset equivalent of
 *  the incidents casualty totals, generalized to whichever numeric columns
 *  this particular dataset actually has. */
datasetsRouter.get("/:id/summary", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const loaded = await loadDatasetSchema(c.env.DB, datasetId);
  if (!loaded) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && loaded.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  return c.json(await fetchDatasetSummary(c.env.DB, datasetId, loaded.schema));
});

datasetsRouter.get("/:id/daily", async (c) => {
  const isAdmin = c.get("role") === "admin";
  const ownerId = c.get("userId");
  const datasetId = c.req.param("id");
  const loaded = await loadDatasetSchema(c.env.DB, datasetId);
  if (!loaded) return c.json({ error: "Not found" }, 404);
  if (!isAdmin && loaded.owner_id !== ownerId) return c.json({ error: "Not found" }, 404);

  const field = c.req.query("field");
  if (!isValidColumn(loaded.schema, field)) {
    return c.json({ error: "field must be one of this dataset's own columns: " + loaded.schema.map((s) => s.name).join(", ") }, 400);
  }
  if (loaded.schema.find((s) => s.name === field)?.type !== "date") {
    return c.json({ error: "field must be a date-typed column" }, 400);
  }
  return c.json(await fetchDatasetDaily(c.env.DB, datasetId, loaded.schema, field));
});
