CREATE TABLE IF NOT EXISTS commerce_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  email TEXT NULL,
  name TEXT NULL,
  role TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, email),
  CHECK (role IN ('platform_admin', 'organization_owner', 'organization_admin', 'store_manager', 'cashier', 'accountant', 'parent', 'customer', 'service'))
);

CREATE TABLE IF NOT EXISTS commerce_user_store_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  user_id UUID NOT NULL,
  store_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id, store_id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES commerce_users (organization_id, id),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id)
);

CREATE TABLE IF NOT EXISTS commerce_service_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES commerce_organizations(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'service',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (role IN ('service', 'platform_admin'))
);

CREATE INDEX IF NOT EXISTS idx_commerce_users_org_role
  ON commerce_users (organization_id, role, active);

CREATE INDEX IF NOT EXISTS idx_commerce_user_store_assignments_user
  ON commerce_user_store_assignments (organization_id, user_id);
