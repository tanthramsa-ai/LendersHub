/* eslint-disable */
/**
 * Backfill ledger_transactions from historical loans and payments.
 *
 * WHY THIS EXISTS
 * ---------------
 * ledger_transactions is the financial source of truth (requirements doc §14),
 * and every figure on the ledger dashboard — Total Disbursed, Outstanding
 * Principal, principal/interest collected — is computed exclusively from it.
 * But rows only ever get written going forward, by the three live posting
 * paths (collections service, loans service, payment webhook). Loans disbursed
 * and payments collected BEFORE the ledger shipped have no rows at all.
 *
 * On a tenant with an existing book that means the ledger dashboard reports
 * near-zero while the loans screens show the real numbers, and requirements
 * doc §15 ("the system can reproduce July and August totals from
 * transactions") cannot pass. This script closes that gap.
 *
 * WHAT IT WRITES
 * --------------
 *   DISBURSEMENT  one per loan with a disbursed_at, principal = loans.principal
 *   COLLECTION    one per payments row, split into principal/interest
 *
 * The principal/interest split is NOT reimplemented here — it imports the real
 * splitPrincipalInterest() from the compiled build, so backfilled rows and
 * live rows agree by construction rather than by two copies of the same
 * formula staying in sync. (The hand-copied-DDL fallback in
 * repair-tenant-schemas.js drifted exactly this way once already; for money,
 * this script refuses to guess and just requires `npm run build` first.)
 *
 * SAFE TO RE-RUN
 * --------------
 * Two independent guards, so a repeat run is a no-op rather than a
 * double-credit:
 *   1. Candidate queries skip anything that already has a ledger row.
 *   2. Every insert carries an idempotency_key and uses ON CONFLICT DO
 *      NOTHING against the partial unique index on that column. Disbursements
 *      reuse the SAME key the live path uses (`disbursement:<loanId>`), so
 *      backfilling a loan that later disburses through the app — or vice
 *      versa — still cannot produce two rows.
 *
 * DELIBERATE ASSUMPTIONS (each overridable or documented, none silent)
 * --------------------------------------------------------------------
 *  - Cancelled/undone payments are skipped entirely. The live path reverses
 *    such a collection (original + negated row, netting to zero); omitting
 *    both nets to the same zero and leaves less noise behind.
 *  - Soft-deleted loans and their payments are skipped by default. A deleted
 *    loan is usually an erroneous record, and including it would inflate
 *    outstanding principal. Pass --include-deleted to keep the financial
 *    history of deleted operational records (requirements doc §10).
 *  - Collections are backfilled on the PLAIN channel (CASH, UPI, ...), never
 *    AGENT_CASH/AGENT_UPI. The dashboard's "Agent Collections Pending
 *    Reconciliation" card counts agent-channel rows that are still POSTED;
 *    tagging years of already-settled history as agent-collected would show
 *    the entire back book as pending reconciliation, which is false.
 *  - created_by / agent_id are set to the person who actually caused the
 *    event (payments.collected_by), matching what the live path records.
 *
 * USAGE (from the backend/ folder, after `npm run build`)
 * -------------------------------------------------------
 *   node scripts/backfill-ledger-transactions.js                     # dry run, all tenants
 *   node scripts/backfill-ledger-transactions.js acme                # dry run, one tenant
 *   node scripts/backfill-ledger-transactions.js --apply             # write, all tenants
 *   node scripts/backfill-ledger-transactions.js acme --apply
 *   node scripts/backfill-ledger-transactions.js acme --apply --include-deleted
 *
 * Dry run is the default and prints exactly what a real run would write.
 */
const path = require('path');
const { Client } = require('pg');
const { resolveDatabaseUrl } = require('./db-url');

