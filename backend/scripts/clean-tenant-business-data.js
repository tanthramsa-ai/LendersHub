/* eslint-disable */
/**
 * Clears the customer book from tenant schemas, so a workspace can be loaded
 * with real data — WITHOUT touching logins, configuration or funder capital.
 *
 * DELETES (in FK-safe order):
 *   incoming_payment_events, daily_ledger_snapshot, collection_audit,
 *   ledger_transactions, loan_funder_allocations, payments, installments,
 *   loans, customers, notifications
 *
 * KEEPS:
 *   users + otp_tokens ......... every login, including role='CUSTOMER'
 *   branches, loan_types, settings, role_permissions ...... configuration
 *   funders, funder_transactions .................... capital contributions
 *   fund_transactions ................... the older cash/fund ledger (below)
 *   activity_log ......................... who-did-what audit trail (below)
 *
 * Two deliberate keeps you may disagree with — both opt-in to delete, because
 * deleting is irreversible and keeping is not:
 *
 *   --include-fund-transactions
 *       fund_transactions rows reference loans by a plain text entity_id (no
 *       FK), so wiping loans leaves credits/debits for loans that no longer
 *       exist and the old Ledger view will not tie out to an empty book.
 *       Kept by default because these are money records nobody asked to lose.
 *
 *   --include-activity-log
 *       activity_log is append-only history of who did what. Kept by default:
 *       it is the record of the very cleanup you are about to run.
 *
 *   --include-customer-logins
 *       also delete users with role='CUSTOMER', whose customer record is
 *       being deleted. Kept by default ("except user logins"), which does
 *       leave those logins pointing at nothing.
 *
 * MODES — dry run is the default; nothing is deleted unless you ask twice.
 *   (no flag)   count what WOULD be deleted, touch nothing
 *   --trial     really run every DELETE, report true row counts, then ROLLBACK
 *   --confirm   run and COMMIT. Irreversible.
 *
 * Usage (from backend/, on the server):
 *   node scripts/clean-tenant-business-data.js                     # dry run, all tenants
 *   node scripts/clean-tenant-business-data.js --tenant acme       # dry run, one workspace
 *   node scripts/clean-tenant-business-data.js --trial             # prove it, change nothing
 *   node scripts/clean-tenant-business-data.js --confirm           # do it
 *
 * TAKE A BACKUP FIRST. There is no undo:
 *   pg_dump -Fc -h <host> -U <user> lendershub > lendershub-$(date +%F-%H%M).dump
 */
const { Client } = require('pg');
const { resolveDatabaseUrl } = require('./db-url');

// Order matters: children before parents. collection_audit is created lazily by
// the collections service, so it may legitimately not exist on some schemas.
const TABLES = [
  'incoming_payment_events',
  'daily_ledger_snapshot',
  'collection_audit',
  'ledger_transactions',
  'loan_funder_allocations',
  'payments',
  'installments',
  'loans',
  'customers',
  'notifications',
];

async function tableExists(client, schema, table) {
  const r = await client.query(
    `SELECT to_regclass($1) AS t`,
    [`"${schema}"."${table}"`],
  );
  return !!r.rows[0].t;
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const trial = args.includes('--trial');
  const tenantIdx = args.indexOf('--tenant');
  const onlyTenant = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;

  const tables = [...TABLES];
  if (args.includes('--include-fund-transactions')) tables.push('fund_transactions');
  if (args.includes('--include-activity-log')) tables.push('activity_log');
  const includeCustomerLogins = args.includes('--include-customer-logins');

  if (confirm && trial) {
    console.error('Pass either --trial or --confirm, not both.');
    process.exit(1);
  }

  const mode = confirm ? 'EXECUTE (COMMIT)' : trial ? 'TRIAL (execute, then ROLLBACK)' : 'DRY RUN (counts only)';
  const client = new Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();

  try {
    const { rows: tenants } = await client.query(
      onlyTenant
        ? `SELECT subdomain, schema_name FROM public.tenants WHERE subdomain = $1 AND schema_name IS NOT NULL ORDER BY subdomain`
        : `SELECT subdomain, schema_name FROM public.tenants WHERE schema_name IS NOT NULL ORDER BY subdomain`,
      onlyTenant ? [onlyTenant] : [],
    );

    if (tenants.length === 0) {
      console.log(onlyTenant ? `No tenant found for subdomain "${onlyTenant}".` : 'No tenants found.');
      return;
    }

    console.log(`Mode: ${mode}`);
    console.log(`Tenants: ${tenants.map((t) => t.subdomain).join(', ')}`);
    console.log(`Also deleting: ${[
      args.includes('--include-fund-transactions') && 'fund_transactions',
      args.includes('--include-activity-log') && 'activity_log',
      includeCustomerLogins && "users(role='CUSTOMER')",
    ].filter(Boolean).join(', ') || '(nothing beyond the standard set)'}`);
    console.log('');

    const grand = {};
    for (const t of tenants) {
      console.log(`--- ${t.subdomain} (${t.schema_name})`);
      const counts = {};

      if (confirm || trial) await client.query('BEGIN');
      try {
        for (const table of tables) {
          if (!(await tableExists(client, t.schema_name, table))) {
            console.log(`    ${table.padEnd(26)} (absent)`);
            continue;
          }
          const q = `"${t.schema_name}"."${table}"`;
          if (confirm || trial) {
            const res = await client.query(`DELETE FROM ${q}`);
            counts[table] = res.rowCount;
          } else {
            const res = await client.query(`SELECT COUNT(*)::int AS n FROM ${q}`);
            counts[table] = res.rows[0].n;
          }
          grand[table] = (grand[table] ?? 0) + counts[table];
          console.log(`    ${table.padEnd(26)} ${counts[table]}`);
        }

        if (includeCustomerLogins) {
          const q = `"${t.schema_name}"."users"`;
          const res = confirm || trial
            ? await client.query(`DELETE FROM ${q} WHERE role = 'CUSTOMER'`)
            : await client.query(`SELECT COUNT(*)::int AS n FROM ${q} WHERE role = 'CUSTOMER'`);
          const n = confirm || trial ? res.rowCount : res.rows[0].n;
          grand["users(CUSTOMER)"] = (grand["users(CUSTOMER)"] ?? 0) + n;
          console.log(`    ${"users(role=CUSTOMER)".padEnd(26)} ${n}`);
        }

        // What survives, so the operator can see it survived.
        const kept = [];
        for (const k of ['users', 'branches', 'loan_types', 'settings', 'funders']) {
          if (!(await tableExists(client, t.schema_name, k))) continue;
          const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t.schema_name}"."${k}"`);
          kept.push(`${k}=${r.rows[0].n}`);
        }
        console.log(`    kept: ${kept.join(' ')}`);

        if (trial) {
          await client.query('ROLLBACK');
          console.log('    -> ROLLED BACK (trial run, nothing changed)');
        } else if (confirm) {
          await client.query('COMMIT');
          console.log('    -> COMMITTED');
        }
      } catch (e) {
        if (confirm || trial) await client.query('ROLLBACK');
        console.error(`    FAILED, rolled back: ${e.message}`);
        process.exitCode = 1;
      }
      console.log('');
    }

    console.log('Totals across all tenants:');
    for (const [k, v] of Object.entries(grand)) console.log(`  ${k.padEnd(26)} ${v}`);
    if (!confirm && !trial) {
      console.log('\nDry run — nothing was deleted.');
      console.log('Take a backup, then re-run with --trial to prove it, and --confirm to apply.');
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
