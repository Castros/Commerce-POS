-- Add missing columns to existing inventory receiving tables

-- Invoices: add created_by, updated_at, and rename attachment_url → raw_file_url alias
ALTER TABLE commerce_inventory_invoices
  ADD COLUMN IF NOT EXISTS created_by       UUID REFERENCES commerce_users(id),
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Invoice lines: add AI extraction metadata
ALTER TABLE commerce_inventory_invoice_lines
  ADD COLUMN IF NOT EXISTS ai_extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS confidence        NUMERIC(4,3) CHECK (confidence BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS match_status      TEXT NOT NULL DEFAULT 'matched'
    CHECK (match_status IN ('matched', 'manual', 'skipped', 'unmatched'));

-- Transfers: add note column if not present (schema has it, just ensuring)
ALTER TABLE commerce_inventory_transfers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
