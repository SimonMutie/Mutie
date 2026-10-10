import { Hono } from "hono";
import { z } from "zod";
import { first } from "../db";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { fieldsOf, runQuery, QueryError, type FilterSpec, type QueryResult, type QuerySpec, type Source } from "../lib/analytics";
import { canReadDataset, loadDatasetSchema } from "./datasets";
import { effectiveScope, effectiveReadScope, effectiveCountryScope } from "./incidents";
import { vizQuerySchema } from "./customDashboards";

/**
 * The any-data engine over HTTP (lib/analytics.ts): the fields of a data
 * source, and group-and-measure queries against it. A source is
 * "incidents" or "dataset:<id>".
 *
 * The signed-in routes run whatever query the editor composes, against data
 * the caller may read. The shared-dashboard route runs only the query saved
 * with one of that dashboard's own visuals, optionally narrowed by filters
 * on fields the dashboard already shows.
 */
export const analyticsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
analyticsRouter.use("*", requireAuth);

export const publicAnalyticsRouter = new Hono<{ Bindings: Env }>();

type Ctx = { env: Env; get: (k: "userId" | "role") => string };

// ── Remembering answers for a moment ─────────────────────────────────────
//
// Every query reads every row of its source, and the database's free
// allowance is counted in rows read. The same question is asked again and
// again in ordinary use — a dashboard reloaded, a click that filters and the
// click that clears it, several people opening one shared link — so an
// answer is kept in this isolate's memory for a short while and reused.
// Nothing is stored anywhere else, and a dataset's answers are dropped the
// moment its rows change (its version is part of the key).
const ANSWERS = new Map<string, { at: number; value: QueryResult }>();
const MAX_ANSWERS = 300;
export const resetAnalyticsCache = () => ANSWERS.clear();

async function remembered(key: string, ttlMs: number, compute: () => Promise<QueryResult>): Promise<QueryResult> {
  const now = Date.now();
  const hit = ANSWERS.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;
  const value = await compute();
  if (ANSWERS.size >= MAX_ANSWERS) ANSWERS.delete(ANSWERS.keys().next().value as string);
  ANSWERS.set(key, { at: now, value });
  return value;
}
/** What a source's answers depend on, besides the query itself. */
const sourceKey = (source: Source, version: string) =>
  source.kind === "dataset" ? `d:${source.datasetId}:${version}` : `i:${JSON.stringify([source.ownerIds, source.countries, source.dateFrom ?? null, source.dateTo ?? null])}`;
/** How long an answer is reused: the editor wants fresh figures; a shared link is looked at, not edited. */
const EDITOR_TTL_MS = 30_000;
const SHARED_TTL_MS = 5 * 60_000;

/** The source a signed-in caller named, if they may read it. */
async function sourceFor(c: Ctx, name: string, range?: { from?: string | null; to?: string | null }): Promise<(Source & { version?: string }) | null> {
  if (name === "incidents") {
    const scope = await effectiveScope(c.env.DB, c.get("role"), c.get("userId"));
    return { kind: "incidents", ownerIds: scope.ownerIds, countries: scope.countries, dateFrom: range?.from, dateTo: range?.to };
  }
  const id = name.startsWith("dataset:") ? name.slice(8) : "";
  if (!id) return null;
  const dataset = await loadDatasetSchema(c.env.DB, id);
  if (!dataset || !(await canReadDataset(c.env.DB, c.get("role"), c.get("userId"), dataset, id))) return null;
  return { kind: "dataset", datasetId: id, schema: dataset.schema, version: dataset.version };
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}/).max(40);
const requestSchema = z.object({
  source: z.string().min(1).max(120),
  query: vizQuerySchema,
  /** A dashboard-wide date range; it applies to Incidents (datasets have no single date field). */
  dateFrom: isoDay.nullable().optional(),
  dateTo: isoDay.nullable().optional(),
});

analyticsRouter.get("/fields", async (c) => {
  const source = await sourceFor(c, c.req.query("source") ?? "");
  if (!source) return c.json({ error: "Data source not found" }, 404);
  return c.json({ source: c.req.query("source"), fields: fieldsOf(source) });
});

