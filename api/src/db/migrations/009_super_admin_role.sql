ALTER TABLE commerce_users
  DROP CONSTRAINT IF EXISTS commerce_users_role_check;

ALTER TABLE commerce_users
  ADD CONSTRAINT commerce_users_role_check
  CHECK (role IN (
    'platform_admin',
    'super_admin',
    'organization_owner',
    'organization_admin',
    'store_manager',
    'cashier',
    'accountant',
    'parent',
    'customer',
    'service'
  ));

ALTER TABLE commerce_service_tokens
  DROP CONSTRAINT IF EXISTS commerce_service_tokens_role_check;

ALTER TABLE commerce_service_tokens
  ADD CONSTRAINT commerce_service_tokens_role_check
  CHECK (role IN ('service', 'platform_admin', 'super_admin'));

