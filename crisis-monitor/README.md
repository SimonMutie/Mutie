# Sentinel — Crisis Monitoring Platform (prototype)

A working starting point for a Sprinklr-style social/media listening tool
focused on crisis monitoring: Boolean-query-driven proactive monitoring,
an auto-updating dashboard (live map, escalation charts, alert feed), and
an architecture designed so real data connectors can be dropped in later.

**Everything currently runs on simulated data.** No real social media, news,
or dark-web connectors are wired up — see "Going from mock data to real
sources" below.

Runs entirely on Cloudflare:

- **Database:** Cloudflare D1 (SQLite) — users, events, monitoring queries, matches, alerts, escalation history
- **Backend:** Cloudflare Worker (Hono) + Durable Objects — boolean query engine, REST API, WebSocket broadcast hub, and the two background loops (mock ingestion, escalation scoring), each driven by a Durable Object alarm
- **Frontend:** React + TypeScript + Vite, deployed as static assets on Cloudflare Pages — per-client login, a query list, and a live dashboard (map, charts, alert feed) for each monitoring query

**Multi-tenant:** every monitoring query belongs to the account that created it.
Clients only ever see their own queries and the dashboards built from them —
enforced on the REST API *and* the live WebSocket feed, not just hidden in
the UI (see "Accounts & multi-tenancy" below). There's no public signup —
an admin creates each client's login.

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

