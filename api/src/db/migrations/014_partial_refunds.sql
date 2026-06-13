ALTER TABLE commerce_order_items
  ADD COLUMN IF NOT EXISTS refunded_quantity INT NOT NULL DEFAULT 0;

ALTER TABLE commerce_order_items
  DROP CONSTRAINT IF EXISTS commerce_order_items_refunded_qty_check;

ALTER TABLE commerce_order_items
  ADD CONSTRAINT commerce_order_items_refunded_qty_check
  CHECK (refunded_quantity >= 0 AND refunded_quantity <= quantity);
