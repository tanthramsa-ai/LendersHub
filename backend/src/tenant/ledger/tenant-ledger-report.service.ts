import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantLedgerPostingService, LedgerTransaction, LedgerTransactionType } from './tenant-ledger-posting.service';
import { TenantFundersService } from '../funders/tenant-funders.service';
import { CASH_DIRECTION_SQL, OUTSTANDING_PRINCIPAL_EXPR, LIVE_LEDGER_SQL } from './ledger-sql';
import { LEDGER_ROLES, UserRole } from '../common/roles';

export interface LedgerTransactionFilters {
  transactionType?: LedgerTransactionType;
  loanId?: string;
  customerId?: string;
  status?: string;
  from?: string; // business_date >=
  to?: string;   // business_date <=
}

/**
 * A ledger transaction with the human-readable fields the Collection Ledger
 * and Daily Ledger View UIs need (requirements doc §5.4: borrower, agent,
 * receipt number, created-by) — joined in, not stored on ledger_transactions
 * itself, which only holds ids.
 */
export interface LedgerTransactionDetailed extends LedgerTransaction {
  loanNumber: string | null;
  customerName: string | null;
  agentName: string | null;
  receiptNumber: string | null;
  createdByName: string | null;
}

/**
 * Read-only reporting layer over ledger_transactions (the Phase 1/2 posting
 * engine's table) — dashboard summary, daily ledger view, filterable
 * transaction listing, and per-loan/per-customer ledgers. Entirely additive:
 * does not touch TenantLedgerService or the existing credits/debits/
 * principal/transactions UI, which still read fund_transactions + live joins.
 *
 * Total Fund and Available Fund (requirements doc §5.1) are sourced from
 * TenantFundersService's funder capital ledger (Phase 4) rather than
 * ledger_transactions itself — ledger_transactions never records funder
 * contributions/withdrawals, only what those funds get spent or collected on.
 */
@Injectable()
export class TenantLedgerReportService {
  constructor(
    private prisma: PrismaService,
    private ledgerPosting: TenantLedgerPostingService,
    private funders: TenantFundersService,
  ) {}

