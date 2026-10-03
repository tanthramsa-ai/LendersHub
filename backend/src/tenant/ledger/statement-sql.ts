import { liveLedgerSql, outstandingPrincipalExpr } from './ledger-sql';

/**
 * One normalised shape for every money movement the Financial Ledger shows, built from the two
 * sources that already exist, so nothing is stored twice and no existing table changes meaning:
 *
 *  - ledger_transactions (the posting engine): disbursements, collections, refunds, fees and
 *    adjustments, joined to loan / customer / agent / branch. A collection is split into one row
 *    per component (principal, interest, fees) because the report is read by component.
 *  - fund_transactions (manual cash and bank entries): deposits, withdrawals, transfers,
 *    expenses and corrections an Owner/Admin/Manager keyed in.
 *
 * Rows of soft-deleted loans and soft-deleted manual entries never appear.
 *
 * `dir` is the effect on cash+bank: +1 money in (credit), -1 money out (debit), 0 for rows that
 * move no money (a ledger adjustment re-states principal, it does not hand over cash).
 */

/** Kinds in the order the UI lists them. */
export const STATEMENT_KINDS = [
  'DISBURSEMENT', 'COLLECTION_PRINCIPAL', 'COLLECTION_INTEREST', 'COLLECTION_OTHER', 'REFUND', 'FEE_INCOME',
  'CASH_IN', 'CASH_OUT', 'BANK_IN', 'BANK_OUT', 'TRANSFER', 'ADJUSTMENT',
] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export const KIND_LABELS: Record<StatementKind, string> = {
  DISBURSEMENT: 'Disbursement',
  COLLECTION_PRINCIPAL: 'Collection – Principal',
  COLLECTION_INTEREST: 'Collection – Interest',
  COLLECTION_OTHER: 'Collection – Fees & other',
  REFUND: 'Refund',
  FEE_INCOME: 'Fee income',
  CASH_IN: 'Cash deposit',
  CASH_OUT: 'Cash withdrawal',
  BANK_IN: 'Bank deposit',
  BANK_OUT: 'Bank withdrawal',
  TRANSFER: 'Transfer',
  ADJUSTMENT: 'Adjustment',
};

export const LOAN_TYPE_LABELS: Record<string, string> = {
  WEEKLY: 'Weekly', DAILY_NO_SUNDAY: 'Daily (no Sunday)', DAILY_WITH_SUNDAY: 'Daily (with Sunday)',
  MONTHLY: 'Monthly', AGENT_RISK: 'Agent risk', TERM_LOAN: 'Term (legacy)',
};

/** Which kinds each breakdown view shows. */
export const KIND_GROUPS: Record<string, StatementKind[]> = {
  principal: ['DISBURSEMENT', 'COLLECTION_PRINCIPAL', 'REFUND'],
  interest: ['COLLECTION_INTEREST'],
  cashbank: ['CASH_IN', 'CASH_OUT', 'BANK_IN', 'BANK_OUT', 'TRANSFER', 'ADJUSTMENT'],
};

export const COLLECTION_KINDS: StatementKind[] = ['COLLECTION_PRINCIPAL', 'COLLECTION_INTEREST', 'COLLECTION_OTHER'];

const CASH_CHANNELS = `('CASH','AGENT_CASH')`;

const LEDGER_PART = `
  SELECT lt.id::text || ':' || part.k AS id,
         lt.business_date AS txn_date,
         lt.created_at AS created_at,
         part.k AS kind,
         part.amt AS amount,
         part.dir::int AS dir,
         CASE WHEN lt.payment_channel IN ${CASH_CHANNELS} THEN 'Cash'
              WHEN lt.payment_channel IN ('UPI','AGENT_UPI') THEN 'UPI'
              WHEN lt.payment_channel IN ('BANK_TRANSFER','NEFT','RTGS','CHEQUE','PAYMENT_GATEWAY') THEN 'Bank'
              ELSE 'Other' END AS mode,
         COALESCE(lt.payment_channel IN ${CASH_CHANNELS}, FALSE) AS is_cash,
         NULL::text AS account_name,
         lt.loan_id, l.loan_number, l.cycle_type AS loan_type,
         lt.customer_id, c.first_name || ' ' || c.last_name AS customer_name,
         COALESCE(lt.agent_id, l.loan_officer_id) AS agent_id,
         ag.first_name || ' ' || ag.last_name AS agent_name,
         l.branch_id, b.name AS branch_name,
         lt.external_reference AS reference_no,
         lt.remarks AS remarks,
         lt.created_by, cb.first_name || ' ' || cb.last_name AS created_by_name,
         'LEDGER'::text AS source,
         lt.id::text AS source_id,
         NULL::text AS group_id
    FROM ledger_transactions lt
    LEFT JOIN loans l ON l.id = lt.loan_id
    LEFT JOIN customers c ON c.id = lt.customer_id
    LEFT JOIN users ag ON ag.id = COALESCE(lt.agent_id, l.loan_officer_id)
    LEFT JOIN branches b ON b.id = l.branch_id
    LEFT JOIN users cb ON cb.id = lt.created_by
   CROSS JOIN LATERAL (VALUES
      ('DISBURSEMENT',         lt.principal_amount,                 -1, lt.transaction_type = 'DISBURSEMENT'),
      ('COLLECTION_PRINCIPAL', lt.principal_amount,                  1, lt.transaction_type = 'COLLECTION'),
      ('COLLECTION_INTEREST',  lt.interest_amount,                   1, lt.transaction_type = 'COLLECTION'),
      ('COLLECTION_OTHER',     lt.fee_amount + lt.other_amount,      1, lt.transaction_type = 'COLLECTION'),
      ('REFUND',               lt.total_amount,                     -1, lt.transaction_type = 'REFUND'),
      ('FEE_INCOME',           lt.total_amount,                      1, lt.transaction_type = 'FEE'),
      ('ADJUSTMENT',           lt.total_amount,                      0, lt.transaction_type IN ('ADJUSTMENT','OTHER'))
   ) AS part(k, amt, dir, applies)
   WHERE ${liveLedgerSql('lt')}
     AND part.applies AND part.amt <> 0
     AND (lt.loan_id IS NULL OR l.deleted_at IS NULL)`;

