-- Spending controls per guardian-student link
-- Guardians set daily limits and blocked categories per child.
-- POS enforces these at wallet-sale and paid-sale time.
ALTER TABLE commerce_guardian_students
  ADD COLUMN IF NOT EXISTS spending_controls JSONB NOT NULL
    DEFAULT '{"daily_limit_cents":null,"blocked_category_ids":[]}';
