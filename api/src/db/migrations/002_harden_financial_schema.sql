ALTER TABLE commerce_organizations
  ADD CONSTRAINT commerce_organizations_org_id_unique UNIQUE (id),
  ADD CONSTRAINT commerce_organizations_type_check
    CHECK (type IN ('school', 'restaurant', 'retail_business', 'nonprofit', 'other'));

ALTER TABLE commerce_stores
  ADD CONSTRAINT commerce_stores_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT commerce_stores_type_check
    CHECK (type IN ('cafeteria', 'uniform_shop', 'bookstore', 'school_supplies', 'restaurant', 'retail', 'event_sales', 'other'));

ALTER TABLE commerce_product_categories
  ADD CONSTRAINT commerce_product_categories_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT commerce_product_categories_parent_org_fk
    FOREIGN KEY (organization_id, parent_id)
    REFERENCES commerce_product_categories (organization_id, id);

ALTER TABLE commerce_products
  ADD CONSTRAINT commerce_products_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT commerce_products_store_org_fk
    FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id),
  ADD CONSTRAINT commerce_products_category_org_fk
    FOREIGN KEY (organization_id, category_id)
    REFERENCES commerce_product_categories (organization_id, id),
  ADD CONSTRAINT commerce_products_currency_check CHECK (currency = 'USD');

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_products_org_store_sku_unique
  ON commerce_products (organization_id, store_id, sku)
  WHERE sku IS NOT NULL;

ALTER TABLE commerce_customers
  ADD CONSTRAINT commerce_customers_org_id_unique UNIQUE (organization_id, id);

ALTER TABLE commerce_wallet_accounts
  ADD CONSTRAINT commerce_wallet_accounts_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT commerce_wallet_accounts_customer_org_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES commerce_customers (organization_id, id),
  ADD CONSTRAINT commerce_wallet_accounts_currency_check CHECK (currency = 'USD');

ALTER TABLE commerce_orders
  ADD CONSTRAINT commerce_orders_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT commerce_orders_store_org_fk
    FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id),
  ADD CONSTRAINT commerce_orders_customer_org_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES commerce_customers (organization_id, id),
  ADD CONSTRAINT commerce_orders_status_check
    CHECK (status IN ('draft', 'paid', 'voided', 'refunded', 'partially_refunded')),
  ADD CONSTRAINT commerce_orders_payment_status_check
    CHECK (payment_status IN ('unpaid', 'paid', 'partially_paid', 'refunded', 'failed')),
  ADD CONSTRAINT commerce_orders_currency_check CHECK (currency = 'USD');

ALTER TABLE commerce_order_items
  ADD COLUMN IF NOT EXISTS organization_id UUID NULL;

UPDATE commerce_order_items oi
SET organization_id = o.organization_id
FROM commerce_orders o
WHERE oi.order_id = o.id
  AND oi.organization_id IS NULL;

ALTER TABLE commerce_order_items
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT commerce_order_items_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT commerce_order_items_order_org_fk
    FOREIGN KEY (organization_id, order_id)
    REFERENCES commerce_orders (organization_id, id),
  ADD CONSTRAINT commerce_order_items_product_org_fk
    FOREIGN KEY (organization_id, product_id)
    REFERENCES commerce_products (organization_id, id),
  ADD CONSTRAINT commerce_order_items_currency_check CHECK (currency = 'USD');

ALTER TABLE commerce_payments
  ADD CONSTRAINT commerce_payments_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT commerce_payments_order_org_fk
    FOREIGN KEY (organization_id, order_id)
    REFERENCES commerce_orders (organization_id, id),
  ADD CONSTRAINT commerce_payments_method_check
    CHECK (method IN ('cash', 'card', 'wallet', 'stripe', 'admin_credit', 'other')),
  ADD CONSTRAINT commerce_payments_status_check
    CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'voided')),
  ADD CONSTRAINT commerce_payments_currency_check CHECK (currency = 'USD');

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_payments_one_success_per_order
  ON commerce_payments (order_id)
  WHERE status = 'succeeded';

ALTER TABLE commerce_wallet_transactions
  ADD CONSTRAINT commerce_wallet_transactions_org_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT commerce_wallet_transactions_wallet_org_fk
    FOREIGN KEY (organization_id, wallet_account_id)
    REFERENCES commerce_wallet_accounts (organization_id, id),
  ADD CONSTRAINT commerce_wallet_transactions_order_org_fk
    FOREIGN KEY (organization_id, order_id)
    REFERENCES commerce_orders (organization_id, id),
  ADD CONSTRAINT commerce_wallet_transactions_type_check
    CHECK (type IN ('top_up', 'purchase', 'refund', 'adjustment')),
  ADD CONSTRAINT commerce_wallet_transactions_currency_check CHECK (currency = 'USD'),
  ADD CONSTRAINT commerce_wallet_transactions_amount_type_check
    CHECK (
      (type IN ('top_up', 'refund') AND amount_cents > 0)
      OR (type = 'purchase' AND amount_cents < 0)
      OR (type = 'adjustment' AND amount_cents <> 0)
    );

ALTER TABLE commerce_idempotency_keys
  ADD CONSTRAINT commerce_idempotency_keys_org_key_unique UNIQUE (organization_id, idempotency_key);

ALTER TABLE commerce_audit_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS metadata JSONB NULL;

UPDATE commerce_audit_events
SET request_id = gen_random_uuid()::TEXT
WHERE request_id IS NULL;

ALTER TABLE commerce_audit_events
  ALTER COLUMN request_id SET NOT NULL,
  ADD CONSTRAINT commerce_audit_events_store_org_fk
    FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id);

CREATE OR REPLACE FUNCTION reject_wallet_transaction_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'wallet transactions are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wallet_transactions_no_update ON commerce_wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_no_update
BEFORE UPDATE ON commerce_wallet_transactions
FOR EACH ROW EXECUTE FUNCTION reject_wallet_transaction_mutation();

DROP TRIGGER IF EXISTS trg_wallet_transactions_no_delete ON commerce_wallet_transactions;
CREATE TRIGGER trg_wallet_transactions_no_delete
BEFORE DELETE ON commerce_wallet_transactions
FOR EACH ROW EXECUTE FUNCTION reject_wallet_transaction_mutation();
