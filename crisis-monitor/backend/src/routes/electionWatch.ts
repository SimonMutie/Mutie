import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import { canViewSpotlight } from "./spotlight";
import { audit, clientIp } from "../lib/audit";
import { buildDashboard, CATEGORIES, CATEGORY_LABELS, clusterFor, collectElectionItems, countyName, ensureElectionWatchTables, type ItemRow } from "../lib/electionWatch";
import type { Env } from "../bindings";

/**
 * Kenya Election Watch, live data. Sits behind the same per-client sharing as
 * Regional Spotlight, and only admins can change anything.
 */
export const electionWatchRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
electionWatchRouter.use("*", requireAuth);
electionWatchRouter.use("*", async (c, next) => {
  if (!(await canViewSpotlight(c.env, c.get("userId"), c.get("role")))) return c.json({ error: "Regional Spotlight hasn't been shared with your organisation. Ask your Afrilens contact." }, 403);
  await ensureElectionWatchTables(c.env);
  await next();
});
const isAdmin = (c: { get: (k: "role") => string }) => c.get("role") === "admin";
const adminOnly = (c: { get: (k: "role") => string; json: (b: unknown, s: 403) => Response }) => (isAdmin(c) ? null : c.json({ error: "Admin access required" }, 403));

electionWatchRouter.get("/dashboard", async (c) => {
  const days = Math.min(365, Math.max(7, Number(c.req.query("days")) || 90));
  return c.json(await buildDashboard(c.env, days));
});

interface ItemOut extends Omit<ItemRow, "cluster_id"> {
  county: string | null;
  reports: number;
  cluster_id: string;
}

electionWatchRouter.get("/items", async (c) => {
  const q = c.req.query();
  const days = Math.min(365, Math.max(1, Number(q.days) || 30));
  const limit = Math.min(300, Math.max(1, Number(q.limit) || 60));
  const where = ["published_at >= ?"];
  const params: unknown[] = [new Date(Date.now() - days * 86_400_000).toISOString()];
  if (q.category && (CATEGORIES as readonly string[]).includes(q.category)) {
    where.push("category = ?");
    params.push(q.category);
  } else where.push("category != 'coverage'");
  if (q.county && /^\d{3}$/.test(q.county)) {
    where.push("county_code = ?");
    params.push(q.county);
  }
  if (q.status === "verified") where.push("status = 'verified'");
  else if (!isAdmin(c) || q.status !== "rejected") where.push("status != 'rejected'");
  else where.push("status = 'rejected'");
  const rows = await all<ItemRow>(c.env.DB, `SELECT * FROM ew_items WHERE ${where.join(" AND ")} ORDER BY published_at DESC LIMIT 1500`, params);
  // One row per event: the newest report, with how many reports stand behind it.
  const seen = new Map<string, ItemOut>();
  for (const r of rows) {
    const s = seen.get(r.cluster_id);
    if (s) {
      s.reports++;
      if (r.fatalities && (!s.fatalities || r.fatalities > s.fatalities)) s.fatalities = r.fatalities;
    } else seen.set(r.cluster_id, { ...r, county: countyName(r.county_code), reports: 1 });
  }
  const list = [...seen.values()].slice(0, limit);
  const filter = isAdmin(c) ? list : list.map(({ note: _n, ...rest }) => ({ ...rest, note: null }));
  return c.json(filter);
});

electionWatchRouter.get("/items.csv", async (c) => {
  const days = Math.min(730, Math.max(1, Number(c.req.query("days")) || 90));
  const rows = await all<ItemRow>(c.env.DB, "SELECT * FROM ew_items WHERE published_at >= ? AND category != 'coverage' AND status != 'rejected' ORDER BY published_at DESC LIMIT 5000", [new Date(Date.now() - days * 86_400_000).toISOString()]);
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet must not run it as a formula
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["published_at", "category", "severity", "county", "fatalities", "status", "title", "source", "url", "event_id"];
  const lines = rows.map((r) => [r.published_at, CATEGORY_LABELS[r.category], r.severity, countyName(r.county_code) ?? "", r.fatalities ?? "", r.status, r.title, r.domain ?? "", r.url, r.cluster_id].map(esc).join(","));
  return new Response([head.join(","), ...lines].join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kenya-election-watch-${new Date().toISOString().slice(0, 10)}.csv"` } });
});

electionWatchRouter.get("/coverage", async (c) => {
  const rows = await all<ItemRow>(c.env.DB, "SELECT * FROM ew_items WHERE category = 'coverage' AND status != 'rejected' ORDER BY published_at DESC LIMIT 18");
  return c.json(rows.map((r) => ({ id: r.id, title: r.title, url: r.url, domain: r.domain, published_at: r.published_at })));
});

const itemSchema = z.object({
  title: z.string().min(5).max(300),
  url: z.string().url().max(600),
  category: z.enum(CATEGORIES).refine((v) => v !== "coverage", "Use a violence or rhetoric category"),
  county_code: z.string().regex(/^\d{3}$/).nullable().optional(),
  published_at: z.string().min(10).max(40),
  fatalities: z.number().int().min(0).max(1000).nullable().optional(),
  severity: z.number().int().min(1).max(3).optional(),
  summary: z.string().max(500).optional(),
});

electionWatchRouter.post("/items", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const parsed = itemSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const d = parsed.data;
  if (Number.isNaN(Date.parse(d.published_at))) return c.json({ error: "Date not recognised" }, 400);
  const id = newId();
  const published = new Date(d.published_at).toISOString();
  const cluster = (await clusterFor(c.env, d.category, d.county_code ?? null, d.title, published)) ?? id;
  let domain = "";
  try {
    domain = new URL(d.url).hostname.replace(/^www\./, "");
  } catch {
    /* validated above */
  }
  try {
    await run(c.env.DB, "INSERT INTO ew_items (id, url, title, summary, domain, published_at, category, severity, county_code, fatalities, cluster_id, method, status, created_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual','verified',?,?)", [
      id, d.url, d.title, d.summary ?? null, domain, published, d.category, d.severity ?? (d.fatalities ? 3 : 2), d.county_code ?? null, d.fatalities ?? null, cluster, nowIso(), nowIso(),
    ]);
  } catch {
    return c.json({ error: "That link is already recorded." }, 409);
  }
  await audit(c.env, { userId: c.get("userId"), action: "election_watch.item_added", detail: `${id} ${d.category}`, ip: clientIp(c.req) });
  return c.json({ id }, 201);
});

