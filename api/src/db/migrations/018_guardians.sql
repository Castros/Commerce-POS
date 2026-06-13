-- family_code links siblings to the same guardian account
ALTER TABLE commerce_customers
  ADD COLUMN IF NOT EXISTS family_code VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_commerce_customers_family_code
  ON commerce_customers(organization_id, family_code)
  WHERE family_code IS NOT NULL;

-- Parent/guardian accounts (separate from commerce_users / staff)
CREATE TABLE IF NOT EXISTS commerce_guardians (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID         NOT NULL REFERENCES commerce_organizations(id),
  name               VARCHAR(255) NOT NULL,
  email              VARCHAR(255) NOT NULL,
  phone              VARCHAR(50),
  family_code        VARCHAR(50),
  notification_prefs JSONB        NOT NULL DEFAULT '{"email_on_purchase":true,"low_balance_threshold_cents":500}',
  active             BOOLEAN      NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_commerce_guardians_org
  ON commerce_guardians(organization_id);

CREATE INDEX IF NOT EXISTS idx_commerce_guardians_family_code
  ON commerce_guardians(organization_id, family_code)
  WHERE family_code IS NOT NULL;

-- Many-to-many: one parent can have multiple children, one child can have multiple guardians
CREATE TABLE IF NOT EXISTS commerce_guardian_students (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id     UUID        NOT NULL REFERENCES commerce_guardians(id) ON DELETE CASCADE,
  student_id      UUID        NOT NULL REFERENCES commerce_customers(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL,
  relationship    VARCHAR(50) NOT NULL DEFAULT 'guardian'
    CHECK (relationship IN ('mother', 'father', 'guardian', 'other')),
  is_primary      BOOLEAN     NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(guardian_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_guardian_students_guardian
  ON commerce_guardian_students(guardian_id);

CREATE INDEX IF NOT EXISTS idx_guardian_students_student
  ON commerce_guardian_students(student_id);

-- One-time 6-digit codes for passwordless email login
CREATE TABLE IF NOT EXISTS commerce_guardian_magic_links (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id     UUID        NOT NULL REFERENCES commerce_guardians(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL,
  code_hash       VARCHAR(64) NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_magic_links_pending
  ON commerce_guardian_magic_links(guardian_id)
  WHERE used_at IS NULL;

-- Guardian browser sessions (mirrors commerce_browser_sessions pattern)
CREATE TABLE IF NOT EXISTS commerce_guardian_sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id        UUID        NOT NULL REFERENCES commerce_guardians(id) ON DELETE CASCADE,
  organization_id    UUID        NOT NULL,
  session_token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at         TIMESTAMPTZ NOT NULL,
  last_used_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardian_sessions_token
  ON commerce_guardian_sessions(session_token_hash);
