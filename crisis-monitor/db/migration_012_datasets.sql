-- Migration 012: datasets + dataset_rows.
--
-- General-purpose data upload, separate from the incidents-specific schema.
-- Each dataset stores its own detected column schema (name + type), and each
-- row is a JSON blob rather than fixed columns — this is what makes the same
-- storage work for a health-stats CSV, an economic-indicators spreadsheet, or
-- anything else with completely different columns, without a new SQL table
-- per upload. Aggregation happens via SQLite's json_extract() at query time,
-- with field names validated against that dataset's own schema (never a
-- hardcoded allowlist), which is what keeps dynamic column names safe from
-- injection despite not being bindable SQL parameters.

CREATE TABLE datasets (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    -- JSON array of { name: string, type: "text" | "number" | "date" },
    -- detected from the uploaded file and confirmable before import.
    schema_json TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE dataset_rows (
    id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    row_data TEXT NOT NULL, -- JSON object, one key per schema column
    created_at TEXT NOT NULL
);

CREATE INDEX idx_datasets_owner ON datasets(owner_id);
CREATE INDEX idx_dataset_rows_dataset ON dataset_rows(dataset_id);
