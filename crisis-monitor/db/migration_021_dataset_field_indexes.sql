-- Migration 021: tracks which dataset_rows field indexes have been
-- created, so ensureFieldIndex (see backend/src/routes/datasets.ts) only
-- attempts CREATE INDEX once per field name rather than re-checking on
-- every query. One index per field name benefits every dataset that has a
-- same-named column, not just one dataset specifically.
CREATE TABLE dataset_field_indexes (
    field_name TEXT PRIMARY KEY,
    index_name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
