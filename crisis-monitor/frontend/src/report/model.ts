/**
 * The commercial due-diligence report as data. The editor, the Word export
 * and the PDF export all read this one structure, so what is on screen is
 * what is delivered.
 */

export type Tone = "good" | "watch" | "high" | "bad" | "none";

export type CellKind = "text" | "num" | "pct" | "choice" | "auto";

export interface Col {
  h: string;
  /** Relative width. */
  w: number;
  kind?: CellKind;
  /** For "choice" cells. */
  options?: string[];
  /** Show the value as plain text rather than colour-coded (for example a confidence level). */
  neutral?: boolean;
}

/** A calculated cell: one value column per rule, same formula applied to each value column unless `only` is given. */
export interface CalcRule {
  row: number;
  /** Arithmetic over cells of the same column, e.g. "r0 - r1 + r2", or "r0 / r0@-1 - 1" for the previous column. */
  expr: string;
  fmt: "num" | "pct";
  /** Restrict to these value-column indexes (1-based column numbers). */
  only?: number[];
}

export type Block =
  | { t: "h"; id: string; text: string }
  | { t: "para"; id: string; label?: string; text: string; hint?: string }
  | { t: "bullets"; id: string; label?: string; items: string[]; hint?: string; ordered?: boolean }
  | { t: "kv"; id: string; head: [string, string]; rows: [string, string][] }
  | { t: "table"; id: string; cols: Col[]; rows: string[][]; calc?: CalcRule[]; blank?: string[]; canAdd?: boolean; boldLast?: boolean; note?: string }
  | { t: "checks"; id: string; items: { label: string; on: boolean }[]; note?: string }
  | { t: "choice"; id: string; label: string; options: string[]; value: string | null; note?: string }
  | { t: "callout"; id: string; title: string; text: string; tone?: Tone };

export interface Section {
  id: string;
  no: string;
  title: string;
  /** Where the content came from. "screening" sections are pre-filled from the public-source run. */
  origin: "screening" | "partly" | "analyst";
  intro?: string;
  blocks: Block[];
}

export interface ReportMeta {
  target: string;
  transaction: string;
  preparedFor: string;
  preparedBy: string;
  date: string;
  versionLabel: string;
  confidentiality: string;
  currency: string;
  /** What kind of decision the report supports (shown on the cover). */
  purpose: string;
}

export interface Report {
  version: 1;
  caseId: string;
  meta: ReportMeta;
  sections: Section[];
}

// ── Tones for words that appear in cells ────────────────────────────────

const TONES: Record<string, Tone> = {
  green: "good", low: "good", positive: "good", received: "good", yes: "none", recommended: "good", "no match": "good", clear: "good",
  amber: "watch", medium: "watch", moderate: "watch", neutral: "watch", partial: "watch", mixed: "watch", possible: "watch",
  orange: "high", high: "high",
  red: "bad", critical: "bad", negative: "bad", outstanding: "bad", strong: "bad",
};
export function toneOf(v: string): Tone {
  const k = v.trim().toLowerCase().replace(/^[●○•]\s*/, "");
  if (TONES[k]) return TONES[k];
  for (const [w, t] of Object.entries(TONES)) if (k.startsWith(w + " ") || k.startsWith(w + "/")) return t;
  return "none";
}

export const RAG = ["Green", "Amber", "Red", "Not assessed"];
export const RISK = ["Low", "Medium", "High", "Critical", "Not assessed"];
export const LMH = ["Low", "Medium", "High"];
export const SENTIMENT = ["Positive", "Neutral", "Negative", "Mixed", "Not rated"];
export const STATUS_IN = ["Received", "Partial", "Outstanding"];

// ── Calculations ─────────────────────────────────────────────────────────

