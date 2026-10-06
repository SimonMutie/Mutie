import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./bindings";
import { AFRICA_SOURCES } from "./data/africaSources";
import { authRouter } from "./routes/auth";
import { queriesRouter } from "./routes/queries";
import { eventsRouter } from "./routes/events";
import { alertsRouter } from "./routes/alerts";
import { statsRouter } from "./routes/stats";
import { queryInsightsRouter } from "./routes/queryInsights";
import { analyticsRouter, publicAnalyticsRouter } from "./routes/analytics";
import { incidentsRouter } from "./routes/incidents";
import { mapRoutesRouter } from "./routes/mapRoutes";
import { mapShapesRouter } from "./routes/mapShapes";
import { customDashboardsRouter, publicDashboardsRouter } from "./routes/customDashboards";
import { datasetsRouter } from "./routes/datasets";
import { clientsRouter } from "./routes/clients";
import { mapSettingsRouter } from "./routes/map-settings";
import { liveLayersRouter } from "./routes/liveLayers";
import { globalStatusRouter } from "./routes/globalStatus";
import { socialListeningRouter } from "./routes/socialListening";
import { listeningQueriesRouter } from "./routes/listeningQueries";
import { spotlightRouter, publicSpotlightRouter } from "./routes/spotlight";
import { ensureSchema } from "./lib/schemaHeal";
import { fetchNewsForQuery, ingestFeedMatches, loadActiveCompiledQueries } from "./ingest";
import { ingestGdeltBulkEvents } from "./connectors/gdeltBulk";
import { ingestGdeltGkg } from "./connectors/gdeltGkg";
import { getTickBudget, recordTickOutcome } from "./lib/gdeltAdaptiveBudget";
import { runEscalationPipeline } from "./escalationIncidents";

export { LiveFeedHub } from "./durableObjects/liveFeedHub";
export { IngestionActor } from "./durableObjects/ingestionActor";
export { AlertingActor } from "./durableObjects/alertingActor";
export { AisIngestionActor } from "./durableObjects/aisIngestionActor";
export { AfricaWireActor } from "./durableObjects/africaWireActor";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

// Adds any column a hand-run migration was meant to add but did not (see
// lib/schemaHeal.ts). Checked once per isolate, before any route runs.
app.use("*", async (c, next) => {
  await ensureSchema(c.env);
  await next();
});

