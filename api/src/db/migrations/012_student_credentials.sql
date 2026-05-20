CREATE TABLE IF NOT EXISTS commerce_student_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES commerce_organizations(id),
  customer_id UUID NOT NULL,
  wallet_account_id UUID NULL,
  credential_type TEXT NOT NULL,
  credential_token_hash TEXT NOT NULL,
  credential_label TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT commerce_student_credentials_customer_org_fk
    FOREIGN KEY (organization_id, customer_id)
    REFERENCES commerce_customers (organization_id, id),
  CONSTRAINT commerce_student_credentials_wallet_org_fk
    FOREIGN KEY (organization_id, wallet_account_id)
    REFERENCES commerce_wallet_accounts (organization_id, id),
  CONSTRAINT commerce_student_credentials_type_check
    CHECK (credential_type IN ('nfc_card', 'nfc_wristband', 'barcode', 'qr_code', 'manual_pin')),
  CONSTRAINT commerce_student_credentials_active_revoked_check
    CHECK (active = TRUE OR revoked_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_student_credentials_org_token_hash
  ON commerce_student_credentials (organization_id, credential_token_hash);

CREATE INDEX IF NOT EXISTS idx_commerce_student_credentials_org_customer
  ON commerce_student_credentials (organization_id, customer_id, active);

CREATE INDEX IF NOT EXISTS idx_commerce_student_credentials_org_wallet
  ON commerce_student_credentials (organization_id, wallet_account_id);
