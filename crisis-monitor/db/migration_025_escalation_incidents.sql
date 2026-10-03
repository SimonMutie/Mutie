-- Article-coded escalation incidents (see backend/src/escalationIncidents.ts),
-- replacing the per-country scoring in migration_024. The Worker creates
-- these tables itself on first run (CREATE TABLE IF NOT EXISTS), so applying
-- this file by hand is optional; it is here as the schema of record.
--
--   escalation_articles   one row per article URL the pipeline has looked at,
--                         with what it decided and why (the audit trail)
--   escalation_reports    one row per event coded from an article: where,
--                         when, who, the indicators with their verbatim
--                         quotes, and how the location was resolved
--   escalation_incidents  reports grouped by place; level, criteria met,
--                         analyst summary/assessment, linked alert
--   geocode_cache         place-name lookups (hit or miss), so each distinct
--                         place costs at most one geocoder request
--
-- country_escalation_snapshots (migration_024) is no longer written or read.
-- It can be dropped once this is deployed:  DROP TABLE country_escalation_snapshots;

CREATE TABLE IF NOT EXISTS escalation_articles (
  id TEXT PRIMARY KEY,               -- hash of the canonical URL
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT,
  origin TEXT NOT NULL,              -- 'africa-wire' | 'wire-feed' | 'gdelt'
  published_at TEXT,
  text_basis TEXT,                   -- 'full_text' | 'feed_summary'
  status TEXT NOT NULL,              -- 'processing' | 'coded' | 'rejected' | 'unreadable' | 'error'
  rejection_reason TEXT,
  rejection_note TEXT,
  report_count INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  model TEXT,
  processed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escalation_articles_processed ON escalation_articles (processed_at);

CREATE TABLE IF NOT EXISTS escalation_reports (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  incident_id TEXT,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  place TEXT,
  admin1 TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  geo_precision TEXT NOT NULL,       -- 'place' | 'approximate' | 'region' | 'country'
  geo_method TEXT NOT NULL,          -- 'curated' | 'geonames' | 'geocoder' | 'model-estimate' | 'region-centroid' | 'country-centroid'
  geo_label TEXT,
  event_date TEXT NOT NULL,          -- YYYY-MM-DD
  date_basis TEXT NOT NULL,          -- 'stated' | 'publication'
  actors TEXT NOT NULL DEFAULT '[]',
  indicators TEXT NOT NULL DEFAULT '[]',   -- [{id,label,quote}]
  fatalities INTEGER,
  trajectory TEXT NOT NULL,
  trajectory_reason TEXT,
  what_happened TEXT NOT NULL,
  significance TEXT,
  confidence TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '[]',  -- what verification changed or could not confirm
  excerpt TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escalation_reports_incident ON escalation_reports (incident_id);
CREATE INDEX IF NOT EXISTS idx_escalation_reports_event_date ON escalation_reports (event_date);

CREATE TABLE IF NOT EXISTS escalation_incidents (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  region_key TEXT NOT NULL DEFAULT '',
  location_label TEXT,
  admin1 TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  geo_precision TEXT NOT NULL,
  level TEXT NOT NULL,               -- 'none' | 'watch' | 'elevated' | 'critical'
  status TEXT NOT NULL,              -- 'active' | 'expired'
  headline TEXT,
  summary TEXT,
  assessment TEXT,
  outlook TEXT,
  caveats TEXT,
  detail TEXT NOT NULL DEFAULT '{}', -- criteria met, indicators with quotes, sources, actors
  content_hash TEXT,
  state_hash TEXT,
  synthesis_model TEXT,
  alerted_level TEXT,
  alert_id TEXT,
  first_event_date TEXT,
  last_event_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_escalation_incidents_status ON escalation_incidents (status, level);

CREATE TABLE IF NOT EXISTS escalation_pipeline_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS geocode_cache (
  key TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  query TEXT NOT NULL,
  lat REAL,
  lon REAL,
  display_name TEXT,
  created_at TEXT NOT NULL
);
