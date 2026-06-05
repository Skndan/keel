-- 006_project_oauth_r2_configs: Add per-project OAuth + R2 config columns
-- These are stored encrypted (AES-256-GCM) with ENCRYPTION_KEY

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS google_client_id TEXT,
  ADD COLUMN IF NOT EXISTS google_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS github_client_id TEXT,
  ADD COLUMN IF NOT EXISTS github_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS r2_access_key_id TEXT,
  ADD COLUMN IF NOT EXISTS r2_secret_access_key TEXT,
  ADD COLUMN IF NOT EXISTS r2_bucket TEXT,
  ADD COLUMN IF NOT EXISTS r2_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS r2_public_url TEXT;
