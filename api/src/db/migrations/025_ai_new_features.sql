-- 025_ai_new_features.sql
-- Extends the AI records source_type constraint to support guardian spending
-- digests and sales forecasts.

ALTER TABLE commerce_ai_records
  DROP CONSTRAINT IF EXISTS ai_records_source_type_check;

ALTER TABLE commerce_ai_records
  ADD CONSTRAINT ai_records_source_type_check CHECK (
    source_type IN (
      'closeout_summary',
      'anomaly_alert',
      'inventory_reorder',
      'receipt_extraction',
      'guardian_digest',
      'sales_forecast'
    )
  );