  private async withSchema<T>(schemaName: string, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private assertAccess(user: TenantJwtPayload) {
    if (!LEDGER_ROLES.includes(user.role as UserRole)) throw new ForbiddenException('Only Owner or Admin can view the ledger');
  }

  private mapRow(r: Record<string, unknown>): LedgerTransaction {
    return {
      id: r.id as string,
      transactionDate: r.transaction_date as string,
      businessDate: r.business_date as string,
      transactionType: r.transaction_type as LedgerTransaction['transactionType'],
      loanId: (r.loan_id as string) ?? null,
      customerId: (r.customer_id as string) ?? null,
      agentId: (r.agent_id as string) ?? null,
      paymentId: (r.payment_id as string) ?? null,
      principalAmount: parseFloat(r.principal_amount as string),
      interestAmount: parseFloat(r.interest_amount as string),
      feeAmount: parseFloat(r.fee_amount as string),
      otherAmount: parseFloat(r.other_amount as string),
      totalAmount: parseFloat(r.total_amount as string),
      paymentChannel: (r.payment_channel as LedgerTransaction['paymentChannel']) ?? null,
      externalReference: (r.external_reference as string) ?? null,
      status: r.status as LedgerTransaction['status'],
      idempotencyKey: (r.idempotency_key as string) ?? null,
      reversalOfId: (r.reversal_of_id as string) ?? null,
      settledAt: (r.settled_at as string) ?? null,
      settlementReference: (r.settlement_reference as string) ?? null,
      remarks: (r.remarks as string) ?? null,
      createdBy: (r.created_by as string) ?? null,
      createdAt: r.created_at as string,
    };
  }

  private mapDetailedRow(r: Record<string, unknown>): LedgerTransactionDetailed {
    return {
      ...this.mapRow(r),
      loanNumber: (r.loan_number as string) ?? null,
      customerName: (r.customer_name as string) ?? null,
      agentName: (r.agent_name as string) ?? null,
      receiptNumber: (r.receipt_number as string) ?? null,
      createdByName: (r.created_by_name as string) ?? null,
    };
  }

  /** LEFT JOINs that resolve ledger_transactions' ids to display names — shared by listTransactions() and getDaily(). */
  private readonly detailedJoinSql = `
    LEFT JOIN loans l ON l.id = lt.loan_id
    LEFT JOIN customers c ON c.id = lt.customer_id
    LEFT JOIN users u ON u.id = lt.agent_id
    LEFT JOIN payments p ON p.id = lt.payment_id
    LEFT JOIN users cb ON cb.id = lt.created_by
  `;
  private readonly detailedSelectSql = `
    lt.*, l.loan_number, c.first_name || ' ' || c.last_name AS customer_name,
    u.first_name || ' ' || u.last_name AS agent_name, p.receipt_number,
    cb.first_name || ' ' || cb.last_name AS created_by_name
  `;

  /**
   * Dashboard summary — requirements doc §5.1, minus Total Fund / Available
   * Fund (see class doc comment). `month` (YYYY-MM) scopes the period figures
   * (principal/interest/total collected); defaults to the current month.
   */
  async getDashboard(user: TenantJwtPayload, month?: string) {
    this.assertAccess(user);
    const periodStart = month ? `${month}-01` : new Date().toISOString().slice(0, 8) + '01';

    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);

      const ledgerRes = await client.query<{
        total_disbursed: string; outstanding_principal: string;
        principal_collected_period: string; interest_collected_period: string; fee_collected_period: string;
        todays_collection: string; this_months_collection: string; agent_pending_reconciliation: string;
      }>(
        `SELECT
           COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'DISBURSEMENT'), 0) AS total_disbursed,
           (${OUTSTANDING_PRINCIPAL_EXPR}) AS outstanding_principal,
           COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'COLLECTION' AND date_trunc('month', business_date) = date_trunc('month', $1::date)), 0) AS principal_collected_period,
           COALESCE(SUM(interest_amount) FILTER (WHERE transaction_type = 'COLLECTION' AND date_trunc('month', business_date) = date_trunc('month', $1::date)), 0) AS interest_collected_period,
           COALESCE(SUM(fee_amount) FILTER (WHERE transaction_type = 'COLLECTION' AND date_trunc('month', business_date) = date_trunc('month', $1::date)), 0) AS fee_collected_period,
           COALESCE(SUM(total_amount) FILTER (WHERE transaction_type = 'COLLECTION' AND business_date = CURRENT_DATE), 0) AS todays_collection,
           COALESCE(SUM(total_amount) FILTER (WHERE transaction_type = 'COLLECTION' AND date_trunc('month', business_date) = date_trunc('month', CURRENT_DATE)), 0) AS this_months_collection,
           -- Everything still POSTED (not RECONCILED) collected via an agent channel. Every
           -- agent collection shows here until the reconciliation workflow (Phase 5) starts
           -- marking rows RECONCILED — that's expected, not a bug, until that phase ships.
           COALESCE(SUM(total_amount) FILTER (WHERE transaction_type = 'COLLECTION' AND payment_channel IN ('AGENT_CASH','AGENT_UPI') AND status = 'POSTED'), 0) AS agent_pending_reconciliation  -- POSTED-only is deliberate here: RECONCILED means already settled
         FROM ledger_transactions
         WHERE ${LIVE_LEDGER_SQL}`,
        [periodStart],
      );

      // NPA/overdue principal comes from loans+installments (existing NPA tracking),
      // not the ledger — the ledger has no per-loan outstanding view without grouping,
      // and installments already carry this reliably. Proportional principal share of
      // each unpaid/partial installment, same method as splitPrincipalInterest().
      const npaRes = await client.query<{ npa_principal: string }>(
        `SELECT COALESCE(SUM(
           i.principal_amount * (GREATEST(i.total_amount - i.paid_amount, 0) / NULLIF(i.total_amount, 0))
         ), 0) AS npa_principal
         FROM installments i
         JOIN loans l ON l.id = i.loan_id
         WHERE l.deleted_at IS NULL AND i.status != 'PAID'
           AND (l.status = 'DEFAULTED' OR l.npa_marked_at IS NOT NULL)`,
      );

      // Available Fund = capital raised - net cash spent since (lifetime cash
      // movement uses the same signed-direction convention as getDaily's
      // cashBankMovement, just without a date filter).
      const totalFund = await this.funders.getTotalCapitalWithClient(client, user.schemaName);
      const cashMovementRes = await client.query<{ movement: string }>(
        `SELECT COALESCE(SUM(total_amount * (${CASH_DIRECTION_SQL})), 0) AS movement
         FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL}`,
      );
      const availableFund = round2(totalFund + parseFloat(cashMovementRes.rows[0].movement));

      const row = ledgerRes.rows[0];
      return {
        month: periodStart.slice(0, 7),
        fundTrackingAvailable: true as const,
        totalFund,
        availableFund,
        totalDisbursed: parseFloat(row.total_disbursed),
        outstandingPrincipal: parseFloat(row.outstanding_principal),
        principalCollected: parseFloat(row.principal_collected_period),
        interestCollected: parseFloat(row.interest_collected_period),
        totalCollections: round2(
          parseFloat(row.principal_collected_period) + parseFloat(row.interest_collected_period) + parseFloat(row.fee_collected_period),
        ),
        todaysCollection: parseFloat(row.todays_collection),
        thisMonthsCollection: parseFloat(row.this_months_collection),
        overdueNpaPrincipal: parseFloat(npaRes.rows[0].npa_principal),
        agentCollectionPendingReconciliation: parseFloat(row.agent_pending_reconciliation),
      };
    });
  }

  /** Daily ledger view — requirements doc §5.5: opening/movements/closing, drillable. */
  async getDaily(user: TenantJwtPayload, date: string, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);

      const openingRes = await client.query<{ opening: string }>(
        `SELECT (${OUTSTANDING_PRINCIPAL_EXPR}) AS opening FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL} AND business_date < $1`,
        [date],
      );
      const dayRes = await client.query<{
        new_disbursements: string; principal_collections: string; adjustments: string;
        interest_collected: string; cash_bank_movement: string;
      }>(
        `SELECT
           COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'DISBURSEMENT'), 0) AS new_disbursements,
           COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'COLLECTION'), 0) AS principal_collections,
           COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type IN ('ADJUSTMENT', 'REFUND')), 0) AS adjustments,
           COALESCE(SUM(interest_amount) FILTER (WHERE transaction_type = 'COLLECTION'), 0) AS interest_collected,
           COALESCE(SUM(total_amount * (${CASH_DIRECTION_SQL})), 0) AS cash_bank_movement
         FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL} AND business_date = $1`,
        [date],
      );
      const txnRes = await client.query(
        `SELECT ${this.detailedSelectSql} FROM ledger_transactions lt ${this.detailedJoinSql}
         WHERE lt.business_date = $1 ORDER BY lt.transaction_date DESC, lt.created_at DESC LIMIT $2 OFFSET $3`,
        [date, limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM ledger_transactions WHERE business_date = $1`,
        [date],
      );

      const opening = parseFloat(openingRes.rows[0].opening);
      const day = dayRes.rows[0];
      const newDisbursements = parseFloat(day.new_disbursements);
      const principalCollections = parseFloat(day.principal_collections);
      const adjustments = parseFloat(day.adjustments);

      return {
        date,
        openingOutstandingPrincipal: opening,
        newDisbursements,
        principalCollections,
        adjustments,
        closingOutstandingPrincipal: round2(opening + newDisbursements - principalCollections + adjustments),
        interestCollected: parseFloat(day.interest_collected),
        cashBankMovement: parseFloat(day.cash_bank_movement),
        transactions: txnRes.rows.map((r) => this.mapDetailedRow(r)),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  /** Filterable transaction listing over the raw ledger. */
  async listTransactions(user: TenantJwtPayload, filters: LedgerTransactionFilters, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (filters.transactionType) { conditions.push(`lt.transaction_type = $${idx++}`); params.push(filters.transactionType); }
      if (filters.loanId) { conditions.push(`lt.loan_id = $${idx++}`); params.push(filters.loanId); }
      if (filters.customerId) { conditions.push(`lt.customer_id = $${idx++}`); params.push(filters.customerId); }
      if (filters.status) { conditions.push(`lt.status = $${idx++}`); params.push(filters.status); }
      if (filters.from) { conditions.push(`lt.business_date >= $${idx++}`); params.push(filters.from); }
      if (filters.to) { conditions.push(`lt.business_date <= $${idx++}`); params.push(filters.to); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const dataRes = await client.query(
        `SELECT ${this.detailedSelectSql} FROM ledger_transactions lt ${this.detailedJoinSql}
         ${where} ORDER BY lt.transaction_date DESC, lt.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM ledger_transactions lt ${where}`,
        params,
      );

      return { data: dataRes.rows.map((r) => this.mapDetailedRow(r)), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  /** Per-loan ledger: every transaction against this loan, plus its own outstanding principal. */
  async getLoanLedger(user: TenantJwtPayload, loanId: string, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);

      const outstandingRes = await client.query<{ outstanding: string }>(
        `SELECT (${OUTSTANDING_PRINCIPAL_EXPR}) AS outstanding FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL} AND loan_id = $1`,
        [loanId],
      );
      const dataRes = await client.query(
        `SELECT * FROM ledger_transactions WHERE loan_id = $1 ORDER BY transaction_date DESC, created_at DESC LIMIT $2 OFFSET $3`,
        [loanId, limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM ledger_transactions WHERE loan_id = $1`,
        [loanId],
      );

      return {
        loanId,
        outstandingPrincipal: parseFloat(outstandingRes.rows[0].outstanding),
        data: dataRes.rows.map((r) => this.mapRow(r)),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  /** Per-customer ledger: every transaction across all of this customer's loans. */
  async getCustomerLedger(user: TenantJwtPayload, customerId: string, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);

      const outstandingRes = await client.query<{ outstanding: string }>(
        `SELECT (${OUTSTANDING_PRINCIPAL_EXPR}) AS outstanding FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL} AND customer_id = $1`,
        [customerId],
      );
      const dataRes = await client.query(
        `SELECT * FROM ledger_transactions WHERE customer_id = $1 ORDER BY transaction_date DESC, created_at DESC LIMIT $2 OFFSET $3`,
        [customerId, limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM ledger_transactions WHERE customer_id = $1`,
        [customerId],
      );

      return {
        customerId,
        outstandingPrincipal: parseFloat(outstandingRes.rows[0].outstanding),
        data: dataRes.rows.map((r) => this.mapRow(r)),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