// ── The real split function, not a copy ───────────────────────────────────
let splitPrincipalInterest;
try {
  ({ splitPrincipalInterest } = require(
    path.resolve(__dirname, '..', 'dist', 'tenant', 'ledger', 'tenant-ledger-posting.service.js'),
  ));
} catch (_) {
  splitPrincipalInterest = null;
}
if (typeof splitPrincipalInterest !== 'function') {
  console.error('Could not load splitPrincipalInterest() from dist/.');
  console.error('');
  console.error('This script deliberately has no fallback copy of the principal/interest');
  console.error('split — a second implementation would drift from the live one and quietly');
  console.error('produce ledger rows that disagree with the app. Build first:');
  console.error('');
  console.error('  npm run build && node scripts/backfill-ledger-transactions.js');
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_DELETED = args.includes('--include-deleted');
const targetSubdomain = args.find((a) => !a.startsWith('--'));

const fmt = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const emptyStats = () => ({
  disbursements: 0, collections: 0, unallocated: 0,
  skippedZero: 0, conflictSkipped: 0,
  disbursedTotal: 0, principalTotal: 0, interestTotal: 0, otherTotal: 0,
});

/** Which optional columns this schema actually has — old schemas predate several. */
async function columnsOn(client, schemaName, table) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [schemaName, table],
  );
  return new Set(rows.map((r) => r.column_name));
}

async function tableExists(client, schemaName, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [schemaName, table],
  );
  return rows.length > 0;
}

/**
 * Loans whose money actually left — disbursed_at is only ever set at the single
 * point of disbursement, so it (not status) is the reliable marker. Skips any
 * loan that already has a DISBURSEMENT row, reversed or not: if one was
 * deliberately reversed, re-posting it here would undo that decision.
 */
