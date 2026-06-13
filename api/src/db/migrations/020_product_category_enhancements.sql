-- Add UI metadata columns to existing commerce_product_categories table
ALTER TABLE commerce_product_categories
  ADD COLUMN IF NOT EXISTS sort_order  INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS color       TEXT     NULL,
  ADD COLUMN IF NOT EXISTS description TEXT     NULL,
  ADD COLUMN IF NOT EXISTS is_system   BOOLEAN  NOT NULL DEFAULT FALSE;

-- Composite unique needed for FK reference in 021
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commerce_product_categories_org_id_unique'
  ) THEN
    ALTER TABLE commerce_product_categories
      ADD CONSTRAINT commerce_product_categories_org_id_unique UNIQUE (organization_id, id);
  END IF;
END $$;

-- Unique category name per org (case-insensitive, active only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_categories_org_name_unique
  ON commerce_product_categories (organization_id, lower(name))
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_product_categories_org_active
  ON commerce_product_categories (organization_id, active, sort_order);

-- Seed default categories for all existing orgs that don't have them yet
INSERT INTO commerce_product_categories
  (organization_id, name, description, sort_order, is_system, active)
SELECT
  o.id,
  cat.name,
  cat.description,
  cat.sort_order,
  TRUE,
  TRUE
FROM commerce_organizations o
CROSS JOIN (VALUES
  ('Cafeteria', 'Daily food and beverage sales',          1),
  ('Tuition',   'Tuition and enrollment fees',            2),
  ('Books',     'Textbooks, workbooks, and supplies',     3),
  ('Fees',      'Activity, lab, and administrative fees', 4),
  ('Events',    'Field trips, shows, and school events',  5),
  ('Other',     'Miscellaneous charges',                  6)
) AS cat(name, description, sort_order)
WHERE o.active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM commerce_product_categories pc
    WHERE pc.organization_id = o.id
      AND lower(pc.name) = lower(cat.name)
  );

-- Add is_virtual flag to products (used for virtual fee product, hidden from catalog)
ALTER TABLE commerce_products
  ADD COLUMN IF NOT EXISTS is_virtual BOOLEAN NOT NULL DEFAULT FALSE;

-- Create one virtual fee product per existing org (used when paying fee assignments)
INSERT INTO commerce_products
  (organization_id, store_id, category_id, name, description,
   price_cents, currency, taxable, active, is_virtual)
SELECT
  o.id,
  NULL,
  pc.id,
  '__virtual_fee__',
  'System product for fee assignment payments. Do not display.',
  0,
  'USD',
  FALSE,
  FALSE,
  TRUE
FROM commerce_organizations o
LEFT JOIN commerce_product_categories pc
  ON pc.organization_id = o.id AND lower(pc.name) = 'fees' AND pc.active = TRUE
WHERE o.active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM commerce_products p
    WHERE p.organization_id = o.id AND p.is_virtual = TRUE
  );
