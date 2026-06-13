-- 016_employees_and_payroll.sql
-- Adds employee tracking and payroll deduction cycle management.
-- Employees are commerce_customers with customer_type = 'employee'.
-- Their wallet runs negative (tab); payroll cycles snapshot what is owed.

-- 1. Add customer_type to existing customers table
ALTER TABLE commerce_customers
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'student'
    CHECK (customer_type IN ('student', 'employee', 'guest'));

CREATE INDEX IF NOT EXISTS idx_commerce_customers_org_type
  ON commerce_customers (organization_id, customer_type);

-- 2. Employee profile — extended fields beyond what commerce_customers holds
CREATE TABLE IF NOT EXISTS commerce_employee_profiles (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID        NOT NULL REFERENCES commerce_organizations (id),
  customer_id                 UUID        NOT NULL REFERENCES commerce_customers (id),
  employee_number             TEXT        NULL,     -- HR/badge/payroll ID
  department                  TEXT        NULL,
  job_title                   TEXT        NULL,
  payroll_deduction_enabled   BOOLEAN     NOT NULL DEFAULT TRUE,
  deduction_cycle             TEXT        NOT NULL DEFAULT 'biweekly'
                                CHECK (deduction_cycle IN ('weekly', 'biweekly', 'monthly')),
  max_credit_cents            BIGINT      NOT NULL DEFAULT 50000   -- $500 default tab
                                CHECK (max_credit_cents >= 0),
  active                      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, customer_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_profiles_org_number
  ON commerce_employee_profiles (organization_id, employee_number)
  WHERE employee_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_profiles_org
  ON commerce_employee_profiles (organization_id, active);

-- 3. Payroll cycles — one open cycle at a time per org per deduction_cycle type
--    Closing a cycle snapshots all employee balances and calculates total deduction.
CREATE TABLE IF NOT EXISTS commerce_payroll_cycles (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES commerce_organizations (id),
  period_start          DATE        NOT NULL,
  period_end            DATE        NOT NULL,
  deduction_cycle       TEXT        NOT NULL DEFAULT 'biweekly'
                          CHECK (deduction_cycle IN ('weekly', 'biweekly', 'monthly')),
  status                TEXT        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'closed', 'deducted')),
  total_deduction_cents BIGINT      NULL,    -- set on close
  employee_count        INTEGER     NULL,    -- set on close
  notes                 TEXT        NULL,
  closed_by_user_id     UUID        NULL,
  closed_at             TIMESTAMPTZ NULL,
  deducted_by_user_id   UUID        NULL,
  deducted_at           TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_payroll_cycles_org_status
  ON commerce_payroll_cycles (organization_id, status, period_end DESC);

-- 4. Payroll cycle items — one row per employee per closed cycle
CREATE TABLE IF NOT EXISTS commerce_payroll_cycle_items (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES commerce_organizations (id),
  cycle_id                  UUID        NOT NULL REFERENCES commerce_payroll_cycles (id),
  customer_id               UUID        NOT NULL REFERENCES commerce_customers (id),
  employee_profile_id       UUID        NOT NULL REFERENCES commerce_employee_profiles (id),
  employee_number           TEXT        NULL,    -- snapshot at close time
  employee_name             TEXT        NOT NULL, -- snapshot at close time
  department                TEXT        NULL,    -- snapshot at close time
  balance_snapshot_cents    BIGINT      NOT NULL, -- wallet balance at cycle close
  deduction_cents           BIGINT      NOT NULL  -- amount HR should deduct from paycheck
                              CHECK (deduction_cents >= 0),
  paid_early_cents          BIGINT      NOT NULL DEFAULT 0
                              CHECK (paid_early_cents >= 0),
  status                    TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'paid_early', 'deducted', 'void')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (cycle_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_cycle_items_cycle
  ON commerce_payroll_cycle_items (cycle_id);

CREATE INDEX IF NOT EXISTS idx_payroll_cycle_items_org_customer
  ON commerce_payroll_cycle_items (organization_id, customer_id);
