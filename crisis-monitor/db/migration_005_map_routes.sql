-- Migration 005: map_routes table.
--
-- User-drawn route simulations on the incidents map: an ordered list of
-- waypoints, either snapped to real roads (via OSRM) or connected as a
-- straight "off-road" path, saved so they persist across sessions and so
-- multiple simulations can exist side by side.

CREATE TABLE map_routes (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('road', 'freehand')),
    waypoints TEXT NOT NULL, -- JSON array of [lat, lng] pairs, the clicked points in order
    geometry TEXT NOT NULL, -- JSON array of [lat, lng] pairs, the actual drawn line (road-snapped or straight)
    distance_km REAL,
    duration_min REAL, -- only meaningful for mode='road'
    color TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_map_routes_owner ON map_routes(owner_id);
