import { dimLabel, dimTick, periodsBetween } from "./format";
import { seriesColor, type DashTheme } from "./themes";
import { fieldInfo, isAdditive, measureLabel, valuesOf, type FieldType, type VizDim, type VizMeasure, type VizResult, type VizSpec } from "./types";

/**
 * Turns the engine's answer (one row per group) into what a chart draws:
 * categories along an axis with one or more series, or the parts of a whole.
 * The rules that keep a chart readable live here — largest first, the long
 * tail folded into "Other" where adding it up is honest, quiet periods shown
 * as zero rather than skipped.
 */

export interface Cat {
  key: string;
  label: string;
  /** A shorter label for an axis tick. */
  tick: string;
  raw: string | number | null;
  /** The folded tail; it cannot be clicked to filter. */
  other?: boolean;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  measure: VizMeasure;
  values: (number | null)[];
  other?: boolean;
}

export interface Matrix {
  cats: Cat[];
  series: Series[];
  /** The axis has a natural order (time, or a number). */
  ordered: boolean;
  catDim: VizDim;
  catType: FieldType;
  splitDim?: VizDim;
  /** What was left out or folded, in words; null when nothing was. */
  note: string | null;
}

const keyOf = (v: string | number | null) => (v === null || v === "" ? "\u0000" : String(v));
const OTHER = "\u0001other";
const DEFAULT_MAX_SERIES = 7;

