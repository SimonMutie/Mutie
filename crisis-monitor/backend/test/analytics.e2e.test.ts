/**
 * The any-data engine (lib/analytics.ts) and its routes, against an
 * in-memory database: grouping and measuring over an uploaded dataset with
 * arbitrary column names, and over Incidents; totals; filters; who may read
 * what; and what a shared dashboard's link can and cannot run.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { analyticsRouter, publicAnalyticsRouter, resetAnalyticsCache } from "../src/routes/analytics";
import { runQuery, fieldsOf, QueryError, type QuerySpec, type Source } from "../src/lib/analytics";
import { createSessionToken } from "../src/auth";
import type { Env } from "../src/bindings";
import { fakeD1 } from "./fakeD1";

let db: ReturnType<typeof fakeD1>["db"];
let env: Env;
let admin: Record<string, string>;
let owner: Record<string, string>;
let stranger: Record<string, string>;

// A dataset whose column names are awkward on purpose: spaces, periods, parentheses.
const SCHEMA = [
  { name: "Country", type: "text" },
  { name: "Aid type", type: "text" },
  { name: "Amount (USD m.)", type: "number" },
  { name: "Signed", type: "date" },
  { name: "Donor.code", type: "text" },
];
const ROWS: [string, string, number | null, string, string][] = [
  ["Kenya", "Health", 12.5, "2026-01-14", "A"],
  ["Kenya", "Health", 7.5, "2026-02-03", "B"],
  ["Kenya", "Security", 30, "2026-02-20", "A"],
  ["Sudan", "Health", 4, "2026-04-02", "A"],
  ["Sudan", "Food", 21, "2026-04-18", "C"],
  ["Sudan", "Food", 9, "2026-07-01", "C"],
  ["Mali", "Security", 15, "2026-07-09", "B"],
  ["", "Food", 2, "2026-07-10", "B"], // no country
  ["Mali", "Health", null, "2026-08-22", "A"], // no amount
];
const dataset: Source = { kind: "dataset", datasetId: "ds1", schema: SCHEMA };
const q = (spec: QuerySpec) => runQuery(env.DB, dataset, spec);
const cells = (rows: { d: unknown[]; m: unknown[] }[]) => rows.map((r) => [...r.d, ...r.m].join("|"));

beforeAll(async () => {
  const d1 = fakeD1();
  db = d1.db;
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, role TEXT, client_id TEXT);
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT, can_view_all_incidents INTEGER, allowed_countries TEXT);
    CREATE TABLE client_dataset_access (client_id TEXT, dataset_id TEXT);
    CREATE TABLE datasets (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, schema_json TEXT, row_count INTEGER, created_at TEXT, updated_at TEXT);
    CREATE TABLE dataset_rows (id TEXT PRIMARY KEY, dataset_id TEXT, owner_id TEXT, row_data TEXT, created_at TEXT);
    CREATE TABLE incidents (id TEXT PRIMARY KEY, owner_id TEXT, occurred_at TEXT, sector TEXT, actor TEXT, tactic TEXT, severity TEXT, country TEXT, province TEXT, county TEXT, district TEXT, city TEXT, suburb TEXT,
      operation TEXT, target TEXT, interest_group TEXT, actual_main_victim TEXT, intended_primary_target TEXT, latitude REAL, longitude REAL,
      civilian_death_child INTEGER, civilian_death_female INTEGER, civilian_death_male INTEGER, civilian_death_unknown INTEGER,
      civilian_injury_female INTEGER, civilian_injury_male INTEGER, civilian_injury_unknown INTEGER, kidnappings_ngo INTEGER);
    CREATE TABLE custom_dashboards (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, widgets TEXT, is_public INTEGER, share_token TEXT, date_range_from TEXT, date_range_to TEXT, theme TEXT);
    INSERT INTO users VALUES ('admin-1', 'admin', 'admin', NULL), ('owner-1', 'owner', 'client', NULL), ('other-1', 'other', 'client', NULL);
  `);
  db.prepare("INSERT INTO datasets VALUES ('ds1', 'owner-1', 'Aid', ?, ?, 'x', 'x')").run(JSON.stringify(SCHEMA), ROWS.length);
  db.prepare("INSERT INTO datasets VALUES ('ds2', 'other-1', 'Private', ?, 1, 'x', 'x')").run(JSON.stringify([{ name: "Secret", type: "text" }]));
  db.prepare("INSERT INTO dataset_rows VALUES ('s1', 'ds2', 'other-1', ?, 'x')").run(JSON.stringify({ Secret: "classified" }));
  const ins = db.prepare("INSERT INTO dataset_rows VALUES (?, 'ds1', 'owner-1', ?, 'x')");
  ROWS.forEach(([country, type, amount, signed, donor], i) => ins.run(`r${i}`, JSON.stringify({ Country: country, "Aid type": type, "Amount (USD m.)": amount, Signed: signed, "Donor.code": donor })));
  const inc = db.prepare("INSERT INTO incidents (id, owner_id, occurred_at, sector, actor, country, civilian_death_male, civilian_death_female, civilian_injury_male, kidnappings_ngo) VALUES (?,?,?,?,?,?,?,?,?,?)");
  inc.run("i1", "owner-1", "2026-03-02T10:00:00Z", "Criminal", "Bandits", "Nigeria", 3, 1, 2, 0);
  inc.run("i2", "owner-1", "2026-03-20T10:00:00Z", "Political", "Militia", "Nigeria", 0, 0, 5, 1);
  inc.run("i3", "owner-1", "2026-05-11T10:00:00Z", "Criminal", "Bandits", "Niger", 10, null, null, null);
  inc.run("i4", "other-1", "2026-05-12T10:00:00Z", "Criminal", "Bandits", "Chad", 99, 0, 0, 0);

  env = { DB: d1.DB, SESSION_SECRET: "test-secret" } as unknown as Env;
  admin = { Authorization: `Bearer ${await createSessionToken("admin-1", "admin", "test-secret")}` };
  owner = { Authorization: `Bearer ${await createSessionToken("owner-1", "client" as never, "test-secret")}` };
  stranger = { Authorization: `Bearer ${await createSessionToken("other-1", "client" as never, "test-secret")}` };
});

describe("grouping and measuring an uploaded dataset", () => {
  it("lists the dataset's own fields, whatever they are called", () => {
    expect(fieldsOf(dataset).map((f) => `${f.name}:${f.type}`)).toEqual(["Country:text", "Aid type:text", "Amount (USD m.):number", "Signed:date", "Donor.code:text"]);
  });

  it("counts, sums, averages, and finds the smallest, largest and number of distinct values per group", async () => {
    const r = await q({
      dimensions: [{ field: "Country" }],
      measures: [{ agg: "count" }, { agg: "sum", field: "Amount (USD m.)" }, { agg: "avg", field: "Amount (USD m.)" }, { agg: "min", field: "Amount (USD m.)" }, { agg: "max", field: "Amount (USD m.)" }, { agg: "distinct", field: "Donor.code" }],
    });
    // Biggest count first; rows with no country are left out by default.
    expect(cells(r.rows)).toEqual(["Kenya|3|50|16.666666666666668|7.5|30|2", "Sudan|3|34|11.333333333333334|4|21|2", "Mali|2|15|15|15|15|2"]);
    expect(r.truncated).toBe(false);
  });

  it("gives a single total when there is nothing to group by", async () => {
    const r = await q({ dimensions: [], measures: [{ agg: "count" }, { agg: "sum", field: "Amount (USD m.)" }] });
    expect(cells(r.rows)).toEqual(["9|101"]);
  });

  it("groups a date by year, quarter, month, week and day, in date order", async () => {
    const by = async (grain: "year" | "quarter" | "month" | "week" | "day") => cells((await q({ dimensions: [{ field: "Signed", grain }], measures: [{ agg: "count" }] })).rows);
    expect(await by("year")).toEqual(["2026|9"]);
    expect(await by("quarter")).toEqual(["2026-Q1|3", "2026-Q2|2", "2026-Q3|4"]);
    expect(await by("month")).toEqual(["2026-01|1", "2026-02|2", "2026-04|2", "2026-07|3", "2026-08|1"]);
    expect((await by("week"))[0]).toBe("2026-01-12|1"); // 14 January 2026 is a Wednesday; its week starts on Monday the 12th
    expect((await by("day")).length).toBe(9);
  });

  it("puts a number into bins for a histogram", async () => {
    const r = await q({ dimensions: [{ field: "Amount (USD m.)", bin: 10 }], measures: [{ agg: "count" }] });
    expect(cells(r.rows)).toEqual(["0|4", "10|2", "20|1", "30|1"]);
  });

  it("crosses two fields, with subtotals and a grand total on request — the pivot table", async () => {
    const r = await q({ dimensions: [{ field: "Country" }, { field: "Aid type" }], measures: [{ agg: "sum", field: "Amount (USD m.)" }], blanks: "include", rollups: [[0], [1], []] });
    const cell = (c: string | null, t: string) => r.rows.find((x) => x.d[0] === c && x.d[1] === t)?.m[0];
    expect(cell("Kenya", "Health")).toBe(20);
    expect(cell("Sudan", "Food")).toBe(30);
    expect(cell(null, "Food")).toBe(2); // the row with no country, kept because blanks were asked for
    expect(cell("Mali", "Health")).toBeNull(); // a group whose only amount is missing has no sum, not zero
    const [byCountry, byType, grand] = r.rollups!;
    expect(byCountry.dims).toEqual([0]);
    expect(Object.fromEntries(byCountry.rows.map((x) => [x.d[0] ?? "(blank)", x.m[0]]))).toEqual({ Kenya: 50, Sudan: 34, Mali: 15, "(blank)": 2 });
    expect(Object.fromEntries(byType.rows.map((x) => [x.d[0], x.m[0]]))).toEqual({ Health: 24, Security: 45, Food: 32 });
    expect(grand.rows[0].m[0]).toBe(101);
  });

  it("works totals out from the main answer, and they match a fresh pass over the rows — averages included", async () => {
    const spec: QuerySpec = {
      dimensions: [{ field: "Country" }, { field: "Signed", grain: "quarter" }],
      measures: [{ agg: "count" }, { agg: "count", field: "Amount (USD m.)" }, { agg: "sum", field: "Amount (USD m.)" }, { agg: "avg", field: "Amount (USD m.)" }, { agg: "min", field: "Amount (USD m.)" }, { agg: "max", field: "Amount (USD m.)" }],
      blanks: "include",
      rollups: [[0], [1], []],
    };
    const derived = await q(spec);
    const scanned = await runQuery(env.DB, dataset, spec, { deriveRollups: false });
    const norm = (r: typeof derived) => r.rollups!.map((x) => ({ dims: x.dims, rows: x.rows.map((row) => `${row.d.join("|")}=${row.m.map((v) => (v === null ? "null" : v.toFixed(6))).join(",")}`).sort() }));
    expect(norm(derived)).toEqual(norm(scanned));
    expect(derived.rows).toEqual(scanned.rows);
    // The grand average is the average over every row with an amount (101 / 8), not the average of the group averages.
    const grand = derived.rollups!.find((x) => x.dims.length === 0)!.rows[0];
    expect(grand.m[0]).toBe(9);
    expect(grand.m[1]).toBe(8);
    expect(grand.m[3]).toBeCloseTo(101 / 8, 9);
    expect(grand.m[4]).toBe(2);
    expect(grand.m[5]).toBe(30);
  });

  it("finds the middle value and the quartiles of each group, and of everything", async () => {
    // Amounts: Kenya 7.5, 12.5, 30 · Sudan 4, 9, 21 · Mali 15 (and one with none) · no country 2.
    const r = await q({
      dimensions: [{ field: "Country" }],
      measures: [{ agg: "median", field: "Amount (USD m.)" }, { agg: "q1", field: "Amount (USD m.)" }, { agg: "q3", field: "Amount (USD m.)" }, { agg: "min", field: "Amount (USD m.)" }, { agg: "max", field: "Amount (USD m.)" }, { agg: "count", field: "Amount (USD m.)" }],
      blanks: "include",
      rollups: [[]],
    });
    const of = (c: string | null) => r.rows.find((x) => x.d[0] === c)!.m;
    expect(of("Kenya")).toEqual([12.5, 7.5, 30, 7.5, 30, 3]);
    expect(of("Sudan")).toEqual([9, 4, 21, 4, 21, 3]);
    expect(of("Mali")).toEqual([15, 15, 15, 15, 15, 1]); // the grant with no amount is not a value
    expect(of(null)).toEqual([2, 2, 2, 2, 2, 1]);
    // Everything: 2, 4, 7.5, 9, 12.5, 15, 21, 30 — an even count, so the median is the mean of the middle two.
    expect(r.rollups![0].rows[0].m).toEqual([10.75, 4, 15, 2, 30, 8]);
    await expect(q({ dimensions: [], measures: [{ agg: "median", field: "Country" }] })).rejects.toThrow(/not a number/);
  });

  it("goes back to the rows for a total it cannot work out: a distinct count, or groups that left blank rows out", async () => {
    // Donor codes A, B and C each appear under several countries: adding the per-country counts would count them twice.
    const distinct = await q({ dimensions: [{ field: "Country" }], measures: [{ agg: "distinct", field: "Donor.code" }], blanks: "include", rollups: [[]] });
    expect(distinct.rows.reduce((s, r) => s + (r.m[0] ?? 0), 0)).toBeGreaterThan(3);
    expect(distinct.rollups![0].rows[0].m[0]).toBe(3);
    // Blank countries are left out of the groups, but the total is still of every row.
    const exclude = await q({ dimensions: [{ field: "Country" }], measures: [{ agg: "count" }], rollups: [[]] });
    expect(exclude.rows.reduce((s, r) => s + (r.m[0] ?? 0), 0)).toBe(8);
    expect(exclude.rollups![0].rows[0].m[0]).toBe(9);
    // No rows at all: the total is a count of zero and no sum.
    const none = await q({ dimensions: [{ field: "Country" }], measures: [{ agg: "count" }, { agg: "sum", field: "Amount (USD m.)" }], blanks: "include", rollups: [[]], filters: [{ field: "Country", op: "in", values: ["Nowhere"] }] });
    expect(none.rows).toEqual([]);
    expect(none.rollups![0].rows).toEqual([{ d: [], m: [0, null] }]);
  });

  it("filters by a list, by exclusion, by a range, by a date, by text and by emptiness", async () => {
    const total = async (filters: QuerySpec["filters"]) => (await q({ dimensions: [], measures: [{ agg: "count" }], filters })).rows[0].m[0];
    expect(await total([{ field: "Country", op: "in", values: ["Kenya", "Mali"] }])).toBe(5);
    expect(await total([{ field: "Country", op: "not_in", values: ["Kenya"] }])).toBe(6); // includes the row with no country
    expect(await total([{ field: "Country", op: "in", values: [""] }])).toBe(1);
    expect(await total([{ field: "Country", op: "not_in", values: ["Kenya", ""] }])).toBe(5);
    expect(await total([{ field: "Amount (USD m.)", op: "gte", values: [15] }])).toBe(3);
    expect(await total([{ field: "Amount (USD m.)", op: "gte", values: [5] }, { field: "Amount (USD m.)", op: "lte", values: [15] }])).toBe(4);
    expect(await total([{ field: "Signed", op: "gte", values: ["2026-07-01"] }])).toBe(4);
    expect(await total([{ field: "Aid type", op: "contains", values: ["ecur"] }])).toBe(2);
    expect(await total([{ field: "Aid type", op: "contains", values: ["%"] }])).toBe(0); // text, not a pattern
    expect(await total([{ field: "Country", op: "in", values: [] }])).toBe(0);
  });

  it("stops at the limit and says so", async () => {
    const r = await q({ dimensions: [{ field: "Signed", grain: "day" }], measures: [{ agg: "count" }], limit: 4 });
    expect(r.rows).toHaveLength(4);
    expect(r.truncated).toBe(true);
  });

  it("refuses what the data cannot answer, in words fit to show", async () => {
    await expect(q({ dimensions: [{ field: "Nope" }], measures: [{ agg: "count" }] })).rejects.toThrow(/no field called “Nope”/);
    await expect(q({ dimensions: [], measures: [{ agg: "sum", field: "Country" }] })).rejects.toThrow(/not a number/);
    await expect(q({ dimensions: [{ field: "Country", grain: "month" }], measures: [{ agg: "count" }] })).rejects.toThrow(/not a date/);
    await expect(q({ dimensions: [{ field: "Country", bin: 5 }], measures: [{ agg: "count" }] })).rejects.toThrow(/not a number/);
    await expect(q({ dimensions: [], measures: [] })).rejects.toBeInstanceOf(QueryError);
    await expect(q({ dimensions: Array(5).fill({ field: "Country" }), measures: [{ agg: "count" }] })).rejects.toThrow(/At most 4/);
  });

  it("treats a hostile field name as a name, never as SQL", async () => {
    const hostile = `x") FROM dataset_rows; DROP TABLE dataset_rows; --`;
    await expect(q({ dimensions: [{ field: hostile }], measures: [{ agg: "count" }] })).rejects.toThrow(/no field called/);
    // A dataset really could have such a column: it is then read as data.
    const odd: Source = { kind: "dataset", datasetId: "ds1", schema: [...SCHEMA, { name: hostile, type: "text" }] };
    const r = await runQuery(env.DB, odd, { dimensions: [{ field: hostile }], measures: [{ agg: "count" }], blanks: "include" });
    expect(cells(r.rows)).toEqual(["|9"]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM dataset_rows").get() as { n: number }).n).toBe(10);
  });
});

describe("Incidents as a source", () => {
  const scoped: Source = { kind: "incidents", ownerIds: ["owner-1"], countries: null };
  it("offers its categories, its date and its casualty figures as fields", () => {
    const names = fieldsOf(scoped).map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["sector", "actor", "country", "date", "deaths", "injuries", "kidnappings_ngo"]));
  });
  it("adds up deaths across their columns, by country and by month, within the caller's own incidents", async () => {
    const byCountry = await runQuery(env.DB, scoped, { dimensions: [{ field: "country" }], measures: [{ agg: "count" }, { agg: "sum", field: "deaths" }, { agg: "sum", field: "injuries" }] });
    expect(cells(byCountry.rows)).toEqual(["Nigeria|2|4|7", "Niger|1|10|0"]); // Chad belongs to someone else
    const byMonth = await runQuery(env.DB, scoped, { dimensions: [{ field: "date", grain: "month" }], measures: [{ agg: "sum", field: "deaths" }] });
    expect(cells(byMonth.rows)).toEqual(["2026-03|4", "2026-05|10"]);
  });
  it("respects a date range and an unrestricted (admin) scope", async () => {
    const ranged = await runQuery(env.DB, { ...scoped, dateFrom: "2026-05-01" }, { dimensions: [], measures: [{ agg: "count" }] });
    expect(ranged.rows[0].m[0]).toBe(1);
    const all = await runQuery(env.DB, { kind: "incidents", ownerIds: null, countries: null }, { dimensions: [], measures: [{ agg: "sum", field: "deaths" }] });
    expect(all.rows[0].m[0]).toBe(113);
  });
});

describe("the signed-in routes", () => {
  const post = (headers: Record<string, string>, body: unknown) => analyticsRouter.request("/query", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }, env);
  const query = { dimensions: [{ field: "Country" }], measures: [{ agg: "count" }] };

  it("answer the owner and the admin, and nobody else", async () => {
    expect((await post(owner, { source: "dataset:ds1", query })).status).toBe(200);
    expect((await post(admin, { source: "dataset:ds1", query })).status).toBe(200);
    expect((await post(stranger, { source: "dataset:ds1", query })).status).toBe(404);
    expect((await post({}, { source: "dataset:ds1", query })).status).toBe(401);
    expect((await analyticsRouter.request("/fields?source=dataset:ds1", { headers: stranger }, env)).status).toBe(404);
    const fields = (await (await analyticsRouter.request("/fields?source=dataset:ds1", { headers: owner }, env)).json()) as { fields: { name: string }[] };
    expect(fields.fields).toHaveLength(5);
  });
  it("scope Incidents to the caller", async () => {
    const mine = (await (await post(owner, { source: "incidents", query: { dimensions: [], measures: [{ agg: "count" }] } })).json()) as { rows: { m: number[] }[] };
    expect(mine.rows[0].m[0]).toBe(3);
    const everyone = (await (await post(admin, { source: "incidents", query: { dimensions: [], measures: [{ agg: "count" }] } })).json()) as { rows: { m: number[] }[] };
    expect(everyone.rows[0].m[0]).toBe(4);
  });
  it("reuse a recent answer, never across callers, and drop it as soon as the dataset changes", async () => {
    resetAnalyticsCache();
    const count = async (headers: Record<string, string>, source: string) => ((await (await post(headers, { source, query: { dimensions: [], measures: [{ agg: "count" }] } })).json()) as { rows: { m: number[] }[] }).rows[0].m[0];
    expect(await count(owner, "dataset:ds1")).toBe(9);
    // A row slipped in behind the dataset's back (its version untouched) is not seen yet: the answer came from memory.
    db.prepare("INSERT INTO dataset_rows VALUES ('extra-1', 'ds1', 'owner-1', ?, 'x')").run(JSON.stringify({ Country: "Chad" }));
    expect(await count(owner, "dataset:ds1")).toBe(9);
    // A real upload stamps the dataset, and the next question is answered afresh.
    db.prepare("UPDATE datasets SET updated_at = 'y', row_count = row_count + 1 WHERE id = 'ds1'").run();
    expect(await count(owner, "dataset:ds1")).toBe(10);
    db.prepare("DELETE FROM dataset_rows WHERE id = 'extra-1'").run();
    db.prepare("UPDATE datasets SET updated_at = 'x', row_count = row_count - 1 WHERE id = 'ds1'").run();
    // What one caller was told is never handed to another whose view of Incidents differs.
    expect(await count(owner, "incidents")).toBe(3);
    expect(await count(admin, "incidents")).toBe(4);
    expect(await count(owner, "incidents")).toBe(3);
    resetAnalyticsCache();
  });
  it("explain a bad request", async () => {
    const res = await post(owner, { source: "dataset:ds1", query: { dimensions: [{ field: "Nope" }], measures: [{ agg: "count" }] } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/no field called/);
    expect((await post(owner, { source: "dataset:ds1", query: { dimensions: [], measures: [{ agg: "median" }] } })).status).toBe(400);
  });
});

describe("a shared dashboard's link", () => {
  const viz = (source: string, extra: Record<string, unknown> = {}) => ({
    kind: "bar",
    source,
    rows: [{ field: "Country" }],
    columns: [],
    values: [{ agg: "sum", field: "Amount (USD m.)" }],
    filters: [],
    query: { dimensions: [{ field: "Country" }], measures: [{ agg: "sum", field: "Amount (USD m.)" }] },
    ...extra,
  });
  const run = (token: string, body: unknown) => publicAnalyticsRouter.request(`/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);

  beforeAll(() => {
    const widgets = [
      { id: "w1", type: "viz", viz: viz("dataset:ds1") },
      { id: "w2", type: "viz", viz: { kind: "slicer", source: "dataset:ds1", rows: [{ field: "Aid type" }], columns: [], values: [{ agg: "count" }], filters: [], query: { dimensions: [{ field: "Aid type" }], measures: [{ agg: "count" }] } } },
      { id: "w3", type: "viz", viz: viz("dataset:ds2", { rows: [{ field: "Secret" }], values: [{ agg: "count" }], query: { dimensions: [{ field: "Secret" }], measures: [{ agg: "count" }] } }) }, // someone else's data
      { id: "w4", type: "viz", viz: { ...viz("incidents"), rows: [{ field: "country" }], values: [{ agg: "sum", field: "deaths" }], query: { dimensions: [{ field: "country" }], measures: [{ agg: "sum", field: "deaths" }] } } },
      { id: "w5", type: "bar", dataField: "by_sector" },
    ];
    const ins = db.prepare("INSERT INTO custom_dashboards (id, owner_id, name, widgets, is_public, share_token, date_range_from) VALUES (?, 'owner-1', 'Shared', ?, ?, ?, ?)");
    ins.run("d1", JSON.stringify(widgets), 1, "tok-public", null);
    ins.run("d2", JSON.stringify(widgets), 0, "tok-private", null);
    ins.run("d3", JSON.stringify(widgets), 1, "tok-ranged", "2026-05-01");
  });

  it("runs the query saved with one of the dashboard's visuals", async () => {
    const r = (await (await run("tok-public", { widgetId: "w1" })).json()) as { rows: { d: string[]; m: number[] }[] };
    expect(cells(r.rows)).toEqual(["Kenya|50", "Sudan|34", "Mali|15"]);
  });
  it("can be narrowed by a field the dashboard already shows, and by no other", async () => {
    const narrowed = (await (await run("tok-public", { widgetId: "w1", filters: [{ field: "Aid type", op: "in", values: ["Health"] }] })).json()) as { rows: { d: string[]; m: number[] }[] };
    // Mali's only health grant has no amount recorded: the group exists, with no sum.
    expect(cells(narrowed.rows)).toEqual(["Kenya|20", "Sudan|4", "Mali|"]);
    // "Donor.code" is on no visual of this dashboard: a filter on it is ignored, not applied.
    const probing = (await (await run("tok-public", { widgetId: "w1", filters: [{ field: "Donor.code", op: "in", values: ["A"] }] })).json()) as { rows: { d: string[]; m: number[] }[] };
    expect(cells(probing.rows)).toEqual(["Kenya|50", "Sudan|34", "Mali|15"]);
  });
  it("runs nothing the viewer composes, nothing from a private dashboard, and nothing from data that is not the owner's", async () => {
    expect((await run("tok-public", { widgetId: "w1", query: { dimensions: [{ field: "Donor.code" }], measures: [{ agg: "count" }] } })).status).toBe(200); // the extra "query" is simply not read
    const ignored = (await (await run("tok-public", { widgetId: "w1", query: { dimensions: [{ field: "Donor.code" }], measures: [{ agg: "count" }] } })).json()) as { rows: { d: string[] }[] };
    expect(ignored.rows.map((r) => r.d[0])).toEqual(["Kenya", "Sudan", "Mali"]);
    expect((await run("tok-private", { widgetId: "w1" })).status).toBe(404);
    expect((await run("no-such-token", { widgetId: "w1" })).status).toBe(404);
    expect((await run("tok-public", { widgetId: "w3" })).status).toBe(404);
    expect((await run("tok-public", { widgetId: "w5" })).status).toBe(404);
    expect((await run("tok-public", { widgetId: "nope" })).status).toBe(404);
  });
  it("shows the owner's incidents only, inside the dashboard's own date range", async () => {
    const all = (await (await run("tok-public", { widgetId: "w4" })).json()) as { rows: { d: string[]; m: number[] }[] };
    expect(cells(all.rows)).toEqual(["Niger|10", "Nigeria|4"]);
    const ranged = (await (await run("tok-ranged", { widgetId: "w4" })).json()) as { rows: { d: string[]; m: number[] }[] };
    expect(cells(ranged.rows)).toEqual(["Niger|10"]);
  });
});
