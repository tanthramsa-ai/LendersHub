import { BadRequestException } from '@nestjs/common';

/**
 * Loan statuses, and which of them count as what.
 *
 * Approving a loan moves it PENDING -> APPROVED and generates its schedule; a loan is collected on from
 * that moment. DISBURSED is only set by an explicit disbursement step that most tenants never use, so
 * "active" has to mean APPROVED *or* DISBURSED. Counting DISBURSED alone made the dashboard, Accounts,
 * Customers list and the overdue/reminder jobs treat every approved loan as if it did not exist.
 */
export const LOAN_STATUSES = ['PENDING', 'APPROVED', 'DISBURSED', 'CLOSED', 'DEFAULTED', 'REJECTED'] as const;

/** Loans being collected on right now. Matches what the Collections screens already use. */
export const ACTIVE_LOAN_STATUSES = ['APPROVED', 'DISBURSED'] as const;
export const ACTIVE_LOANS_SQL = `('APPROVED','DISBURSED')`;

/**
 * Loans whose principal has actually gone out: everything that got past approval. PENDING and REJECTED
 * loans never lent anything, so they must stay out of "principal disbursed" style totals.
 */
export const LENT_LOANS_SQL = `('APPROVED','DISBURSED','CLOSED','DEFAULTED')`;

/** The pseudo-status a list filter can send to mean "any active loan". */
export const ACTIVE_FILTER = 'ACTIVE';

/**
 * Turns the `?status=` of a loan list into the statuses to match. `ACTIVE` expands to every active
 * status; a real status matches itself; anything else is a 400 (it used to reach Postgres as an
 * invalid enum value and surface as a 500).
 */
export function loanStatusFilter(status: string): string[] {
  const s = status.trim().toUpperCase();
  if (s === ACTIVE_FILTER) return [...ACTIVE_LOAN_STATUSES];
  if ((LOAN_STATUSES as readonly string[]).includes(s)) return [s];
  throw new BadRequestException(`Unknown loan status "${status}"`);
}
