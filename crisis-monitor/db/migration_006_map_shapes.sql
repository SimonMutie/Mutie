-- Migration 006: map_shapes table.
--
-- Freeform shape overlays on the incidents map: hand-drawn polygons/rectangles/
-- circles, or whole layers uploaded from a shapefile (.zip) or GeoJSON file.
-- Each row is one GeoJSON Feature or FeatureCollection plus a style, so an
-- uploaded shapefile with many polygons is stored as a single FeatureCollection
-- row (styled as one layer), while hand-drawn shapes get one row each.

CREATE TABLE map_shapes (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('drawn', 'shapefile', 'geojson')),
    geometry TEXT NOT NULL, -- GeoJSON Feature or FeatureCollection, JSON-encoded
    style TEXT NOT NULL DEFAULT '{}', -- { color, fillColor, fillOpacity, weight, dashArray }
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_map_shapes_owner ON map_shapes(owner_id);
