import { Hono } from "hono";
import { z } from "zod";
import { all, run } from "../db";
import { requireAuth, requireAdmin, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { ensureElectionTable, publishedEntries, proposalById, TIMELINE_COUNTRIES } from "../lib/electionTimeline";

/** Public: approved, dated entries for a country's timeline. */
export const electionTimelineRouter = new Hono<{ Bindings: Env }>();
electionTimelineRouter.get("/:country", async (c) => {
  const country = c.req.param("country").toUpperCase();
  if (!(TIMELINE_COUNTRIES as readonly string[]).includes(country)) return c.json({ error: "unknown country" }, 404);
  return c.json({ entries: await publishedEntries(c.env, country) });
});

/** Reviewers only: proposals waiting for a decision, and the reviewed ones. */
export const electionReviewRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
electionReviewRouter.use("*", requireAuth, requireAdmin);
electionReviewRouter.use("*", async (c, next) => {
  await ensureElectionTable(c.env);
  await next();
});

electionReviewRouter.get("/", async (c) => {
  const rows = await all(
    c.env.DB,
    `SELECT id, country_code, kind, title, source_url, source_domain, published_at, status, date, detail, reviewed_at
     FROM election_proposals ORDER BY status = 'proposed' DESC, published_at DESC LIMIT 300`
  );
  return c.json({ proposals: rows });
});

const decision = z.object({
  status: z.enum(["approved", "rejected"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  detail: z.string().max(600).nullable().optional(),
});

electionReviewRouter.post("/:id", async (c) => {
  const id = c.req.param("id");
  const parsed = decision.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "status must be approved or rejected; date must be YYYY-MM-DD" }, 400);
  if (!(await proposalById(c.env, id))) return c.json({ error: "not found" }, 404);
  const { status, date, detail } = parsed.data;
  if (status === "approved" && !date) return c.json({ error: "an approved entry needs a date" }, 400);
  await run(
    c.env.DB,
    `UPDATE election_proposals SET status = ?, date = COALESCE(?, date), detail = COALESCE(?, detail), reviewed_at = ?, reviewed_by = ? WHERE id = ?`,
    [status, date ?? null, detail ?? null, new Date().toISOString(), c.get("userId"), id]
  );
  return c.json({ ok: true });
});
