# Sentinel — Crisis Monitoring Platform (prototype)

A working starting point for a Sprinklr-style social/media listening tool
focused on crisis monitoring: Boolean-query-driven proactive monitoring,
an auto-updating dashboard (live map, escalation charts, alert feed), and
an architecture designed so real data connectors can be dropped in later.

**Everything currently runs on simulated data.** No real social media, news,
or dark-web connectors are wired up — see "Going from mock data to real
sources" below.

Runs entirely on Cloudflare:

- **Database:** Cloudflare D1 (SQLite) — events, monitoring queries, matches, alerts, escalation history
- **Backend:** Cloudflare Worker (Hono) + Durable Objects — boolean query engine, REST API, WebSocket broadcast hub, and the two background loops (mock ingestion, escalation scoring), each driven by a Durable Object alarm
- **Frontend:** React + TypeScript + Vite, deployed as static assets on Cloudflare Pages — live dashboard (map, charts, alert feed, query builder)

> This was ported from an earlier Express + Postgres + `ws` prototype to run
> natively on Cloudflare's edge platform. See "Why Durable Objects" below if
> you're wondering where the old `setInterval` loops and WebSocket server went.

## Deploying it (step by step)

You'll need a free Cloudflare account and `wrangler` (the Cloudflare CLI,
installed as a dev dependency below — no global install needed).

### 1. Deploy the backend (Worker + D1 + Durable Objects)

```bash
cd crisis-monitor/backend
npm install
npx wrangler login          # opens a browser to authorize the CLI

# Create the D1 database, then copy the returned database_id into wrangler.toml
npx wrangler d1 create sentinel
#   -> paste the "database_id" it prints into backend/wrangler.toml,
#      replacing REPLACE_WITH_YOUR_D1_DATABASE_ID

# Apply the schema (creates tables + seeds 4 starter monitoring queries)
npm run db:migrate:remote

# Deploy
npm run deploy
```

Wrangler prints your Worker's URL at the end, e.g.
`https://sentinel-api.<your-subdomain>.workers.dev`. Sanity-check it:

```bash
curl https://sentinel-api.<your-subdomain>.workers.dev/api/health
# {"status":"ok","db":"connected"}
```

Within a couple of minutes the mock ingestion loop (an alarm-driven Durable
Object) will start writing simulated events and the escalation scorer will
start evaluating them — no further action needed, the first hit to
`/api/health` (or the 5-minute cron safety net) kicks both loops off.

### 2. Deploy the frontend (Cloudflare Pages)

Easiest path is the dashboard's Git integration:

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick this repo.
3. Set:
   - **Root directory:** `crisis-monitor/frontend`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Add environment variables (Settings → Environment variables) using the
   Worker URL from step 1:
   - `VITE_API_URL` = `https://sentinel-api.<your-subdomain>.workers.dev`
   - `VITE_WS_URL` = `wss://sentinel-api.<your-subdomain>.workers.dev`
5. Deploy. Pages gives you a `https://<project>.pages.dev` URL — that's your live dashboard.

(CLI alternative: `cd crisis-monitor/frontend && npm install && npm run build && npx wrangler pages deploy dist`,
after setting the two `VITE_*` vars in a `.env` file for the build step, or as
`--env` values in your CI.)

### Enabling the live GDELT news connector

[GDELT](https://www.gdeltproject.org/) is a free, public global news index
with **no API key or account required**, which makes it the easiest real
source to turn on first. Set `GDELT_ENABLED = "true"` under `[vars]` in
`backend/wrangler.toml` and redeploy (`npm run deploy`). It polls every 5
minutes via a Cloudflare Cron Trigger — matching GDELT's own 15-minute index
refresh rate, so polling faster just wastes requests — building its search
query from whatever terms are in your active monitoring queries, then runs
every returned article back through the same Boolean engine used for the
mock data, so your existing queries/alerts start firing on real news without
any extra setup. See `backend/src/connectors/gdelt.ts` for details, including
the coarse country→map-coordinate lookup used to plot articles (GDELT's DOC
API only gives a source country, not a precise location — a production build
would run real geocoding/NLP on the article text instead).

### Local development

```bash
# terminal 1 — backend, via Miniflare (D1 + Durable Objects simulated locally)
cd crisis-monitor/backend
npm install
npm run db:migrate:local     # seeds a local D1 instance under .wrangler/
npm run dev                  # wrangler dev, http://localhost:8787

# terminal 2 — frontend
cd crisis-monitor/frontend
npm install
VITE_API_URL=http://localhost:8787 VITE_WS_URL=ws://localhost:8787 npm run dev
```

## How it fits together

```
 mock/real connectors --> events table (D1) --> boolean query engine (per active query)
                                                        |
                                                        v
                                                query_matches table
                                                        |
                                        +---------------+----------------+
                                        |                                |
                          AlertingActor (DO, 30s alarm)         REST API (Hono Worker)
                          - volume vs baseline                          |
                          - sentiment penalty                           v
                                        |                        React dashboard
                                        v                    (map, charts, alert feed,
                                 alerts table                  query builder — all
                                        |                       live-updating)
                                        +--------> LiveFeedHub (DO) --> WebSocket broadcast
                                                        ^
                                                        |
                          IngestionActor (DO, ~1.2s alarm) generates
                          mock events and matches/broadcasts them the
                          same way real connectors do
```

### Why Durable Objects

The original prototype was a long-lived Node process: a `setInterval` every
~1.2s generated mock events, another every 30s scored escalations, and a `ws`
`WebSocketServer` held dashboard connections in memory. Cloudflare Workers
don't run long-lived processes — each invocation is short-lived and
stateless. Two Cloudflare primitives replace that:

- **Durable Object alarms** (`IngestionActor`, `AlertingActor`) — a Durable
  Object can schedule a wake-up at an arbitrary future time (no 1-minute
  floor, unlike Cron Triggers) and re-schedule itself from inside the alarm
  handler, which is exactly a `setInterval` translated to the serverless
  world.
- **A Durable Object as a WebSocket hub** (`LiveFeedHub`) — a single global
  DO instance accepts every dashboard's WebSocket connection (using the
  hibernatable WebSocket API, so idle connections don't keep it billed as
  active) and fans out `{ type, payload }` broadcasts, the same wire protocol
  the old `ws` server used.

