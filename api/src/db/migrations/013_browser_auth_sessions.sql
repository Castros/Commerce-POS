ALTER TABLE commerce_users
  ADD COLUMN IF NOT EXISTS pin_hash TEXT NULL,
  ADD COLUMN IF NOT EXISTS pin_salt TEXT NULL,
  ADD COLUMN IF NOT EXISTS pin_last4 TEXT NULL,
  ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS commerce_browser_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES commerce_users (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_browser_sessions_org_user
  ON commerce_browser_sessions (organization_id, user_id, active);

CREATE INDEX IF NOT EXISTS idx_commerce_browser_sessions_expires
  ON commerce_browser_sessions (expires_at);