export function parseNum(s: string | undefined): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t || /^[-–—]$/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  const n = Number(t.replace(/[(),\s$€£%]|^-|^[A-Za-z]{3}\s/g, "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

export function fmtNum(n: number): string {
  const r = Math.round(n);
  const s = Math.abs(r).toLocaleString("en-US");
  return r < 0 ? `(${s})` : s;
}
export const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Evaluates "r0 - r1 / r2@-1" against the table; null when any input is missing or the result is not finite. */
export function evalExpr(expr: string, rows: string[][], col: number, computed: Map<string, number | null>): number | null {
  const tokens = expr.match(/r\d+(?:@-?\d+)?|\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  let pos = 0;
  let bad = false;
  const ref = (t: string): number | null => {
    const m = /^r(\d+)(?:@(-?\d+))?$/.exec(t)!;
    const r = Number(m[1]);
    const c = col + Number(m[2] ?? 0);
    if (c < 1 || r >= rows.length) return null;
    const key = `${r}:${c}`;
    if (computed.has(key)) return computed.get(key)!;
    return parseNum(rows[r]?.[c]);
  };
  const atom = (): number => {
    const t = tokens[pos++];
    if (t === undefined) return (bad = true), 0;
    if (t === "(") {
      const v = sum();
      pos++;
      return v;
    }
    if (t === "-") return -atom();
    if (/^r/.test(t)) {
      const v = ref(t);
      if (v == null) bad = true;
      return v ?? 0;
    }
    return Number(t);
  };
  const prod = (): number => {
    let v = atom();
    while (tokens[pos] === "*" || tokens[pos] === "/") {
      const op = tokens[pos++];
      const r = atom();
      v = op === "*" ? v * r : r === 0 ? ((bad = true), 0) : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = prod();
    while (tokens[pos] === "+" || tokens[pos] === "-") {
      const op = tokens[pos++];
      const r = prod();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const out = sum();
  return bad || !Number.isFinite(out) ? null : out;
}

/** The table's rows with every calculated cell filled in (the stored rows are never changed). */
export function withCalc(b: Extract<Block, { t: "table" }>): string[][] {
  if (!b.calc?.length) return b.rows;
  const rows = b.rows.map((r) => [...r]);
  const computed = new Map<string, number | null>();
  for (const rule of b.calc) {
    for (let c = 1; c < b.cols.length; c++) {
      if (rule.only && !rule.only.includes(c)) continue;
      const v = evalExpr(rule.expr, rows, c, computed);
      computed.set(`${rule.row}:${c}`, v);
      rows[rule.row][c] = v == null ? "" : rule.fmt === "pct" ? fmtPct(v) : fmtNum(v);
    }
  }
  return rows;
}

const LV = { low: 1, medium: 2, high: 3 } as const;
/** Likelihood x impact on a 3x3 scale. */
export function riskRating(likelihood: string, impact: string): string {
  const l = LV[likelihood.trim().toLowerCase() as keyof typeof LV];
  const i = LV[impact.trim().toLowerCase() as keyof typeof LV];
  if (!l || !i) return "Not assessed";
  const s = l * i;
  return s >= 9 ? "Critical" : s >= 6 ? "High" : s >= 3 ? "Medium" : "Low";
}

/** The risk-matrix table's rows with the rating column worked out from likelihood and impact. */
export function riskRows(b: Extract<Block, { t: "table" }>): string[][] {
  const iL = b.cols.findIndex((c) => /likelihood/i.test(c.h));
  const iI = b.cols.findIndex((c) => /impact/i.test(c.h));
  const iR = b.cols.findIndex((c) => /rating/i.test(c.h));
  if (iL < 0 || iI < 0 || iR < 0) return b.rows;
  return b.rows.map((r) => {
    const x = [...r];
    x[iR] = riskRating(r[iL] ?? "", r[iI] ?? "");
    return x;
  });
}

export const isCalcRow = (b: Extract<Block, { t: "table" }>, r: number) => !!b.calc?.some((x) => x.row === r);

/** What a table shows (and exports): calculated cells filled in, then risk ratings worked out. */
export function shownRows(b: Extract<Block, { t: "table" }>): string[][] {
  const calc = withCalc(b).map((r, ri) =>
    r.map((v, ci) => (b.cols[ci]?.kind === "num" && !isCalcRow(b, ri) ? fmtTyped(v) : v))
  );
  if (!b.cols.some((c) => c.kind === "auto")) return calc;
  return riskRows({ ...b, rows: calc });
}

/** A typed amount with thousands separators; anything that is not plainly a number is left as written. */
export function fmtTyped(v: string): string {
  const t = (v ?? "").trim();
  if (!/^-?\(?\d[\d,]*(\.\d+)?\)?$/.test(t)) return v;
  const n = parseNum(t);
  if (n == null) return v;
  const dec = /\.\d+/.test(t) ? Math.min(2, t.split(".")[1].replace(/\D/g, "").length) : 0;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return n < 0 ? `(${s})` : s;
}

export const EMPTY = "Not provided";
export const isEmpty = (s: string | undefined | null) => !s || !s.trim();