export function shapeMatrix(viz: VizSpec, result: VizResult, theme: DashTheme, defaults: { topN: number; maxSeries?: number }): Matrix {
  const MAX_SERIES = defaults.maxSeries ?? DEFAULT_MAX_SERIES;
  const measures = valuesOf(viz);
  const catDim: VizDim = viz.kind === "histogram" ? { field: viz.rows[0].field, bin: viz.rows[0].bin ?? 1 } : viz.rows[0];
  const catType = fieldInfo(viz, catDim.field).type;
  const splitDim = viz.kind === "histogram" ? undefined : viz.columns[0];
  const splitType = splitDim ? fieldInfo(viz, splitDim.field).type : "text";
  const ordered = !!catDim.grain || catDim.bin !== undefined || catType === "date" || catType === "number";
  const notes: string[] = [];

  // 1. Collect: category → series → value.
  const cats = new Map<string, { raw: string | number | null; total: number; cells: Map<string, number | null> }>();
  const seriesInfo = new Map<string, { raw: string | number | null; total: number; measure: VizMeasure; label: string }>();
  if (!splitDim) measures.forEach((m, i) => seriesInfo.set(`m${i}`, { raw: null, total: 0, measure: m, label: measureLabel(viz, m) }));
  for (const row of result.rows) {
    const ck = keyOf(row.d[0] ?? null);
    let cat = cats.get(ck);
    if (!cat) cats.set(ck, (cat = { raw: row.d[0] ?? null, total: 0, cells: new Map() }));
    if (splitDim) {
      const sk = keyOf(row.d[1] ?? null);
      const v = row.m[0] ?? null;
      let s = seriesInfo.get(sk);
      if (!s) seriesInfo.set(sk, (s = { raw: row.d[1] ?? null, total: 0, measure: measures[0], label: dimLabel(row.d[1] ?? null, splitDim, splitType) }));
      cat.cells.set(sk, v);
      cat.total += Math.abs(v ?? 0);
      s.total += Math.abs(v ?? 0);
    } else {
      measures.forEach((_, i) => {
        const v = row.m[i] ?? null;
        cat!.cells.set(`m${i}`, v);
        if (i === 0) cat!.total += Math.abs(v ?? 0);
        seriesInfo.get(`m${i}`)!.total += Math.abs(v ?? 0);
      });
    }
  }

  // 2. Order the categories.
  let catKeys = [...cats.keys()];
  const numeric = catDim.bin !== undefined || (catType === "number" && !catDim.grain);
  if (ordered) {
    catKeys.sort((a, b) => {
      if (a === "\u0000") return 1;
      if (b === "\u0000") return -1;
      return numeric ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0;
    });
    // Every period in between, so a month with nothing in it is drawn as nothing rather than skipped over.
    const real = catKeys.filter((k) => k !== "\u0000");
    if (catDim.grain && real.length >= 2) {
      const all = periodsBetween(real[0], real[real.length - 1], catDim.grain);
      if (all && all.length >= real.length) {
        for (const k of all) if (!cats.has(k)) cats.set(k, { raw: k, total: 0, cells: new Map() });
        catKeys = [...all, ...(cats.has("\u0000") ? ["\u0000"] : [])];
      }
    }
    // Likewise every bin of a histogram, so an empty stretch reads as empty.
    if (catDim.bin !== undefined && real.length >= 2) {
      const w = catDim.bin;
      const lo = Math.round(Number(real[0]) / w);
      const hi = Math.round(Number(real[real.length - 1]) / w);
      if (hi - lo < 400) {
        const all: string[] = [];
        for (let k = lo; k <= hi; k++) {
          const key = String(k * w);
          all.push(key);
          if (!cats.has(key)) cats.set(key, { raw: k * w, total: 0, cells: new Map() });
        }
        if (real.every((k) => all.includes(k))) catKeys = [...all, ...(cats.has("\u0000") ? ["\u0000"] : [])];
      }
    }
    if (catKeys.length > 600) {
      notes.push(`Showing the latest 600 of ${catKeys.length.toLocaleString()} points. Group by a longer period to see them all.`);
      catKeys = catKeys.slice(-600);
    }
  } else {
    catKeys.sort((a, b) => cats.get(b)!.total - cats.get(a)!.total || (a < b ? -1 : 1));
  }

  // 3. Keep the largest series; fold the rest.
  let seriesKeys = [...seriesInfo.keys()];
  const additive = isAdditive(measures[0]);
  let foldedSeries: string[] = [];
  if (splitDim) {
    seriesKeys.sort((a, b) => seriesInfo.get(b)!.total - seriesInfo.get(a)!.total);
    if (seriesKeys.length > MAX_SERIES + 1) {
      foldedSeries = seriesKeys.slice(MAX_SERIES);
      seriesKeys = seriesKeys.slice(0, MAX_SERIES);
      notes.push(
        additive ? `The ${MAX_SERIES} largest are shown; ${foldedSeries.length} more are added together as “Other”.` : `The ${MAX_SERIES} largest of ${MAX_SERIES + foldedSeries.length} are shown.`,
      );
    }
  }

  // 4. Keep the largest categories; fold the rest.
  const topN = viz.options?.topN ?? defaults.topN;
  let foldedCats: string[] = [];
  if (!ordered && topN > 0 && catKeys.length > topN + 1) {
    foldedCats = catKeys.slice(topN);
    catKeys = catKeys.slice(0, topN);
    const canFold = additive && (!!splitDim || measures.every(isAdditive));
    notes.push(
      canFold
        ? `The ${topN} largest are shown; ${foldedCats.length.toLocaleString()} more are added together as “Other”.`
        : `The ${topN} largest of ${(topN + foldedCats.length).toLocaleString()} are shown.`,
    );
    if (!canFold) foldedCats = [];
  }
  if (result.truncated) notes.push("There are more groups than one visual can hold; the smallest were left out.");

  // 5. Build.
  // A group with no rows counts as zero for a count or a sum; an average of nothing is not zero.
  const emptyValue = (m: VizMeasure) => (m.agg === "count" || m.agg === "sum" || m.agg === "distinct" ? 0 : null);
  const cellOf = (ck: string, sk: string, m: VizMeasure): number | null => {
    const cell = cats.get(ck)?.cells.get(sk);
    return cell === undefined ? emptyValue(m) : cell;
  };
  const sumOver = (cks: string[], sks: string[], m: VizMeasure): number | null => {
    let total = 0;
    for (const ck of cks) for (const sk of sks) total += cellOf(ck, sk, m) ?? 0;
    return total;
  };
  const outCats: Cat[] = catKeys.map((k) => {
    const raw = cats.get(k)!.raw;
    return { key: k, raw, label: dimLabel(raw, catDim, catType), tick: dimTick(raw, catDim, catType) };
  });
  if (foldedCats.length) outCats.push({ key: OTHER, raw: null, label: "Other", tick: "Other", other: true });

  const outSeries: Series[] = seriesKeys.map((sk, i) => {
    const info = seriesInfo.get(sk)!;
    const values = catKeys.map((ck) => cellOf(ck, sk, info.measure));
    if (foldedCats.length) values.push(sumOver(foldedCats, [sk], info.measure));
    return { key: sk, label: info.label, color: seriesColor(theme, i), measure: info.measure, values };
  });
  if (foldedSeries.length && additive) {
    const values = catKeys.map((ck) => sumOver([ck], foldedSeries, measures[0]));
    if (foldedCats.length) values.push(sumOver(foldedCats, foldedSeries, measures[0]));
    outSeries.push({ key: OTHER, label: "Other", color: theme.neutral, measure: measures[0], values, other: true });
  }

  return { cats: outCats, series: outSeries, ordered, catDim, catType, splitDim, note: notes.length ? notes.join(" ") : null };
}

// ── Parts of a whole ─────────────────────────────────────────────────────

export interface Part {
  key: string;
  label: string;
  raw: string | number | null;
  value: number;
  /** This part's fraction of the total shown. */
  share: number;
  color: string;
  other?: boolean;
}

