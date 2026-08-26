-- Migration 009: custom_dashboards table.
--
-- User-built "bespoke" dashboards: an ordered list of widgets (stat cards,
-- charts, or a map), each pulling from the same incident-stats data already
-- used elsewhere. A dashboard can optionally be made public via a random
-- share token, giving a real URL viewable by anyone — including people
-- without an account — for live/read-only viewing.

CREATE TABLE custom_dashboards (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    widgets TEXT NOT NULL DEFAULT '[]', -- JSON array of widget configs
    is_public INTEGER NOT NULL DEFAULT 0,
    share_token TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_custom_dashboards_owner ON custom_dashboards(owner_id);
CREATE INDEX idx_custom_dashboards_share_token ON custom_dashboards(share_token);
