-- Migration 026: Regional Spotlight — a database of publications by region.
--
-- NOT required to be run by hand: the Worker creates this table itself on
-- first use (see backend/src/routes/spotlight.ts, ensureSpotlightTable).
-- This file is the readable record of the schema.

CREATE TABLE IF NOT EXISTS spotlight_entries (
    id TEXT PRIMARY KEY,
    region TEXT NOT NULL,                       -- slug, see backend/src/lib/spotlightRegions.ts
    title TEXT NOT NULL,
    product_type TEXT NOT NULL DEFAULT 'Analysis',
    countries TEXT,                             -- free text, e.g. "Sudan, South Sudan"
    summary TEXT,
    body TEXT,
    cover_image_url TEXT,
    link_url TEXT,                              -- the full report / original article, if hosted elsewhere
    link_label TEXT,
    author TEXT,
    publication_date TEXT NOT NULL,             -- YYYY-MM-DD, the date shown to readers
    status TEXT NOT NULL DEFAULT 'draft',       -- 'draft' | 'published'
    is_public INTEGER NOT NULL DEFAULT 0,       -- 1 = readable without signing in, at /spotlight/<id>
    published_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spotlight_region_date ON spotlight_entries (region, publication_date DESC);
