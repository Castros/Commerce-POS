-- Staff category permission assignments.
-- Same structural pattern as commerce_user_store_assignments.
-- Zero rows for a user = unrestricted (all categories visible).
-- Only meaningful for cashier and store_manager roles.

CREATE TABLE IF NOT EXISTS commerce_user_category_permissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES commerce_organizations(id),
  user_id         UUID        NOT NULL,
  category_id     UUID        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, user_id, category_id),

  FOREIGN KEY (organization_id, user_id)
    REFERENCES commerce_users (organization_id, id),

  FOREIGN KEY (organization_id, category_id)
    REFERENCES commerce_product_categories (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_user_category_permissions_user
  ON commerce_user_category_permissions (organization_id, user_id);
