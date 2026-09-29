-- Migration 022: listening_queries table.
--
-- Named, saved Social Listening searches (see backend/src/routes/socialListening.ts
-- and listeningQueries.ts). `query` is the raw string passed straight through
-- to GDELT's DOC 2.0 API, which natively understands boolean AND (implicit
-- between terms), OR (uppercase), "quoted phrases", -negation, and
-- (parenthetical grouping) — so no separate query-language layer is needed
-- here, just a place to persist a query under a name.
--
-- `pinned` drives the left-hand map rail's "Social Listening" flyout: a
-- pinned query shows there as a toggle, and toggling it on starts polling it
-- in the background (see the frontend's LAYER_DEFS-style polling, applied to
-- listening queries) so the rail can show a live tone/volume badge the same
-- way every other layer shows a live count.

CREATE TABLE listening_queries (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_listening_queries_owner ON listening_queries(owner_id);