const patchSchema = z.object({
  status: z.enum(["auto", "verified", "rejected"]).optional(),
  category: z.enum(CATEGORIES).optional(),
  county_code: z.string().regex(/^\d{3}$/).nullable().optional(),
  fatalities: z.number().int().min(0).max(1000).nullable().optional(),
  severity: z.number().int().min(1).max(3).optional(),
  note: z.string().max(500).nullable().optional(),
});

electionWatchRouter.patch("/items/:id", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    sets.push(`${k} = ?`);
    params.push(v ?? null);
  }
  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);
  sets.push("reviewed_at = ?");
  params.push(nowIso(), c.req.param("id"));
  // A verdict applies to the whole event: every report grouped with this one.
  const row = await first<{ cluster_id: string }>(c.env.DB, "SELECT cluster_id FROM ew_items WHERE id = ?", [c.req.param("id")]);
  if (!row) return c.json({ error: "Not found" }, 404);
  const wholeEvent = parsed.data.status !== undefined && Object.keys(parsed.data).length === 1;
  await run(c.env.DB, `UPDATE ew_items SET ${sets.join(", ")} WHERE ${wholeEvent ? "cluster_id = ?" : "id = ?"}`, [...params.slice(0, -1), wholeEvent ? row.cluster_id : c.req.param("id")]);
  await audit(c.env, { userId: c.get("userId"), action: "election_watch.item_updated", detail: `${c.req.param("id")} ${JSON.stringify(parsed.data)}`, ip: clientIp(c.req) });
  return c.json({ ok: true });
});

/* ── content (polls, candidates, milestones) ─────────────── */

const KINDS = ["poll", "candidate", "milestone"] as const;

electionWatchRouter.get("/content", async (c) => {
  const rows = await all<{ kind: string; id: string; data: string; updated_at: string }>(c.env.DB, "SELECT kind, id, data, updated_at FROM ew_content ORDER BY updated_at");
  const out: Record<string, { id: string; data: unknown; updated_at: string }[]> = { poll: [], candidate: [], milestone: [] };
  for (const r of rows) {
    try {
      (out[r.kind] ??= []).push({ id: r.id, data: JSON.parse(r.data), updated_at: r.updated_at });
    } catch {
      /* skip a damaged row */
    }
  }
  return c.json(out);
});

electionWatchRouter.put("/content/:kind/:id", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const kind = c.req.param("kind");
  const id = c.req.param("id");
  if (!(KINDS as readonly string[]).includes(kind) || !/^[a-z0-9-]{1,60}$/.test(id)) return c.json({ error: "Bad kind or id" }, 400);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Expected an object" }, 400);
  const text = JSON.stringify(body);
  if (text.length > 20_000) return c.json({ error: "Too large" }, 413);
  await run(c.env.DB, "INSERT INTO ew_content (kind, id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at", [kind, id, text, nowIso()]);
  await audit(c.env, { userId: c.get("userId"), action: "election_watch.content_saved", detail: `${kind}/${id}`, ip: clientIp(c.req) });
  return c.json({ ok: true });
});

electionWatchRouter.delete("/content/:kind/:id", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  await run(c.env.DB, "DELETE FROM ew_content WHERE kind = ? AND id = ?", [c.req.param("kind"), c.req.param("id")]);
  await audit(c.env, { userId: c.get("userId"), action: "election_watch.content_removed", detail: `${c.req.param("kind")}/${c.req.param("id")}`, ip: clientIp(c.req) });
  return c.json({ ok: true });
});

/* ── leads ────────────────────────────────────────────────── */

electionWatchRouter.get("/leads", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  return c.json(await all(c.env.DB, "SELECT id, kind, title, url, domain, published_at, status FROM ew_leads WHERE status = 'pending' ORDER BY published_at DESC LIMIT 60"));
});

electionWatchRouter.patch("/leads/:id", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const body = z.object({ status: z.enum(["pending", "done", "dismissed"]) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Bad status" }, 400);
  await run(c.env.DB, "UPDATE ew_leads SET status = ? WHERE id = ?", [body.data.status, c.req.param("id")]);
  return c.json({ ok: true });
});

electionWatchRouter.post("/collect", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const hours = Math.min(24 * 14, Math.max(1, Number((await c.req.json().catch(() => ({}))).hours) || 48));
  return c.json(await collectElectionItems(c.env, hours));
});