# Set the session-signing secret (never put this in wrangler.toml — it's a real secret)
npx wrangler secret put SESSION_SECRET
#   -> paste any long random string when prompted, e.g. output of:
#      node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Deploy
npm run deploy
```

> **Upgrading an existing deployment** (created before accounts existed)?
> Run `npx wrangler d1 execute sentinel --remote --file=../db/migration_002_auth.sql`
> instead of the fresh-install schema above — it's additive (new `users`
> table + an `owner_id` column on `monitoring_queries`) and safe to run
> against a database that already has data in it.

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

The `users` table starts empty, so the **first visit to the deployed
frontend** shows a one-time "set up admin account" screen instead of a login
screen — that's you. From there you're the admin: you create a login for
each client from the "Clients" tab, and you're the only role that sees
across every client's queries.

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

### Conflict Escalation — how a flag is decided

The Conflict Escalation layer and its alerts come from
`backend/src/escalationIncidents.ts`. Nothing is flagged from event codes or
report volume. Each 5-minute tick:

1. **Collects candidate articles** from the Africa Wire crawl, the wire-service
   feeds, and the URLs behind GDELT's conflict-coded events located in Africa.
   A loose multilingual keyword filter only decides what is worth reading.
   - **First pass on headlines** (`lib/headlineCoder.ts`) — no model, no
     download, no cost. Each candidate's headline and feed summary are read by
     fixed rules that recognise a limited set of explicit, completed events
     ("gunmen killed 12", "drone strike hit", "clashes erupted", "captured the
     town of") beside a named town or region; warnings, commentary, court
     news, anniversaries and events outside Africa are left alone. Positives
     are stored as **low-confidence** reports marked `text_basis = 'headline'`
     and go through the same verification as a model's coding. This is what
     puts a marker on the map within minutes on the free AI allowance, which
     affords only about 25-30 full readings a day. It reads English and
     French headlines.
2. **Reads each article in full** (`lib/articleReader.ts`) — those the first
   pass coded come first (markers already on the map before the rest). The
   full reading **replaces** the first pass: it confirms the report, corrects
   it, or removes it if the article is not what its headline suggested.
3. **Codes it against the written codebook** (`lib/escalationCodebook.ts`,
   `lib/escalationCoder.ts`): is this a real, dated event; where exactly; who;
   which indicators — each with a verbatim quote. The coding is then checked
   against the article: an indicator whose quote is not in the text is
   dropped, a place the article never names is dropped, a non-African event
   is rejected, and the country is corrected if the named place belongs to a
   different one.
4. **Locates the event from the place the article names**, inside the country
   the article says it is in (`lib/africaGeo.ts`, `lib/geocoder.ts`): curated
   gazetteer → GeoNames → Nominatim → a border-checked estimate → the named
   region → the country centre. Every marker says which of these it is.
   GDELT's own coordinates are never used.
5. **Groups reports into incidents** by place and sets the level with fixed
   rules (`decideLevel()` in the codebook). The model never assigns a level.
   A single low-confidence report (one unread headline) flags nothing unless
   it states five or more deaths; two independent outlets reporting armed
   events at the same place do. Critical on a death toll (25+) needs a second
   outlet or a full reading. Syndicated copies of one story — the same quote,
   or the same headline on an aggregator — count as one source.
6. **Writes the assessment**: one analyst call per flagged incident, from that
   incident's own coded reports and quotes, with inline citations. An incident
   known only from headlines gets no analyst call: its text is assembled from
   those headlines, cited, with the rule that flagged it, and is labelled
   *preliminary* in the interface until an article behind it has been read.
7. **Raises one alert per incident**, keeps it in step with the incident, and
   closes it when the incident's reports age out (24 hours).

**Only the last 24 hours count** (`ACTIVE_WINDOW_HOURS`, `isLive()`). A report
counts toward a flag only if its article was published in the last 24 hours
*and* the event's own date is today or yesterday. Articles older than that
are not collected or read. The headline first pass reads the date the text
gives ("on Sunday", "yesterday", "3 October", "last week", "this past
weekend", the day something was said) against the publication day, uses it
as the event date, and leaves the report alone when it dates the event more
than a day back; a date attached to something else ("despite a curfew
imposed on September 21") is ignored.

Useful endpoints (all under `/api/live-layers/conflict-escalation`):

| Path | What it shows |
| --- | --- |
| `/` | Flagged incidents, each with criteria met, indicators + quotes, sources |
| `/status` | Model in use, last tick's counts, what was rejected and why (24h) |
| `/audit?country=Ethiopia&q=Tigray` | Every article read and the decision on it |
| `/codebook` | The indicators, exclusions and thresholds in force |

Settings (`wrangler secret put …` for the key; `[vars]` in `wrangler.toml` for the rest):

| Name | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | unset | Strongly recommended. Without it the pipeline runs on Workers AI, a smaller model that codes less reliably. |
| `ESCALATION_CODER_MODEL` | `claude-haiku-4-5-20251001` | Model that reads and codes each article. |
| `ESCALATION_ANALYST_MODEL` | same as coder | Model that writes each incident's assessment (far fewer calls). |
| `ESCALATION_ARTICLES_PER_TICK` | `12` | Articles read per 5-minute tick. |
| `ESCALATION_PIPELINE_ENABLED` | `true` | `false` pauses reading/coding; existing incidents age out normally. |
| `ESCALATION_HEADLINE_TIER` | `true` | `false` switches off the headline first pass; markers then come only from articles a model has read. |
| `GEOCODER_ENABLED` | `true` | `false` disables Nominatim lookups (bundled gazetteers only). |
| `TRANSLATION_ENABLED` | `false` | `true` turns on Workers AI translation of non-English Africa Wire items (each item once). Off by default because of its cost. |

Tests: `cd backend && npm test`.

### Local development

```bash
# terminal 1 — backend, via Miniflare (D1 + Durable Objects simulated locally)
cd crisis-monitor/backend
npm install
echo 'SESSION_SECRET="local-dev-only"' > .dev.vars   # wrangler dev reads this automatically; never commit it
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

