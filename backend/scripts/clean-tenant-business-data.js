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
 *   --all-except-users
 *       A different job entirely: empties EVERY table in the tenant schema
 *       except `users`, config included (branches, loan types, settings, the
 *       permission matrix, funders, the activity trail). For handing a
 *       workspace back as a blank slate that its people can still log in to.
 *       `users` does carry outbound foreign keys in a real database even
 *       though tenant-schema.ts does not show them — users.branch_id ->
 *       branches is there in practice — and a table cannot be truncated while
 *       something outside the truncated set still references it. Those columns
 *       are set to NULL first, so the logins survive and lose only an
 *       assignment to a branch that is being deleted anyway. TRUNCATE is
 *       deliberately issued without CASCADE: CASCADE would happily truncate
 *       `users` too, which is the one thing this mode must not do.
 *       role_permissions re-seeds itself from tenantSchemaDDL() on the next
 *       backend boot, so the permission matrix comes back on its own.
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

/** Every base table in the schema except `users` — the --all-except-users set. */
async function tablesExceptUsers(client, schema) {
  const r = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name <> 'users'
      ORDER BY table_name`,
    [schema],
  );
  return r.rows.map((x) => x.table_name);
}

/**
 * Order in which the schema's tables can be emptied: a table is only cleared
 * once everything that references it has been cleared.
 *
 * TRUNCATE cannot do this job. It refuses on any table referenced by a foreign
 * key from outside the truncated set — and it judges that by the constraint's
 * existence, not by whether any row actually points there, so `users` keeping
 * its branch_id constraint blocks `branches` even when the column is all NULL.
 * TRUNCATE ... CASCADE would get past it by also truncating `users`, which is
 * the one table this must preserve. Ordered DELETEs respect rows rather than
 * constraints, so they can.
 *
 * Kahn's algorithm over the real pg_constraint graph — self-references are
 * ignored (a single DELETE clears the whole table at once) as are references
 * from tables being kept, which are detached beforehand.
 */
async function deletionOrder(client, schema, tables, keep) {
  const edges = await client.query(
    `SELECT src.relname AS referencing, tgt.relname AS referenced
       FROM pg_constraint con
       JOIN pg_class src ON src.oid = con.conrelid
       JOIN pg_class tgt ON tgt.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = src.relnamespace
      WHERE con.contype = 'f' AND n.nspname = $1`,
    [schema],
  );
  const set = new Set(tables);
  const blockers = new Map(tables.map((t) => [t, new Set()]));
  for (const e of edges.rows) {
    if (e.referencing === e.referenced) continue;
    if (keep.includes(e.referencing)) continue;
    if (!set.has(e.referencing) || !set.has(e.referenced)) continue;
    blockers.get(e.referenced).add(e.referencing);
  }
  const order = [];
  const pending = new Set(tables);
  while (pending.size > 0) {
    const ready = [...pending].filter((t) => [...blockers.get(t)].every((b) => !pending.has(b)));
    if (ready.length === 0) {
      // Mutually referencing tables: emit the rest and let the DELETE speak.
      order.push(...pending);
      break;
    }
    for (const t of ready) { order.push(t); pending.delete(t); }
  }
  return order;
}

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

  const allExceptUsers = args.includes('--all-except-users');
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

    console.log(`Mode: ${mode}${allExceptUsers ? '  [--all-except-users: empties the whole schema but users]' : ''}`);
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
        // Truncate the whole schema in one statement rather than deleting table
        // by table: TRUNCATE takes every table at once, so mutual foreign keys
        // cannot deadlock the order. No CASCADE — with `users` the only table
        // held back, and nothing referenced by it, a plain TRUNCATE must
        // succeed; if it does not, that is something to look at rather than
        // silently widen.
        if (allExceptUsers) {
          const all = await tablesExceptUsers(client, t.schema_name);

          // Detach users from anything about to be truncated. Read the live
          // catalogue rather than trusting the schema source, which does not
          // list users.branch_id.
          const fks = await client.query(
            `SELECT att.attname AS column_name, tgt.relname AS referenced_table, att.attnotnull AS not_null
               FROM pg_constraint con
               JOIN pg_class src ON src.oid = con.conrelid
               JOIN pg_class tgt ON tgt.oid = con.confrelid
               JOIN pg_namespace n ON n.oid = src.relnamespace
               JOIN unnest(con.conkey) AS k(attnum) ON TRUE
               JOIN pg_attribute att ON att.attrelid = src.oid AND att.attnum = k.attnum
              WHERE con.contype = 'f' AND n.nspname = $1 AND src.relname = 'users'`,
            [t.schema_name],
          );
          const blocking = fks.rows.filter((f) => all.includes(f.referenced_table));
          const notNullable = blocking.filter((f) => f.not_null);
          if (notNullable.length > 0) {
            throw new Error(
              `users.${notNullable.map((f) => f.column_name).join(', users.')} is NOT NULL and references ` +
              `${notNullable.map((f) => f.referenced_table).join(', ')}, which this mode empties. ` +
              `Cannot keep the logins and clear that table in the same pass.`,
            );
          }
          for (const f of blocking) {
            if (confirm || trial) {
              const r = await client.query(
                `UPDATE "${t.schema_name}"."users" SET "${f.column_name}" = NULL WHERE "${f.column_name}" IS NOT NULL`,
              );
              console.log(`    detached users.${f.column_name} -> ${f.referenced_table} (${r.rowCount} row(s))`);
            } else {
              console.log(`    would detach users.${f.column_name} -> ${f.referenced_table}`);
            }
          }

          const order = await deletionOrder(client, t.schema_name, all, ['users']);
          for (const table of order) {
            const q = `"${t.schema_name}"."${table}"`;
            if (confirm || trial) {
              const r = await client.query(`DELETE FROM ${q}`);
              counts[table] = r.rowCount;
            } else {
              const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${q}`);
              counts[table] = r.rows[0].n;
            }
            grand[table] = (grand[table] ?? 0) + counts[table];
            console.log(`    ${table.padEnd(26)} ${counts[table]}`);
          }
          const u = await client.query(`SELECT COUNT(*)::int AS n FROM "${t.schema_name}"."users"`);
          console.log(`    kept: users=${u.rows[0].n} (everything else emptied)`);
          if (trial) { await client.query('ROLLBACK'); console.log('    -> ROLLED BACK (trial run, nothing changed)'); }
          else if (confirm) { await client.query('COMMIT'); console.log('    -> COMMITTED'); }
          console.log('');
          continue;
        }

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
