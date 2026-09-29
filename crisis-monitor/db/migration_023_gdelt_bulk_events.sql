-- Bulk-ingested GDELT Event Export rows (conflict-toned events only —
-- QuadClass 3 "Verbal Conflict" or 4 "Material Conflict"), pulled from
-- GDELT's own 15-minute export files instead of its live, shared, rate-
-- limited query API. See ingestGdeltBulkEvents() in
-- backend/src/connectors/gdeltBulk.ts for the full rationale.
CREATE TABLE gdelt_bulk_events (
  id TEXT PRIMARY KEY,          -- GDELT GlobalEventID
  event_date TEXT NOT NULL,     -- SQLDATE, YYYYMMDD
  date_added TEXT NOT NULL,     -- DATEADDED, YYYYMMDDHHMMSS (UTC)
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  place_name TEXT NOT NULL,
  goldstein REAL,
  num_mentions INTEGER,
  avg_tone REAL,
  event_code TEXT,
  quad_class INTEGER NOT NULL,
  source_url TEXT,
  ingested_at TEXT NOT NULL
);
CREATE INDEX idx_gdelt_bulk_events_date_added ON gdelt_bulk_events(date_added);
CREATE INDEX idx_gdelt_bulk_events_quad ON gdelt_bulk_events(quad_class);

-- Small key/value table for ingestion bookkeeping (e.g. the last GDELT
-- export timestamp already processed, so a 5-minute cron tick that lands
-- between GDELT's 15-minute export refreshes is a cheap no-op).
CREATE TABLE gdelt_ingest_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