// Any unhandled error in a route is returned as JSON with its message, so
// the page shows what actually went wrong instead of a bare "Request
// failed: 500" — and logged, so it is findable in the Worker's logs.
app.onError((err, c) => {
  console.error(`[api] ${c.req.method} ${new URL(c.req.url).pathname} failed:`, err);
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
});

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
  const aisId = env.AIS_INGESTION_ACTOR.idFromName("global");
  await Promise.all([
    env.INGESTION_ACTOR.get(ingestionId).fetch("http://ingestion-actor/start"),
    env.ALERTING_ACTOR.get(alertingId).fetch("http://alerting-actor/start"),
    env.AIS_INGESTION_ACTOR.get(aisId).fetch("http://ais-ingestion-actor/start"),
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
app.route("/api/query-insights", queryInsightsRouter);
app.route("/api/analytics", analyticsRouter);
app.route("/api/public/dashboards-viz", publicAnalyticsRouter);
app.route("/api/incidents", incidentsRouter);
app.route("/api/map-routes", mapRoutesRouter);
app.route("/api/map-shapes", mapShapesRouter);
app.route("/api/custom-dashboards", customDashboardsRouter);
app.route("/api/public/dashboards", publicDashboardsRouter);
app.route("/api/datasets", datasetsRouter);
app.route("/api/clients", clientsRouter);
app.route("/api/map-settings", mapSettingsRouter);
app.route("/api/live-layers", liveLayersRouter);
app.route("/api/global-status", globalStatusRouter);
app.route("/api/social-listening", socialListeningRouter);
app.route("/api/listening-queries", listeningQueriesRouter);
app.route("/api/spotlight", spotlightRouter);
app.route("/api/public/spotlight", publicSpotlightRouter);

// Auth for the live feed happens inside LiveFeedHub itself (reads ?token= off
// this same URL) — forwarding the raw request preserves that query string.
app.get("/ws", async (c) => {
  const id = c.env.LIVE_FEED.idFromName("global");
  return c.env.LIVE_FEED.get(id).fetch(c.req.raw);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

/** Splits the ~260-source list into Queues' max-100-messages-per-call
 *  sendBatch chunks. Every source is enqueued every tick (no cursor) —
 *  the queue's own pacing (wrangler.toml's max_batch_size/
 *  max_batch_timeout) and per-message retries govern actual throughput
 *  and failure handling from here, not this function. */
async function enqueueAfricaWireCrawl(env: Env): Promise<void> {
  const SENDBATCH_LIMIT = 100;
  const messages = AFRICA_SOURCES.map((_, index) => ({ body: { index } }));
  for (let i = 0; i < messages.length; i += SENDBATCH_LIMIT) {
    await env.AFRICA_WIRE_QUEUE.sendBatch(messages.slice(i, i + SENDBATCH_LIMIT));
  }
}

/** Consumer side of the "africa-wire-crawl" queue — forwards each message
 *  to AfricaWireActor's /process-source route (durableObjects/
 *  africaWireActor.ts), which does the actual fetch/parse/translate/store
 *  for that one source. A source that throws is retried by the queue
 *  itself (up to wrangler.toml's max_retries) rather than silently
 *  dropped; one source's failure never blocks the rest of the batch. */
async function processAfricaWireQueueBatch(batch: MessageBatch<{ index: number }>, env: Env): Promise<void> {
  const stub = env.AFRICA_WIRE_ACTOR.get(env.AFRICA_WIRE_ACTOR.idFromName("global"));
  await Promise.all(
    batch.messages.map(async (msg) => {
      try {
        await stub.fetch(`http://africa-wire-actor/process-source?index=${msg.body.index}`);
        msg.ack();
      } catch (err) {
        console.error(`[africa-wire-queue] source ${msg.body.index} failed`, err);
        msg.retry();
      }
    })
  );
}

export default {
  fetch: app.fetch,

  queue: processAfricaWireQueueBatch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await ensureSchema(env);
    // Safety net independent of HTTP traffic: re-kick the actors' alarms here too.
    ctx.waitUntil(bootstrapActors(env).catch((err) => console.error("[cron] bootstrap failed", err)));

    // Bulk event-export ingestion (see connectors/gdeltBulk.ts) — a plain
    // file download against GDELT's own 15-minute export, not its shared
    // query API, so this runs unconditionally (not gated behind
    // GDELT_ENABLED, which only controls the query-based per-saved-query
    // ingestion below). It's a cheap no-op on ticks where GDELT hasn't
    // published a new export yet.
    ctx.waitUntil(
      ingestGdeltBulkEvents(env)
        .then((result) => {
          if (!result.skipped) console.log(`[gdelt-bulk] ingested ${result.insertedRows} conflict-toned events from export ${result.fileTimestamp}`);
        })
        .catch((err) => console.error("[gdelt-bulk] ingestion failed", err))
    );

    // GKG bulk ingestion (see connectors/gdeltGkg.ts) — GDELT's second
    // 15-minute bulk file, carrying real casualty/displacement counts
    // (KILL/WOUND/DISPLACED/KIDNAP) and per-article tone that Event Export
    // above has no equivalent of. Same zero-rate-limit static-file pattern,
    // same "cheap no-op on ticks with nothing new" shape.
    ctx.waitUntil(
      ingestGdeltGkg(env)
        .then((result) => {
          if (!result.skipped) console.log(`[gdelt-gkg] ingested ${result.insertedRows} impact-toned articles from export ${result.fileTimestamp}`);
        })
        .catch((err) => console.error("[gdelt-gkg] ingestion failed", err))
    );

    // Escalation pipeline (see escalationIncidents.ts) — reads new candidate
    // articles in full, codes them against the written codebook, groups
    // them into located incidents and raises/updates/closes alerts. Bounded
    // per tick (ESCALATION_ARTICLES_PER_TICK) and self-locking, so a slow
    // tick never overlaps the next one.
    ctx.waitUntil(runEscalationPipeline(env).catch((err) => console.error("[escalation] pipeline tick failed", err)));

    // Africa Wire crawl (see durableObjects/africaWireActor.ts) — enqueues
    // one message per source onto the "africa-wire-crawl" Cloudflare Queue
    // (provisioned via the dashboard) rather than processing a fixed batch
    // in-line here. The queue() handler below (and wrangler.toml's
    // max_batch_size/max_batch_timeout) is what actually paces the fan-out,
    // so every source gets a fresh attempt each 5-minute tick instead of
    // cycling through the list via a persisted cursor over many ticks.
    ctx.waitUntil(enqueueAfricaWireCrawl(env).catch((err) => console.error("[africa-wire] enqueue failed", err)));

    if ((env.GDELT_ENABLED ?? "false") !== "true") return;

    // One GDELT search per active query (rather than one shared search across
    // all of them) — a shared search caps out at a fixed number of terms, so
    // a query with many terms (a real-world topic with lots of synonyms/place
    // names) would get most of its terms silently dropped. Each query's own
    // search still gets deduped against events already in the table, and any
    // newly-inserted article is matched against *every* active query (not
    // just the one whose search happened to surface it), same as before.
    //
    // Each query's terms are further split into GDELT-sized chunks
    // (buildQueryChunks) — a query can have any number of terms, it just costs
    // one extra GDELT request per chunk beyond the first. GDELT's free,
    // unauthenticated API rate-limits aggressively (has been observed
    // returning 429 under fairly light load) but documents no actual number,
    // so the total request *volume* allowed across the whole tick is no
    // longer a guessed constant — lib/gdeltAdaptiveBudget.ts tracks it in D1
    // across ticks and climbs it for real until a 429/403 actually fires,
    // then cuts back and cools down, the same additive-increase/
    // multiplicative-decrease shape TCP uses to discover an unknown shared
    // capacity. The starting query still rotates each tick so a tight budget
    // (e.g. just after a cooldown) doesn't always starve the same queries at
    // the end of the list.
    //
    // Previously this whole loop ran as a direct `await` in the scheduled()
    // body (unlike the three tasks above it, which are all `ctx.waitUntil`),
    // making it the one piece that blocked the handler from completing. Now
    // that its budget can legitimately climb well past the old fixed 20, it
    // moves into `ctx.waitUntil` too, consistent with the rest of this file
    // — a slow tick here no longer risks the handler itself overrunning.
    ctx.waitUntil(
      runGdeltLiveQueries(env).catch((err) => console.error("[gdelt] live-query tick failed", err))
    );
  },
};

async function runGdeltLiveQueries(env: Env): Promise<void> {
  const MAX_CHUNKS_PER_QUERY = 15; // safety ceiling per query (150 terms) — the shared budget below is the real limiter
  const GDELT_REQUEST_STAGGER_MS = 3000;
  // Feed items newer than this are (re)checked each tick. Longer than the
  // tick interval by a wide margin, so an outlet that publishes its feed
  // late, or a tick that fails, loses nothing.
  const FEED_MATCH_WINDOW_HOURS = 12;
  const compiled = await loadActiveCompiledQueries(env);

  // The platform's own news feeds, for every active query. Runs before the
  // GDELT budget check on purpose: it does not use GDELT, so it must keep
  // working while GDELT is rate-limiting this Worker.
  if (compiled.length > 0) {
    try {
      const f = await ingestFeedMatches(env, compiled, FEED_MATCH_WINDOW_HOURS);
      if (f.inserted > 0) console.log(`[feeds] ${f.inserted} new articles matched to monitoring queries`);
    } catch (err) {
      console.error("[feeds] matching failed:", err);
    }
  }

  const { budget, cooldownRemainingMs } = await getTickBudget(env);
  if (budget <= 0) {
    console.log(`[gdelt] skipping this tick — cooling down ${Math.ceil(cooldownRemainingMs / 60_000)}min after a recent rate limit`);
    return;
  }

  // Shared across every query this tick: if several queries' broad recall
  // both surface the same trending article, we fetch its full text once,
  // not once per query.
  const fulltextCache = new Map<string, string | null>();
  const requestBudget = { remaining: budget };
  let rateLimitedThisTick = false;

  // No fixed MAX_QUERIES_PER_TICK slice anymore — the adaptive budget above
  // is the real governor now (the loop below stops the moment it runs out),
  // so a tick with headroom gets to try every active query, not just the
  // first N of them regardless of how much budget is actually left.
  const queue = compiled;
  const rotation = queue.length > 0 ? Math.floor(Date.now() / (5 * 60_000)) % queue.length : 0;
  const rotated = [...queue.slice(rotation), ...queue.slice(0, rotation)];

  for (const [i, q] of rotated.entries()) {
    if (requestBudget.remaining <= 0) {
      console.warn(`[gdelt] request budget exhausted for this tick — ${rotated.length - i} quer${rotated.length - i === 1 ? "y" : "ies"} deferred to next tick`);
      break;
    }
    // Be a good citizen of GDELT's free API — spread requests out within
    // the tick instead of firing them back to back.
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, GDELT_REQUEST_STAGGER_MS));

    try {
      // Searches with the query's AND/OR structure intact, so what comes
      // back is about the query's subject — see ingest.ts's fetchNewsForQuery.
      const r = await fetchNewsForQuery(env, q, { fulltextCache, requestBudget, maxSearches: MAX_CHUNKS_PER_QUERY });
      if (r.rateLimited) rateLimitedThisTick = true;
      if (r.inserted > 0 || r.matched > 0) {
        console.log(`[gdelt] query=${q.id} searches=${r.searches.length} -> ${r.inserted} new articles, ${r.matched} matches`);
      }
    } catch (err) {
      console.error(`[gdelt] poll failed for query ${q.id}:`, err);
    }
  }

  await recordTickOutcome(env, {
    allocatedBudget: budget,
    requestsUsed: budget - requestBudget.remaining,
    rateLimited: rateLimitedThisTick,
  });
}
