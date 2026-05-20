CREATE TABLE IF NOT EXISTS commerce_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  name TEXT NOT NULL,
  contact_name TEXT NULL,
  phone TEXT NULL,
  email TEXT NULL,
  address_line1 TEXT NULL,
  address_line2 TEXT NULL,
  city TEXT NULL,
  region TEXT NULL,
  postal_code TEXT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  vendor_number TEXT NULL,
  notes TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS commerce_inventory_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  store_id UUID NOT NULL,
  supplier_id UUID NULL,
  invoice_number TEXT NULL,
  invoice_date DATE NULL,
  received_date DATE NULL,
  subtotal_cents BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents BIGINT NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents BIGINT NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv', 'ai_receipt')),
  attachment_url TEXT NULL,
  notes TEXT NULL,
  approved_by_user_id UUID NULL,
  approved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id)
    REFERENCES commerce_suppliers (organization_id, id),
  CHECK (total_cents = subtotal_cents + tax_cents)
);

CREATE TABLE IF NOT EXISTS commerce_inventory_invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  product_id UUID NULL,
  product_name TEXT NOT NULL,
  sku TEXT NULL,
  barcode TEXT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  unit_cost_cents BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  line_total_cents BIGINT NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  expiration_date DATE NULL,
  lot_number TEXT NULL,
  match_status TEXT NOT NULL DEFAULT 'matched'
    CHECK (match_status IN ('matched', 'needs_review', 'new_product')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES commerce_inventory_invoices (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, product_id)
    REFERENCES commerce_products (organization_id, id),
  CHECK (line_total_cents = quantity * unit_cost_cents)
);

CREATE TABLE IF NOT EXISTS commerce_inventory_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  store_id UUID NULL,
  filename TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('uploaded', 'parsed', 'pending_approval', 'approved', 'rejected', 'applied')),
  total_rows INT NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows INT NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  error_rows INT NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by_user_id UUID NULL,
  approved_at TIMESTAMPTZ NULL,
  applied_at TIMESTAMPTZ NULL,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id)
);

CREATE TABLE IF NOT EXISTS commerce_inventory_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  row_number INT NOT NULL,
  store_id UUID NULL,
  product_id UUID NULL,
  sku TEXT NULL,
  barcode TEXT NULL,
  product_name TEXT NULL,
  category TEXT NULL,
  supplier_name TEXT NULL,
  quantity_on_hand INT NULL CHECK (quantity_on_hand IS NULL OR quantity_on_hand >= 0),
  reorder_threshold INT NULL CHECK (reorder_threshold IS NULL OR reorder_threshold >= 0),
  unit_cost_cents BIGINT NULL CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  status TEXT NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid', 'needs_review', 'error', 'applied')),
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, batch_id)
    REFERENCES commerce_inventory_import_batches (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id),
  FOREIGN KEY (organization_id, product_id)
    REFERENCES commerce_products (organization_id, id)
);

CREATE TABLE IF NOT EXISTS commerce_receipt_extraction_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  store_id UUID NULL,
  supplier_id UUID NULL,
  image_url TEXT NULL,
  status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('uploaded', 'extracted', 'needs_review', 'approved', 'rejected')),
  confidence NUMERIC(5, 4) NULL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  extracted_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_notes TEXT NULL,
  created_invoice_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by_user_id UUID NULL,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id),
  FOREIGN KEY (organization_id, supplier_id)
    REFERENCES commerce_suppliers (organization_id, id),
  FOREIGN KEY (organization_id, created_invoice_id)
    REFERENCES commerce_inventory_invoices (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_suppliers_org_active
  ON commerce_suppliers (organization_id, active);

CREATE INDEX IF NOT EXISTS idx_commerce_inventory_invoices_org_store_status
  ON commerce_inventory_invoices (organization_id, store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commerce_inventory_import_batches_org_status
  ON commerce_inventory_import_batches (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commerce_receipt_extraction_drafts_org_status
  ON commerce_receipt_extraction_drafts (organization_id, status, created_at DESC);
