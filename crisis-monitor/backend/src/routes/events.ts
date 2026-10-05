import { Hono } from "hono";
import { all, isoMinutesAgo } from "../db";
import { rowToEvent } from "../mappers";
import { canAccessQuery } from "../ownership";
import { requireAuth, type AuthedVariables } from "../middleware";
import type { Env } from "../bindings";
import { locateEventText, withTextLocation, type EventLocationPrecision } from "../lib/eventLocation";

export const eventsRouter = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

eventsRouter.use("*", requireAuth);

eventsRouter.get("/", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 100, 500);
  const sourceType = c.req.query("source_type") ?? null;
  const queryId = c.req.query("query_id") ?? null;
  // Optional ISO-8601 bounds for browsing history instead of "most recent N".
  const from = c.req.query("from") ?? null;
  const to = c.req.query("to") ?? null;
  const isAdmin = c.get("role") === "admin";

  // Non-admins only ever see events matched to a query they own — never the raw, unscoped firehose.
  if (!queryId && !isAdmin) {
    return c.json({ error: "query_id is required" }, 400);
  }

  if (queryId) {
    if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
      return c.json({ error: "Query not found" }, 404);
    }
    const conditions = ["qm.query_id = ?"];
    const params: unknown[] = [queryId];
    if (from) {
      conditions.push("e.published_at >= ?");
      params.push(from);
    }
    if (to) {
      conditions.push("e.published_at <= ?");
      params.push(to);
    }
    // Browsing a specific range reads chronologically; "most recent" (no range) reads newest-first.
    const order = from || to ? "ASC" : "DESC";
    params.push(limit);

    const rows = await all<Record<string, unknown>>(
      c.env.DB,
      `SELECT e.* FROM events e
       JOIN query_matches qm ON qm.event_id = e.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.published_at ${order} LIMIT ?`,
      params
    );
    // News events are placed where their text says, not at their
    // publisher's country — see lib/eventLocation.ts.
    return c.json(rows.map(withTextLocation).map(rowToEvent));
  }

  if (sourceType) {
    const rows = await all<Record<string, unknown>>(
      c.env.DB,
      "SELECT * FROM events WHERE source_type = ? ORDER BY published_at DESC LIMIT ?",
      [sourceType, limit]
    );
    return c.json(rows.map(rowToEvent));
  }

  const rows = await all<Record<string, unknown>>(c.env.DB, "SELECT * FROM events ORDER BY published_at DESC LIMIT ?", [limit]);
  return c.json(rows.map(rowToEvent));
});

eventsRouter.get("/geo", async (c) => {
  const minutes = Math.min(Number(c.req.query("minutes")) || 120, 1440);
  const queryId = c.req.query("query_id") ?? null;
  const isAdmin = c.get("role") === "admin";
  const cutoff = isoMinutesAgo(minutes);

  if (!queryId && !isAdmin) {
    return c.json({ error: "query_id is required" }, 400);
  }

  if (queryId) {
    if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
      return c.json({ error: "Query not found" }, 404);
    }
    const rows = await all<Record<string, unknown>>(
      c.env.DB,
      `SELECT e.id, e.source_type, e.title, e.content, e.geo_lat, e.geo_lng, e.geo_label, e.sentiment, e.published_at, e.raw_metadata
       FROM events e JOIN query_matches qm ON qm.event_id = e.id
       WHERE qm.query_id = ? AND e.published_at > ?
       ORDER BY e.published_at DESC LIMIT 500`,
      [queryId, cutoff]
    );
    // Located from each event's own text (lib/eventLocation.ts); events
    // whose text names nowhere have no point to return.
    return c.json(
      rows
        .map(withTextLocation)
        .filter((r) => r.geo_lat != null && r.geo_lng != null)
        .map(rowToEvent)
    );
  }

  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, source_type, content, geo_lat, geo_lng, geo_label, sentiment, published_at
     FROM events
     WHERE geo_lat IS NOT NULL AND published_at > ?
     ORDER BY published_at DESC LIMIT 500`,
    [cutoff]
  );
  return c.json(rows.map(rowToEvent));
});

interface LocatedEvent {
  id: string;
  source_type: string;
  title: string | null;
  snippet: string;
  url: string | null;
  sentiment: number | null;
  published_at: string;
  lat: number;
  lon: number;
  /** "Mekelle, Ethiopia" / "Tigray, Ethiopia" / "Ethiopia". */
  place: string;
  precision: EventLocationPrecision;
}

/** A monitoring query's recent matches, located for the Live Intel map.
 *
 *  The events table's own geo_lat/geo_lng are NOT used here: for news they
 *  are the centroid of the PUBLISHER's country (GDELT's `sourcecountry`),
 *  so a Kenyan paper's report on fighting in Sudan would be drawn in Kenya.
 *  Each match is instead located from the places its own headline/text
 *  names, and a match that names nowhere is counted but not plotted.
 *
 *  ?query_id= (required) &hours= (default 24, max 168). */
eventsRouter.get("/located", async (c) => {
  const queryId = c.req.query("query_id") ?? null;
  if (!queryId) return c.json({ error: "query_id is required" }, 400);
  if (!(await canAccessQuery(c.env, c.get("userId"), c.get("role"), queryId))) {
    return c.json({ error: "Query not found" }, 404);
  }
  const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 168);
  const rows = await all<{ id: string; source_type: string; title: string | null; content: string; url: string | null; sentiment: number | null; published_at: string }>(
    c.env.DB,
    `SELECT e.id, e.source_type, e.title, e.content, e.url, e.sentiment, e.published_at
     FROM events e JOIN query_matches qm ON qm.event_id = e.id
     WHERE qm.query_id = ? AND e.published_at > ?
     ORDER BY e.published_at DESC LIMIT 500`,
    [queryId, isoMinutesAgo(hours * 60)]
  );
  const events: LocatedEvent[] = [];
  for (const r of rows) {
    const loc = locateEventText(r.title, (r.content ?? "").replace(/https?:\/\/\S+/g, " "));
    if (!loc) continue;
    events.push({
      id: r.id,
      source_type: r.source_type,
      title: r.title,
      snippet: (r.content ?? "").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim().slice(0, 220),
      url: r.url,
      sentiment: r.sentiment,
      published_at: r.published_at,
      lat: loc.lat,
      lon: loc.lon,
      place: loc.place,
      precision: loc.precision,
    });
  }
  return c.json({ queryId, hours, total: rows.length, located: events.length, events, fetchedAt: new Date().toISOString() });
});
