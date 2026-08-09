-- Migration 002: user accounts + per-query ownership.
--
-- Adds a users table and an owner_id column on monitoring_queries so each
-- client only sees the queries (and the dashboard built from them) that
-- belong to their account. Non-destructive — safe to run against the
-- already-seeded production database.
--
-- After running this, visit the site: since the users table starts empty,
-- you'll land on a one-time "set up admin account" screen instead of a
-- login screen. No password hashes need to be hand-crafted here.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'client')),
    created_at TEXT NOT NULL
);

ALTER TABLE monitoring_queries ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX idx_monitoring_queries_owner ON monitoring_queries (owner_id);
