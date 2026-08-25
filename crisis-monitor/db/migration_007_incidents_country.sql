-- Migration 007: add missing `country` column to incidents.
--
-- Non-destructive — safe to run against the already-seeded production
-- database, same pattern as migration_003's title column. Existing rows will
-- have country = NULL until re-uploaded/edited.

ALTER TABLE incidents ADD COLUMN country TEXT;
