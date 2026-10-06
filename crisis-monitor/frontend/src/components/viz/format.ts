import type { Agg, FieldType, Grain, VizDim, VizMeasure, VizOptions } from "./types";

/** Labels, number formatting, scales and colour arithmetic shared by every visual. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const BLANK = "(blank)";

function dayLabel(s: string): string {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return m >= 1 && m <= 12 && d ? `${d} ${MONTHS[m - 1]} ${y}` : s;
}

/** A dimension's value as people read it: "2026-09" grouped by month is "Sep 2026". */
export function dimLabel(value: string | number | null | undefined, dim?: VizDim, type?: FieldType): string {
  if (value === null || value === undefined || value === "") return BLANK;
  const s = String(value);
  if (dim?.grain === "year") return s;
  if (dim?.grain === "quarter") return `${s.slice(5)} ${s.slice(0, 4)}`;
  if (dim?.grain === "month") return `${MONTHS[Number(s.slice(5, 7)) - 1] ?? s.slice(5, 7)} ${s.slice(0, 4)}`;
  if (dim?.grain === "week") return `Week of ${dayLabel(s)}`;
  if (dim?.grain === "day") return dayLabel(s);
  if (dim?.bin !== undefined) {
    const lo = Number(value);
    return `${plain(lo)} to ${plain(lo + dim.bin)}`;
  }
  if (type === "date" && /^\d{4}-\d{2}-\d{2}/.test(s)) return dayLabel(s);
  return s;
}

/** The same, short enough for an axis tick. */
export function dimTick(value: string | number | null | undefined, dim?: VizDim, type?: FieldType): string {
  if (value === null || value === undefined || value === "") return BLANK;
  const s = String(value);
  if (dim?.grain === "quarter") return `${s.slice(5)} ’${s.slice(2, 4)}`;
  if (dim?.grain === "month") return `${MONTHS[Number(s.slice(5, 7)) - 1] ?? ""} ’${s.slice(2, 4)}`;
  if (dim?.grain === "week" || dim?.grain === "day" || (type === "date" && !dim?.grain && /^\d{4}-\d{2}-\d{2}/.test(s))) {
    const [, m, d] = s.slice(0, 10).split("-").map(Number);
    return `${d} ${MONTHS[m - 1] ?? ""}`;
  }
  if (dim?.bin !== undefined) return plain(Number(value));
  return s;
}

const plain = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

const compactFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** A figure, in full. Averages keep a decimal; whole numbers never show one. */
export function fmt(n: number | null | undefined, agg?: Agg, options?: VizOptions): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  void agg;
  const decimals = options?.decimals ?? (Number.isInteger(n) ? 0 : Math.abs(n) < 10 ? 2 : Math.abs(n) < 1000 ? 1 : 0);
  return `${options?.prefix ?? ""}${n.toLocaleString(undefined, { minimumFractionDigits: options?.decimals ?? 0, maximumFractionDigits: decimals })}${options?.suffix ?? ""}`;
}

/** A figure short enough for an axis or a tight label: 12,400 is "12.4K". */
export function fmtCompact(n: number | null | undefined, options?: VizOptions): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const body = Math.abs(n) >= 10_000 ? compactFmt.format(n) : Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 });
  return `${options?.prefix ?? ""}${body}${options?.suffix ?? ""}`;
}

export const fmtMeasure = (n: number | null | undefined, m: VizMeasure | undefined, options?: VizOptions) => fmt(n, m?.agg, options);
export const pct = (share: number, digits = 0) => `${(share * 100).toLocaleString(undefined, { maximumFractionDigits: digits })}%`;

/** A percent change between two figures, or null when there is nothing to compare with. */
export function change(now: number | null | undefined, before: number | null | undefined): number | null {
  if (now == null || before == null || before === 0) return null;
  return (now - before) / Math.abs(before);
}

// ── Scales ───────────────────────────────────────────────────────────────

/** Round tick values covering [min, max], and the range they span. */
export function niceScale(min: number, max: number, count = 5): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) {
    if (max === 0) max = 1;
    else if (max > 0) min = 0;
    else max = 0;
  }
  const span = max - min;
  const raw = span / Math.max(count, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { min: lo, max: hi, ticks };
}

/** Every period between two labels of one grain, so a quiet month shows as a gap in the line and not a missing point. */
export function periodsBetween(first: string, last: string, grain: Grain, cap = 800): string[] | null {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  if (grain === "year") {
    for (let y = Number(first); y <= Number(last) && out.length < cap; y++) out.push(String(y));
    return out.length ? out : null;
  }
  if (grain === "quarter" || grain === "month") {
    const per = grain === "quarter" ? 4 : 12;
    const index = (s: string) => Number(s.slice(0, 4)) * per + (grain === "quarter" ? Number(s.slice(6, 7)) : Number(s.slice(5, 7))) - 1;
    const a = index(first);
    const b = index(last);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    for (let i = a; i <= b && out.length < cap; i++) {
      const y = Math.floor(i / per);
      const p = (i % per) + 1;
      out.push(grain === "quarter" ? `${y}-Q${p}` : `${y}-${pad(p)}`);
    }
    return out;
  }
  const step = grain === "week" ? 7 : 1;
  const a = Date.parse(`${first.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${last.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  for (let t = a; t <= b && out.length < cap; t += step * 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ── Colour ───────────────────────────────────────────────────────────────

export function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` blended towards `b` by t (0 is all a, 1 is all b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const k = Math.min(Math.max(t, 0), 1);
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i] - v) * k)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads better on this fill. */
export const inkOn = (fill: string) => (luminance(fill) > 0.36 ? "#10151d" : "#ffffff");

/** Text cut to fit a width, by rough character count (SVG text does not wrap or clip itself). */
export function clip(text: string, width: number, fontSize = 11): string {
  const max = Math.max(Math.floor(width / (fontSize * 0.56)), 1);
  return text.length <= max ? text : max <= 2 ? text.slice(0, max) : `${text.slice(0, max - 1).trimEnd()}…`;
}
