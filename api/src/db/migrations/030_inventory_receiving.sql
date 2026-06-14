-- Enable trigram extension for fuzzy product matching (Phase 3 AI)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Supplier directory ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commerce_inventory_suppliers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES commerce_organizations(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  vendor_number    TEXT,
  email            TEXT,
  phone            TEXT,
  address_line1    TEXT,
  city             TEXT,
  region           TEXT,
  postal_code      TEXT,
  notes            TEXT,
  active           BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_suppliers_org
  ON commerce_inventory_suppliers (organization_id)
  WHERE active = TRUE;

-- ── Receiving invoices ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commerce_inventory_invoices (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES commerce_organizations(id) ON DELETE CASCADE,
  store_id         UUID        REFERENCES commerce_stores(id),
  supplier_id      UUID        REFERENCES commerce_inventory_suppliers(id),
  invoice_number   TEXT,
  invoice_date     DATE,
  received_date    DATE,
  -- source tracks how this invoice was created
  source           TEXT        NOT NULL DEFAULT 'manual'
                               CHECK (source IN ('manual', 'ai_image', 'ai_pdf', 'csv')),
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'auto_approved', 'rejected')),
  total_cents      BIGINT      NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  tax_cents        BIGINT      NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  notes            TEXT,
  raw_file_url     TEXT,
  approved_by      UUID        REFERENCES commerce_users(id),
  approved_at      TIMESTAMPTZ,
  created_by       UUID        REFERENCES commerce_users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_invoices_org_status
  ON commerce_inventory_invoices (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inv_invoices_supplier
  ON commerce_inventory_invoices (supplier_id)
  WHERE supplier_id IS NOT NULL;

-- ── Invoice line items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commerce_inventory_invoice_lines (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES commerce_organizations(id) ON DELETE CASCADE,
  invoice_id        UUID        NOT NULL REFERENCES commerce_inventory_invoices(id) ON DELETE CASCADE,
  product_id        UUID        REFERENCES commerce_products(id),
  -- AI-extracted raw text (null for manual lines)
  ai_extracted_text TEXT,
  -- human-confirmed product name (may differ from products.name if item is new)
  product_name      TEXT        NOT NULL,
  sku               TEXT,
  quantity          INTEGER     NOT NULL CHECK (quantity > 0),
  unit_cost_cents   BIGINT      NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  line_total_cents  BIGINT      GENERATED ALWAYS AS (quantity * unit_cost_cents) STORED,
  -- how this line was matched to a product
  match_status      TEXT        NOT NULL DEFAULT 'matched'
                                CHECK (match_status IN ('matched', 'manual', 'skipped', 'unmatched')),
  confidence        NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_invoice_lines_invoice
  ON commerce_inventory_invoice_lines (invoice_id);

CREATE INDEX IF NOT EXISTS idx_inv_invoice_lines_product
  ON commerce_inventory_invoice_lines (product_id)
  WHERE product_id IS NOT NULL;

-- ── Location transfers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commerce_inventory_transfers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES commerce_organizations(id) ON DELETE CASCADE,
  from_store_id    UUID        NOT NULL REFERENCES commerce_stores(id),
  to_store_id      UUID        NOT NULL REFERENCES commerce_stores(id),
  product_id       UUID        NOT NULL REFERENCES commerce_products(id),
  quantity         INTEGER     NOT NULL CHECK (quantity > 0),
  note             TEXT,
  status           TEXT        NOT NULL DEFAULT 'completed'
                               CHECK (status IN ('pending', 'completed', 'cancelled')),
  created_by       UUID        REFERENCES commerce_users(id),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_transfers_org
  ON commerce_inventory_transfers (organization_id, created_at DESC);
