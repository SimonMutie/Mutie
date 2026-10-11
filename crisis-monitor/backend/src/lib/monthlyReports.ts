import { all, run, first, nowIso } from "../db";
import { ensureElectionWatchTables, type Watch } from "./electionWatch";
import type { Env } from "../bindings";

/**
 * Monthly reports, per country. The numbers are computed from the same watch
 * items the dashboard shows, grouped by calendar month (UTC). A report is an
 * editable record of sections: narrative sections the analysts write, and data
 * sections (figures, map, trend, categories) that draw on the month's series.
 * Publishing freezes the month's numbers into the record, so a published PDF
 * does not change when later reports are collected or recoded.
 */

export const REPORT_TABLE = "monthly_reports";

export type SectionKind = "narrative" | "figures" | "map" | "trend" | "categories";

export const THEMES = ["lens", "dusk", "sand"] as const;
export type ReportTheme = (typeof THEMES)[number];
export const FONTS = ["serif", "sans", "mono"] as const;
export const SIZES = ["s", "m", "l", "xl"] as const;
export const ALIGNS = ["left", "center", "right", "justify"] as const;

/** How one section's text is set. Stored with the section, so every reader and every export sees the same page. */
export interface SectionStyle {
  font?: (typeof FONTS)[number];
  size?: (typeof SIZES)[number];
  align?: (typeof ALIGNS)[number];
}

export interface ReportSection {
  id: string;
  kind: SectionKind;
  title: string;
  body?: string;
  /** True when the text was carried over from the previous month and not yet reviewed. */
  carried?: boolean;
  style?: SectionStyle;
}

export interface PeriodRow {
  period: string;
  reports: number;
  events: number;
  verified: number;
  fatalities: number;
  byCategory: Record<string, number>;
  byPlace: Record<string, number>;
}

export interface ReportRow {
  country: string;
  period: string;
  title: string;
  theme: ReportTheme;
  status: "draft" | "published";
  sections: ReportSection[];
  snapshot: PeriodRow | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  updated_by: string | null;
}

let ready: Promise<void> | null = null;
export function ensureReportTables(env: Env): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await run(
        env.DB,
        `CREATE TABLE IF NOT EXISTS ${REPORT_TABLE} (
          country TEXT NOT NULL, period TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
          sections TEXT NOT NULL, snapshot TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          published_at TEXT, updated_by TEXT, PRIMARY KEY (country, period))`,
      );
      // Added after the first release: SQLite has no ADD COLUMN IF NOT EXISTS, so a duplicate column error means it is already there.
      await run(env.DB, `ALTER TABLE ${REPORT_TABLE} ADD COLUMN theme TEXT NOT NULL DEFAULT 'lens'`).catch(() => {});
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** The month a timestamp falls in, as YYYY-MM (UTC). */
export const monthOf = (iso: string) => iso.slice(0, 7);

