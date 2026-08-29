-- Migration 018: persistent default map view settings.
--
-- Until now, the Mapping view's starting state (which incidents/layers show,
-- what view mode, which basemap) was hardcoded to reset on every visit —
-- unselecting something didn't stick, since there was nowhere for that
-- choice to actually live. This is a single, platform-wide row (not
-- per-user or per-client) that the platform admin controls, and that
-- everyone — admin and every client alike — gets as their starting point
-- when they open Mapping. A fixed id of 'default' keeps this a genuine
-- singleton; there's only ever meant to be one row.
CREATE TABLE map_default_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    show_incidents_by_default INTEGER NOT NULL DEFAULT 1,
    default_view_mode TEXT NOT NULL DEFAULT 'markers',
    default_basemap TEXT NOT NULL DEFAULT 'osm',
    updated_at TEXT NOT NULL
);

INSERT INTO map_default_settings (id, show_incidents_by_default, default_view_mode, default_basemap, updated_at)
VALUES ('default', 1, 'markers', 'osm', datetime('now'));
