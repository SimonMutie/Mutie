/** Cloudflare Worker bindings, wired up in wrangler.toml. */
export interface Env {
  DB: D1Database;
  LIVE_FEED: DurableObjectNamespace;
  INGESTION_ACTOR: DurableObjectNamespace;
  ALERTING_ACTOR: DurableObjectNamespace;
  /** Holds the single persistent outbound WebSocket to AISstream.io and the
   *  in-memory snapshot of recent vessel positions — see
   *  durableObjects/aisIngestionActor.ts. */
  AIS_INGESTION_ACTOR: DurableObjectNamespace;
  /** Crawls the ~260 African country/pan-African/institutional sources in
   *  data/africaSources.ts — see durableObjects/africaWireActor.ts. */
  AFRICA_WIRE_ACTOR: DurableObjectNamespace;
  MOCK_MODE: string;
  GDELT_ENABLED: string;
  /** Set as an encrypted Worker secret (never in wrangler.toml [vars]) — signs session tokens. */
  SESSION_SECRET: string;
  /** Encrypted Worker secrets for the /live-malware route (liveLayers.ts) —
   *  a personal Auth-Key from a free abuse.ch account (auth.abuse.ch),
   *  used to call the ThreatFox IOC API, which abuse.ch made mandatory
   *  across its APIs. Optional: unset until the account owner provides
   *  one, at which point the route starts working rather than 502ing. */
  ABUSECH_AUTH_KEY?: string;
  /** MaxMind account id + license key (from a free maxmind.com account),
   *  used to download the GeoLite2-Country database for IP→country
   *  lookups (see fetchGeoLite2CountryReader in liveLayers.ts). Both
   *  required together — MaxMind's download API uses HTTP Basic Auth with
   *  these two values, not the license key alone. */
  MAXMIND_ACCOUNT_ID?: string;
  MAXMIND_LICENSE_KEY?: string;
  /** Free FRED API key (fred.stlouisfed.org/docs/api/api_key.html), used by
   *  /api/global-status/markets for WTI crude + Henry Hub natural gas
   *  (both EIA/US-government-sourced FRED series — verified commercial-use
   *  safe, unlike FRED's precious-metal series). Optional: the route still
   *  returns exchange status + crypto without it, just with
   *  commoditiesAvailable: false. */
  FRED_API_KEY?: string;
  /** API key from a free aisstream.io account (aisstream.io — sign in,
   *  then generate a key), used by AisIngestionActor to open the
   *  persistent WebSocket to wss://stream.aisstream.io/v0/stream for real
   *  global live AIS vessel positions. Optional: the /ais-vessels route
   *  502s with a specific "AISSTREAM_API_KEY not set" message until this
   *  is provided, same pattern as ABUSECH_AUTH_KEY. Chosen over
   *  alternatives (AISHub requires operating a physical AIS receiver;
   *  MarineTraffic/Datalastic are paid) after checking each directly —
   *  accepted with eyes open that aisstream.io publishes no terms of
   *  service or SLA, per the user's explicit decision. */
  AISSTREAM_API_KEY?: string;
  /** Access token from UCDP (Uppsala Conflict Data Program) for its GED
   *  (Georeferenced Event Dataset) API — used by /api/live-layers/ucdp-conflict-events
   *  for validated, academically-coded historical conflict events (CC BY
   *  4.0, verified commercial-safe directly against ucdp.uu.se/downloads).
   *  Unlike every other optional key in this file, there's no self-serve
   *  signup: email mertcan.yilmaz@pcr.uu.se with a short description of the
   *  intended use (UCDP's own API docs, ucdp.uu.se/apidocs) and they issue
   *  one. Optional: the route reports it's unconfigured until this is set,
   *  same pattern as ABUSECH_AUTH_KEY/AISSTREAM_API_KEY. */
  UCDP_API_TOKEN?: string;
  /** Personal access token for a Mastodon account, used by
   *  /api/social-listening to search public posts for a keyword (full-text
   *  status search needs an authenticated call even for public posts).
   *  Unlike UCDP, this is instant and self-serve: on mastodon.social (or
   *  any instance), go to Settings > Development > New Application, leave
   *  the default "read" scope, create it, then copy the "Your access
   *  token" value shown immediately — no approval wait. Optional: the
   *  route works without it, just without the Mastodon section of the
   *  results (mastodonAvailable: false). */
  MASTODON_ACCESS_TOKEN?: string;
  /** Anthropic API key (console.anthropic.com -> API Keys), used by
   *  countryEscalation.ts to turn a country's escalation numbers (current
   *  vs. baseline report count, tone, sample locations) into a short
   *  analyst-style narrative brief for the alert, instead of the plain
   *  templated sentence. Optional: alerts still fire and still carry a
   *  real, accurate (just more mechanical) description without this set —
   *  same "degrades, never breaks" pattern as every other optional key in
   *  this file. */
  ANTHROPIC_API_KEY?: string;
}
