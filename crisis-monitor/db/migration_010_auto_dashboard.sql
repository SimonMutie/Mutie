-- Migration 010: is_auto flag on custom_dashboards.
--
-- The "Auto Dashboard" view now uses the exact same editable widget system as
-- "Create Bespoke" (real drag-resize, color/legend/label editing, etc.)
-- instead of being separate hardcoded charts. Each user gets exactly one
-- reserved dashboard row with is_auto=1, created on first visit with a
-- sensible default widget set, found via GET /api/custom-dashboards/auto.

ALTER TABLE custom_dashboards ADD COLUMN is_auto INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_custom_dashboards_is_auto ON custom_dashboards(owner_id, is_auto);
