import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./bindings";
import { authRouter } from "./routes/auth";
import { queriesRouter } from "./routes/queries";
import { eventsRouter } from "./routes/events";
import { alertsRouter } from "./routes/alerts";
import { statsRouter } from "./routes/stats";
import { matchAndBroadcast, loadActiveCompiledQueries } from "./ingest";
import { buildQueryFromTerms, pollGdelt } from "./connectors/gdelt";

export { LiveFeedHub } from "./durableObjects/liveFeedHub";
export { IngestionActor } from "./durableObjects/ingestionActor";
export { AlertingActor } from "./durableObjects/alertingActor";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

/**
 * The mock-ingestion and alerting loops live in Durable Object alarms, which
 * need one initial `/start` kick to begin self-rescheduling (see
 * IngestionActor/AlertingActor). This is idempotent — once an alarm is
 * pending it's a no-op — so it's cheap to call opportunistically from both
 * the health check and the cron handler as a self-healing safety net.
 */
async function bootstrapActors(env: Env) {
  const ingestionId = env.INGESTION_ACTOR.idFromName("global");
  const alertingId = env.ALERTING_ACTOR.idFromName("global");
  await Promise.all([
    env.INGESTION_ACTOR.get(ingestionId).fetch("http://ingestion-actor/start"),
    env.ALERTING_ACTOR.get(alertingId).fetch("http://alerting-actor/start"),
  ]);
}

app.get("/api/health", async (c) => {
  c.executionCtx.waitUntil(bootstrapActors(c.env).catch((err) => console.error("[startup] bootstrap failed", err)));
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ status: "ok", db: "connected" });
  } catch {
    return c.json({ status: "degraded", db: "unreachable" }, 503);
  }
});

app.route("/api/auth", authRouter);
app.route("/api/queries", queriesRouter);
app.route("/api/events", eventsRouter);
app.route("/api/alerts", alertsRouter);
app.route("/api/stats", statsRouter);

// Auth for the live feed happens inside LiveFeedHub itself (reads ?token= off
// this same URL) — forwarding the raw request preserves that query string.
app.get("/ws", async (c) => {
  const id = c.env.LIVE_FEED.idFromName("global");
  return c.env.LIVE_FEED.get(id).fetch(c.req.raw);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Safety net independent of HTTP traffic: re-kick the actors' alarms here too.
    ctx.waitUntil(bootstrapActors(env).catch((err) => console.error("[cron] bootstrap failed", err)));

    if ((env.GDELT_ENABLED ?? "false") !== "true") return;

    // One GDELT search per active query (rather than one shared search across
    // all of them) — a shared search caps out at a fixed number of terms, so
    // a query with many terms (a real-world topic with lots of synonyms/place
    // names) would get most of its terms silently dropped. Each query's own
    // search still gets deduped against events already in the table, and any
    // newly-inserted article is matched against *every* active query (not
    // just the one whose search happened to surface it), same as before.
    const MAX_QUERIES_PER_TICK = 25;
    const compiled = await loadActiveCompiledQueries(env);

    for (const q of compiled.slice(0, MAX_QUERIES_PER_TICK)) {
      try {
        const searchTerms = buildQueryFromTerms(q.parsed.positiveTerms);
        const inserted = await pollGdelt(env, searchTerms);
        for (const event of inserted) {
          await matchAndBroadcast(env, event);
        }
        if (inserted.length > 0) {
          console.log(`[gdelt] query=${q.id} terms="${searchTerms}" -> ${inserted.length} new articles`);
        }
      } catch (err) {
        console.error(`[gdelt] poll failed for query ${q.id}:`, err);
      }
    }
  },
};
