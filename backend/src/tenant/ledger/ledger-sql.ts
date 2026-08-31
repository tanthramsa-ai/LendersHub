/**
 * Shared SQL fragments over ledger_transactions — used by the reporting,
 * reconciliation/snapshot and reports services, so the outstanding-principal,
 * cash-direction and "which rows count" rules stay defined once.
 */

/**
 * Which ledger rows count toward a financial total. Every aggregate MUST use
 * this rather than `status = 'POSTED'`, which is wrong at both ends:
 *
 *  - RECONCILED rows are still real money. Filtering to POSTED made a
 *    collection vanish from every total the moment it was marked settled.
 *  - A reversal is stored as a NEW negated row while the original is flipped
 *    to REVERSED. Filtering to POSTED therefore dropped the original (+X) but
 *    kept the reversal (−X), moving totals by −X instead of netting to zero —
 *    a 2X error in the wrong direction. Excluding reversal rows *and*
 *    REVERSED originals is what actually nets a reversal to zero.
 *  - PENDING rows are not money yet and stay excluded.
 *
 * Listings that deliberately show reversals (the Reversed Transactions view)
 * intentionally do not use this.
 *
 * Pass a table alias when the query joins (e.g. liveLedgerSql('lt')).
 */
export function liveLedgerSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}status IN ('POSTED','RECONCILED') AND ${p}reversal_of_id IS NULL`;
}

/** Unaliased form, for the common single-table case. */
export const LIVE_LEDGER_SQL = liveLedgerSql();

/** Same rule for funder_transactions, which has no RECONCILED status but the identical reversal model. */
export function liveFunderTxnSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `${p}status = 'POSTED' AND ${p}reversal_of_id IS NULL`;
}

export const LIVE_FUNDER_TXN_SQL = liveFunderTxnSql();

/**
 * Signed-cash-flow direction per transaction_type — total_amount on a posted
 * row is always a positive magnitude (what happened), not a cash direction,
 * so "net cash movement" needs its own per-type sign. ADJUSTMENT is excluded
 * (0): an adjustment's cash effect isn't implied by its type alone.
 */
export const CASH_DIRECTION_SQL = `CASE transaction_type
  WHEN 'COLLECTION'   THEN 1
  WHEN 'FEE'          THEN 1
  WHEN 'DISBURSEMENT' THEN -1
  WHEN 'REFUND'       THEN -1
  ELSE 0
END`;

/**
 * Net change in outstanding principal contributed by each transaction_type —
 * the formula from the ledger requirements doc (§7.1): disbursements increase
 * it, collections decrease it, refunds and adjustments apply as signed.
 */
export function outstandingPrincipalExpr(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `
  COALESCE(SUM(${p}principal_amount) FILTER (WHERE ${p}transaction_type = 'DISBURSEMENT'), 0)
  - COALESCE(SUM(${p}principal_amount) FILTER (WHERE ${p}transaction_type = 'COLLECTION'), 0)
  + COALESCE(SUM(${p}principal_amount) FILTER (WHERE ${p}transaction_type = 'REFUND'), 0)
  + COALESCE(SUM(${p}principal_amount) FILTER (WHERE ${p}transaction_type = 'ADJUSTMENT'), 0)
`;
}

/** Unaliased form, for the common single-table case. */
export const OUTSTANDING_PRINCIPAL_EXPR = outstandingPrincipalExpr();
