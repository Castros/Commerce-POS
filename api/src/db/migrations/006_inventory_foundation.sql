CREATE TABLE IF NOT EXISTS commerce_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  store_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity_on_hand INT NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  reorder_threshold INT NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
  location TEXT NULL,
  track_inventory BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, store_id, product_id),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id),
  FOREIGN KEY (organization_id, product_id)
    REFERENCES commerce_products (organization_id, id)
);

CREATE TABLE IF NOT EXISTS commerce_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  store_id UUID NOT NULL,
  product_id UUID NOT NULL,
  order_id UUID NULL,
  type TEXT NOT NULL CHECK (type IN ('receive', 'sale', 'adjustment')),
  quantity_delta INT NOT NULL CHECK (quantity_delta <> 0),
  quantity_after INT NOT NULL CHECK (quantity_after >= 0),
  note TEXT NULL,
  created_by_user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id),
  FOREIGN KEY (organization_id, product_id)
    REFERENCES commerce_products (organization_id, id),
  FOREIGN KEY (organization_id, order_id)
    REFERENCES commerce_orders (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_inventory_items_org_store
  ON commerce_inventory_items (organization_id, store_id);

CREATE INDEX IF NOT EXISTS idx_commerce_inventory_movements_org_product_created
  ON commerce_inventory_movements (organization_id, product_id, created_at DESC);