async function backfillDisbursements(client, schemaName, loanCols, stats) {
  const deletedFilter = !INCLUDE_DELETED && loanCols.has('deleted_at') ? 'AND l.deleted_at IS NULL' : '';
  const { rows } = await client.query(
    // Dates come back as text, not as JS Date objects: a DATE parsed to local
    // midnight and serialized back can land on the previous day in a negative
    // UTC offset, silently filing a disbursement under the wrong business date.
    `SELECT l.id, l.loan_number, l.customer_id, l.principal,
            to_char(l.disbursed_at::date, 'YYYY-MM-DD') AS business_date, l.loan_officer_id
       FROM loans l
      WHERE l.disbursed_at IS NOT NULL
        ${deletedFilter}
        AND NOT EXISTS (
          SELECT 1 FROM ledger_transactions lt
           WHERE lt.loan_id = l.id AND lt.transaction_type = 'DISBURSEMENT'
        )
      ORDER BY l.disbursed_at`,
  );

  for (const l of rows) {
    const principal = round2(parseFloat(l.principal));
    if (principal === 0) { stats.skippedZero++; continue; }

    if (!APPLY) {
      stats.disbursements++;
      stats.disbursedTotal = round2(stats.disbursedTotal + principal);
      continue;
    }

    const res = await client.query(
      `INSERT INTO ledger_transactions (
         transaction_date, business_date, transaction_type, loan_id, customer_id,
         principal_amount, total_amount, payment_channel, status,
         idempotency_key, remarks, created_by
       ) VALUES ($1,$1,'DISBURSEMENT',$2,$3,$4,$4,'CASH','POSTED',$5,$6,$7)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        l.business_date, l.id, l.customer_id, principal,
        // Same key the live disbursement path uses — a loan can never end up
        // with both a backfilled and a live-posted disbursement.
        `disbursement:${l.id}`,
        `Loan disbursement — ${l.loan_number} [backfilled from loans.disbursed_at]`,
        l.loan_officer_id,
      ],
    );
    // Counted only once the row actually landed, so the summary never claims
    // to have posted something the idempotency guard absorbed.
    if (res.rowCount === 0) {
      stats.conflictSkipped++;
    } else {
      stats.disbursements++;
      stats.disbursedTotal = round2(stats.disbursedTotal + principal);
    }
  }
}

/**
 * One COLLECTION per payments row — the live collection path also writes one
 * payment row and one ledger row per settled installment, so the mapping is 1:1.
 */
async function backfillCollections(client, schemaName, loanCols, payCols, stats) {
  const deletedFilter = !INCLUDE_DELETED && loanCols.has('deleted_at') ? 'AND l.deleted_at IS NULL' : '';
  // Undone collections: skipped, not posted-then-reversed. Both net to zero.
  const cancelledFilters = [];
  if (payCols.has('cancelled_at')) cancelledFilters.push('AND p.cancelled_at IS NULL');
  if (payCols.has('collection_status')) cancelledFilters.push(`AND p.collection_status <> 'CANCELLED'`);

  const { rows } = await client.query(
    `SELECT p.id, p.loan_id, p.installment_id, p.amount, p.payment_method,
            p.reference_number, p.collected_by,
            to_char(p.payment_date, 'YYYY-MM-DD') AS payment_date,
            l.customer_id, l.loan_number,
            i.principal_amount, i.interest_amount
       FROM payments p
       JOIN loans l ON l.id = p.loan_id
       LEFT JOIN installments i ON i.id = p.installment_id
      WHERE NOT EXISTS (
              SELECT 1 FROM ledger_transactions lt WHERE lt.payment_id = p.id
            )
        ${deletedFilter}
        ${cancelledFilters.join(' ')}
      ORDER BY p.payment_date, p.created_at`,
  );

  for (const p of rows) {
    const amount = round2(parseFloat(p.amount));
    if (amount === 0) { stats.skippedZero++; continue; }

    // No installment to allocate against means the components genuinely aren't
    // known — recorded as unclassified rather than guessed, exactly as the
    // live office-payment path does.
    const hasSchedule = p.installment_id !== null && p.principal_amount !== null;
    const split = hasSchedule
      ? splitPrincipalInterest(amount, parseFloat(p.principal_amount), parseFloat(p.interest_amount))
      : null;
    const principal = split ? split.principal : 0;
    const interest = split ? split.interest : 0;
    const other = split ? 0 : amount;

    const tally = () => {
      stats.collections++;
      if (!hasSchedule) stats.unallocated++;
      stats.principalTotal = round2(stats.principalTotal + principal);
      stats.interestTotal = round2(stats.interestTotal + interest);
      stats.otherTotal = round2(stats.otherTotal + other);
    };
    if (!APPLY) { tally(); continue; }

    const res = await client.query(
      `INSERT INTO ledger_transactions (
         transaction_date, business_date, transaction_type, loan_id, customer_id,
         agent_id, payment_id, principal_amount, interest_amount, other_amount, total_amount,
         payment_channel, external_reference, status, idempotency_key, remarks, created_by
       ) VALUES ($1,$1,'COLLECTION',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'POSTED',$12,$13,$4)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        p.payment_date, p.loan_id, p.customer_id, p.collected_by, p.id,
        principal, interest, other, amount,
        // Plain channel, never AGENT_* — see the header note on the
        // pending-reconciliation card.
        p.payment_method,
        p.reference_number,
        `backfill:payment:${p.id}`,
        hasSchedule
          ? `Collection for installment ${p.installment_id} [backfilled from payments]`
          : `Payment not tied to a specific installment (unallocated) [backfilled from payments]`,
      ],
    );
    if (res.rowCount === 0) stats.conflictSkipped++;
    else tally();
  }
}

