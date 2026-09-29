-- Per-country conflict-escalation scoring, computed from gdelt_bulk_events
-- (see backend/src/countryEscalation.ts). One row per country per scoring
-- tick, so the map layer always reads the latest row and the history is
-- kept for trend display / debugging.
CREATE TABLE country_escalation_snapshots (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,   -- ISO-3166-1 alpha-2
  country_name TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  current_count INTEGER NOT NULL,
  baseline_count REAL NOT NULL,
  avg_tone REAL,
  escalation_score REAL NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('none', 'elevated', 'critical')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_country_escalation_country_time ON country_escalation_snapshots(country_code, window_end DESC);
