-- Migration 014: client organizations and sub-accounts.
--
-- Until now, "client" was just a role on an individual login — no way to
-- group several logins under one organization, cap how many logins a given
-- client is allowed, or let one of a client's own people manage their
-- teammates' logins without needing the platform admin involved every time.
--
-- clients: one row per client organization (e.g. "Acme Corp"), not per
-- login — max_accounts caps how many user logins can belong to it.
--
-- users.client_id: which client organization this login belongs to. NULL
-- for the platform admin and for any standalone login not part of a client
-- org (existing accounts keep working exactly as before — this is additive).
--
-- users.is_client_admin: whether this specific login can manage its own
-- client's *other* logins (create/remove them, up to max_accounts) without
-- needing platform-admin rights generally. Meaningless (and ignored) when
-- client_id is NULL.

CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    max_accounts INTEGER NOT NULL DEFAULT 3,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN is_client_admin INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_users_client ON users(client_id);