analyticsRouter.post("/query", async (c) => {
  const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "That request is not valid.", detail: parsed.error.issues[0]?.message }, 400);
  const source = await sourceFor(c, parsed.data.source, { from: parsed.data.dateFrom, to: parsed.data.dateTo });
  if (!source) return c.json({ error: "Data source not found" }, 404);
  try {
    const query = parsed.data.query as QuerySpec;
    return c.json(await remembered(`${sourceKey(source, source.version ?? "")}|${JSON.stringify(query)}`, EDITOR_TTL_MS, () => runQuery(c.env.DB, source, query)));
  } catch (err) {
    if (err instanceof QueryError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

// ── Shared dashboards ────────────────────────────────────────────────────

interface StoredViz {
  source?: string;
  rows?: { field: string }[];
  columns?: { field: string }[];
  filters?: { field: string }[];
  query?: QuerySpec;
}

const publicRequestSchema = z.object({
  widgetId: z.string().min(1).max(100),
  /** Narrowing chosen by the viewer (a slicer, or a click on another visual). */
  filters: z
    .array(z.object({ field: z.string().min(1).max(200), op: z.enum(["in", "not_in", "gte", "lte", "contains"]), values: z.array(z.union([z.string().max(200), z.number(), z.null()])).max(60) }))
    .max(8)
    .optional(),
});

/**
 * POST /api/public/dashboards-viz/:token  { widgetId, filters? }
 *
 * Anyone with a shared dashboard's link can run the query saved with one of
 * its visuals. They cannot compose their own: the query comes from the
 * stored dashboard, the data must belong to the dashboard's owner, and any
 * extra filter must be on a field some visual of that dashboard already
 * groups or filters by — so the link shows no more of the data than the
 * dashboard itself does.
 */
publicAnalyticsRouter.post("/:token", async (c) => {
  const dashboard = await first<{ owner_id: string | null; widgets: string; date_range_from: string | null; date_range_to: string | null; country: string | null }>(
    c.env.DB,
    `SELECT owner_id, widgets, date_range_from, date_range_to, country FROM custom_dashboards WHERE share_token = ? AND is_public = 1 AND (share_expires_at IS NULL OR share_expires_at > ?)`,
    [c.req.param("token"), new Date().toISOString()]
  );
  if (!dashboard) return c.json({ error: "Not found" }, 404);
  const parsed = publicRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "That request is not valid." }, 400);

  let widgets: { id?: string; type?: string; viz?: StoredViz }[] = [];
  try {
    widgets = JSON.parse(dashboard.widgets ?? "[]");
  } catch {
    widgets = [];
  }
  const widget = widgets.find((w) => w.id === parsed.data.widgetId && w.type === "viz");
  const viz = widget?.viz;
  if (!viz?.query || !viz.source) return c.json({ error: "Not found" }, 404);
  const storedQuery = vizQuerySchema.safeParse(viz.query);
  if (!storedQuery.success) return c.json({ error: "Not found" }, 404);

  let source: Source;
  let version = "";
  if (viz.source === "incidents") {
    // The same scope the rest of the shared view uses: the owner's own incidents, in the dashboard's date range.
    if (!dashboard.owner_id) return c.json({ error: "Not found" }, 404);
    const ownerRow = await first<{ role: string }>(c.env.DB, `SELECT role FROM users WHERE id = ?`, [dashboard.owner_id]);
    const ownerIds = ownerRow ? await effectiveReadScope(c.env.DB, ownerRow.role, dashboard.owner_id) : [dashboard.owner_id];
    const allowed = ownerRow ? await effectiveCountryScope(c.env.DB, ownerRow.role, dashboard.owner_id) : null;
    const countries = dashboard.country ? (allowed && !allowed.some((a) => a.toLowerCase() === dashboard.country!.toLowerCase()) ? ["\u0000none"] : [dashboard.country]) : allowed;
    source = { kind: "incidents", ownerIds, countries, dateFrom: dashboard.date_range_from, dateTo: dashboard.date_range_to };
  } else {
    const id = viz.source.startsWith("dataset:") ? viz.source.slice(8) : "";
    const dataset = id ? await loadDatasetSchema(c.env.DB, id) : null;
    // A tampered widget naming someone else's dataset must not leak it here.
    if (!dataset || dataset.owner_id !== dashboard.owner_id) return c.json({ error: "Not found" }, 404);
    source = { kind: "dataset", datasetId: id, schema: dataset.schema };
    version = dataset.version;
  }

  // Fields this dashboard already exposes for this source.
  const exposed = new Set<string>();
  for (const w of widgets) {
    if (w.type !== "viz" || w.viz?.source !== viz.source) continue;
    for (const list of [w.viz.rows, w.viz.columns, w.viz.filters]) for (const f of list ?? []) if (f?.field) exposed.add(f.field);
  }
  const extra = (parsed.data.filters ?? []).filter((f) => exposed.has(f.field)) as FilterSpec[];
  const query: QuerySpec = { ...(storedQuery.data as QuerySpec), filters: [...((storedQuery.data.filters as FilterSpec[] | undefined) ?? []), ...extra].slice(0, 12) };

  try {
    return c.json(await remembered(`${sourceKey(source, version)}|${JSON.stringify(query)}`, SHARED_TTL_MS, () => runQuery(c.env.DB, source, query)));
  } catch (err) {
    if (err instanceof QueryError) return c.json({ error: err.message }, 400);
    throw err;
  }
});