/** Last 24 months of events, grouped by calendar month. Each event is counted once, in the month of its first report. */
export async function seriesFor(env: Env, W: Watch): Promise<PeriodRow[]> {
  await ensureElectionWatchTables(env, W);
  const since = new Date(Date.now() - 24 * 31 * 86_400_000).toISOString();
  const rows = await all<{ published_at: string; category: string; county_code: string | null; fatalities: number | null; cluster_id: string; status: string }>(
    env.DB,
    `SELECT published_at, category, county_code, fatalities, cluster_id, status FROM ${W.t.items}
     WHERE published_at >= ? AND category != 'coverage' AND status != 'rejected' ORDER BY published_at ASC LIMIT 20000`,
    [since],
  );
  const periods = new Map<string, PeriodRow>();
  const get = (p: string) => {
    let r = periods.get(p);
    if (!r) periods.set(p, (r = { period: p, reports: 0, events: 0, verified: 0, fatalities: 0, byCategory: {}, byPlace: {} }));
    return r;
  };
  const clusters = new Map<string, { period: string; category: string; county: string | null; maxFat: number; verified: boolean }>();
  for (const r of rows) {
    const p = monthOf(r.published_at);
    get(p).reports++;
    let c = clusters.get(r.cluster_id);
    if (!c) clusters.set(r.cluster_id, (c = { period: p, category: r.category, county: r.county_code, maxFat: 0, verified: false }));
    c.maxFat = Math.max(c.maxFat, r.fatalities ?? 0);
    c.verified ||= r.status === "verified";
  }
  for (const c of clusters.values()) {
    const row = get(c.period);
    row.events++;
    if (c.verified) row.verified++;
    row.fatalities += c.maxFat;
    row.byCategory[c.category] = (row.byCategory[c.category] ?? 0) + 1;
    if (c.county) row.byPlace[c.county] = (row.byPlace[c.county] ?? 0) + 1;
  }
  return [...periods.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export const emptyPeriod = (period: string): PeriodRow => ({ period, reports: 0, events: 0, verified: 0, fatalities: 0, byCategory: {}, byPlace: {} });

/** The structure every new monthly report starts from. Narrative sections are blank for the analysts to write. */
export function defaultSections(): ReportSection[] {
  return [
    { id: "summary", kind: "narrative", title: "Summary", body: "" },
    { id: "figures", kind: "figures", title: "The month in figures" },
    { id: "map", kind: "map", title: "Where it happened" },
    { id: "trend", kind: "trend", title: "Twelve months in view" },
    { id: "categories", kind: "categories", title: "What kind of events" },
    { id: "analysis", kind: "narrative", title: "Analysis", body: "" },
    { id: "outlook", kind: "narrative", title: "Outlook for next month", body: "" },
    {
      id: "method",
      kind: "narrative",
      title: "Method and caveats",
      body:
        "Counts are of reports collected from the platform’s feeds and coded by written rules. Verified events have been checked by an analyst. The figures measure what is reported, not everything that happens, and they undercount, most of all in areas with little independent reporting.",
    },
  ];
}

export const monthName = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function toReport(row: Record<string, unknown>): ReportRow {
  return {
    country: String(row.country),
    period: String(row.period),
    title: String(row.title),
    theme: THEMES.includes(row.theme as ReportTheme) ? (row.theme as ReportTheme) : "lens",
    status: row.status === "published" ? "published" : "draft",
    sections: JSON.parse(String(row.sections)) as ReportSection[],
    snapshot: row.snapshot ? (JSON.parse(String(row.snapshot)) as PeriodRow) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    published_at: (row.published_at as string | null) ?? null,
    updated_by: (row.updated_by as string | null) ?? null,
  };
}

export async function getReport(env: Env, country: string, period: string): Promise<ReportRow | null> {
  await ensureReportTables(env);
  const row = await first<Record<string, unknown>>(env.DB, `SELECT * FROM ${REPORT_TABLE} WHERE country = ? AND period = ?`, [country, period]);
  return row ? toReport(row) : null;
}

export async function listReports(env: Env, country: string) {
  await ensureReportTables(env);
  const rows = await all<Record<string, unknown>>(env.DB, `SELECT * FROM ${REPORT_TABLE} WHERE country = ? ORDER BY period DESC LIMIT 60`, [country]);
  return rows.map(toReport).map((r) => ({ period: r.period, title: r.title, status: r.status, updated_at: r.updated_at, published_at: r.published_at }));
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
}

export async function saveReport(env: Env, country: string, period: string, data: { title: string; theme: ReportTheme; sections: ReportSection[] }, by: string | null) {
  const now = nowIso();
  await run(
    env.DB,
    `UPDATE ${REPORT_TABLE} SET title = ?, theme = ?, sections = ?, updated_at = ?, updated_by = ? WHERE country = ? AND period = ? AND status = 'draft'`,
    [data.title, data.theme, JSON.stringify(data.sections), now, by, country, period],
  );
}

export async function insertReport(env: Env, r: { country: string; period: string; title: string; sections: ReportSection[]; by: string | null }) {
  const now = nowIso();
  await run(
    env.DB,
    `INSERT INTO ${REPORT_TABLE} (country, period, title, status, sections, snapshot, created_at, updated_at, published_at, updated_by) VALUES (?, ?, ?, 'draft', ?, NULL, ?, ?, NULL, ?)`,
    [r.country, r.period, r.title, JSON.stringify(r.sections), now, now, r.by],
  );
}
