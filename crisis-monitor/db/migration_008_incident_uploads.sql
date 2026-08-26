-- Migration 008: incident_uploads table.
--
-- Tracks one row per upload BATCH (a whole file, or a manual entry), so a
-- large file that got chunked into several bulk-insert API calls can still be
-- identified and deleted as one unit. Previously each chunk got its own
-- random batch ID server-side, so a >500-row file split into disconnected
-- batches with no shared identifier — this is what made "delete this whole
-- upload" impossible for anything bigger than one chunk.

CREATE TABLE incident_uploads (
    id TEXT PRIMARY KEY, -- matches incidents.upload_batch_id
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_incident_uploads_owner ON incident_uploads(owner_id);
