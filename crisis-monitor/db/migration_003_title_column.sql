-- Migration 003: dedicated title column, for field-scoped query operators.
--
-- Adds events.title, kept separate from events.content (which additionally
-- includes the URL and fetched article body). This backs the new title:/
-- titleCharCount: query operators. Non-destructive — safe to run against the
-- already-seeded production database. New connector inserts (gdelt.ts,
-- mockGenerator via ingest.ts) populate it going forward; existing rows will
-- have title = NULL until they're re-ingested, so title:/titleCharCount:
-- queries won't match older backfilled events, only new ones from here on.

ALTER TABLE events ADD COLUMN title TEXT;