GDELT polling, which only needs to run every 5 minutes, uses a native
Cloudflare Cron Trigger instead (`backend/wrangler.toml`'s `[triggers]`) since
its 1-minute floor is more than fine there.

### Boolean query engine (`backend/src/booleanQuery.ts`)

Unchanged from the original — pure TypeScript, no platform dependency.
Supports the syntax analysts expect from listening tools:

```
("cholera" OR "outbreak") AND "Nairobi" NOT "drill"
flood* AND evacuat*          # wildcard suffix matching
```

`AND` / `OR` / `NOT`, parentheses for grouping, quoted phrases, and
wildcards. Add a query in the dashboard's "New monitoring query" panel and
it's live within seconds — each ingestion tick re-reads and re-parses the
active query set from D1 (cheap at this scale, and avoids trying to keep an
in-memory cache coherent across Worker/Durable-Object isolates).

### Escalation scoring (`backend/src/alerting.ts`)

Every 30 seconds (`AlertingActor`'s alarm), for each active query: compares
match volume in the last 5 minutes against a rolling baseline (default 60
min), computes a simple escalation score (volume growth relative to baseline
variance + a penalty for negative average sentiment), and opens an `elevated`
or `critical` alert if it crosses the query's configured thresholds.
Thresholds, baseline window, and category are all per-query and editable via
`PATCH /api/queries/:id`.

### Dashboard

- **World map** — live event markers by source type, with pulsing rings on open alerts, positioned at their reported location.
- **Volume chart** — event throughput over the last hour.
- **Source mix + sentiment** — breakdown by source type and rolling sentiment split.
- **Alert feed** — live-updating, with acknowledge/resolve actions.
- **Query builder** — add/pause/delete Boolean monitoring rules, see live match counts per query.

## Going from mock data to real sources

This prototype intentionally ships with `MOCK_MODE = "true"`
(`backend/src/mockGenerator.ts`) instead of live connectors, since real ones
need paid API/data agreements this project can't assume you have. To wire in
real sources:

1. **Mainstream media / news** — ✅ done: `backend/src/connectors/gdelt.ts` polls GDELT's free DOC 2.0 API (no key needed). Set `GDELT_ENABLED = "true"` in `wrangler.toml` to turn it on. For deeper news coverage later, add NewsAPI or direct RSS/Atom feeds from specific wire services using the same pattern (insert into `events`, call `matchAndBroadcast`).
2. **Social media** — most platforms (X/Twitter, Meta, TikTok, Reddit) require paid enterprise API tiers for full-firehose or historical search access. Write a connector that calls the platform API, following the same shape as `gdelt.ts`: `INSERT OR IGNORE` into `events` (the partial unique index on `(source_type, external_id)` dedupes for you), then call `matchAndBroadcast()`. It can live in a Worker route hit by an external scheduler, or its own Cron Trigger.
3. **Dark web** — do **not** build a DIY Tor scraper. Use a licensed threat-intelligence feed (e.g. Flashpoint, Recorded Future, DarkOwl, SixgillOwl) that already handles the legal, safety, and operational-security side of dark-web collection, and normalize their API output into the `events` table the same way.
4. Once you have enough real sources, set `MOCK_MODE = "false"` in `wrangler.toml` to stop the synthetic generator.
5. For genuine production scale you'll also want: a queue (Cloudflare Queues) between ingestion and scoring instead of writing directly to D1 under load, deduplication/near-duplicate detection across sources reporting the same real-world story, real NLP for sentiment/entity/geo-extraction (GDELT gives you a country, not coordinates — the connector currently just centroids that), and role-based access control on the dashboard (there is currently none — see limitations below).

## Database schema

See `db/schema.sql` — `sources`, `events`, `monitoring_queries`,
`query_matches`, `alerts`, `escalation_snapshots`. SQLite/D1-flavored: text
ids (generated by the Worker with `crypto.randomUUID()`), `CHECK` constraints
instead of enums, JSON stored as `TEXT`, timestamps stored as ISO-8601 text.

## Notable limitations of this prototype

- Single-tenant, no authentication/authorization on the dashboard or API. Put it behind Cloudflare Access if you deploy it anywhere non-trivial.
- Sentiment is randomly assigned per mock event, not computed from text — a real deployment needs an actual NLP sentiment/entity pipeline.
- Geolocation is asserted per event rather than extracted from text/metadata.
- No deduplication across sources for the same real-world story.
- Escalation scoring is a simple heuristic (documented in `alerting.ts`), not a calibrated statistical/ML anomaly model — tune `elevated_threshold`/`critical_threshold` per query against your own baseline data before relying on it operationally.
- The mock ingestion tick and escalation scoring loop are single global Durable Object instances — fine for a demo/prototype's event volume, but a real production system would want to shard ingestion across multiple DOs or move to Cloudflare Queues once volume grows past what one DO's alarm loop can process per tick.
