ALTER TABLE commerce_inventory_movements
  DROP CONSTRAINT IF EXISTS commerce_inventory_movements_type_check;

ALTER TABLE commerce_inventory_movements
  ADD CONSTRAINT commerce_inventory_movements_type_check
  CHECK (type IN ('receive', 'sale', 'adjustment', 'transfer_in', 'transfer_out'));

CREATE TABLE IF NOT EXISTS commerce_inventory_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  from_store_id UUID NOT NULL,
  to_store_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending_approval', 'completed', 'rejected')),
  note TEXT NULL,
  created_by_user_id UUID NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, from_store_id)
    REFERENCES commerce_stores (organization_id, id),
  FOREIGN KEY (organization_id, to_store_id)
    REFERENCES commerce_stores (organization_id, id),
  FOREIGN KEY (organization_id, product_id)
    REFERENCES commerce_products (organization_id, id),
  CHECK (from_store_id <> to_store_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_inventory_transfers_org_created
  ON commerce_inventory_transfers (organization_id, created_at DESC);

