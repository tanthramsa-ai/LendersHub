/**
 * NPA (non-performing asset) classification.
 *
 * A loan is NPA when either:
 *  - an admin has manually flagged it (loans.npa_marked_at), or
 *  - its overdue installment count has reached the tenant's threshold.
 *
 * The threshold lives in the tenant `settings` table under `npa_overdue_threshold`
 * and falls back to this default when unset.
 */
export const NPA_DEFAULT_THRESHOLD = 4;

export const NPA_THRESHOLD_SETTING_KEY = 'npa_overdue_threshold';

/**
 * Counts installments that are past due and not settled, for NPA classification.
 *
 * Deliberately date-based rather than `status = 'OVERDUE'`. Only the ageing job
 * writes OVERDUE, and it skips anything with a payment against it — while any
 * token payment flips an installment to PARTIALLY_PAID, which nothing ever ages
 * back. Counting statuses would therefore let a borrower who pays ₹1 an
 * installment stay off the NPA list forever.
 *
 * Kept separate from the installment status so the financial roll-ups, which key
 * off status to decide how much of an installment counts as received, are
 * untouched. Expects the installments table aliased as `i`.
 */
export const NPA_OVERDUE_COUNT_SQL = `COUNT(i.id) FILTER (
  WHERE i.due_date < CURRENT_DATE
    AND i.status NOT IN ('PAID','WAIVED')
    AND i.paid_amount < i.total_amount
)`;

/**
 * Whole-loan NPA test as a correlated subquery, for aggregates that group over loans
 * (agent performance, portfolio totals) rather than listing installments.
 *
 * @param loanAlias      table alias of `loans` in the enclosing query
 * @param thresholdParam bound parameter holding the tenant threshold, e.g. '$3'
 */
export function npaLoanPredicateSql(
  loanAlias: string,
  thresholdParam: string,
): string {
  return `(${loanAlias}.npa_marked_at IS NOT NULL OR (
    SELECT COUNT(*) FROM installments i
     WHERE i.loan_id = ${loanAlias}.id
       AND i.due_date < CURRENT_DATE
       AND i.status NOT IN ('PAID','WAIVED')
       AND i.paid_amount < i.total_amount
  ) >= ${thresholdParam})`;
}

/** Reads the configured threshold from a raw settings value, falling back to the default. */
export function parseNpaThreshold(raw: string | undefined | null): number {
  const parsed = parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1
    ? parsed
    : NPA_DEFAULT_THRESHOLD;
}
