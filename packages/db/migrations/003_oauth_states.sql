-- 003_oauth_states: OAuth PKCE state storage

CREATE TABLE IF NOT EXISTS oauth_states (
    state         TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    redirect_uri  TEXT NOT NULL,
    provider      TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX idx_oauth_states_expires ON oauth_states (expires_at);
