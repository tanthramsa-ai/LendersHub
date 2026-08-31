import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantLedgerPostingService, LedgerTransaction } from '../ledger/tenant-ledger-posting.service';
import { TenantFundersService } from '../funders/tenant-funders.service';
import { CASH_DIRECTION_SQL, OUTSTANDING_PRINCIPAL_EXPR, LIVE_LEDGER_SQL } from '../ledger/ledger-sql';
import { LEDGER_ROLES, UserRole } from '../common/roles';

export interface DailySnapshot {
  id: string;
  businessDate: string;
  openingOutstandingPrincipal: number;
  newDisbursementPrincipal: number;
  principalCollected: number;
  interestCollected: number;
  adjustments: number;
  closingOutstandingPrincipal: number;
  availableFund: number;
  generatedBy: string | null;
  generatedAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
}

/**
 * Reconciliation workspace + daily snapshot generation (requirements doc
 * §5.6/§6.5/§7.2). Scoped to what's derivable from data this app actually
 * has: unreconciled agent collections, reversed transactions, and partially
 * allocated payments. Unmatched-bank-transaction and duplicate-candidate
 * panels need an external bank/payment feed this app doesn't have yet (the
 * deferred direct-payment integration) — not built here.
 *
 * Locking a day is informational only: it timestamps that the day was
 * reviewed and marks the snapshot as closed for reporting/audit purposes.
 * It does NOT block TenantLedgerPostingService from accepting a new or
 * backdated transaction into a locked day — deliberately, so a legitimate
 * late collection is never silently rejected by a workflow this deep in the
 * stack. Reopening a day (unlockDay) is always available to Owner/Admin.
 */
