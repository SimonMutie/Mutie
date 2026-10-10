import { Hono } from "hono";
import { z } from "zod";
import { all, first, run, nowIso } from "../db";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import { canViewSpotlight } from "./spotlight";
import { audit, clientIp } from "../lib/audit";
import { buildDashboard, clusterFor, collectElectionItems, ensureElectionWatchTables, KE_WATCH, type ItemRow, type Watch } from "../lib/electionWatch";
import { SS_WATCH } from "../lib/southSudanWatch";
import type { Env } from "../bindings";

/**
 * Election watches, live data: one router per country, built from the same
 * factory. Each sits behind the same per-client sharing as Regional Spotlight,
 * and only admins can change anything.
 */
export function watchRouter(W: Watch) {
  const r = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();
  const T = W.t;
  const cats = W.categories as [string, ...string[]];
  r.use("*", requireAuth);
  r.use("*", async (c, next) => {
    if (!(await canViewSpotlight(c.env, c.get("userId"), c.get("role")))) return c.json({ error: "Regional Spotlight hasn't been shared with your organisation. Ask your Afrilens contact." }, 403);
    await ensureElectionWatchTables(c.env, W);
    await next();
  });
  const isAdmin = (c: { get: (k: "role") => string }) => c.get("role") === "admin";
  const adminOnly = (c: { get: (k: "role") => string; json: (b: unknown, s: 403) => Response }) => (isAdmin(c) ? null : c.json({ error: "Admin access required" }, 403));

  r.get("/dashboard", async (c) => {
    const days = Math.min(365, Math.max(7, Number(c.req.query("days")) || 90));
    return c.json(await buildDashboard(c.env, days, W));
  });

  interface ItemOut extends Omit<ItemRow, "cluster_id"> {
    county: string | null;
    reports: number;
    cluster_id: string;
  }

  r.get("/items", async (c) => {
    const q = c.req.query();
    const days = Math.min(365, Math.max(1, Number(q.days) || 30));
    const limit = Math.min(300, Math.max(1, Number(q.limit) || 60));
    const where = ["published_at >= ?"];
    const params: unknown[] = [new Date(Date.now() - days * 86_400_000).toISOString()];
    if (q.category && (cats as readonly string[]).includes(q.category)) {
      where.push("category = ?");
      params.push(q.category);
    } else where.push("category != 'coverage'");
    if (q.county && W.placeRe.test(q.county)) {
      where.push("county_code = ?");
      params.push(q.county);
    }
    if (q.status === "verified") where.push("status = 'verified'");
    else if (!isAdmin(c) || q.status !== "rejected") where.push("status != 'rejected'");
    else where.push("status = 'rejected'");
    const rows = await all<ItemRow>(c.env.DB, `SELECT * FROM ${T.items} WHERE ${where.join(" AND ")} ORDER BY published_at DESC LIMIT 1500`, params);
    // One row per event: the newest report, with how many reports stand behind it.
    const seen = new Map<string, ItemOut>();
    for (const row of rows) {
      const s = seen.get(row.cluster_id);
      if (s) {
        s.reports++;
        if (row.fatalities && (!s.fatalities || row.fatalities > s.fatalities)) s.fatalities = row.fatalities;
      } else seen.set(row.cluster_id, { ...row, county: placeName(W, row.county_code), reports: 1 });
    }
    const list = [...seen.values()].slice(0, limit);
    const filter = isAdmin(c) ? list : list.map(({ note: _n, ...rest }) => ({ ...rest, note: null }));
    return c.json(filter);
  });

  r.get("/items.csv", async (c) => {
    const days = Math.min(730, Math.max(1, Number(c.req.query("days")) || 90));
    const rows = await all<ItemRow>(c.env.DB, `SELECT * FROM ${T.items} WHERE published_at >= ? AND category != 'coverage' AND status != 'rejected' ORDER BY published_at DESC LIMIT 5000`, [new Date(Date.now() - days * 86_400_000).toISOString()]);
    const esc = (v: unknown) => {
      let s = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet must not run it as a formula
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["published_at", "category", "severity", "place", "fatalities", "status", "title", "source", "url", "event_id"];
    const lines = rows.map((row) => [row.published_at, W.labels[row.category] ?? row.category, row.severity, placeName(W, row.county_code) ?? "", row.fatalities ?? "", row.status, row.title, row.domain ?? "", row.url, row.cluster_id].map(esc).join(","));
    return new Response([head.join(","), ...lines].join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${W.csvName}-${new Date().toISOString().slice(0, 10)}.csv"` } });
  });

  r.get("/coverage", async (c) => {
    const rows = await all<ItemRow>(c.env.DB, `SELECT * FROM ${T.items} WHERE category = 'coverage' AND status != 'rejected' ORDER BY published_at DESC LIMIT 18`);
    return c.json(rows.map((row) => ({ id: row.id, title: row.title, url: row.url, domain: row.domain, published_at: row.published_at })));
  });

  const itemSchema = z.object({
    title: z.string().min(5).max(300),
    url: z.string().url().max(600),
    category: z.enum(cats).refine((v) => v !== "coverage", "Use a violence or rhetoric category"),
    county_code: z.string().nullable().optional(),
    published_at: z.string().min(10).max(40),
    fatalities: z.number().int().min(0).max(1000).nullable().optional(),
    severity: z.number().int().min(1).max(3).optional(),
    summary: z.string().max(500).optional(),
  });

  r.post("/items", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const parsed = itemSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const d = parsed.data;
    if (d.county_code && !W.placeRe.test(d.county_code)) return c.json({ error: "Unknown place" }, 400);
    if (Number.isNaN(Date.parse(d.published_at))) return c.json({ error: "Date not recognised" }, 400);
    const id = newId();
    const published = new Date(d.published_at).toISOString();
    const cluster = (await clusterFor(c.env, d.category, d.county_code ?? null, d.title, published, W)) ?? id;
    let domain = "";
    try {
      domain = new URL(d.url).hostname.replace(/^www\./, "");
    } catch {
      /* validated above */
    }
    try {
      await run(c.env.DB, `INSERT INTO ${T.items} (id, url, title, summary, domain, published_at, category, severity, county_code, fatalities, cluster_id, method, status, created_at, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'manual','verified',?,?)`, [
        id, d.url, d.title, d.summary ?? null, domain, published, d.category, d.severity ?? (d.fatalities ? 3 : 2), d.county_code ?? null, d.fatalities ?? null, cluster, nowIso(), nowIso(),
      ]);
    } catch {
      return c.json({ error: "That link is already recorded." }, 409);
    }
    await audit(c.env, { userId: c.get("userId"), action: `${W.key}_watch.item_added`, detail: `${id} ${d.category}`, ip: clientIp(c.req) });
    return c.json({ id }, 201);
  });

  const patchSchema = z.object({
    status: z.enum(["auto", "verified", "rejected"]).optional(),
    category: z.enum(cats).optional(),
    county_code: z.string().nullable().optional(),
    fatalities: z.number().int().min(0).max(1000).nullable().optional(),
    severity: z.number().int().min(1).max(3).optional(),
    note: z.string().max(500).nullable().optional(),
  });

  r.patch("/items/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    if (parsed.data.county_code && !W.placeRe.test(parsed.data.county_code)) return c.json({ error: "Unknown place" }, 400);
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
    const row = await first<{ cluster_id: string }>(c.env.DB, `SELECT cluster_id FROM ${T.items} WHERE id = ?`, [c.req.param("id")]);
    if (!row) return c.json({ error: "Not found" }, 404);
    const wholeEvent = parsed.data.status !== undefined && Object.keys(parsed.data).length === 1;
    await run(c.env.DB, `UPDATE ${T.items} SET ${sets.join(", ")} WHERE ${wholeEvent ? "cluster_id = ?" : "id = ?"}`, [...params.slice(0, -1), wholeEvent ? row.cluster_id : c.req.param("id")]);
    await audit(c.env, { userId: c.get("userId"), action: `${W.key}_watch.item_updated`, detail: `${c.req.param("id")} ${JSON.stringify(parsed.data)}`, ip: clientIp(c.req) });
    return c.json({ ok: true });
  });

  /* ── content (polls, candidates, milestones, and so on) ── */

  const KINDS = W.contentKinds;

  r.get("/content", async (c) => {
    const rows = await all<{ kind: string; id: string; data: string; updated_at: string }>(c.env.DB, `SELECT kind, id, data, updated_at FROM ${T.content} ORDER BY updated_at`);
    const out: Record<string, { id: string; data: unknown; updated_at: string }[]> = Object.fromEntries(KINDS.map((k) => [k, []]));
    for (const row of rows) {
      try {
        (out[row.kind] ??= []).push({ id: row.id, data: JSON.parse(row.data), updated_at: row.updated_at });
      } catch {
        /* skip a damaged row */
      }
    }
    return c.json(out);
  });

  r.put("/content/:kind/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const kind = c.req.param("kind");
    const id = c.req.param("id");
    if (!KINDS.includes(kind) || !/^[a-z0-9-]{1,60}$/.test(id)) return c.json({ error: "Bad kind or id" }, 400);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Expected an object" }, 400);
    const text = JSON.stringify(body);
    if (text.length > 20_000) return c.json({ error: "Too large" }, 413);
    await run(c.env.DB, `INSERT INTO ${T.content} (kind, id, data, updated_at) VALUES (?,?,?,?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, [kind, id, text, nowIso()]);
    await audit(c.env, { userId: c.get("userId"), action: `${W.key}_watch.content_saved`, detail: `${kind}/${id}`, ip: clientIp(c.req) });
    return c.json({ ok: true });
  });

  r.delete("/content/:kind/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    await run(c.env.DB, `DELETE FROM ${T.content} WHERE kind = ? AND id = ?`, [c.req.param("kind"), c.req.param("id")]);
    await audit(c.env, { userId: c.get("userId"), action: `${W.key}_watch.content_removed`, detail: `${c.req.param("kind")}/${c.req.param("id")}`, ip: clientIp(c.req) });
    return c.json({ ok: true });
  });

  /* ── leads ── */

  r.get("/leads", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    return c.json(await all(c.env.DB, `SELECT id, kind, title, url, domain, published_at, status FROM ${T.leads} WHERE status = 'pending' ORDER BY published_at DESC LIMIT 60`));
  });

  r.patch("/leads/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const body = z.object({ status: z.enum(["pending", "done", "dismissed"]) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Bad status" }, 400);
    await run(c.env.DB, `UPDATE ${T.leads} SET status = ? WHERE id = ?`, [body.data.status, c.req.param("id")]);
    return c.json({ ok: true });
  });

  r.post("/collect", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const hours = Math.min(24 * 14, Math.max(1, Number((await c.req.json().catch(() => ({}))).hours) || 48));
    return c.json(await collectElectionItems(c.env, hours, W));
  });

  return r;
}

function placeName(W: Watch, code: string | null | undefined): string | null {
  if (!code) return null;
  return W.places?.get(code) ?? null;
}

export const electionWatchRouter = watchRouter(KE_WATCH);
export const southSudanWatchRouter = watchRouter(SS_WATCH);