export interface Parts {
  parts: Part[];
  total: number;
  dim: VizDim;
  type: FieldType;
  measure: VizMeasure;
  note: string | null;
}

/** The first dimension's groups as parts, largest first, at most `max` of them (the last being "Other"). */
export function shapeParts(viz: VizSpec, result: VizResult, theme: DashTheme, max: number, opts: { keepOrder?: boolean; allowNegative?: boolean } = {}): Parts {
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const notes: string[] = [];
  const ordered = !!dim.grain || dim.bin !== undefined || type === "date";
  let rows = result.rows.map((r) => ({ raw: r.d[0] ?? null, value: r.m[0] ?? 0 }));
  if (!opts.allowNegative) {
    const before = rows.length;
    rows = rows.filter((r) => r.value > 0);
    if (rows.length < before) notes.push(`${before - rows.length} with nothing or less than nothing ${before - rows.length === 1 ? "is" : "are"} not shown.`);
  }
  if (opts.keepOrder && ordered) rows.sort((a, b) => (keyOf(a.raw) < keyOf(b.raw) ? -1 : 1));
  else rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  let tail: typeof rows = [];
  if (rows.length > max) {
    tail = opts.keepOrder && ordered ? rows.slice(0, rows.length - max) : rows.slice(max - 1);
    rows = opts.keepOrder && ordered ? rows.slice(-max) : rows.slice(0, max - 1);
    if (opts.keepOrder && ordered) {
      notes.push(`The latest ${max} of ${(max + tail.length).toLocaleString()} are shown.`);
      tail = [];
    } else if (isAdditive(measure)) notes.push(`The ${max - 1} largest are shown; ${tail.length.toLocaleString()} more are added together as “Other”.`);
    else {
      notes.push(`The ${max - 1} largest of ${(max - 1 + tail.length).toLocaleString()} are shown.`);
      tail = [];
    }
  }
  if (!isAdditive(measure) && !opts.allowNegative) notes.push("These figures are not counts or sums, so the shares are a comparison of size rather than parts of one total.");
  const parts: Part[] = rows.map((r, i) => ({ key: keyOf(r.raw), raw: r.raw, label: dimLabel(r.raw, dim, type), value: r.value, share: 0, color: seriesColor(theme, i) }));
  if (tail.length) parts.push({ key: OTHER, raw: null, label: "Other", value: tail.reduce((s, r) => s + r.value, 0), share: 0, color: theme.neutral, other: true });
  const total = parts.reduce((s, p) => s + p.value, 0);
  for (const p of parts) p.share = total ? p.value / total : 0;
  return { parts, total, dim, type, measure, note: notes.length ? notes.join(" ") : null };
}

// ── Two points compared, item by item ────────────────────────────────────

export interface Pair {
  /** The two things compared: the first and last of an ordered field, or the two largest of an unordered one. */
  from: string;
  to: string;
  rows: { key: string; raw: string | number | null; label: string; a: number | null; b: number | null }[];
  note: string | null;
}

/** For the dumbbell and the butterfly: each value of the first field, with its figure under each of two values of the second. */
export function shapePair(viz: VizSpec, result: VizResult, max: number, opts: { keepOrder?: boolean } = {}): Pair | null {
  const measure = valuesOf(viz)[0];
  const dim = viz.rows[0];
  const type = fieldInfo(viz, dim.field).type;
  const colDim = viz.columns[0];
  const colType = fieldInfo(viz, colDim.field).type;
  const totals = new Map<string, { raw: string | number | null; total: number }>();
  for (const r of result.rows) {
    if (r.d[1] == null) continue;
    const k = keyOf(r.d[1]);
    const c = totals.get(k) ?? { raw: r.d[1], total: 0 };
    c.total += Math.abs(r.m[0] ?? 0);
    totals.set(k, c);
  }
  const ordered = !!colDim.grain || colType === "date" || colType === "number";
  const keys = [...totals.keys()].sort((a, b) => (ordered ? (colType === "number" && !colDim.grain ? Number(a) - Number(b) : a < b ? -1 : 1) : totals.get(b)!.total - totals.get(a)!.total));
  if (keys.length < 2) return null;
  const [from, to] = ordered ? [keys[0], keys[keys.length - 1]] : [keys[0], keys[1]];
  const empty = measure.agg === "count" || measure.agg === "sum" || measure.agg === "distinct" ? 0 : null;
  const lines = new Map<string, { raw: string | number | null; a: number | null; b: number | null }>();
  for (const r of result.rows) {
    const ck = keyOf(r.d[1] ?? null);
    if (ck !== from && ck !== to) continue;
    const k = keyOf(r.d[0] ?? null);
    const line = lines.get(k) ?? { raw: r.d[0] ?? null, a: empty, b: empty };
    if (ck === from) line.a = r.m[0];
    else line.b = r.m[0];
    lines.set(k, line);
  }
  let rows = [...lines.entries()].map(([key, l]) => ({ key, raw: l.raw, label: dimLabel(l.raw, dim, type), a: l.a, b: l.b }));
  const rowOrdered = !!dim.grain || dim.bin !== undefined || type === "date" || type === "number";
  if (opts.keepOrder && rowOrdered) rows.sort((x, y) => (dim.bin !== undefined || type === "number" ? Number(x.key) - Number(y.key) : x.key < y.key ? -1 : 1));
  else rows.sort((x, y) => Math.max(y.a ?? 0, y.b ?? 0) - Math.max(x.a ?? 0, x.b ?? 0));
  const all = rows.length;
  rows = rows.slice(0, max);
  const notes = [
    all > max ? `The ${max} largest of ${all} are shown.` : "",
    keys.length > 2 ? (ordered ? `Compares the first and the last of ${keys.length} values of the second field.` : "Compares the two largest values of the second field.") : "",
  ];
  return { from: dimLabel(totals.get(from)!.raw, colDim, colType), to: dimLabel(totals.get(to)!.raw, colDim, colType), rows, note: notes.filter(Boolean).join(" ") || null };
}

