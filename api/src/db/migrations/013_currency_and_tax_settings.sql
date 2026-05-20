ALTER TABLE commerce_organizations
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'MXN',
  ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tax_rate_bps INT NOT NULL DEFAULT 0,
  ADD CONSTRAINT commerce_organizations_tax_rate_bps_check
    CHECK (tax_rate_bps >= 0 AND tax_rate_bps <= 10000);

ALTER TABLE commerce_products
  ALTER COLUMN currency SET DEFAULT 'MXN',
  DROP CONSTRAINT IF EXISTS commerce_products_currency_check;

ALTER TABLE commerce_wallet_accounts
  ALTER COLUMN currency SET DEFAULT 'MXN',
  DROP CONSTRAINT IF EXISTS commerce_wallet_accounts_currency_check;

ALTER TABLE commerce_orders
  ALTER COLUMN currency SET DEFAULT 'MXN',
  DROP CONSTRAINT IF EXISTS commerce_orders_currency_check;

ALTER TABLE commerce_order_items
  ALTER COLUMN currency SET DEFAULT 'MXN',
  DROP CONSTRAINT IF EXISTS commerce_order_items_currency_check;

ALTER TABLE commerce_payments
  ALTER COLUMN currency SET DEFAULT 'MXN',
  DROP CONSTRAINT IF EXISTS commerce_payments_currency_check;

ALTER TABLE commerce_wallet_transactions
  ALTER COLUMN currency SET DEFAULT 'MXN',
  DROP CONSTRAINT IF EXISTS commerce_wallet_transactions_currency_check;
