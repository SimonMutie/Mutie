import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, type AuthedVariables } from "../middleware";
import { canViewSpotlight } from "./spotlight";
import { KE_WATCH, type Watch } from "../lib/electionWatch";
import { SS_WATCH } from "../lib/southSudanWatch";
import {
  defaultSections,
  emptyPeriod,
  getReport,
  insertReport,
  listReports,
  monthName,
  nextPeriod,
  saveReport,
  seriesFor,
  ensureReportTables,
  REPORT_TABLE,
  THEMES,
  FONTS,
  SIZES,
  ALIGNS,
  type ReportSection,
} from "../lib/monthlyReports";
import { run, nowIso } from "../db";
import type { Env } from "../bindings";

/**
 * Monthly reports for one country. Anyone Regional Spotlight is shared with
 * can read the series and published reports. Only admins can start, edit,
 * publish or reopen a report.
 */

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const SECTION_KINDS = ["narrative", "figures", "map", "trend", "categories"] as const;
const SaveBody = z.object({
  title: z.string().min(1).max(200),
  theme: z.enum(THEMES).optional(),
  sections: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        kind: z.enum(SECTION_KINDS),
        title: z.string().min(1).max(200),
        body: z.string().max(20_000).optional(),
        carried: z.boolean().optional(),
        style: z
          .object({ font: z.enum(FONTS).optional(), size: z.enum(SIZES).optional(), align: z.enum(ALIGNS).optional() })
          .optional(),
      }),
    )
    .min(1)
    .max(40),
});

export function reportRouter(W: Watch) {
  const r = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
  r.use("*", requireAuth);
  r.use("*", async (c, next) => {
    if (!(await canViewSpotlight(c.env, c.get("userId"), c.get("role")))) {
      return c.json({ error: "Regional Spotlight hasn't been shared with your organisation. Ask your Afrilens contact." }, 403);
    }
    await ensureReportTables(c.env);
    await next();
  });
  const isAdmin = (role: string) => role === "admin";
  const country = W.key;

  r.get("/series", async (c) => {
    const rows = await seriesFor(c.env, W);
    return c.json({ updated_at: nowIso(), periods: rows });
  });

  r.get("/", async (c) => {
    const all = await listReports(c.env, country);
    return c.json(isAdmin(c.get("role")) ? all : all.filter((x) => x.status === "published"));
  });

  r.get("/:period", async (c) => {
    const period = c.req.param("period");
    if (!PERIOD.test(period)) return c.json({ error: "Period must be YYYY-MM" }, 400);
    const report = await getReport(c.env, country, period);
    const canEdit = isAdmin(c.get("role"));
    // Viewers see only published reports; drafts are for the analysts.
    if (report && report.status !== "published" && !canEdit) return c.json({ report: null, title: monthName(period) });
    return c.json({ report, title: monthName(period), can_edit: canEdit });
  });

  r.post("/:period/start", async (c) => {
    if (!isAdmin(c.get("role"))) return c.json({ error: "Admin access required" }, 403);
    const period = c.req.param("period");
    if (!PERIOD.test(period)) return c.json({ error: "Period must be YYYY-MM" }, 400);
    if (await getReport(c.env, country, period)) return c.json({ error: "A report for this month already exists" }, 409);

    // Carry the narrative text forward from the most recent earlier report, marked for review.
    const earlier = (await listReports(c.env, country)).find((x) => x.period < period);
    let sections: ReportSection[] = defaultSections();
    if (earlier) {
      const prev = await getReport(c.env, country, earlier.period);
      if (prev) {
        sections = prev.sections.map((s) => (s.kind === "narrative" && s.id !== "method" ? { ...s, body: s.body ?? "", carried: true } : s));
      }
    }
    await insertReport(c.env, { country, period, title: `${monthName(period)} · ${W.key === "ke" ? "Kenya" : "South Sudan"} election and conflict watch`, sections, by: c.get("userId") ?? null });
    return c.json({ ok: true, period, next: nextPeriod(period) });
  });

  r.put("/:period", async (c) => {
    if (!isAdmin(c.get("role"))) return c.json({ error: "Admin access required" }, 403);
    const period = c.req.param("period");
    if (!PERIOD.test(period)) return c.json({ error: "Period must be YYYY-MM" }, 400);
    const parsed = SaveBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid report", issues: parsed.error.issues.slice(0, 5) }, 400);
    const existing = await getReport(c.env, country, period);
    if (!existing) return c.json({ error: "No report for this month yet" }, 404);
    if (existing.status === "published") return c.json({ error: "This report is published. Reopen it to make changes." }, 409);
    // Section ids must be unique, so the page can address each one.
    if (new Set(parsed.data.sections.map((s) => s.id)).size !== parsed.data.sections.length) return c.json({ error: "Section ids must be unique" }, 400);
    await saveReport(c.env, country, period, { title: parsed.data.title, theme: parsed.data.theme ?? existing.theme, sections: parsed.data.sections.map((s) => ({ ...s, body: s.body ?? "" })) }, c.get("userId") ?? null);
    return c.json({ ok: true });
  });

  // Publishing freezes the month's numbers into the record. Later collection or recoding does not change them.
  r.post("/:period/publish", async (c) => {
    if (!isAdmin(c.get("role"))) return c.json({ error: "Admin access required" }, 403);
    const period = c.req.param("period");
    if (!PERIOD.test(period)) return c.json({ error: "Period must be YYYY-MM" }, 400);
    const existing = await getReport(c.env, country, period);
    if (!existing) return c.json({ error: "No report for this month yet" }, 404);
    const series = (await seriesFor(c.env, W)).find((p) => p.period === period) ?? emptyPeriod(period);
    const now = nowIso();
    await run(
      c.env.DB,
      `UPDATE ${REPORT_TABLE} SET status = 'published', snapshot = ?, published_at = ?, updated_at = ?, updated_by = ? WHERE country = ? AND period = ?`,
      [JSON.stringify(series), now, now, c.get("userId") ?? null, country, period],
    );
    return c.json({ ok: true, published_at: now });
  });

  r.post("/:period/reopen", async (c) => {
    if (!isAdmin(c.get("role"))) return c.json({ error: "Admin access required" }, 403);
    const period = c.req.param("period");
    if (!PERIOD.test(period)) return c.json({ error: "Period must be YYYY-MM" }, 400);
    await run(c.env.DB, `UPDATE ${REPORT_TABLE} SET status = 'draft', updated_at = ? WHERE country = ? AND period = ?`, [nowIso(), country, period]);
    return c.json({ ok: true });
  });

  return r;
}

export const keReportRouter = reportRouter(KE_WATCH);
export const ssReportRouter = reportRouter(SS_WATCH);
