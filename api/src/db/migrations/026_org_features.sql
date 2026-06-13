-- Feature flags per organization. All existing orgs get full access by default.
-- Platform admin toggles these; API middleware enforces them.
ALTER TABLE commerce_organizations
  ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{"ai":true,"guardians":true,"fee_assignments":true,"student_integration":true,"payroll":true}';

-- Backfill existing orgs so nothing breaks.
UPDATE commerce_organizations
SET features = '{"ai":true,"guardians":true,"fee_assignments":true,"student_integration":true,"payroll":true}'
WHERE features = '{}';
