-- Migration 016: client logos.
--
-- Stored directly as a base64 data URL in D1 rather than an object storage
-- bucket (R2) — this app has no R2 binding configured yet, and setting one
-- up requires provisioning a bucket by hand in the Cloudflare dashboard
-- first. For something as small as a logo image, a size-capped base64
-- string in an existing table is the lower-friction choice; it can move to
-- R2 later without much rework if logos ever need to get larger than that
-- cap comfortably allows.
ALTER TABLE clients ADD COLUMN logo_data TEXT;
