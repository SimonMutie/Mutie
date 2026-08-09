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
}
