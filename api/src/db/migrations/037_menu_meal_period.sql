-- Add meal_period to menu calendar so schools can have both Almuerzo and Comida on the same day.
-- Existing rows default to 'comida' (the main meal). The unique constraint expands to include meal_period.

ALTER TABLE commerce_menu_calendar
  ADD COLUMN IF NOT EXISTS meal_period VARCHAR(50) NOT NULL DEFAULT 'comida';

-- Replace the date-level unique constraint with a date+period constraint
ALTER TABLE commerce_menu_calendar
  DROP CONSTRAINT IF EXISTS commerce_menu_calendar_organization_id_store_id_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS commerce_menu_calendar_org_store_date_period_key
  ON commerce_menu_calendar (organization_id, store_id, date, meal_period);
