/* eslint-disable */
/**
 * Backfill missing DDL on already-provisioned tenant schemas.
 *
 * provisionSchema() (see src/super-admin/tenants/tenant-schema.ts) only runs once,
 * at tenant creation. When new enum values (e.g. 'AGENT', 'STAFF') or other DDL are
 * added to tenantSchemaDDL() later, tenants provisioned before that change never
 * get it — causing failures like `role = 'AGENT'` rejected with Postgres 22P02
 * ("Invalid ID format" to the user), or a missing payments.receipt_number taking
 * out both payment recording and the ledger views.
 *
 * The same pass now runs automatically on every backend boot
 * (TenantSchemaRepairService), so this script is the manual escape hatch:
 * repairing one tenant, or forcing a re-run without a restart. Both share one
 * implementation — src/super-admin/tenants/tenant-schema-repair.ts — so they
 * cannot drift apart.
 *
 * Requires a build (`npm run build`); dist/ exists in every deployed image.
 *
 * Usage (run from the backend/ folder, deps installed):
 *   node scripts/repair-tenant-schemas.js                 # every tenant, skipping any already at the current DDL
 *   node scripts/repair-tenant-schemas.js <subdomain>     # one tenant
 *   node scripts/repair-tenant-schemas.js --force         # re-apply even if the fingerprint matches
 */
const path = require('path');
const { Client } = require('pg');
const { resolveDatabaseUrl } = require('./db-url');

const DATABASE_URL = resolveDatabaseUrl();

let repairAllTenantSchemas;
try {
  ({ repairAllTenantSchemas } = require(
    path.resolve(__dirname, '..', 'dist', 'super-admin', 'tenants', 'tenant-schema-repair.js'),
  ));
} catch (e) {
  console.error('dist/ not built — run `npm run build` first, then re-run this script.');
  console.error(`  (${e.message})`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const subdomain = args.find((a) => !a.startsWith('--'));

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const results = await repairAllTenantSchemas(client, { force, subdomain });

    if (results.length === 0) {
      console.log(subdomain ? `No tenant found for subdomain "${subdomain}".` : 'No tenants found.');
      return;
    }

    let anyFailed = false;
    for (const r of results) {
      if (r.skipped) {
        console.log(`${r.schemaName}: already at the current DDL — skipped (use --force to re-apply)`);
        continue;
      }
      if (r.failures.length === 0) {
        console.log(`${r.schemaName}: ok — ${r.statements} statements applied`);
        continue;
      }
      anyFailed = true;
      console.log(`${r.schemaName}: ${r.applied}/${r.statements} applied, ${r.failures.length} FAILED:`);
      for (const f of r.failures) {
        console.log(`    - ${f.message}`);
        console.log(`      ${f.sql}...`);
      }
    }

    if (anyFailed) {
      console.log('\nSome statements failed — see above. These usually indicate a schema so old');
      console.log('it predates a table/column another statement depends on. Fix those manually,');
      console.log('then re-run; this script is idempotent and safe to repeat. A schema with any');
      console.log('failure is left unmarked, so the next boot repairs it again rather than');
      console.log('recording it as done.');
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
