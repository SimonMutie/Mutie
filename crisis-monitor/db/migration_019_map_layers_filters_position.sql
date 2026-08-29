-- Migration 019: persistent layer visibility, full default filters, and a
-- lockable default map position.
--
-- visible on map_routes/map_shapes: until now this was purely a client-side
-- field that reset to "on" every time routes/shapes were fetched — there
-- was no column here to persist it at all. Since routes and shapes are
-- already owner-scoped (each user only sees their own), this gives every
-- user, admin or client, a real "what I had turned off stays off" that
-- sticks across sessions, not a shared platform-wide setting.
ALTER TABLE map_routes ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE map_shapes ADD COLUMN visible INTEGER NOT NULL DEFAULT 1;

-- default_filters: a JSON blob covering date range plus all 15 categorical
-- fields (sector, tactic, country, etc.) — stored as one column rather than
-- 17 separate ones, since these are all optional and only ever read/written
-- together as a single filter object, never queried individually.
--
-- map_center_lat/lng/zoom + position_locked: the platform-wide starting
-- camera position for Mapping, same admin-only, everyone-inherits-it model
-- as the rest of this table. Null lat/lng/zoom means no fixed position is
-- set (falls back to the existing natural centering behavior);
-- position_locked separately controls whether that saved position is
-- actually the current live one being enforced.
ALTER TABLE map_default_settings ADD COLUMN default_filters TEXT;
ALTER TABLE map_default_settings ADD COLUMN map_center_lat REAL;
ALTER TABLE map_default_settings ADD COLUMN map_center_lng REAL;
ALTER TABLE map_default_settings ADD COLUMN map_zoom REAL;
ALTER TABLE map_default_settings ADD COLUMN position_locked INTEGER NOT NULL DEFAULT 0;
