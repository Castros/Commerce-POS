-- 015_ai_records.sql
-- Stores AI-generated drafts, summaries, and anomaly alerts.
-- AI never writes to financial tables — this is the only table AI outputs touch.

CREATE TYPE commerce_ai_record_status AS ENUM (
  'pending',
  'draft',
  'reviewed',
  'dismissed',
  'error'
);

CREATE TABLE IF NOT EXISTS commerce_ai_records (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID          NOT NULL,
  store_id              UUID          NULL,
  source_type           TEXT          NOT NULL,
  source_record_id      UUID          NULL,
  model_name            TEXT          NOT NULL,
  input_hash            TEXT          NOT NULL,
  input_snapshot        JSONB         NOT NULL DEFAULT '{}',
  output_json           JSONB         NULL,
  prompt_tokens         INTEGER       NULL CHECK (prompt_tokens >= 0),
  completion_tokens     INTEGER       NULL CHECK (completion_tokens >= 0),
  status                commerce_ai_record_status NOT NULL DEFAULT 'pending',
  error_message         TEXT          NULL,
  reviewed_by_user_id   UUID          NULL,
  reviewed_at           TIMESTAMPTZ   NULL,
  applied_at            TIMESTAMPTZ   NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_records_source_type_check CHECK (
    source_type IN ('closeout_summary', 'anomaly_alert', 'inventory_reorder', 'receipt_extraction')
  ),
  CONSTRAINT ai_records_reviewed_requires_reviewer CHECK (
    status NOT IN ('reviewed', 'dismissed') OR reviewed_by_user_id IS NOT NULL
  ),

  FOREIGN KEY (organization_id) REFERENCES commerce_organizations (id)
);

-- Dedup: one non-error, non-dismissed record per source + input hash
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_records_dedup
  ON commerce_ai_records (organization_id, source_type, source_record_id, input_hash)
  WHERE status NOT IN ('error', 'dismissed');

-- Manager review queue by org + source type + status
CREATE INDEX IF NOT EXISTS idx_ai_records_org_source_status
  ON commerce_ai_records (organization_id, source_type, status, created_at DESC);

-- Store-scoped closeout summary lookup
CREATE INDEX IF NOT EXISTS idx_ai_records_org_store_created
  ON commerce_ai_records (organization_id, store_id, created_at DESC)
  WHERE source_type = 'closeout_summary';

-- Anomaly alert queue
CREATE INDEX IF NOT EXISTS idx_ai_records_org_alerts_created
  ON commerce_ai_records (organization_id, created_at DESC)
  WHERE source_type = 'anomaly_alert';
