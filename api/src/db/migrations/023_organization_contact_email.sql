-- Add contact email to organizations for transactional email reply-to
ALTER TABLE commerce_organizations
  ADD COLUMN IF NOT EXISTS contact_email TEXT NULL;
