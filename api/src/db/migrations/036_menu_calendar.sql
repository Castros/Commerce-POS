CREATE TABLE commerce_menu_calendar (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES commerce_organizations(id),
  store_id        UUID        NOT NULL REFERENCES commerce_stores(id),
  date            DATE        NOT NULL,
  items           JSONB       NOT NULL DEFAULT '[]',
  published       BOOLEAN     NOT NULL DEFAULT false,
  notes           TEXT,
  created_by      UUID        REFERENCES commerce_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, store_id, date)
);

CREATE INDEX idx_menu_calendar_org_store_date
  ON commerce_menu_calendar (organization_id, store_id, date);
