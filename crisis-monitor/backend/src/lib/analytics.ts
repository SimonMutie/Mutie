import { all } from "../db";
import { buildScopeClause } from "../routes/incidents";
import { jsonPathFor } from "../routes/datasets";

/**
 * One way to ask questions of any table of data.
 *
 * This is the idea behind tools like Tableau and Power BI: every column is
 * either a DIMENSION (something to group by — a country, an actor, a month)
 * or a MEASURE (something to work out for each group — a count, a sum, an
 * average). Every chart and every pivot table is then the same request:
 * "group the rows by these dimensions and work out these measures".
 *
 * The request is a QuerySpec; the answer is one row per group. It works on
 * any uploaded dataset, whatever its columns, and on Incidents — a visual
 * built on it is not tied to a fixed set of fields.
 *
 * Nothing a caller sends is ever placed into the SQL text. A dataset's
 * column names travel as bound parameters (the JSON path to read); an
 * Incidents field is looked up in the fixed table below; everything else —
 * the grain of a date, the aggregation, the comparison in a filter — is
 * chosen from a fixed list.
 */

export type Agg = "count" | "distinct" | "sum" | "avg" | "min" | "max";
export type Grain = "year" | "quarter" | "month" | "week" | "day";
export type FieldType = "text" | "number" | "date";

export interface DimensionSpec {
  field: string;
  /** For a date field: group by year, quarter, month, week or day. */
  grain?: Grain;
  /** For a number field: group into bins this wide (a histogram). */
  bin?: number;
}

export interface MeasureSpec {
  /** Not needed for a plain row count. */
  field?: string;
  agg: Agg;
}

export interface FilterSpec {
  field: string;
  /** in / not_in take a list; gte / lte one value; contains a piece of text. */
  op: "in" | "not_in" | "gte" | "lte" | "contains";
  values: (string | number)[];
}

export interface QuerySpec {
  dimensions: DimensionSpec[];
  measures: MeasureSpec[];
  filters?: FilterSpec[];
  /** Groups whose dimension is empty are left out unless this is "include" (they then come back as null). */
  blanks?: "exclude" | "include";
  /** Extra totals: each entry lists the dimensions (by position) to keep; [] is the grand total. A pivot table's subtotals and totals. */
  rollups?: number[][];
  limit?: number;
}

export interface QueryRow {
  /** One value per dimension, in order. */
  d: (string | number | null)[];
  /** One value per measure, in order. */
  m: (number | null)[];
}

export interface QueryResult {
  rows: QueryRow[];
  /** True when there were more groups than the limit. */
  truncated: boolean;
  rollups?: { dims: number[]; rows: QueryRow[] }[];
}

export interface FieldInfo {
  name: string;
  label: string;
  type: FieldType;
}

/** Where the rows come from. */
export type Source =
  | { kind: "dataset"; datasetId: string; schema: { name: string; type: string }[] }
  | { kind: "incidents"; ownerIds: string[] | null; countries: string[] | null; dateFrom?: string | null; dateTo?: string | null };

export const MAX_DIMENSIONS = 4;
export const MAX_MEASURES = 6;
export const MAX_FILTERS = 12;
export const MAX_FILTER_VALUES = 60;
export const MAX_ROWS = 5000;
const DEFAULT_ROWS = 2000;
/** D1 accepts at most 100 bound values in one statement. */
const MAX_BOUND = 96;

// ── Incidents as a source ────────────────────────────────────────────────

