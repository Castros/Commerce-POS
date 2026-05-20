-- Add matricula / school-assigned external ID to POS customers.
-- This is the bridge key when a school uses POS standalone first and later connects the Spelling App,
-- or any external SIS. Matched against students.external_id in the educational app.

ALTER TABLE commerce_customers
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Unique per org so the same matricula can exist in different schools.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_customers_org_external_id
  ON commerce_customers (organization_id, external_id)
  WHERE external_id IS NOT NULL;
