ALTER TABLE commerce_wallet_accounts
  ADD COLUMN IF NOT EXISTS credit_limit_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE commerce_wallet_accounts
  DROP CONSTRAINT IF EXISTS commerce_wallet_accounts_balance_cents_check,
  ADD CONSTRAINT commerce_wallet_accounts_credit_limit_cents_check
    CHECK (credit_limit_cents >= 0),
  ADD CONSTRAINT commerce_wallet_accounts_balance_credit_limit_check
    CHECK (balance_cents + credit_limit_cents >= 0);

ALTER TABLE commerce_wallet_transactions
  DROP CONSTRAINT IF EXISTS commerce_wallet_transactions_balance_after_cents_check;
