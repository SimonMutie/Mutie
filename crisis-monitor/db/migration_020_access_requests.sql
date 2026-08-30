-- Migration 020: access requests, submitted from the sign-in screen by
-- anyone without an account yet. Deliberately just a request queue for the
-- admin to review, not an automatic account-creation flow — deciding a
-- username, password, and client assignment stays a deliberate admin action
-- through the existing client management UI, since a self-service signup
-- would bypass that entirely.
CREATE TABLE access_requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    organization TEXT,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied'
    created_at TEXT NOT NULL,
    reviewed_at TEXT
);

CREATE INDEX idx_access_requests_status ON access_requests(status);
