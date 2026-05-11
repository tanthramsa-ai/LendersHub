ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "city"          TEXT,
  ADD COLUMN IF NOT EXISTS "state"         TEXT,
  ADD COLUMN IF NOT EXISTS "primary_color" TEXT,
  ADD COLUMN IF NOT EXISTS "custom_domain" TEXT,
  ADD COLUMN IF NOT EXISTS "features"      JSONB;
