-- 024_ai_cost_tracking.sql
-- Adds per-call cost tracking to AI records so platform admins can monitor
-- API spend per org without relying on the Anthropic dashboard alone.

ALTER TABLE commerce_ai_records
  ADD COLUMN IF NOT EXISTS cost_microdollars BIGINT NULL CHECK (cost_microdollars >= 0);

COMMENT ON COLUMN commerce_ai_records.cost_microdollars IS
  'Estimated cost in microdollars (1 USD = 1,000,000). Calculated from token counts at the model rate at time of generation.';