/** Ledger totals after the run, for eyeballing against the loans screens. */
async function reportPosition(client) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'DISBURSEMENT'), 0) AS disbursed,
       COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'COLLECTION'), 0) AS principal_collected,
       COALESCE(SUM(interest_amount)  FILTER (WHERE transaction_type = 'COLLECTION'), 0) AS interest_collected
     FROM ledger_transactions
     WHERE status IN ('POSTED','RECONCILED') AND reversal_of_id IS NULL`,
  );
  const r = rows[0];
  const disbursed = parseFloat(r.disbursed);
  const principalCollected = parseFloat(r.principal_collected);
  return {
    disbursed,
    principalCollected,
    interestCollected: parseFloat(r.interest_collected),
    outstanding: round2(disbursed - principalCollected),
  };
}

async function backfillTenant(client, tenant) {
  const { subdomain, schema_name: schemaName } = tenant;
  console.log(`\n── ${subdomain} (${schemaName}) ${'─'.repeat(Math.max(0, 48 - subdomain.length - schemaName.length))}`);

  if (!(await tableExists(client, schemaName, 'ledger_transactions'))) {
    console.log('  skipped — no ledger_transactions table. Run scripts/repair-tenant-schemas.js first.');
    return { skipped: true };
  }

  await client.query(`SET search_path = "${schemaName}", public`);

  const loanCols = await columnsOn(client, schemaName, 'loans');
  const payCols = await columnsOn(client, schemaName, 'payments');

  const stats = emptyStats();

  // One transaction per tenant: a failure partway leaves that tenant exactly
  // as it was, rather than half-backfilled.
  await client.query('BEGIN');
  try {
    await backfillDisbursements(client, schemaName, loanCols, stats);
    await backfillCollections(client, schemaName, loanCols, payCols, stats);
    const position = APPLY ? await reportPosition(client) : null;
    if (APPLY) await client.query('COMMIT');
    else await client.query('ROLLBACK');

    const verb = APPLY ? 'posted' : 'would post';
    console.log(`  ${verb} ${stats.disbursements} disbursement(s)  ${fmt(stats.disbursedTotal)}`);
    console.log(`  ${verb} ${stats.collections} collection(s)   principal ${fmt(stats.principalTotal)}  interest ${fmt(stats.interestTotal)}`);
    if (stats.otherTotal > 0) {
      console.log(`    of which ${stats.unallocated} unallocated (no installment): ${fmt(stats.otherTotal)}`);
    }
    if (stats.skippedZero > 0) console.log(`  skipped ${stats.skippedZero} zero-amount record(s)`);
    if (stats.conflictSkipped > 0) console.log(`  skipped ${stats.conflictSkipped} already-keyed row(s) (idempotency conflict)`);
    if (stats.disbursements === 0 && stats.collections === 0) console.log('  nothing to backfill — already up to date');

    if (position) {
      console.log(`  ledger position now:`);
      console.log(`    total disbursed        ${fmt(position.disbursed)}`);
      console.log(`    principal collected    ${fmt(position.principalCollected)}`);
      console.log(`    interest collected     ${fmt(position.interestCollected)}`);
      console.log(`    outstanding principal  ${fmt(position.outstanding)}   <- cross-check against the loans screens`);
    }
    return { stats };
  } catch (e) {
    await client.query('ROLLBACK');
    console.log(`  FAILED — rolled back, this tenant is unchanged`);
    console.log(`    ${e.message}`);
    return { failed: true };
  } finally {
    await client.query(`SET search_path = public`);
  }
}

async function main() {
  const DATABASE_URL = resolveDatabaseUrl();
  console.log(APPLY
    ? 'Mode: APPLY — ledger transactions will be written.'
    : 'Mode: DRY RUN — nothing will be written. Re-run with --apply to commit.');
  if (INCLUDE_DELETED) console.log('Including soft-deleted loans and their payments.');

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const { rows: tenants } = await client.query(
      targetSubdomain
        ? `SELECT subdomain, schema_name FROM public.tenants WHERE subdomain = $1 AND schema_name IS NOT NULL`
        : `SELECT subdomain, schema_name FROM public.tenants WHERE schema_name IS NOT NULL ORDER BY subdomain`,
      targetSubdomain ? [targetSubdomain] : [],
    );

    if (tenants.length === 0) {
      console.log(targetSubdomain ? `No tenant found for subdomain "${targetSubdomain}".` : 'No tenants found.');
      return;
    }

    let anyFailed = false;
    for (const t of tenants) {
      const result = await backfillTenant(client, t);
      if (result.failed) anyFailed = true;
    }

    if (!APPLY) {
      console.log('\nDry run complete — no changes were written.');
      console.log('Re-run with --apply once the figures above look right.');
    }
    if (anyFailed) {
      console.log('\nOne or more tenants failed and were rolled back. This script is idempotent,');
      console.log('so fix the cause and re-run; tenants that succeeded will report nothing to do.');
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

// Exported so the backfill logic can be exercised against a real Postgres in a
// test harness without going through tenant discovery or the CLI.
module.exports = { backfillDisbursements, backfillCollections, reportPosition, emptyStats };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
