/**
 * NPA (non-performing asset) classification.
 *
 * A loan is NPA when it currently has a run of consecutive overdue installments AND
 * either:
 *  - an admin has manually flagged it (loans.npa_marked_at), or
 *  - that consecutive run has reached the tenant's threshold.
 *
 * "Consecutive" is deliberate: a borrower who missed installment #2, caught up, and
 * later missed #5 alone has a run of 1, not a run of 2, even though 2 installments
 * are overdue somewhere in the schedule. NPA is meant to flag a sustained streak of
 * non-payment (the sheet's own framing: "if more than 4 instalments pending"), not
 * scattered misses spread across a long-running loan.
 *
 * The "currently overdue" requirement (run > 0) means NPA status tracks live
 * delinquency: once a borrower catches up (the run drops to 0) or the loan is fully
 * settled, it stops showing as NPA even if it was manually flagged earlier — a
 * manual flag isn't a permanent label, it's an assertion about current risk that
 * stops applying once there's nothing overdue to justify it. The npa_marked_at/by/
 * reason columns are left untouched (only "Clear NPA" or a fresh mark writes them),
 * so the flag reactivates automatically if the loan falls behind again later.
 *
 * The threshold lives in the tenant `settings` table under `npa_overdue_threshold`
 * and falls back to this default when unset.
 */
export const NPA_DEFAULT_THRESHOLD = 4;

export const NPA_THRESHOLD_SETTING_KEY = 'npa_overdue_threshold';

/**
 * Scalar correlated subquery: the length of the longest run of consecutive-by-
 * installment_number overdue installments for the loan aliased `loanAlias`.
 *
 * Standard gaps-and-islands technique: filter to overdue rows, then
 * `installment_number - ROW_NUMBER() OVER (ORDER BY installment_number)` is
 * constant across any maximal run of consecutive installment_numbers (each step
 * advances both sides by 1) and changes the moment a non-overdue installment
 * breaks the run — grouping on that expression and taking the largest group size
 * gives the longest streak, 0 if there are no overdue installments at all.
 *
 * "Overdue" here is deliberately date-based rather than `status = 'OVERDUE'`. Only
 * the ageing job writes OVERDUE, and it skips anything with a payment against it —
 * while any token payment flips an installment to PARTIALLY_PAID, which nothing
 * ever ages back. Counting statuses would let a borrower who pays ₹1 an
 * installment stay off the NPA list forever.
 *
 * @param loanAlias table alias of `loans` in the enclosing query
 */
export function npaConsecutiveOverdueRunSql(loanAlias: string): string {
  return `(SELECT COALESCE(MAX(run_length), 0) FROM (
    SELECT COUNT(*) AS run_length FROM (
      SELECT installment_number,
             installment_number - ROW_NUMBER() OVER (ORDER BY installment_number) AS grp
      FROM installments
      WHERE loan_id = ${loanAlias}.id
        AND due_date < CURRENT_DATE
        AND status NOT IN ('PAID','WAIVED')
        AND paid_amount < total_amount
    ) overdue_only
    GROUP BY grp
  ) runs)`;
}

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
  const run = npaConsecutiveOverdueRunSql(loanAlias);
  return `(${run} > 0 AND (${loanAlias}.npa_marked_at IS NOT NULL OR ${run} >= ${thresholdParam}))`;
}

/** Reads the configured threshold from a raw settings value, falling back to the default. */
export function parseNpaThreshold(raw: string | undefined | null): number {
  const parsed = parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1
    ? parsed
    : NPA_DEFAULT_THRESHOLD;
}
