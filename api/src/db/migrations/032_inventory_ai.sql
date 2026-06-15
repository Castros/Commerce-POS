-- AI extraction drafts: one row per uploaded invoice/receipt image or PDF
CREATE TABLE IF NOT EXISTS commerce_inventory_ai_drafts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES commerce_organizations(id) ON DELETE CASCADE,
  store_id            UUID        REFERENCES commerce_stores(id),
  supplier_id         UUID        REFERENCES commerce_inventory_suppliers(id),
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'approved', 'rejected')),
  source              TEXT        NOT NULL DEFAULT 'ai_image'
                                  CHECK (source IN ('ai_image', 'ai_pdf')),
  file_url            TEXT,
  -- raw structured output Claude returned
  raw_payload         JSONB,
  -- enriched lines after product matching (array of line objects)
  lines               JSONB       NOT NULL DEFAULT '[]',
  overall_confidence  NUMERIC(4,3),
  -- set when draft is approved and an invoice is created
  invoice_id          UUID        REFERENCES commerce_inventory_invoices(id),
  created_by          UUID        REFERENCES commerce_users(id),
  reviewed_by         UUID        REFERENCES commerce_users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_inv_ai_drafts_org_status
  ON commerce_inventory_ai_drafts (organization_id, status, created_at DESC);

-- Learning loop: maps raw extracted text → confirmed product for each org
-- When a manager corrects an AI match, we store it here so future extractions
-- use it as a few-shot hint
CREATE TABLE IF NOT EXISTS commerce_ai_inventory_corrections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES commerce_organizations(id) ON DELETE CASCADE,
  -- the normalized extracted text from the invoice (lowercased, trimmed)
  extracted_text  TEXT        NOT NULL,
  product_id      UUID        NOT NULL REFERENCES commerce_products(id) ON DELETE CASCADE,
  product_name    TEXT        NOT NULL,
  sku             TEXT,
  confirmed_by    UUID        REFERENCES commerce_users(id),
  -- incremented each time this correction is used, for future scoring
  use_count       INTEGER     NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, extracted_text)
);

CREATE INDEX IF NOT EXISTS idx_inv_ai_corrections_org
  ON commerce_ai_inventory_corrections (organization_id);
