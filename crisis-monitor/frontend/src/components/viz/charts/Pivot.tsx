import { useMemo, useState } from "react";
import { dimLabel, fmtMeasure, inkOn, mix } from "../format";
import { dimTitle, fieldInfo, measureLabel, valuesOf, type VizDim, type VizMeasure, type VizResult, type VizRow, type VizSpec } from "../types";
import type { ChartProps } from "./kit";

/**
 * The pivot table: fields down the side, fields across the top, figures in
 * the cells, with subtotals for the outer row field and totals for every row
 * and column.
 *
 * The totals are not added up here. They come from the server as their own
 * groupings, so the total of an average is the average over everything and
 * the total of a distinct count does not count anything twice.
 */

const SEP = "\u0002";
const keyOf = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "\u0000" : String(v));
const MAX_COLS = 30;
const MAX_ROWS = 600;

export interface PivotRow {
  key: string;
  label: string;
  /** 0 for a top-level row or a group heading, 1 for a row inside a group. */
  level: 0 | 1;
  isGroup: boolean;
  /** The group this row sits in, for collapsing. */
  parent?: string;
  /** The outer row field's value: what a click on the row filters by. */
  raw: string | number | null;
  pickKey: string;
  /** One figure per leaf column per measure. */
  cells: (number | null)[];
  /** The row's own total, one per measure; empty when there is no total column. */
  totals: (number | null)[];
  /** Which measure each cell and total belongs to (differs per row only when measures are the rows). */
  measures: VizMeasure[];
  /** The largest cell per measure, for shading. */
  maxes: number[];
}

export interface PivotModel {
  rowTitle: string;
  /** Header rows above the leaf columns, outermost first; spans are in leaf columns. */
  colHeaders: { label: string; span: number }[][];
  leafCount: number;
  /** Measure names under each leaf column; empty when there is only one measure (or measures are the rows). */
  measureLabels: string[];
  perLeaf: number;
  rows: PivotRow[];
  totalRow: PivotRow | null;
  hasTotalCol: boolean;
  notes: string[];
}

function sortKeys(keys: string[], ordered: boolean, numeric: boolean, weight: (k: string) => number): string[] {
  return [...keys].sort((a, b) => {
    if (a === "\u0000") return 1;
    if (b === "\u0000") return -1;
    if (ordered) return numeric ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0;
    return weight(b) - weight(a) || (a < b ? -1 : 1);
  });
}

