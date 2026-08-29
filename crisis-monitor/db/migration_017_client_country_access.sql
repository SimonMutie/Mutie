-- Migration 017: country-scoped client access (Stage 3 of client management).
--
-- A client with zero rows here is deliberately UNRESTRICTED, not locked out
-- of everything — this makes the feature opt-in per client. Every existing
-- client keeps working exactly as before until the platform admin
-- explicitly adds one or more countries for a specific client, at which
-- point that client's accounts are restricted to only those countries for
-- BOTH viewing and uploading incidents (see effectiveCountryScope and the
-- upload/edit validation in incidents.ts).
CREATE TABLE client_country_access (
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    country TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (client_id, country)
);

CREATE INDEX idx_client_country_access_client ON client_country_access(client_id);