const MANUAL_PART = `
  SELECT 'ft:' || ft.id::text AS id,
         ft.transaction_date AS txn_date,
         ft.created_at AS created_at,
         CASE WHEN ft.category IN ('TRANSFER','ADJUSTMENT') THEN ft.category
              WHEN ft.type = 'CREDIT' AND COALESCE(ft.account_name, 'CASH') = 'CASH' THEN 'CASH_IN'
              WHEN ft.type = 'CREDIT' THEN 'BANK_IN'
              WHEN COALESCE(ft.account_name, 'CASH') = 'CASH' THEN 'CASH_OUT'
              ELSE 'BANK_OUT' END AS kind,
         ft.amount AS amount,
         CASE WHEN ft.type = 'CREDIT' THEN 1 ELSE -1 END AS dir,
         CASE WHEN COALESCE(ft.account_name, 'CASH') = 'CASH' THEN 'Cash' ELSE 'Bank' END AS mode,
         COALESCE(ft.account_name, 'CASH') = 'CASH' AS is_cash,
         CASE WHEN COALESCE(ft.account_name, 'CASH') = 'CASH' THEN NULL ELSE ft.account_name END AS account_name,
         NULL::uuid AS loan_id,
         CASE WHEN ft.entity_type = 'loan' THEN ft.entity_name END AS loan_number,
         NULL::text AS loan_type,
         NULL::uuid AS customer_id,
         CASE WHEN ft.entity_type = 'customer' THEN ft.entity_name END AS customer_name,
         NULL::uuid AS agent_id,
         CASE WHEN ft.entity_type = 'agent' THEN ft.entity_name END AS agent_name,
         NULL::uuid AS branch_id, NULL::text AS branch_name,
         ft.reference_number AS reference_no,
         COALESCE(ft.description, ft.category) AS remarks,
         ft.created_by, cb.first_name || ' ' || cb.last_name AS created_by_name,
         'MANUAL'::text AS source,
         ft.id::text AS source_id,
         CASE WHEN ft.entity_type = 'transfer' THEN ft.entity_id END AS group_id
    FROM fund_transactions ft
    LEFT JOIN users cb ON cb.id = ft.created_by
   WHERE ft.deleted_at IS NULL`;

/** `stmt_rows` CTE: every movement, normalised. (Not `rows`: that is a SQL keyword.) */
export const ROWS_CTE = `stmt_rows AS (${LEDGER_PART}\n UNION ALL ${MANUAL_PART}\n)`;

/** Outstanding principal over the live ledger, ignoring soft-deleted loans. */
export const OUTSTANDING_PRINCIPAL_LIVE_SQL = `
  SELECT ${outstandingPrincipalExpr('lt')} AS outstanding
    FROM ledger_transactions lt
    LEFT JOIN loans l ON l.id = lt.loan_id
   WHERE ${liveLedgerSql('lt')} AND (lt.loan_id IS NULL OR l.deleted_at IS NULL)`;

/**
 * Interest still to come on loans that are running: the interest share of every unpaid or
 * part-paid installment (same proportional method the NPA figure uses), soft-deleted and
 * not-yet-approved loans excluded.
 */
export const OUTSTANDING_INTEREST_SQL = `
  SELECT COALESCE(SUM(
           i.interest_amount * (GREATEST(i.total_amount - i.paid_amount, 0) / NULLIF(i.total_amount, 0))
         ), 0) AS outstanding
    FROM installments i
    JOIN loans l ON l.id = i.loan_id
   WHERE l.deleted_at IS NULL
     AND l.status IN ('APPROVED','DISBURSED','DEFAULTED')
     AND i.status NOT IN ('PAID','WAIVED')`;
