-- Project database template
-- Applied to each new project database (keel_p_<slug>)

-- Enable pg_notify for realtime subscriptions
CREATE OR REPLACE FUNCTION notify_table_change() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify(
        'keel_change',
        json_build_object(
            'table', TG_TABLE_NAME,
            'op', TG_OP,
            'data', row_to_json(NEW),
            'old_data', CASE WHEN TG_OP = 'UPDATE' OR TG_OP = 'DELETE'
                        THEN row_to_json(OLD) ELSE NULL END
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS with default open policy (locked down by app)
ALTER DATABASE CURRENT SET row_security TO on;

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _keel_migrations (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- API keys table for project-level auth
CREATE TABLE IF NOT EXISTS _keel_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash    TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT 'default',
    scopes      TEXT[] NOT NULL DEFAULT ARRAY['read', 'write'],
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);
