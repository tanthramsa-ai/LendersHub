/* eslint-disable */
/**
 * Backfill missing DDL on already-provisioned tenant schemas.
 *
 * provisionSchema() (see src/super-admin/tenants/tenant-schema.ts) only runs once,
 * at tenant creation. When new enum values (e.g. 'AGENT', 'STAFF') or other DDL are
 * added to tenantSchemaDDL() later, tenants provisioned before that change never
 * get it — causing inserts like `role = 'AGENT'` to fail with Postgres error 22P02
 * (invalid_text_representation), surfaced to users as "Invalid ID format".
 *
 * This script re-runs the (idempotent) tenantSchemaDDL() statements against every
 * existing tenant schema, safe to run repeatedly.
 *
 * Usage (run from the backend/ folder, deps installed):
 *   node scripts/repair-tenant-schemas.js                # all tenants
 *   node scripts/repair-tenant-schemas.js <subdomain>     # one tenant
 */
const path = require('path');
const { Client } = require('pg');

try { require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') }); } catch (_) {}
try { require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') }); } catch (_) {}

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:devpass@localhost:5433/lendershub';

// Kept in sync by hand with backend/src/super-admin/tenants/tenant-schema.ts.
// TS source can't be required directly from a plain Node script without a build step.
function tenantSchemaDDL(s) {
  const q = `"${s}"`;
  return [
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'OWNER'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'MANAGER'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'AGENT'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'STAFF'; EXCEPTION WHEN others THEN NULL; END $$`,
    `DO $$ BEGIN ALTER TYPE ${q}.user_role ADD VALUE IF NOT EXISTS 'CUSTOMER'; EXCEPTION WHEN others THEN NULL; END $$`,

    // role_permissions — tenant-admin-editable permission matrix (see
    // backend/src/super-admin/tenants/tenant-schema.ts for the canonical
    // source this is kept in sync with by hand).
    `CREATE TABLE IF NOT EXISTS ${q}."role_permissions" (
       role           ${q}.user_role NOT NULL,
       permission_key TEXT           NOT NULL,
       value          TEXT           NOT NULL,
       updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
       PRIMARY KEY (role, permission_key)
     )`,
    `INSERT INTO ${q}."role_permissions" (role, permission_key, value) VALUES
       ('OWNER',    'add_user',        'yes'),
       ('OWNER',    'add_customer',    'yes'),
       ('OWNER',    'view_loan',       'all'),
       ('OWNER',    'add_loan',        'yes'),
       ('OWNER',    'update_loan',     'yes'),
       ('OWNER',    'view_collection', 'all'),
       ('OWNER',    'add_collection',  'yes'),
       ('ADMIN',    'add_user',        'yes'),
       ('ADMIN',    'add_customer',    'yes'),
       ('ADMIN',    'view_loan',       'all'),
       ('ADMIN',    'add_loan',        'yes'),
       ('ADMIN',    'update_loan',     'yes'),
       ('ADMIN',    'view_collection', 'all'),
       ('ADMIN',    'add_collection',  'yes'),
       ('MANAGER',  'add_user',        'no'),
       ('MANAGER',  'add_customer',    'yes'),
       ('MANAGER',  'view_loan',       'all'),
       ('MANAGER',  'add_loan',        'yes'),
       ('MANAGER',  'update_loan',     'yes'),
       ('MANAGER',  'view_collection', 'all'),
       ('MANAGER',  'add_collection',  'yes'),
       ('AGENT',    'add_user',        'no'),
       ('AGENT',    'add_customer',    'yes'),
       ('AGENT',    'view_loan',       'self'),
       ('AGENT',    'add_loan',        'partial'),
       ('AGENT',    'update_loan',     'no'),
       ('AGENT',    'view_collection', 'self'),
       ('AGENT',    'add_collection',  'yes'),
       ('STAFF',    'add_user',        'no'),
       ('STAFF',    'add_customer',    'yes'),
       ('STAFF',    'view_loan',       'all'),
       ('STAFF',    'add_loan',        'partial'),
       ('STAFF',    'update_loan',     'no'),
       ('STAFF',    'view_collection', 'all'),
       ('STAFF',    'add_collection',  'yes'),
       ('CUSTOMER', 'add_user',        'no'),
       ('CUSTOMER', 'add_customer',    'no'),
       ('CUSTOMER', 'view_loan',       'self'),
       ('CUSTOMER', 'add_loan',        'no'),
       ('CUSTOMER', 'update_loan',     'no'),
       ('CUSTOMER', 'view_collection', 'self'),
       ('CUSTOMER', 'add_collection',  'no')
     ON CONFLICT (role, permission_key) DO NOTHING`,
  ];
}

async function main() {
  const targetSubdomain = process.argv[2];
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const { rows: tenants } = await client.query(
      targetSubdomain
        ? `SELECT subdomain, schema_name FROM public.tenants WHERE subdomain = $1 AND schema_name IS NOT NULL`
        : `SELECT subdomain, schema_name FROM public.tenants WHERE schema_name IS NOT NULL`,
      targetSubdomain ? [targetSubdomain] : [],
    );

    if (tenants.length === 0) {
      console.log(targetSubdomain ? `No tenant found for subdomain "${targetSubdomain}".` : 'No tenants found.');
      return;
    }

    for (const t of tenants) {
      process.stdout.write(`Repairing ${t.subdomain} (${t.schema_name})... `);
      for (const sql of tenantSchemaDDL(t.schema_name)) {
        await client.query(sql);
      }
      console.log('done');
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
