-- 001_accounts: Core account table
-- Stores user accounts from OAuth providers

CREATE TABLE IF NOT EXISTS accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL,
    name        TEXT NOT NULL,
    avatar_url  TEXT,
    provider    TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    provider_id TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_id)
);

CREATE INDEX idx_accounts_email ON accounts (email);
