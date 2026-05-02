CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS commerce_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  external_school_id UUID NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  external_school_id UUID NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  name TEXT NOT NULL,
  parent_id UUID NULL REFERENCES commerce_product_categories(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  store_id UUID NULL REFERENCES commerce_stores(id),
  category_id UUID NULL REFERENCES commerce_product_categories(id),
  name TEXT NOT NULL,
  description TEXT NULL,
  sku TEXT NULL,
  price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  taxable BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  external_student_id UUID NULL,
  external_parent_id UUID NULL,
  name TEXT NULL,
  email TEXT NULL,
  phone TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  customer_id UUID NOT NULL REFERENCES commerce_customers(id),
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, customer_id, currency)
);

CREATE TABLE IF NOT EXISTS commerce_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  store_id UUID NOT NULL REFERENCES commerce_stores(id),
  customer_id UUID NULL REFERENCES commerce_customers(id),
  status TEXT NOT NULL,
  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  tax_cents BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_status TEXT NOT NULL,
  created_by_user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (total_cents = subtotal_cents + tax_cents - discount_cents)
);

CREATE TABLE IF NOT EXISTS commerce_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES commerce_orders(id),
  product_id UUID NOT NULL REFERENCES commerce_products(id),
  name_snapshot TEXT NOT NULL,
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
  quantity INT NOT NULL CHECK (quantity > 0),
  line_total_cents BIGINT NOT NULL CHECK (line_total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (line_total_cents = unit_price_cents * quantity)
);

CREATE TABLE IF NOT EXISTS commerce_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  order_id UUID NOT NULL REFERENCES commerce_orders(id),
  method TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL,
  provider TEXT NULL,
  provider_payment_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  wallet_account_id UUID NOT NULL REFERENCES commerce_wallet_accounts(id),
  order_id UUID NULL REFERENCES commerce_orders(id),
  type TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  balance_after_cents BIGINT NOT NULL CHECK (balance_after_cents >= 0),
  source TEXT NULL,
  note TEXT NULL,
  created_by_user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commerce_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INT NULL,
  response_body JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS commerce_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES commerce_organizations(id),
  store_id UUID NULL REFERENCES commerce_stores(id),
  actor_user_id UUID NULL,
  actor_service TEXT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NULL,
  summary JSONB NULL,
  ip_address INET NULL,
  user_agent TEXT NULL,
  request_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commerce_stores_org_active
  ON commerce_stores (organization_id, active);

CREATE INDEX IF NOT EXISTS idx_commerce_products_org_store_active
  ON commerce_products (organization_id, store_id, active);

CREATE INDEX IF NOT EXISTS idx_commerce_products_org_sku
  ON commerce_products (organization_id, sku);

CREATE INDEX IF NOT EXISTS idx_commerce_customers_org_external_student
  ON commerce_customers (organization_id, external_student_id);

CREATE INDEX IF NOT EXISTS idx_commerce_wallet_accounts_org_customer
  ON commerce_wallet_accounts (organization_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_commerce_orders_org_store_created
  ON commerce_orders (organization_id, store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commerce_orders_org_customer_created
  ON commerce_orders (organization_id, customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commerce_payments_order
  ON commerce_payments (order_id);

CREATE INDEX IF NOT EXISTS idx_commerce_wallet_transactions_wallet_created
  ON commerce_wallet_transactions (wallet_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commerce_audit_events_org_created
  ON commerce_audit_events (organization_id, created_at DESC);

