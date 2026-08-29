-- Migration 015: client data-sharing grants (Stage 2 of client management).
--
-- clients.can_view_all_incidents: lets a client's accounts see the full
-- shared incidents pool (not just what they've personally uploaded) —
-- READ visibility only. Deliberately does not touch write/delete
-- permissions anywhere; a client granted this can still only edit or
-- delete their own incidents, never anyone else's. Conflating "can view
-- the shared pool" with "can modify other people's data" would be a real
-- access-control bug, not just an inconsistency, so it's kept strictly to
-- the read-only endpoints in the backend code that uses this column.
ALTER TABLE clients ADD COLUMN can_view_all_incidents INTEGER NOT NULL DEFAULT 0;

-- Explicit, one-at-a-time sharing of a specific dashboard or dataset with a
-- client — the admin picks exactly what to share, rather than clients
-- automatically seeing everything an admin has ever created. Deleting the
-- underlying dashboard/dataset (or the client) cleans up the grant too.
CREATE TABLE client_dashboard_access (
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    dashboard_id TEXT NOT NULL REFERENCES custom_dashboards(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (client_id, dashboard_id)
);

CREATE TABLE client_dataset_access (
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (client_id, dataset_id)
);

CREATE INDEX idx_client_dashboard_access_dashboard ON client_dashboard_access(dashboard_id);
CREATE INDEX idx_client_dataset_access_dataset ON client_dataset_access(dataset_id);
