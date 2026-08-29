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
