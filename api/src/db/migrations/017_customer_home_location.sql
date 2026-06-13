-- Add home store/location to customers so students and employees
-- have a primary campus while still being able to transact org-wide.

ALTER TABLE commerce_customers
  ADD COLUMN IF NOT EXISTS home_store_id UUID NULL
    REFERENCES commerce_stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_commerce_customers_home_store
  ON commerce_customers (home_store_id)
  WHERE home_store_id IS NOT NULL;
