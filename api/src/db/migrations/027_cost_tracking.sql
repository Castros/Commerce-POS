-- Optional cost-of-goods tracking per product.
-- NULL means cost is unknown and profit/margin will not be shown for that item.
ALTER TABLE commerce_products
  ADD COLUMN IF NOT EXISTS cost_cents INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0);

-- Snapshot cost at sale time so historical margin stays accurate.
ALTER TABLE commerce_order_items
  ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0);
