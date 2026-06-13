-- Composite unique on stores needed for FK reference below
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commerce_stores_org_id_unique'
  ) THEN
    ALTER TABLE commerce_stores
      ADD CONSTRAINT commerce_stores_org_id_unique UNIQUE (organization_id, id);
  END IF;
END $$;

-- Pre-assigned charges against specific students.
-- Surfaces at the register when the student is selected.
-- Payment converts the assignment into an order via the existing sale flow.

CREATE TABLE IF NOT EXISTS commerce_fee_assignments (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES commerce_organizations(id),
  store_id             UUID        NOT NULL,
  customer_id          UUID        NOT NULL REFERENCES commerce_customers(id),
  category_id          UUID        NULL   REFERENCES commerce_product_categories(id),

  amount_cents         BIGINT      NOT NULL CHECK (amount_cents > 0),
  currency             TEXT        NOT NULL DEFAULT 'USD',
  description          TEXT        NOT NULL,
  due_date             DATE        NULL,

  status               TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'paid', 'cancelled')),

  paid_order_id        UUID        NULL REFERENCES commerce_orders(id),
  paid_at              TIMESTAMPTZ NULL,

  created_by_user_id   UUID        NULL,
  cancelled_by_user_id UUID        NULL,
  cancelled_at         TIMESTAMPTZ NULL,
  cancel_reason        TEXT        NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fee_assignment_paid_once
    CHECK (status != 'paid' OR paid_order_id IS NOT NULL),

  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id)
);

-- Fast register lookup: pending fees for a student
CREATE INDEX IF NOT EXISTS idx_fee_assignments_customer_status
  ON commerce_fee_assignments (organization_id, customer_id, status, due_date ASC)
  WHERE status = 'pending';

-- Admin list: all fees for an org newest first
CREATE INDEX IF NOT EXISTS idx_fee_assignments_org_created
  ON commerce_fee_assignments (organization_id, created_at DESC);

-- Order → fee linkage for refunds and receipts
CREATE INDEX IF NOT EXISTS idx_fee_assignments_paid_order
  ON commerce_fee_assignments (organization_id, paid_order_id)
  WHERE paid_order_id IS NOT NULL;

-- Link order items back to the fee assignment that was collected
ALTER TABLE commerce_order_items
  ADD COLUMN IF NOT EXISTS fee_assignment_id UUID NULL REFERENCES commerce_fee_assignments(id);