const INCIDENT_TEXT = ["sector", "actor", "tactic", "severity", "country", "province", "county", "district", "city", "suburb", "operation", "target", "interest_group", "actual_main_victim", "intended_primary_target"] as const;
const INCIDENT_LABELS: Record<string, string> = {
  sector: "Sector",
  actor: "Actor",
  tactic: "Tactic",
  severity: "Severity",
  country: "Country",
  province: "Province",
  county: "County",
  district: "District",
  city: "City",
  suburb: "Suburb",
  operation: "Operation",
  target: "Target",
  interest_group: "Interest group",
  actual_main_victim: "Actual main victim",
  intended_primary_target: "Intended primary target",
};
const n = (col: string) => `COALESCE(${col}, 0)`;
/** Every Incidents field a query may name, with the fixed SQL that reads it. */
const INCIDENT_FIELDS: Record<string, { label: string; type: FieldType; sql: string }> = {
  ...Object.fromEntries(INCIDENT_TEXT.map((f) => [f, { label: INCIDENT_LABELS[f], type: "text" as FieldType, sql: f }])),
  date: { label: "Date", type: "date", sql: "occurred_at" },
  deaths: { label: "Civilian deaths", type: "number", sql: `(${n("civilian_death_child")} + ${n("civilian_death_female")} + ${n("civilian_death_male")} + ${n("civilian_death_unknown")})` },
  injuries: { label: "Civilian injuries", type: "number", sql: `(${n("civilian_injury_female")} + ${n("civilian_injury_male")} + ${n("civilian_injury_unknown")})` },
  deaths_children: { label: "Deaths: children", type: "number", sql: n("civilian_death_child") },
  deaths_women: { label: "Deaths: women", type: "number", sql: n("civilian_death_female") },
  deaths_men: { label: "Deaths: men", type: "number", sql: n("civilian_death_male") },
  kidnappings_ngo: { label: "NGO kidnappings", type: "number", sql: n("kidnappings_ngo") },
  latitude: { label: "Latitude", type: "number", sql: "latitude" },
  longitude: { label: "Longitude", type: "number", sql: "longitude" },
};

/** The fields of a source, for the builder's field list. */
export function fieldsOf(source: Source): FieldInfo[] {
  if (source.kind === "incidents") return Object.entries(INCIDENT_FIELDS).map(([name, f]) => ({ name, label: f.label, type: f.type }));
  return source.schema.map((c) => ({ name: c.name, label: c.name, type: (c.type === "number" || c.type === "date" ? c.type : "text") as FieldType }));
}

export class QueryError extends Error {}

// ── Building the statement ───────────────────────────────────────────────

/**
 * Runs a query. Throws QueryError (a message fit to show) when the request
 * names a field the source does not have or is larger than allowed.
 */
