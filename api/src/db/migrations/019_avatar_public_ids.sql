-- Adds Cloudinary public_id columns for image/avatar support.
-- Store only the public_id (e.g. "staff/xk9m2p"). Never store full URLs.
-- Derive CDN URLs at render time using the imageUrl utility in the frontend.

ALTER TABLE commerce_users
  ADD COLUMN IF NOT EXISTS avatar_public_id TEXT NULL;

ALTER TABLE commerce_customers
  ADD COLUMN IF NOT EXISTS avatar_public_id TEXT NULL;

ALTER TABLE commerce_guardians
  ADD COLUMN IF NOT EXISTS avatar_public_id TEXT NULL;

-- Stores get a logo/banner image, not a personal avatar
ALTER TABLE commerce_stores
  ADD COLUMN IF NOT EXISTS image_public_id TEXT NULL;
