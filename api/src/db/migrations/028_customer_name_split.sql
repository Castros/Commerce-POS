-- Split customer name into structured fields for Spanish naming conventions
-- (first_name, middle_name, last_name_1/apellido paterno, last_name_2/apellido materno)
-- The existing `name` column is kept and kept in sync server-side for search, receipts, orders.

ALTER TABLE commerce_customers
  ADD COLUMN IF NOT EXISTS first_name   TEXT,
  ADD COLUMN IF NOT EXISTS middle_name  TEXT,
  ADD COLUMN IF NOT EXISTS last_name_1  TEXT,
  ADD COLUMN IF NOT EXISTS last_name_2  TEXT;
