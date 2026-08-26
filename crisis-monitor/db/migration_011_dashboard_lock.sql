-- Migration 011: locked flag on custom_dashboards.
--
-- Lets a dashboard be flipped to read-only once editing is done — hides the
-- add/edit/remove/rename controls and disables drag/resize entirely, so it
-- can't be bumped or changed by accident while just being viewed. Individual
-- widgets can also be locked one at a time (stored inside the existing
-- widgets JSON column, no schema change needed for that part).

ALTER TABLE custom_dashboards ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