export async function runQuery(db: D1Database, source: Source, spec: QuerySpec, opts: { deriveRollups?: boolean } = {}): Promise<QueryResult> {
  const fields = new Map(fieldsOf(source).map((f) => [f.name, f]));
  const dims = spec.dimensions ?? [];
  const measures = spec.measures ?? [];
  const filters = spec.filters ?? [];
  if (dims.length > MAX_DIMENSIONS) throw new QueryError(`At most ${MAX_DIMENSIONS} fields can be grouped by at once.`);
  if (measures.length === 0) throw new QueryError("Choose at least one value to calculate.");
  if (measures.length > MAX_MEASURES) throw new QueryError(`At most ${MAX_MEASURES} values can be calculated at once.`);
  if (filters.length > MAX_FILTERS) throw new QueryError(`At most ${MAX_FILTERS} filters can be applied at once.`);
  const need = (name: string | undefined): FieldInfo => {
    const f = name ? fields.get(name) : undefined;
    if (!f) throw new QueryError(`This data has no field called “${name ?? ""}”. It may have been renamed or removed.`);
    return f;
  };

  // Each distinct field is read once, in an inner SELECT, under a short
  // alias (f0, f1, …). Everything else refers to the alias — so a dataset
  // column's name is bound exactly once, however many times it is used.
  const alias = new Map<string, string>();
  const innerSelect: string[] = [];
  const innerParams: unknown[] = [];
  const col = (name: string): string => {
    const known = alias.get(name);
    if (known) return known;
    const a = `f${alias.size}`;
    alias.set(name, a);
    if (source.kind === "dataset") {
      innerSelect.push(`json_extract(row_data, ?) AS ${a}`);
      innerParams.push(jsonPathFor(name));
    } else {
      innerSelect.push(`${INCIDENT_FIELDS[name].sql} AS ${a}`);
    }
    return a;
  };

  // Dimensions
  const dimSql = dims.map((d) => {
    const f = need(d.field);
    const a = col(d.field);
    if (d.grain) {
      if (f.type !== "date") throw new QueryError(`“${f.label}” is not a date, so it cannot be grouped by ${d.grain}.`);
      return grainSql(a, d.grain);
    }
    if (d.bin !== undefined) {
      if (f.type !== "number") throw new QueryError(`“${f.label}” is not a number, so it cannot be put into bins.`);
      if (!(Number.isFinite(d.bin) && d.bin > 0)) throw new QueryError("A bin must be wider than zero.");
      // The start of the bin the value falls in. (The width is a validated
      // number. SQLite's CAST truncates towards zero, hence the correction
      // for negative values, which must round down, not up.)
      const x = `CAST(${a} AS REAL)`;
      const w = Number(d.bin);
      const q = `(${x} / ${w})`;
      return `((CAST(${q} AS INTEGER) - (CASE WHEN ${x} < 0 AND CAST(${q} AS INTEGER) != ${q} THEN 1 ELSE 0 END)) * ${w})`;
    }
    return f.type === "date" ? `substr(${a}, 1, 10)` : a;
  });

  // Measures
  const measureSql = measures.map((m) => {
    if (m.agg === "count" && !m.field) return "COUNT(*)";
    const f = need(m.field);
    const a = col(f.name);
    const present = `${a} IS NOT NULL AND ${a} != ''`;
    if (m.agg === "count") return `SUM(CASE WHEN ${present} THEN 1 ELSE 0 END)`;
    if (m.agg === "distinct") return `COUNT(DISTINCT CASE WHEN ${present} THEN ${a} END)`;
    if (f.type !== "number") throw new QueryError(`“${f.label}” is not a number, so it can be counted but not ${m.agg === "avg" ? "averaged" : m.agg === "sum" ? "added up" : "compared"}.`);
    const fn = { sum: "SUM", avg: "AVG", min: "MIN", max: "MAX" }[m.agg];
    if (!fn) throw new QueryError("Unknown calculation.");
    return `${fn}(CASE WHEN ${present} THEN CAST(${a} AS REAL) END)`;
  });

  // Filters
  const where: string[] = [];
  const whereParams: unknown[] = [];
  for (const flt of filters) {
    const f = need(flt.field);
    const a = col(f.name);
    const values = (flt.values ?? []).slice(0, MAX_FILTER_VALUES);
    const expr = f.type === "number" ? `CAST(${a} AS REAL)` : f.type === "date" ? `substr(${a}, 1, 10)` : a;
    if (flt.op === "in" || flt.op === "not_in") {
      if (values.length === 0) {
        if (flt.op === "in") where.push("0");
        continue;
      }
      // An empty value in the list stands for the rows where the field is empty.
      const wantsBlank = values.some((v) => v === null || v === "");
      const real = values.filter((v) => v !== null && v !== "");
      const isBlank = `(${a} IS NULL OR ${a} = '')`;
      const list = real.length ? `${expr} IN (${real.map(() => "?").join(",")})` : null;
      whereParams.push(...real.map((v) => (f.type === "number" ? Number(v) : String(v))));
      if (flt.op === "in") where.push(`(${[list, wantsBlank ? isBlank : null].filter(Boolean).join(" OR ")})`);
      else {
        // Everything except the listed values; empty rows stay unless "empty" was listed too.
        const parts = [wantsBlank ? `NOT ${isBlank}` : null, list ? `(${isBlank} OR NOT (${list}))` : null].filter(Boolean);
        where.push(`(${parts.join(" AND ")})`);
      }
    } else if (flt.op === "gte" || flt.op === "lte") {
      if (values.length === 0) continue;
      where.push(`${expr} ${flt.op === "gte" ? ">=" : "<="} ?`);
      whereParams.push(f.type === "number" ? Number(values[0]) : String(values[0]));
    } else if (flt.op === "contains") {
      const text = String(values[0] ?? "").slice(0, 40);
      if (!text) continue;
      where.push(`${a} LIKE ? ESCAPE '\\'`);
      whereParams.push(`%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    } else {
      throw new QueryError("Unknown kind of filter.");
    }
  }

  // The rows the caller may read
  let from: string;
  let scopeParams: unknown[];
  if (source.kind === "dataset") {
    from = "FROM dataset_rows WHERE dataset_id = ?";
    scopeParams = [source.datasetId];
  } else {
    const scope = buildScopeClause(source.ownerIds, source.dateFrom ?? undefined, source.dateTo ?? undefined, source.countries);
    from = `FROM incidents ${scope.whereClause}`;
    scopeParams = scope.params;
  }
  const limit = Math.min(Math.max(Math.floor(spec.limit ?? DEFAULT_ROWS), 1), MAX_ROWS);
  const includeBlanks = spec.blanks === "include";

  // Totals without reading the table again.
  //
  // Each roll-up could be its own query, but every query reads every row of
  // the source, and a pivot table asks for up to five. When the main answer
  // holds every row (blanks kept, nothing cut off) and no measure is a
  // distinct count, the totals follow from the main answer's own groups: a
  // sum of sums, a count of counts, the smallest of the smallest — and an
  // average from the sum and count behind it, which the main query is asked
  // to return alongside (never an average of averages). Only a distinct
  // count has to go back to the rows, because the same value can sit in
  // several groups.
  const wantsRollups = (spec.rollups?.length ?? 0) > 0;
  const derivable = opts.deriveRollups !== false && wantsRollups && includeBlanks && measures.every((m) => m.agg !== "distinct");
  const extraSql: string[] = [];
  const avgParts = new Map<number, number>();
  if (derivable) {
    measures.forEach((m, i) => {
      if (m.agg !== "avg") return;
      const a = col(need(m.field).name);
      const present = `${a} IS NOT NULL AND ${a} != ''`;
      avgParts.set(i, extraSql.length);
      extraSql.push(`SUM(CASE WHEN ${present} THEN CAST(${a} AS REAL) END)`, `SUM(CASE WHEN ${present} THEN 1 ELSE 0 END)`);
    });
  }

  if (innerSelect.length === 0) innerSelect.push("1 AS f_none");
  const inner = `SELECT ${innerSelect.join(", ")} ${from}`;
  const baseParams = [...innerParams, ...scopeParams];

  type Row = QueryRow & { x?: (number | null)[] };
  const run = async (keep: number[], rowLimit: number, withExtras = false): Promise<{ rows: Row[]; truncated: boolean }> => {
    const kept = keep.map((i) => dimSql[i]);
    const conditions = [...where];
    if (!includeBlanks) for (const k of kept) conditions.push(`${k} IS NOT NULL AND ${k} != ''`);
    const selectDims = kept.map((k, i) => `${includeBlanks ? `NULLIF(${k}, '')` : k} AS d${i}`);
    const selectMeasures = [...measureSql.map((m, i) => `${m} AS m${i}`), ...(withExtras ? extraSql.map((x, i) => `${x} AS x${i}`) : [])];
    const group = kept.length ? `GROUP BY ${kept.map((_, i) => `d${i}`).join(", ")}` : "";
    // Dates read in order; everything else, biggest first.
    const dated = keep.length > 0 && keep.every((i) => !!dims[i].grain || !!dims[i].bin || fields.get(dims[i].field)?.type === "date");
    const order = kept.length ? `ORDER BY ${dated ? kept.map((_, i) => `d${i}`).join(", ") : `m0 DESC, ${kept.map((_, i) => `d${i}`).join(", ")}`}` : "";
    const params = [...baseParams, ...whereParams, rowLimit + 1];
    if (params.length > MAX_BOUND) throw new QueryError("That is too many filter values for one visual. Use fewer, or split it into two visuals.");
    const sql = `SELECT ${[...selectDims, ...selectMeasures].join(", ")} FROM (${inner}) ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ${group} ${order} LIMIT ?`;
    const raw = await all<Record<string, string | number | null>>(db, sql, params);
    const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
    const rows = raw.slice(0, rowLimit).map((r): Row => {
      const row: Row = { d: kept.map((_, i) => r[`d${i}`] ?? null), m: measures.map((_, i) => num(r[`m${i}`])) };
      if (withExtras && extraSql.length) row.x = extraSql.map((_, i) => num(r[`x${i}`]));
      return row;
    });
    return { rows, truncated: raw.length > rowLimit };
  };

  /** A roll-up worked out from the main answer's groups (see above). */
  const derive = (rows: Row[], keep: number[]): QueryRow[] => {
    const groups = new Map<string, { d: (string | number | null)[]; m: (number | null)[]; x: (number | null)[] }>();
    const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
    for (const r of rows) {
      const d = keep.map((i) => r.d[i]);
      const key = JSON.stringify(d);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { d, m: measures.map(() => null), x: extraSql.map(() => null) }));
      measures.forEach((m, i) => {
        const v = r.m[i];
        if (m.agg === "min") g!.m[i] = v === null ? g!.m[i] : g!.m[i] === null ? v : Math.min(g!.m[i]!, v);
        else if (m.agg === "max") g!.m[i] = v === null ? g!.m[i] : g!.m[i] === null ? v : Math.max(g!.m[i]!, v);
        else if (m.agg !== "avg") g!.m[i] = add(g!.m[i], v);
      });
      (r.x ?? []).forEach((v, i) => (g!.x[i] = add(g!.x[i], v)));
    }
    // With no rows at all, a grand total is still one row: a count of zero, and nothing for the rest.
    if (groups.size === 0 && keep.length === 0) groups.set("[]", { d: [], m: measures.map((m) => (m.agg === "count" ? 0 : null)), x: extraSql.map(() => null) });
    const out = [...groups.values()].map((g) => {
      for (const [i, at] of avgParts) g.m[i] = g.x[at] !== null && g.x[at + 1] ? g.x[at]! / g.x[at + 1]! : null;
      return { d: g.d, m: g.m };
    });
    // The same order a query would give: dates and numbers in order, everything else biggest first.
    const dated = keep.length > 0 && keep.every((i) => !!dims[i].grain || !!dims[i].bin || fields.get(dims[i].field)?.type === "date");
    const byDims = (a: QueryRow, b: QueryRow) => {
      for (let i = 0; i < a.d.length; i++) {
        if (a.d[i] === b.d[i]) continue;
        if (a.d[i] === null) return -1;
        if (b.d[i] === null) return 1;
        return a.d[i]! < b.d[i]! ? -1 : 1;
      }
      return 0;
    };
    out.sort((a, b) => (dated ? byDims(a, b) : (b.m[0] ?? -Infinity) - (a.m[0] ?? -Infinity) || byDims(a, b)));
    return out.slice(0, limit);
  };

  const main = await run(
    dims.map((_, i) => i),
    limit,
    derivable
  );
  const result: QueryResult = { rows: main.rows.map(({ d, m }) => ({ d, m })), truncated: main.truncated };
  if (spec.rollups?.length) {
    result.rollups = [];
    // A main answer that was cut off does not hold every row, so nothing can be worked out from it.
    const fromMain = derivable && !main.truncated;
    for (const keep of spec.rollups.slice(0, 6)) {
      const valid = [...new Set(keep.filter((i) => Number.isInteger(i) && i >= 0 && i < dims.length))].sort((a, b) => a - b);
      if (valid.length === dims.length) continue; // that is the main result
      result.rollups.push({ dims: valid, rows: fromMain ? derive(main.rows, valid) : (await run(valid, limit)).rows });
    }
  }
  return result;
}

/** A date read at a coarser grain. Dates are stored as ISO text ("2026-10-05…"). */
function grainSql(a: string, grain: Grain): string {
  switch (grain) {
    case "year":
      return `substr(${a}, 1, 4)`;
    case "quarter":
      return `(substr(${a}, 1, 4) || '-Q' || ((CAST(substr(${a}, 6, 2) AS INTEGER) + 2) / 3))`;
    case "month":
      return `substr(${a}, 1, 7)`;
    case "week":
      // The Monday the date's week starts on.
      return `date(substr(${a}, 1, 10), '-6 days', 'weekday 1')`;
    case "day":
      return `substr(${a}, 1, 10)`;
    default:
      throw new QueryError("Unknown way of grouping a date.");
  }
}
