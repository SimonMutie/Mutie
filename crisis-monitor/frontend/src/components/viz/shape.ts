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
const MAX_SERIES = 7;

export function shapeMatrix(viz: VizSpec, result: VizResult, theme: DashTheme, defaults: { topN: number }): Matrix {
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
