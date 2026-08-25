-- Migration 004: incidents table.
--
-- A second, independent data pillar alongside the news-monitoring `events`
-- table: structured incident records uploaded from Excel (via the frontend's
-- SheetJS-based parser, POSTed as JSON to /api/incidents/bulk), rather than
-- pulled automatically from GDELT. Used for the incidents map + dashboard.
--
-- Column names mirror the source spreadsheet closely (Province, County,
-- District, City, Suburb, ...) so the upload mapping stays simple and
-- obvious, rather than being renamed into a different internal vocabulary.

CREATE TABLE incidents (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,

    -- Raw date/time strings as they appeared in the spreadsheet (kept for
    -- display/fidelity), plus a best-effort combined ISO timestamp for
    -- sorting and time-series charting. occurred_at may be NULL if the
    -- source date couldn't be parsed.
    occurred_date TEXT,
    occurred_time TEXT,
    occurred_at TEXT,

    province TEXT,
    county TEXT,
    district TEXT,
    city TEXT,
    suburb TEXT,
    precise_location TEXT,
    latitude REAL,
    longitude REAL,

    sector TEXT,
    actor TEXT,
    operation TEXT,
    tactic TEXT,
    severity TEXT,
    details TEXT,
    target TEXT,
    interest_group TEXT,
    actual_main_victim TEXT,
    intended_primary_target TEXT,

    civilian_death_child INTEGER,
    civilian_death_female INTEGER,
    civilian_death_male INTEGER,
    civilian_death_unknown INTEGER,
    civilian_injury_female INTEGER,
    civilian_injury_male INTEGER,
    civilian_injury_unknown INTEGER,
    kidnappings_ngo INTEGER,

    -- Full original row as uploaded, JSON-encoded — lets the UI show/export
    -- exactly what was imported even for spreadsheet columns not modeled
    -- above, and makes debugging a bad import straightforward.
    raw_row TEXT NOT NULL DEFAULT '{}',

    -- Groups rows uploaded together in one file, so an accidental bad import
    -- can be identified and deleted as a batch.
    upload_batch_id TEXT,

    created_at TEXT NOT NULL
);

CREATE INDEX idx_incidents_owner ON incidents(owner_id);
CREATE INDEX idx_incidents_occurred_at ON incidents(occurred_at);
CREATE INDEX idx_incidents_province ON incidents(province);
CREATE INDEX idx_incidents_sector ON incidents(sector);
CREATE INDEX idx_incidents_actor ON incidents(actor);
CREATE INDEX idx_incidents_upload_batch ON incidents(upload_batch_id);