- **Query list** — every query the logged-in account owns (admins see everyone's), with a live 2h match count. Create new queries here.
- **Per-query dashboard** — clicking a query opens its own dedicated view, scoped to just that query's matches:
  - **World map** — live event markers by source type, with pulsing rings on open alerts, positioned at their reported location. Hover any marker for the full event text/alert detail.
  - **Volume chart** — match throughput over the last hour.
  - **Source mix + sentiment** — breakdown by source type and rolling sentiment split.
  - **Alert feed** — live-updating, with acknowledge/resolve actions.
- **Admin panel** (admin role only) — create a login for each client, see every account.

### Accounts & multi-tenancy

There's no public signup. The first person to visit a freshly-deployed site
sets up the one admin account; from then on, the admin creates a
username/password for each client (Clients tab). Every monitoring query
belongs to whichever account created it — clients only ever see and manage
their own; admins see every query, including any created directly by the
admin ("house" queries, not owned by any client).

Implementation (`backend/src/auth.ts`, `middleware.ts`, `ownership.ts`):

- **Passwords:** PBKDF2-SHA256 (100k iterations, random salt) via Web Crypto — no native bindings needed on Workers.
- **Sessions:** stateless, HMAC-signed bearer tokens (`SESSION_SECRET`, 30-day expiry) — no sessions table, verified by recomputing the signature. Sent as `Authorization: Bearer <token>` on REST calls and `?token=` on the WebSocket URL (browsers can't set custom headers on a WS handshake).
- **REST isolation:** every query/event/alert/stats route checks ownership before returning data — a client hitting another client's `query_id` gets a `404`, not a `403`, so existence isn't leaked either.
- **Live feed isolation:** this is the one that's easy to get wrong — a naive implementation would broadcast every event to every connected socket and just *filter it in the UI*, meaning a client's browser would technically receive other clients' private data over the wire. Instead, `LiveFeedHub` (the Durable Object WebSocket hub) verifies the session token **at connect time** and tags each socket with its owner via the hibernatable WebSocket attachment API; every broadcast carries the owning `ownerIds`, and the DO only forwards a message to sockets whose owner matches (admins always receive everything). Verified locally by connecting two clients and confirming one receives zero bytes of the other's matched events.

Known simplifications, worth knowing about before this handles anything sensitive: the bearer token lives in `localStorage` (accessible to any JS on the page — no `httpOnly` cookie), there's no password-reset flow (an admin just creates a new login), and there's no rate-limiting on login attempts.

## AI use and cost ceiling

The platform is set up so that its AI use cannot produce a charge.

- **What uses AI:** reading articles for escalation alerts and writing each flagged incident's assessment (Workers AI). Translation of non-English feeds is off by default.
- **The ceiling:** Cloudflare gives 10,000 Workers AI "neurons" a day free and bills beyond that. Nothing on Cloudflare's side stops a paid account at the free amount, so the Worker does: every model call first reserves its worst-case cost against a daily budget of 9,000 and is not made if that would go over (`backend/src/lib/aiBudget.ts`). The count resets at 00:00 UTC, with the allowance.
- **What that buys:** roughly 25–30 articles read a day with the current model, highest priority first, spread through the day rather than spent at once.
- **What would cost money:** setting `ANTHROPIC_API_KEY` (paid per call, not covered by the ceiling), or setting `AI_DAILY_NEURON_BUDGET` above 10,000. `AI_DAILY_NEURON_BUDGET = "0"` switches AI off entirely.
- **Where to see it:** Settings → "AI use and costs" (platform admin) shows today's use, the limit, and whether article reading is running.
- **Not covered:** the Cloudflare plan itself and non-AI usage (requests, database, queues) are outside this ceiling.

## Regional Spotlight — publications by region

A database of publications ("products": analyses, situation updates, reports) filed under a region: Africa, Asia-Pacific, Europe & Central Asia, Latin America & the Caribbean, Middle East, United States & Canada. A region holds as many entries as you add.

- **Where:** "Regional Spotlight" in the top bar. Hovering it lists the regions with their counts; it also opens by tap or keyboard.
- **Who can write:** platform admins only (New entry, Edit, Publish, Unpublish, Delete).
- **Draft / published:** an entry is a draft, visible only to admins, until it is published. Publishing makes it live for every signed-in user.
- **Public link:** a separate switch on each entry. A published entry with it on can be read without signing in at `/spotlight/<id>`. The link stops working as soon as the entry is unpublished or the switch is turned off.
- **Writing an article:** a formatting editor (headings, bold/italic/underline, colour and highlight, alignment, lists, quotes, key-points boxes, tables, links). Text and tables can be pasted in from Word or Excel. The author writes inside the real page layout, so what is on screen is what readers get.
- **Images, maps, infographics:** uploaded from the computer, pasted, or dragged in. Stored in the database (table `spotlight_media`), at most about 1.35 MB each; larger files are shrunk in the browser before upload. Each image can be resized, aligned and captioned. They are served from an address containing a random id and need no sign-in, so public articles can show them.
- **Live content inside an article:** "Live dashboard" places one of the platform's own dashboards (it must be shared live; the editor offers to switch that on). "Embed" places an interactive map or chart from another site, from its embed code or address (https only). Both can be resized.
- **Page width:** set per article — reading column, wide (the default) or the full width of the page.
- **How the text is stored:** as a document tree (JSON), not HTML. The reader can only display the block types the editor offers, and the server re-checks every link, image and embed address before saving (`backend/src/lib/spotlightDoc.ts`). Entries written in the first, plain-text version still display and are converted when next edited.
- **Not included:** uploading PDFs or other documents. Link to them with "Link to the full report".
- **Storage:** tables `spotlight_entries` and `spotlight_media`, created (and upgraded) by the Worker itself on first use — there is no migration to run (`db/migration_026_regional_spotlight.sql` is the readable record). Code: `backend/src/routes/spotlight.ts`, `frontend/src/components/RegionalSpotlight.tsx`.

## Going from mock data to real sources

This prototype intentionally ships with `MOCK_MODE = "true"`
(`backend/src/mockGenerator.ts`) instead of live connectors, since real ones
need paid API/data agreements this project can't assume you have. To wire in
real sources:

1. **Mainstream media / news** — ✅ done: `backend/src/connectors/gdelt.ts` polls GDELT's free DOC 2.0 API (no key needed). Set `GDELT_ENABLED = "true"` in `wrangler.toml` to turn it on. For deeper news coverage later, add NewsAPI or direct RSS/Atom feeds from specific wire services using the same pattern (insert into `events`, call `matchAndBroadcast`).
2. **Social media** — most platforms (X/Twitter, Meta, TikTok, Reddit) require paid enterprise API tiers for full-firehose or historical search access. Write a connector that calls the platform API, following the same shape as `gdelt.ts`: `INSERT OR IGNORE` into `events` (the partial unique index on `(source_type, external_id)` dedupes for you), then call `matchAndBroadcast()`. It can live in a Worker route hit by an external scheduler, or its own Cron Trigger.
3. **Dark web** — do **not** build a DIY Tor scraper. Use a licensed threat-intelligence feed (e.g. Flashpoint, Recorded Future, DarkOwl, SixgillOwl) that already handles the legal, safety, and operational-security side of dark-web collection, and normalize their API output into the `events` table the same way.
4. Once you have enough real sources, set `MOCK_MODE = "false"` in `wrangler.toml` to stop the synthetic generator.
5. For genuine production scale you'll also want: a queue (Cloudflare Queues) between ingestion and scoring instead of writing directly to D1 under load, deduplication/near-duplicate detection across sources reporting the same real-world story, and real NLP for sentiment/entity/geo-extraction (GDELT gives you a country, not coordinates — the connector currently just centroids that).

## Database schema

See `db/schema.sql` — `sources`, `events`, `monitoring_queries`,
`query_matches`, `alerts`, `escalation_snapshots`. SQLite/D1-flavored: text
ids (generated by the Worker with `crypto.randomUUID()`), `CHECK` constraints
instead of enums, JSON stored as `TEXT`, timestamps stored as ISO-8601 text.

## Notable limitations of this prototype

- No password-reset flow or login rate-limiting (see "Accounts & multi-tenancy" above) — fine for a small number of admin-provisioned clients, not for anything open to the public internet at scale.
- Sentiment is randomly assigned per mock event, not computed from text — a real deployment needs an actual NLP sentiment/entity pipeline.
- Geolocation is asserted per event rather than extracted from text/metadata.
- No deduplication across sources for the same real-world story.
- Escalation scoring is a simple heuristic (documented in `alerting.ts`), not a calibrated statistical/ML anomaly model — tune `elevated_threshold`/`critical_threshold` per query against your own baseline data before relying on it operationally.
- The mock ingestion tick and escalation scoring loop are single global Durable Object instances — fine for a demo/prototype's event volume, but a real production system would want to shard ingestion across multiple DOs or move to Cloudflare Queues once volume grows past what one DO's alarm loop can process per tick.