// ── Flows and ties ───────────────────────────────────────────────────────

export interface FlowNode {
  key: string;
  raw: string | number | null;
  label: string;
  /** Which stage (field) the node belongs to. */
  stage: number;
  value: number;
  color: string;
  other?: boolean;
}
export interface FlowLink {
  source: string;
  target: string;
  value: number;
}
export interface Flows {
  nodes: FlowNode[];
  links: FlowLink[];
  stages: number;
  note: string | null;
}

/**
 * The answer's rows as stages of nodes with links between neighbouring
 * stages. Each stage keeps its largest `perStage` nodes; the rest are joined
 * as "Other" (the flows through them are still drawn, so totals hold).
 */
export function shapeFlows(viz: VizSpec, result: VizResult, theme: DashTheme, perStage: number): Flows {
  const dims = [...viz.rows, ...viz.columns];
  const stages = Math.min(dims.length, result.rows[0]?.d.length ?? dims.length);
  const totals = dims.map(() => new Map<string, { raw: string | number | null; value: number }>());
  for (const r of result.rows) {
    const v = r.m[0] ?? 0;
    if (v <= 0) continue;
    for (let s = 0; s < stages; s++) {
      const k = keyOf(r.d[s] ?? null);
      const t = totals[s].get(k) ?? { raw: r.d[s] ?? null, value: 0 };
      t.value += v;
      totals[s].set(k, t);
    }
  }
  const kept = totals.map(
    (m) =>
      new Set(
        [...m.entries()]
          .sort((a, b) => b[1].value - a[1].value)
          .slice(0, perStage)
          .map(([k]) => k),
      ),
  );
  const folded = totals.some((m, s) => m.size > kept[s].size);
  const nodes = new Map<string, FlowNode>();
  const links = new Map<string, FlowLink>();
  const id = (s: number, k: string) => `${s}\u0002${kept[s].has(k) ? k : OTHER}`;
  for (const r of result.rows) {
    const v = r.m[0] ?? 0;
    if (v <= 0) continue;
    for (let s = 0; s < stages; s++) {
      const k = keyOf(r.d[s] ?? null);
      const nodeId = id(s, k);
      const isOther = !kept[s].has(k);
      const node = nodes.get(nodeId) ?? {
        key: nodeId,
        raw: isOther ? null : (r.d[s] ?? null),
        label: isOther ? "Other" : dimLabel(r.d[s] ?? null, dims[s], fieldInfo(viz, dims[s].field).type),
        stage: s,
        value: 0,
        color: theme.neutral,
        other: isOther || undefined,
      };
      node.value += v;
      nodes.set(nodeId, node);
      if (s < stages - 1) {
        const target = id(s + 1, keyOf(r.d[s + 1] ?? null));
        const linkId = `${nodeId}\u0003${target}`;
        const link = links.get(linkId) ?? { source: nodeId, target, value: 0 };
        link.value += v;
        links.set(linkId, link);
      }
    }
  }
  const list = [...nodes.values()].sort((a, b) => a.stage - b.stage || Number(!!a.other) - Number(!!b.other) || b.value - a.value);
  // Colour belongs to the first stage: a flow keeps the colour of where it started.
  let c = 0;
  for (const n of list) if (n.stage === 0 && !n.other) n.color = seriesColor(theme, c++);
  return { nodes: list, links: [...links.values()], stages, note: folded ? `Each side shows its ${perStage} largest; the rest are joined as “Other”.` : null };
}
