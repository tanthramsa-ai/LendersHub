-- Make loans.tenant_id non-nullable: every loan must belong to a tenant.
-- Super-admin users legitimately have tenant_id = NULL so users.tenant_id stays nullable.
ALTER TABLE "loans" ALTER COLUMN "tenant_id" SET NOT NULL;

-- Drop the SetNull FK (incompatible with NOT NULL) and replace with Restrict.
ALTER TABLE "loans" DROP CONSTRAINT IF EXISTS "loans_tenant_id_fkey";
ALTER TABLE "loans"
  ADD CONSTRAINT "loans_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── users ─────────────────────────────────────────────────────────────────────
-- FORCE ROW LEVEL SECURITY ensures the policy applies even when the DB session
-- is owned by the table owner (the application's Postgres user).
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

-- Permissive policy for all operations (SELECT / INSERT / UPDATE / DELETE).
-- A row is visible / writable when:
--   • app.bypass_rls is 'true'  (super-admin context set by the NestJS middleware), OR
--   • app.current_tenant_id matches the row's tenant_id  (tenant-user context).
-- When neither setting is present current_setting() returns '' so both conditions
-- are false → zero rows visible, fail-safe by default.
CREATE POLICY "users_tenant_isolation" ON "users"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.bypass_rls', TRUE) = 'true'
    OR (
      current_setting('app.current_tenant_id', TRUE) <> ''
      AND "tenant_id"::text = current_setting('app.current_tenant_id', TRUE)
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', TRUE) = 'true'
    OR (
      current_setting('app.current_tenant_id', TRUE) <> ''
      AND "tenant_id"::text = current_setting('app.current_tenant_id', TRUE)
    )
  );

-- ── loans ─────────────────────────────────────────────────────────────────────
ALTER TABLE "loans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loans" FORCE ROW LEVEL SECURITY;

CREATE POLICY "loans_tenant_isolation" ON "loans"
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (
    current_setting('app.bypass_rls', TRUE) = 'true'
    OR (
      current_setting('app.current_tenant_id', TRUE) <> ''
      AND "tenant_id"::text = current_setting('app.current_tenant_id', TRUE)
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', TRUE) = 'true'
    OR (
      current_setting('app.current_tenant_id', TRUE) <> ''
      AND "tenant_id"::text = current_setting('app.current_tenant_id', TRUE)
    )
  );
