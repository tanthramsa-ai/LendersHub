/* eslint-disable */
/**
 * Report schema drift between what the CURRENT code expects and what each
 * already-provisioned tenant actually has.
 *
 * Why this exists: tenantSchemaDDL() runs once, at tenant creation. A column
 * added later to an existing table only reaches old tenants if it ALSO has an
 * idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — a bare declaration
 * inside `CREATE TABLE IF NOT EXISTS` is a silent no-op there. That gap is
 * invisible until a query 500s in production ("column l.npa_marked_at does not
 * exist"), one column at a time.
 *
 * This builds a pristine reference schema from the current DDL, diffs every
 * tenant against it, then drops the reference. Read-only for real tenants —
 * it reports, it never alters them. Use repair-tenant-schemas.js to fix.
 *
 * Usage (from backend/, after `npm run build`):
 *   node scripts/check-tenant-schemas.js
 */
const path = require('path');
const { Client } = require('pg');
const { resolveDatabaseUrl } = require('./db-url');

const DATABASE_URL = resolveDatabaseUrl();

const REF = '__schema_reference_check';

let tenantSchemaDDL;
try {
  ({ tenantSchemaDDL } = require(path.resolve(__dirname, '..', 'dist', 'super-admin', 'tenants', 'tenant-schema.js')));
} catch (_) {
  console.error('dist/ not built. Run `npm run build` first — this tool needs the real DDL.');
  process.exit(1);
}

async function columnsOf(client, schema) {
  const { rows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = $1 ORDER BY table_name, column_name`,
    [schema],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.table_name)) out.set(r.table_name, new Set());
    out.get(r.table_name).add(r.column_name);
  }
  return out;
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    // Build the pristine reference from current code.
    await client.query(`DROP SCHEMA IF EXISTS "${REF}" CASCADE`);
    for (const sql of tenantSchemaDDL(REF)) {
      try { await client.query(sql); } catch (_) { /* seed/UPDATE statements may no-op on an empty schema */ }
    }
    const expected = await columnsOf(client, REF);

    const { rows: tenants } = await client.query(
      `SELECT subdomain, schema_name FROM public.tenants WHERE schema_name IS NOT NULL ORDER BY subdomain`,
    );

    let anyDrift = false;
    for (const t of tenants) {
      const actual = await columnsOf(client, t.schema_name);
      const problems = [];
      for (const [table, cols] of expected) {
        if (!actual.has(table)) { problems.push(`  MISSING TABLE  ${table}`); continue; }
        const have = actual.get(table);
        const missing = [...cols].filter((c) => !have.has(c));
        if (missing.length) problems.push(`  ${table}: missing ${missing.join(', ')}`);
      }
      if (problems.length === 0) {
        console.log(`\n${t.subdomain} (${t.schema_name}): up to date`);
      } else {
        anyDrift = true;
        console.log(`\n${t.subdomain} (${t.schema_name}): DRIFT`);
        problems.forEach((p) => console.log(p));
      }
    }

    if (anyDrift) {
      console.log('\nRun `node scripts/repair-tenant-schemas.js` to backfill.');
      console.log('If anything is still missing after that, the column is declared only');
      console.log('inside CREATE TABLE and needs a matching ALTER ... ADD COLUMN IF NOT EXISTS');
      console.log('in tenant-schema.ts before a repair can reach existing tenants.');
      console.log('\nExpected false positives: installments.assigned_to and the');
      console.log('payments collection_status/confirmed_*/cancelled_at/idempotency_key');
      console.log('columns (plus the collection_audit table) are created lazily by the');
      console.log('collections service on first use, not by tenantSchemaDDL — they appear');
      console.log('as drift until any Collections page is opened for that tenant.');
    }
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${REF}" CASCADE`).catch(() => {});
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
