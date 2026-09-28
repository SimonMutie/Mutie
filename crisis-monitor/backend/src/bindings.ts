/** Cloudflare Worker bindings, wired up in wrangler.toml. */
export interface Env {
  DB: D1Database;
  LIVE_FEED: DurableObjectNamespace;
  INGESTION_ACTOR: DurableObjectNamespace;
  ALERTING_ACTOR: DurableObjectNamespace;
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
}
