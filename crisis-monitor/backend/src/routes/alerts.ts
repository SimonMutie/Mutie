import { Hono } from "hono";
import { all, nowIso } from "../db";
import { rowToAlert } from "../mappers";
import { canAccessQuery, canAccessAlert } from "../ownership";
import { newId } from "../ids";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";

export const alertsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

alertsRouter.use("*", requireAuth);

/** Sends a made-up alert over the live socket (nothing is stored) so the pop-up and sound can be tried. Admins only. */
alertsRouter.post("/test", async (c) => {
  if (c.get("role") !== "admin") return c.json({ error: "Admin access required" }, 403);
  const body = await c.req.json().catch(() => ({}));
  const level = body?.level === "critical" ? "critical" : "elevated";
  const payload = {
    id: `test-${newId()}`,
    query_id: null,
    level,
    title: `TEST — ${level === "critical" ? "Critical" : "Elevated"} escalation: armed opposition attack near Nasir, Upper Nile`,
    description: "This is a test alert from The Lens. SPLA-IO fighters reportedly attacked an army position; fighting is continuing and several people are reported killed.",
    geo_label: "Nasir, Upper Nile, South Sudan",
    geo_lat: 8.6,
    geo_lng: 33.06,
    created_at: nowIso(),
    acknowledged_at: null,
    resolved_at: null,
    metric_snapshot: {
      criteriaMet: ["Armed opposition activity reported (2 sources).", "8 deaths reported in a single event."],
      headlines: [
        { title: "Fighting erupts in Nasir as SPLA-IO attacks army base", url: null, source: "Test source", published_at: nowIso() },
        { title: "Dozens flee Nasir after clashes", url: null, source: "Test source", published_at: nowIso() },
      ],
    },
  };
  const id = c.env.LIVE_FEED.idFromName("global");
  await c.env.LIVE_FEED.get(id).fetch("http://live-feed/broadcast", { method: "POST", body: JSON.stringify({ type: "alert", payload, ownerIds: [c.get("userId")] }) });
  return c.json({ ok: true, level });
});

alertsRouter.get("/", async (c) => {
  const status = c.req.query("status") ?? "open";
  const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
  const queryId = c.req.query("query_id") ?? null;
  // Escalation-incident alerts (escalationIncidents.ts) are unscoped —
  // query_id IS NULL — since they're a standing Africa-wide watch, not tied
  // to any one client's saved query. They're a shared "house" signal (like
  // house monitoring queries with owner_id NULL), so any authenticated user
  // can ask for just those via ?unscoped=1 without needing admin — the
  // query_id-required rule below is only there to stop a non-admin client
  // from requesting *every* alert across every client's private queries.
  const unscopedOnly = c.req.query("unscoped") === "1";
  const isAdmin = c.get("role") === "admin";

  if (!queryId && !unscopedOnly && !isAdmin) {
    return c.json({ error: "query_id is required" }, 400);
  }
  if (queryId && !(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
    return c.json({ error: "Query not found" }, 404);
  }

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status === "open") conditions.push("a.resolved_at IS NULL");
  else if (status === "resolved") conditions.push("a.resolved_at IS NOT NULL");

  if (queryId) {
    conditions.push("a.query_id = ?");
    params.push(queryId);
  } else if (unscopedOnly) {
    conditions.push("a.query_id IS NULL");
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.*, q.name AS query_name, q.category
     FROM alerts a LEFT JOIN monitoring_queries q ON q.id = a.query_id
     ${where} ORDER BY a.created_at DESC LIMIT ?`,
    params
  );
  return c.json(rows.map(rowToAlert));
});

alertsRouter.patch("/:id/acknowledge", async (c) => {
  const id = c.req.param("id");
  if (!(await canAccessAlert(c.env, c.get("userId"), c.get("role"), id))) {
    return c.json({ error: "Alert not found" }, 404);
  }
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    "UPDATE alerts SET acknowledged_at = ? WHERE id = ? RETURNING *",
    [nowIso(), id]
  );
  if (rows.length === 0) return c.json({ error: "Alert not found" }, 404);
  return c.json(rowToAlert(rows[0]));
});

alertsRouter.patch("/:id/resolve", async (c) => {
  const id = c.req.param("id");
  if (!(await canAccessAlert(c.env, c.get("userId"), c.get("role"), id))) {
    return c.json({ error: "Alert not found" }, 404);
  }
  const rows = await all<Record<string, unknown>>(c.env.DB, "UPDATE alerts SET resolved_at = ? WHERE id = ? RETURNING *", [
    nowIso(),
    id,
  ]);
  if (rows.length === 0) return c.json({ error: "Alert not found" }, 404);
  return c.json(rowToAlert(rows[0]));
});
