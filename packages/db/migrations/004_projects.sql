-- 004_projects: Project registry for multi-tenant DB provisioning

CREATE TABLE IF NOT EXISTS projects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id    UUID NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    slug          TEXT NOT NULL UNIQUE,
    db_name       TEXT NOT NULL UNIQUE,
    db_user       TEXT NOT NULL,
    api_key_hash  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_account ON projects (account_id);
CREATE INDEX idx_projects_slug ON projects (slug);