@Injectable()
export class TenantReconciliationService {
  private ensuredSchemas = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private activity: TenantActivityLogService,
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
    if (!LEDGER_ROLES.includes(user.role as UserRole)) throw new ForbiddenException('Only Owner or Admin can access reconciliation');
  }

  async ensureTable(client: import('pg').PoolClient, schemaName: string): Promise<void> {
    if (this.ensuredSchemas.has(schemaName)) return;
    const q = `"${schemaName}"`;
    const s = schemaName.replace(/[^a-zA-Z0-9_]/g, '_');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${q}."daily_ledger_snapshot" (
        id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        business_date                 DATE          NOT NULL,
        opening_outstanding_principal NUMERIC(14,2) NOT NULL DEFAULT 0,
        new_disbursement_principal    NUMERIC(14,2) NOT NULL DEFAULT 0,
        principal_collected           NUMERIC(14,2) NOT NULL DEFAULT 0,
        interest_collected            NUMERIC(14,2) NOT NULL DEFAULT 0,
        adjustments                   NUMERIC(14,2) NOT NULL DEFAULT 0,
        closing_outstanding_principal NUMERIC(14,2) NOT NULL DEFAULT 0,
        available_fund                NUMERIC(14,2) NOT NULL DEFAULT 0,
        generated_by                  UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
        generated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        locked_at                     TIMESTAMPTZ,
        locked_by                     UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
        CONSTRAINT uq_${s}_dls_date UNIQUE (business_date)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_dls_date ON ${q}."daily_ledger_snapshot" (business_date DESC)`);
    this.ensuredSchemas.add(schemaName);
  }

  private mapTxnRow(r: Record<string, unknown>): LedgerTransaction {
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

  private mapSnapshotRow(r: Record<string, unknown>): DailySnapshot {
    return {
      id: r.id as string,
      businessDate: r.business_date as string,
      openingOutstandingPrincipal: parseFloat(r.opening_outstanding_principal as string),
      newDisbursementPrincipal: parseFloat(r.new_disbursement_principal as string),
      principalCollected: parseFloat(r.principal_collected as string),
      interestCollected: parseFloat(r.interest_collected as string),
      adjustments: parseFloat(r.adjustments as string),
      closingOutstandingPrincipal: parseFloat(r.closing_outstanding_principal as string),
      availableFund: parseFloat(r.available_fund as string),
      generatedBy: (r.generated_by as string) ?? null,
      generatedAt: r.generated_at as string,
      lockedAt: (r.locked_at as string) ?? null,
      lockedBy: (r.locked_by as string) ?? null,
    };
  }

  /** Every POSTED agent-channel collection — money the field agent has, not yet settled with the office. */
  async listUnreconciledCollections(user: TenantJwtPayload, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const dataRes = await client.query(
        `SELECT * FROM ledger_transactions
         WHERE transaction_type = 'COLLECTION' AND status = 'POSTED' AND reversal_of_id IS NULL AND payment_channel IN ('AGENT_CASH','AGENT_UPI')
         ORDER BY transaction_date ASC, created_at ASC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      );
      const aggRes = await client.query<{ total: string; sum: string }>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(total_amount), 0) AS sum FROM ledger_transactions
         WHERE transaction_type = 'COLLECTION' AND status = 'POSTED' AND reversal_of_id IS NULL AND payment_channel IN ('AGENT_CASH','AGENT_UPI')`,
      );
      return {
        data: dataRes.rows.map((r) => this.mapTxnRow(r)),
        total: parseInt(aggRes.rows[0].total),
        totalAmount: parseFloat(aggRes.rows[0].sum),
        page, limit,
      };
    });
  }

  /** Marks the given POSTED collection transactions as settled/RECONCILED. */
  async reconcile(user: TenantJwtPayload, transactionIds: string[], settlementReference?: string) {
    this.assertAccess(user);
    if (!transactionIds?.length) throw new BadRequestException('Select at least one transaction to reconcile');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const res = await client.query(
        `UPDATE ledger_transactions
           SET status = 'RECONCILED', settled_at = NOW(), settlement_reference = $1
         WHERE id = ANY($2::uuid[]) AND status = 'POSTED'
         RETURNING *`,
        [settlementReference ?? null, transactionIds],
      );
      if (res.rows.length === 0) {
        throw new BadRequestException('None of the selected transactions are eligible for reconciliation (already reconciled/reversed, or not found)');
      }
      await this.activity.record(client, user, {
        action: 'ledger.transactions_reconciled',
        entityType: 'ledger_transaction',
        entityLabel: `${res.rows.length} transaction${res.rows.length === 1 ? '' : 's'} reconciled`,
        metadata: { transactionIds: res.rows.map((r) => r.id), settlementReference },
      });
      return { reconciled: res.rows.length, transactions: res.rows.map((r) => this.mapTxnRow(r)) };
    });
  }

  /** Every transaction that is itself a reversal, or has since been reversed. */
  async listReversedTransactions(user: TenantJwtPayload, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const dataRes = await client.query(
        `SELECT * FROM ledger_transactions WHERE status = 'REVERSED' OR reversal_of_id IS NOT NULL
         ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM ledger_transactions WHERE status = 'REVERSED' OR reversal_of_id IS NOT NULL`,
      );
      return { data: dataRes.rows.map((r) => this.mapTxnRow(r)), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  /** Collections whose underlying payment was short of what was owed (payments.collection_status = PARTIALLY_COLLECTED). */
  async listPartiallyAllocated(user: TenantJwtPayload, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      const dataRes = await client.query(
        `SELECT lt.* FROM ledger_transactions lt
         JOIN payments p ON p.id = lt.payment_id
         WHERE p.collection_status = 'PARTIALLY_COLLECTED' AND lt.status IN ('POSTED','RECONCILED') AND lt.reversal_of_id IS NULL
         ORDER BY lt.transaction_date DESC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM ledger_transactions lt
         JOIN payments p ON p.id = lt.payment_id
         WHERE p.collection_status = 'PARTIALLY_COLLECTED' AND lt.status IN ('POSTED','RECONCILED') AND lt.reversal_of_id IS NULL`,
      );
      return { data: dataRes.rows.map((r) => this.mapTxnRow(r)), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  /** Computes and upserts the day's figures — re-runnable any time, even on a locked day (refreshes the numbers, doesn't touch the lock). */
  async generateSnapshot(user: TenantJwtPayload, date: string) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ledgerPosting.ensureTable(client, user.schemaName);
      await this.ensureTable(client, user.schemaName);

      const openingRes = await client.query<{ opening: string }>(
        `SELECT (${OUTSTANDING_PRINCIPAL_EXPR}) AS opening FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL} AND business_date < $1`,
        [date],
      );
      const dayRes = await client.query<{ new_disbursements: string; principal_collections: string; adjustments: string; interest_collected: string }>(
        `SELECT
           COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'DISBURSEMENT'), 0) AS new_disbursements,
           COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type = 'COLLECTION'), 0) AS principal_collections,
           COALESCE(SUM(principal_amount) FILTER (WHERE transaction_type IN ('ADJUSTMENT', 'REFUND')), 0) AS adjustments,
           COALESCE(SUM(interest_amount) FILTER (WHERE transaction_type = 'COLLECTION'), 0) AS interest_collected
         FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL} AND business_date = $1`,
        [date],
      );
      const totalFund = await this.funders.getTotalCapitalWithClient(client, user.schemaName, date);
      const cashMovementRes = await client.query<{ movement: string }>(
        `SELECT COALESCE(SUM(total_amount * (${CASH_DIRECTION_SQL})), 0) AS movement
         FROM ledger_transactions WHERE ${LIVE_LEDGER_SQL} AND business_date <= $1`,
        [date],
      );
      const availableFund = round2(totalFund + parseFloat(cashMovementRes.rows[0].movement));

      const opening = parseFloat(openingRes.rows[0].opening);
      const day = dayRes.rows[0];
      const newDisbursements = parseFloat(day.new_disbursements);
      const principalCollections = parseFloat(day.principal_collections);
      const adjustments = parseFloat(day.adjustments);
      const closing = round2(opening + newDisbursements - principalCollections + adjustments);

      const res = await client.query(
        `INSERT INTO daily_ledger_snapshot (
           business_date, opening_outstanding_principal, new_disbursement_principal, principal_collected,
           interest_collected, adjustments, closing_outstanding_principal, available_fund, generated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (business_date) DO UPDATE SET
           opening_outstanding_principal = EXCLUDED.opening_outstanding_principal,
           new_disbursement_principal = EXCLUDED.new_disbursement_principal,
           principal_collected = EXCLUDED.principal_collected,
           interest_collected = EXCLUDED.interest_collected,
           adjustments = EXCLUDED.adjustments,
           closing_outstanding_principal = EXCLUDED.closing_outstanding_principal,
           available_fund = EXCLUDED.available_fund,
           generated_by = EXCLUDED.generated_by,
           generated_at = NOW()
         RETURNING *`,
        [date, opening, newDisbursements, principalCollections, parseFloat(day.interest_collected), adjustments, closing, availableFund, user.sub],
      );
      const snapshot = this.mapSnapshotRow(res.rows[0]);
      await this.activity.record(client, user, {
        action: 'ledger.snapshot_generated', entityType: 'daily_ledger_snapshot', entityId: snapshot.id, entityLabel: date,
      });
      return snapshot;
    });
  }

  async getSnapshot(user: TenantJwtPayload, date: string): Promise<DailySnapshot | null> {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const res = await client.query(`SELECT * FROM daily_ledger_snapshot WHERE business_date = $1`, [date]);
      return res.rows[0] ? this.mapSnapshotRow(res.rows[0]) : null;
    });
  }

  async listSnapshots(user: TenantJwtPayload, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const dataRes = await client.query(
        `SELECT * FROM daily_ledger_snapshot ORDER BY business_date DESC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM daily_ledger_snapshot`);
      return { data: dataRes.rows.map((r) => this.mapSnapshotRow(r)), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  async lockDay(user: TenantJwtPayload, date: string) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const existing = await client.query(`SELECT * FROM daily_ledger_snapshot WHERE business_date = $1`, [date]);
      if (!existing.rows[0]) throw new BadRequestException("Generate this day's snapshot before locking it");
      if (existing.rows[0].locked_at) return this.mapSnapshotRow(existing.rows[0]); // already locked — idempotent

      const res = await client.query(
        `UPDATE daily_ledger_snapshot SET locked_at = NOW(), locked_by = $1 WHERE business_date = $2 RETURNING *`,
        [user.sub, date],
      );
      const snapshot = this.mapSnapshotRow(res.rows[0]);
      await this.activity.record(client, user, {
        action: 'ledger.day_locked', entityType: 'daily_ledger_snapshot', entityId: snapshot.id, entityLabel: date,
      });
      return snapshot;
    });
  }

  async unlockDay(user: TenantJwtPayload, date: string) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const res = await client.query(
        `UPDATE daily_ledger_snapshot SET locked_at = NULL, locked_by = NULL WHERE business_date = $1 RETURNING *`,
        [date],
      );
      if (!res.rows[0]) throw new BadRequestException('No snapshot found for this day');
      const snapshot = this.mapSnapshotRow(res.rows[0]);
      await this.activity.record(client, user, {
        action: 'ledger.day_unlocked', entityType: 'daily_ledger_snapshot', entityId: snapshot.id, entityLabel: date,
      });
      return snapshot;
    });
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
