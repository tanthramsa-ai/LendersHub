# Database Deployment Guide

LendersHub uses **two separate schema layers** in the same PostgreSQL instance:

| Layer | Schema | Managed by | When it runs |
|---|---|---|---|
| **Public (platform)** | `public` | Prisma migrations | On every backend container start |
| **Per-tenant** | `tenant_<subdomain>` | `tenantSchemaDDL()` in code | When a tenant is created or the backend boots |

Understanding this split is the key to knowing which deployment command to run.

---

## Layer 1 — Public schema (Prisma)

The `public` schema holds platform-level tables: `tenants`, `users` (super-admins), `login_audit_logs`, `loans` (Prisma model, kept for historical reasons).

### How migrations work

Prisma keeps a migration history in `backend/prisma/migrations/`. Each subfolder is a timestamped SQL file. `prisma migrate deploy` applies any unapplied migrations in order.

### Deploy DB changes (Docker)

**Rebuild and restart only the backend** — it runs `prisma migrate deploy` automatically on startup:

```bash
docker compose up --build backend
```

To apply migrations **without rebuilding** the image (useful when the image is already built):

```bash
docker compose run --rm backend sh -c "npx prisma migrate deploy"
```

Or exec into a running container:

```bash
docker compose exec backend sh -c "npx prisma migrate deploy"
```

### Deploy DB changes (local dev)

```bash
cd backend
npx prisma migrate deploy
```

### Create a new migration

Only needed when you change `backend/prisma/schema.prisma` (public schema tables/enums):

```bash
cd backend
npx prisma migrate dev --name describe_your_change
```

This generates a new SQL file in `prisma/migrations/`, applies it locally, and regenerates the Prisma client.

### Reset the public schema (dev only — destroys all data)

```bash
cd backend
npx prisma migrate reset
npm run seed   # recreate super-admin
```

---

## Layer 2 — Per-tenant schema

Each tenant gets its own schema (`tenant_demo`, `tenant_acme`, etc.). The schema is **not managed by Prisma** — it is defined as plain SQL in:

```
backend/src/super-admin/tenants/tenant-schema.ts
```

The function `tenantSchemaDDL(schemaName)` returns an ordered array of idempotent DDL statements (all using `CREATE … IF NOT EXISTS` and `ALTER TABLE … ADD COLUMN IF NOT EXISTS`). They are safe to re-run on existing schemas.

### When tenant DDL runs

1. **New tenant creation** — `tenantSchemaDDL` is called once when a super-admin creates a tenant.
2. **Backend startup** — the backend re-runs `tenantSchemaDDL` for every existing tenant on boot, so adding a new `ADD COLUMN IF NOT EXISTS` to `tenant-schema.ts` is automatically applied to all tenants on the next deploy with no extra command.

### Deploy a tenant schema change (add column / table)

1. Add your idempotent statement to `tenant-schema.ts` (use `ADD COLUMN IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS`).
2. Redeploy the backend:

```bash
# Docker
docker compose up --build backend

# Local dev
npm run start:dev   # or start:prod / restart the process
```

On startup the backend iterates all `ACTIVE` tenants and re-runs the DDL. The new column/table appears in every tenant schema within seconds.

### Manually run tenant DDL for a specific tenant (emergency)

```bash
docker compose exec backend node -e "
const { PrismaService } = require('./dist/prisma/prisma.service');
const { tenantSchemaDDL } = require('./dist/super-admin/tenants/tenant-schema');

async function run() {
  const prisma = new PrismaService();
  await prisma.\$connect();
  const tenant = await prisma.tenant.findUnique({ where: { subdomain: 'SUBDOMAIN_HERE' } });
  const client = await prisma.pool.connect();
  try {
    for (const sql of tenantSchemaDDL(tenant.schemaName)) {
      await client.query(sql);
    }
    console.log('Done');
  } finally { client.release(); await prisma.\$disconnect(); }
}
run().catch(console.error);
"
```

Replace `SUBDOMAIN_HERE` with the tenant subdomain.

### Rename a column or drop a table (non-idempotent changes)

`ADD COLUMN IF NOT EXISTS` handles additive changes safely. For destructive changes (rename, drop, type change):

1. Write a one-off migration script in `backend/prisma/migrations/<timestamp>_<name>/migration.sql` that targets tenant schemas:

```sql
-- Example: rename a column across all tenant schemas
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%' LOOP
    EXECUTE format(
      'ALTER TABLE %I.customers RENAME COLUMN old_name TO new_name',
      r.schema_name
    );
  END LOOP;
END $$;
```

2. Apply it:

```bash
# Docker
docker compose exec backend sh -c "psql $DATABASE_URL -f /path/to/migration.sql"

# Local
psql $DATABASE_URL -f migration.sql
```

---

## Deploy DB only (no code changes)

If you changed only `tenant-schema.ts` and want to push the schema change without a full image rebuild:

```bash
# Restart the running backend container — it re-runs tenant DDL on boot
docker compose restart backend
```

If the backend image already contains the updated code (e.g., copied in via a volume mount in dev mode), a restart is sufficient. For a production deploy where the code is baked into the image, rebuild:

```bash
docker compose up --build backend
```

---

## Connecting directly to the database

```bash
# Via Docker
docker compose exec db psql -U postgres -d lendershub

# From host (port 5433 is mapped)
psql postgresql://postgres:devpass@localhost:5433/lendershub

# Inspect a tenant schema
\c lendershub
SET search_path = "tenant_demo", public;
\dt        -- list tables
\d loans   -- describe loans table
```

---

## Backup and restore

```bash
# Full database dump
docker compose exec db pg_dump -U postgres lendershub > backup_$(date +%Y%m%d).sql

# Restore
docker compose exec -T db psql -U postgres lendershub < backup_20260531.sql

# Tenant-schema only (one tenant)
docker compose exec db pg_dump -U postgres -n "tenant_demo" lendershub > tenant_demo_backup.sql
```
