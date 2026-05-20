CREATE TABLE IF NOT EXISTS commerce_cash_drawer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  store_id UUID NOT NULL,
  register_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_cash_cents BIGINT NOT NULL DEFAULT 0 CHECK (opening_cash_cents >= 0),
  expected_cash_cents BIGINT NOT NULL DEFAULT 0 CHECK (expected_cash_cents >= 0),
  counted_cash_cents BIGINT NULL CHECK (counted_cash_cents >= 0),
  over_short_cents BIGINT NULL,
  opened_by_user_id UUID NULL,
  closed_by_user_id UUID NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ NULL,
  note TEXT NULL,
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id)
);

ALTER TABLE commerce_cash_drawer_sessions
  ADD CONSTRAINT commerce_cash_drawer_sessions_org_id_unique UNIQUE (organization_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_drawer_one_open_register
  ON commerce_cash_drawer_sessions (organization_id, store_id, register_name)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_cash_drawer_sessions_org_store_opened
  ON commerce_cash_drawer_sessions (organization_id, store_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS commerce_cash_drawer_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  store_id UUID NOT NULL,
  session_id UUID NOT NULL,
  order_id UUID NULL,
  type TEXT NOT NULL CHECK (type IN ('open', 'cash_sale', 'close', 'adjustment')),
  amount_cents BIGINT NOT NULL,
  cash_balance_after_cents BIGINT NOT NULL CHECK (cash_balance_after_cents >= 0),
  note TEXT NULL,
  created_by_user_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, store_id)
    REFERENCES commerce_stores (organization_id, id),
  FOREIGN KEY (organization_id, session_id)
    REFERENCES commerce_cash_drawer_sessions (organization_id, id),
  FOREIGN KEY (organization_id, order_id)
    REFERENCES commerce_orders (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_events_session_created
  ON commerce_cash_drawer_events (session_id, created_at DESC);
