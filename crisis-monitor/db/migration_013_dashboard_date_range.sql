-- Migration 013: dashboard-wide date range filter.
--
-- A dashboard-level "what date range am I looking at" filter, applied
-- consistently across every Incidents-sourced widget on the dashboard at
-- once (stats, breakdowns, crosstabs, daily calendar buckets, the incident
-- map's own point list) — set once by whoever's building the dashboard,
-- persisted so it's still in effect on reload and for public share viewers,
-- not just a per-session filter that resets each time someone opens it.

ALTER TABLE custom_dashboards ADD COLUMN date_range_from TEXT;
ALTER TABLE custom_dashboards ADD COLUMN date_range_to TEXT;