export function buildPivot(viz: VizSpec, result: VizResult): PivotModel {
  const measures = valuesOf(viz);
  const R = viz.rows.length;
  const C = Math.min(viz.columns.length, 4 - R);
  const rowDims = viz.rows;
  const colDims = viz.columns.slice(0, C);
  const M = measures.length;
  const wantTotals = viz.options?.totals !== false;
  const wantSubtotals = viz.options?.subtotals !== false && R >= 2;
  const notes: string[] = [];
  const typeOf = (d: VizDim) => fieldInfo(viz, d.field).type;
  const isOrdered = (d: VizDim) => !!d.grain || d.bin !== undefined || typeOf(d) === "date" || typeOf(d) === "number";
  const isNumeric = (d: VizDim) => d.bin !== undefined || (typeOf(d) === "number" && !d.grain);
  const label = (d: VizDim, v: string | number | null) => dimLabel(v, d, typeOf(d));
  const rollup = (dims: number[]): VizRow[] => result.rollups?.find((r) => r.dims.length === dims.length && r.dims.every((x, i) => x === dims[i]))?.rows ?? [];
  const rowIdx = rowDims.map((_, i) => i);
  const colIdx = colDims.map((_, i) => R + i);

  // ── Leaf columns ──
  const colKeyOf = (row: VizRow, at: number[]) => at.map((i) => keyOf(row.d[i])).join(SEP);
  const colInfo = new Map<string, { raws: (string | number | null)[]; weight: number }>();
  const colSource = C > 0 && R > 0 && rollup(colIdx).length ? rollup(colIdx).map((r) => ({ d: r.d, m: r.m, at: colDims.map((_, i) => i) })) : result.rows.map((r) => ({ d: r.d, m: r.m, at: colIdx }));
  if (C > 0) {
    for (const r of colSource) {
      const k = r.at.map((i) => keyOf(r.d[i])).join(SEP);
      const info = colInfo.get(k) ?? { raws: r.at.map((i) => r.d[i] ?? null), weight: 0 };
      info.weight += Math.abs(r.m[0] ?? 0);
      colInfo.set(k, info);
    }
  }
  let colKeys = [...colInfo.keys()];
  if (C > 0) {
    // Sorted level by level: the outer field first, then the inner one within it.
    const outerWeight = new Map<string, number>();
    for (const [k, info] of colInfo) outerWeight.set(k.split(SEP)[0], (outerWeight.get(k.split(SEP)[0]) ?? 0) + info.weight);
    const outer = sortKeys([...outerWeight.keys()], isOrdered(colDims[0]), isNumeric(colDims[0]), (k) => outerWeight.get(k) ?? 0);
    colKeys = outer.flatMap((o) => {
      const inner = colKeys.filter((k) => k.split(SEP)[0] === o);
      if (C === 1) return inner;
      const part = new Map(inner.map((k) => [k.split(SEP)[1], k]));
      return sortKeys([...part.keys()], isOrdered(colDims[1]), isNumeric(colDims[1]), (k) => colInfo.get(part.get(k)!)!.weight).map((k) => part.get(k)!);
    });
    if (colKeys.length > MAX_COLS) {
      const all = colKeys.length;
      const keepLatest = isOrdered(colDims[0]);
      if (keepLatest) colKeys = colKeys.slice(-MAX_COLS);
      else {
        const top = new Set([...colKeys].sort((a, b) => colInfo.get(b)!.weight - colInfo.get(a)!.weight).slice(0, MAX_COLS));
        colKeys = colKeys.filter((k) => top.has(k));
      }
      notes.push(`${keepLatest ? "The latest" : "The largest"} ${MAX_COLS} of ${all} columns are shown; the totals still cover them all.`);
    }
  }
  const leafKeys = C > 0 ? colKeys : [""];
  const leafIndex = new Map(leafKeys.map((k, i) => [k, i]));

  const colHeaders: { label: string; span: number }[][] = [];
  for (let level = 0; level < C; level++) {
    const row: { label: string; span: number; id: string }[] = [];
    for (const k of colKeys) {
      const id = k
        .split(SEP)
        .slice(0, level + 1)
        .join(SEP);
      const last = row[row.length - 1];
      if (last && last.id === id) last.span++;
      else row.push({ id, span: 1, label: label(colDims[level], colInfo.get(k)!.raws[level]) });
    }
    colHeaders.push(row.map(({ label: l, span }) => ({ label: l, span })));
  }

  // ── Measures as rows: there is nothing on Rows, so each figure gets a row of its own. ──
  if (R === 0) {
    const byCol = new Map(result.rows.map((r) => [colKeyOf(r, colIdx), r]));
    const grand = rollup([])[0];
    const rows: PivotRow[] = measures.map((m, mi) => {
      const cells = leafKeys.map((k) => byCol.get(k)?.m[mi] ?? null);
      return {
        key: `m${mi}`,
        label: measureLabel(viz, m),
        level: 0,
        isGroup: false,
        raw: null,
        pickKey: "",
        cells,
        totals: wantTotals && grand ? [grand.m[mi] ?? null] : [],
        measures: [m],
        maxes: [Math.max(...cells.map((c) => Math.abs(c ?? 0)), 0)],
      };
    });
    return { rowTitle: "", colHeaders, leafCount: leafKeys.length, measureLabels: [], perLeaf: 1, rows, totalRow: null, hasTotalCol: wantTotals && !!grand, notes };
  }

  // ── Cells ──
  const cellMap = new Map<string, (number | null)[]>();
  const rowInfo = new Map<string, { raws: (string | number | null)[] }>();
  for (const r of result.rows) {
    const rk = colKeyOf(r, rowIdx);
    if (!rowInfo.has(rk)) rowInfo.set(rk, { raws: rowIdx.map((i) => r.d[i] ?? null) });
    cellMap.set(`${rk}\u0003${C > 0 ? colKeyOf(r, colIdx) : ""}`, r.m);
  }
  const rowTotals = new Map<string, (number | null)[]>();
  if (C > 0) for (const r of rollup(rowIdx)) rowTotals.set(colKeyOf(r, rowIdx), r.m);
  else for (const r of result.rows) rowTotals.set(colKeyOf(r, rowIdx), r.m);
  const groupTotals = new Map<string, (number | null)[]>();
  const groupCells = new Map<string, (number | null)[]>();
  if (R >= 2) {
    for (const r of rollup([0])) groupTotals.set(keyOf(r.d[0]), r.m);
    if (C > 0) for (const r of rollup([0, ...colIdx])) groupCells.set(`${keyOf(r.d[0])}\u0003${r.d.slice(1).map(keyOf).join(SEP)}`, r.m);
  }

  const cellsFor = (lookup: (leaf: string) => (number | null)[] | undefined): (number | null)[] => {
    const out: (number | null)[] = new Array(leafKeys.length * M).fill(null);
    for (const leaf of leafKeys) {
      const m = lookup(leaf);
      if (!m) continue;
      const at = leafIndex.get(leaf)! * M;
      for (let mi = 0; mi < M; mi++) out[at + mi] = m[mi] ?? null;
    }
    return out;
  };

  // ── Rows, in order ──
  const weightOf = (m: (number | null)[] | undefined) => Math.abs(m?.[0] ?? 0);
  const outerKeys = new Map<string, string[]>();
  for (const rk of rowInfo.keys()) {
    const o = rk.split(SEP)[0];
    outerKeys.set(o, [...(outerKeys.get(o) ?? []), rk]);
  }
  const outerWeight = (o: string) => (R >= 2 ? weightOf(groupTotals.get(o)) || (outerKeys.get(o) ?? []).reduce((s, rk) => s + weightOf(rowTotals.get(rk)), 0) : weightOf(rowTotals.get(o)));
  const outerSorted = sortKeys([...outerKeys.keys()], isOrdered(rowDims[0]), isNumeric(rowDims[0]), outerWeight);
  const innerOrdered = R >= 2 && rowDims.slice(1).every(isOrdered);
  const maxes: number[] = new Array(M).fill(0);
  const rows: PivotRow[] = [];
  for (const o of outerSorted) {
    const members = outerKeys.get(o)!;
    const raw0 = rowInfo.get(members[0])!.raws[0];
    if (R === 1) {
      const cells = cellsFor((leaf) => cellMap.get(`${o}\u0003${leaf}`));
      rows.push({ key: o, label: label(rowDims[0], raw0), level: 0, isGroup: false, raw: raw0, pickKey: o, cells, totals: C > 0 && wantTotals ? (rowTotals.get(o) ?? []) : [], measures, maxes });
      continue;
    }
    const sorted = [...members].sort((a, b) => (innerOrdered ? (a < b ? -1 : 1) : weightOf(rowTotals.get(b)) - weightOf(rowTotals.get(a)) || (a < b ? -1 : 1)));
    if (wantSubtotals) {
      rows.push({
        key: `g${SEP}${o}`,
        label: label(rowDims[0], raw0),
        level: 0,
        isGroup: true,
        raw: raw0,
        pickKey: o,
        cells: C > 0 ? cellsFor((leaf) => groupCells.get(`${o}\u0003${leaf}`)) : cellsFor(() => groupTotals.get(o)),
        totals: C > 0 && wantTotals ? (groupTotals.get(o) ?? []) : [],
        measures,
        maxes,
      });
    }
    for (const rk of sorted) {
      const raws = rowInfo.get(rk)!.raws;
      const inner = raws
        .slice(1)
        .map((v, i) => label(rowDims[i + 1], v))
        .join(" › ");
      rows.push({
        key: rk,
        label: wantSubtotals ? inner : `${label(rowDims[0], raw0)} › ${inner}`,
        level: wantSubtotals ? 1 : 0,
        isGroup: false,
        parent: wantSubtotals ? `g${SEP}${o}` : undefined,
        raw: raw0,
        pickKey: o,
        cells: cellsFor((leaf) => cellMap.get(`${rk}\u0003${leaf}`)),
        totals: C > 0 && wantTotals ? (rowTotals.get(rk) ?? []) : [],
        measures,
        maxes,
      });
    }
  }
  // Shading compares like with like: the detail rows, measure by measure. Subtotals would swamp them.
  for (const row of rows) if (!row.isGroup) row.cells.forEach((c, i) => (maxes[i % M] = Math.max(maxes[i % M], Math.abs(c ?? 0))));

  let totalRow: PivotRow | null = null;
  if (wantTotals) {
    const grand = rollup([])[0];
    const colTotals = new Map<string, (number | null)[]>();
    if (C > 0) for (const r of rollup(colIdx)) colTotals.set(r.d.map(keyOf).join(SEP), r.m);
    totalRow = {
      key: "total",
      label: "Total",
      level: 0,
      isGroup: true,
      raw: null,
      pickKey: "",
      cells: C > 0 ? cellsFor((leaf) => colTotals.get(leaf)) : cellsFor(() => grand?.m),
      totals: C > 0 ? (grand?.m ?? []) : [],
      measures,
      maxes,
    };
  }
  if (result.truncated) notes.push("This table has more combinations than can be fetched at once (5,000). Some rows are missing; add a filter or use fewer fields.");
  if (rows.length > MAX_ROWS) notes.push(`The first ${MAX_ROWS} of ${rows.length.toLocaleString()} rows are shown. Download the table for all of them.`);

  return {
    rowTitle: rowDims.map((d) => dimTitle(viz, d)).join(" › "),
    colHeaders,
    leafCount: leafKeys.length,
    measureLabels: M > 1 || C === 0 ? measures.map((m) => measureLabel(viz, m)) : [],
    perLeaf: M,
    rows,
    totalRow,
    hasTotalCol: C > 0 && wantTotals,
    notes,
  };
}

