-- Migration 027: the watch on monitoring queries, and notes on their timelines.
--
-- NOTHING NEEDS TO BE RUN BY HAND. The Worker creates these three tables
-- itself the first time they are needed (backend/src/queryWatch.ts,
-- ensureWatchTables). This file records their shape, and creates them when
-- a fresh local database is built from the db/ folder.
--
-- query_watch        one row per monitoring query, overwritten in place:
--                    its last 24 hours, its usual day, and whether a
--                    coverage surge is open. Replaces escalation_snapshots,
--                    which the old scorer appended to every 30 seconds and
--                    which is now emptied a little at a time.
-- query_watch_state  small flags for one-off housekeeping.
-- query_notes        the analyst's notes on a query, each pinned to a day.

CREATE TABLE IF NOT EXISTS query_watch (
    query_id TEXT PRIMARY KEY,
    last24h INTEGER NOT NULL DEFAULT 0,
    usual REAL NOT NULL DEFAULT 0,
    basis_days INTEGER NOT NULL DEFAULT 0,
    busiest INTEGER NOT NULL DEFAULT 0,
    baseline_at TEXT,
    surge_open INTEGER NOT NULL DEFAULT 0,
    alert_id TEXT,
    last_item_at TEXT,
    computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS query_watch_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS query_notes (
    id TEXT PRIMARY KEY,
    query_id TEXT NOT NULL,
    day TEXT NOT NULL,
    body TEXT NOT NULL,
    author_id TEXT,
    author_name TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_query_notes_query ON query_notes (query_id, day);

-- A query's open and closed alerts are read every time its dashboard
-- refreshes; this lets the database read only that query's rows.
CREATE INDEX IF NOT EXISTS idx_alerts_query ON alerts (query_id, resolved_at, created_at);