/** The table as rows of plain cells — the form a spreadsheet download takes. */
export function pivotToSheet(model: PivotModel): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  const totalHead = (i: number) => (model.hasTotalCol ? Array.from({ length: model.rows[0]?.totals.length ?? 1 }, (_, t) => (i === 0 && t === 0 ? "Total" : "")) : []);
  model.colHeaders.forEach((level, i) =>
    out.push([
      i === model.colHeaders.length - 1 && !model.measureLabels.length ? model.rowTitle : "",
      ...level.flatMap((h) => Array.from({ length: h.span * model.perLeaf }, (_, s) => (s === 0 ? h.label : ""))),
      ...totalHead(i),
    ]),
  );
  if (model.measureLabels.length) out.push([model.rowTitle, ...Array.from({ length: model.leafCount }, () => model.measureLabels).flat(), ...(model.hasTotalCol ? model.measureLabels : [])]);
  if (!out.length) out.push([model.rowTitle, "Value", ...(model.hasTotalCol ? ["Total"] : [])]);
  for (const r of [...model.rows, ...(model.totalRow ? [model.totalRow] : [])]) out.push([`${r.level === 1 ? "    " : ""}${r.label}`, ...r.cells, ...r.totals]);
  return out;
}

export default function Pivot({ viz, result, theme, selectedKey, onPick }: ChartProps) {
  const model = useMemo(() => buildPivot(viz, result), [viz, result]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const shading = viz.options?.shading ?? "heat";
  const rowDim = viz.rows[0];
  const rowType = rowDim ? fieldInfo(viz, rowDim.field).type : "text";
  const visible = model.rows.filter((r) => !r.parent || !collapsed.has(r.parent)).slice(0, MAX_ROWS);
  const perLeaf = model.perLeaf;

  const cell = (row: PivotRow, value: number | null, i: number, key: string, total = false) => {
    const m = row.measures[i % row.measures.length];
    const text = value === null ? "" : fmtMeasure(value, m, viz.options);
    const max = row.maxes[i % row.maxes.length] || 0;
    const t = value !== null && max > 0 ? Math.min(Math.abs(value) / max, 1) : 0;
    const shade = !total && !row.isGroup && value !== null && value !== 0;
    let style: React.CSSProperties | undefined;
    if (shade && shading === "heat") {
      const fill = mix(theme.surface, theme.ramp, 0.08 + 0.72 * t);
      style = { background: fill, color: inkOn(fill) };
    } else if (shade && shading === "bars") {
      const bar = mix(theme.surface, theme.ramp, 0.3);
      style = {
        backgroundImage: `linear-gradient(to right, ${bar} ${t * 100}%, transparent ${t * 100}%)`,
        backgroundSize: "calc(100% - 8px) 60%",
        backgroundPosition: "4px center",
        backgroundRepeat: "no-repeat",
      };
    }
    return (
      <td key={key} className={`${total ? "is-total" : ""}${i % perLeaf === 0 && perLeaf > 1 ? " is-first" : ""}`} style={style}>
        {text}
      </td>
    );
  };

  const renderRow = (row: PivotRow, isTotal = false) => {
    const group = row.isGroup && !isTotal;
    const pickable = !!onPick && !isTotal && !!rowDim;
    return (
      <tr
        key={row.key}
        className={`${row.isGroup ? "is-group" : ""}${isTotal ? " is-grand" : ""}${row.level === 1 ? " is-child" : ""}${!isTotal && selectedKey !== null && selectedKey !== row.pickKey ? " is-dim" : ""}`}
      >
        <th scope="row">
          {group && (
            <button
              type="button"
              className="vz-pivot__toggle"
              aria-expanded={!collapsed.has(row.key)}
              aria-label={`${collapsed.has(row.key) ? "Show" : "Hide"} the rows under ${row.label}`}
              onClick={() =>
                setCollapsed((c) => {
                  const next = new Set(c);
                  if (next.has(row.key)) next.delete(row.key);
                  else next.add(row.key);
                  return next;
                })
              }
            >
              {collapsed.has(row.key) ? "▸" : "▾"}
            </button>
          )}
          <span
            className={pickable ? "is-click" : undefined}
            title={pickable ? "Click to filter the other visuals" : undefined}
            onClick={pickable ? () => onPick!(rowDim, rowType, row.raw, dimLabel(row.raw, rowDim, rowType), row.pickKey) : undefined}
          >
            {row.label}
          </span>
        </th>
        {row.cells.map((v, i) => cell(row, v, i, `c${i}`, isTotal))}
        {model.hasTotalCol && row.totals.map((v, i) => cell(row, v, i, `t${i}`, true))}
      </tr>
    );
  };

  if (model.rows.length === 0) return <div className="vz-empty">No rows match.</div>;
  const totalSpan = model.rows[0]?.totals.length || 1;
  const headRows = model.colHeaders.length + (model.measureLabels.length ? 1 : 0);

  return (
    <div className="vz-frame">
      <div className="vz-pivot">
        <table>
          <thead>
            {model.colHeaders.map((level, li) => (
              <tr key={li}>
                {li === 0 && (
                  <th rowSpan={headRows} className="vz-pivot__corner">
                    {model.rowTitle}
                  </th>
                )}
                {level.map((h, i) => (
                  <th key={i} colSpan={h.span * perLeaf} className="is-col">
                    {h.label}
                  </th>
                ))}
                {li === 0 && model.hasTotalCol && (
                  <th rowSpan={model.colHeaders.length} colSpan={totalSpan} className="is-col is-total">
                    Total
                  </th>
                )}
              </tr>
            ))}
            {model.measureLabels.length > 0 && (
              <tr>
                {model.colHeaders.length === 0 && <th className="vz-pivot__corner">{model.rowTitle}</th>}
                {Array.from({ length: model.leafCount }, (_, leaf) =>
                  model.measureLabels.map((m, mi) => (
                    <th key={`${leaf}-${mi}`} className={`is-measure${mi === 0 && perLeaf > 1 ? " is-first" : ""}`}>
                      {m}
                    </th>
                  )),
                )}
                {model.hasTotalCol &&
                  model.measureLabels.map((m, mi) => (
                    <th key={`t${mi}`} className="is-measure is-total">
                      {m}
                    </th>
                  ))}
              </tr>
            )}
          </thead>
          <tbody>
            {visible.map((r) => renderRow(r))}
            {model.totalRow && renderRow(model.totalRow, true)}
          </tbody>
        </table>
      </div>
      {model.notes.length > 0 && <div className="vz-note">{model.notes.join(" ")}</div>}
    </div>
  );
}
