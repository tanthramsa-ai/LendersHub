import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { LEDGER_ROLES, UserRole } from '../common/roles';
import { ensureReceiptNumberColumn } from '../common/receipt-number';

export type LedgerTransactionType = 'DISBURSEMENT' | 'COLLECTION' | 'REFUND' | 'ADJUSTMENT' | 'FEE' | 'OTHER';
export type LedgerPaymentChannel = 'AGENT_CASH' | 'AGENT_UPI' | 'BANK_TRANSFER' | 'UPI' | 'PAYMENT_GATEWAY' | 'CASH' | 'CHEQUE' | 'NEFT' | 'RTGS' | 'OTHER';
export type LedgerTransactionStatus = 'PENDING' | 'POSTED' | 'REVERSED' | 'RECONCILED';

export interface PostLedgerTransactionInput {
  transactionDate?: string;   // YYYY-MM-DD, defaults to today
  businessDate?: string;      // YYYY-MM-DD, defaults to transactionDate
  transactionType: LedgerTransactionType;
  loanId?: string;
  customerId?: string;
  agentId?: string;
  paymentId?: string;
  principalAmount?: number;
  interestAmount?: number;
  feeAmount?: number;
  otherAmount?: number;
  paymentChannel?: LedgerPaymentChannel;
  externalReference?: string;
  idempotencyKey?: string;
  remarks?: string;
}

export interface LedgerTransaction {
  id: string;
  transactionDate: string;
  businessDate: string;
  transactionType: LedgerTransactionType;
  loanId: string | null;
  customerId: string | null;
  agentId: string | null;
  paymentId: string | null;
  principalAmount: number;
  interestAmount: number;
  feeAmount: number;
  otherAmount: number;
  totalAmount: number;
  paymentChannel: LedgerPaymentChannel | null;
  externalReference: string | null;
  status: LedgerTransactionStatus;
  idempotencyKey: string | null;
  reversalOfId: string | null;
  settledAt: string | null;
  settlementReference: string | null;
  remarks: string | null;
  createdBy: string | null;
  createdAt: string;
}

/**
 * Splits a payment amount applied to one installment into principal/interest
 * components, proportional to that installment's own fixed principal:interest
 * ratio. Exact for a full settlement (applied === installment total) since it
 * then just returns the installment's own split; for a partial settlement this
 * is a simplifying assumption — the schema doesn't track how much of an
 * installment's *prior* partial payments already went to principal vs
 * interest, so each new partial payment is allocated against the
 * installment's original ratio rather than its true remaining split.
 * Rounding remainder is folded into interest so principal+interest always
 * equals `applied` exactly (required by ledger_transactions' total_amount
 * CHECK constraint).
 */
export function splitPrincipalInterest(
  applied: number,
  installmentPrincipal: number,
  installmentInterest: number,
): { principal: number; interest: number } {
  const scheduledTotal = installmentPrincipal + installmentInterest;
  if (scheduledTotal <= 0) return { principal: 0, interest: round2(applied) };
  const principal = round2(applied * (installmentPrincipal / scheduledTotal));
  const interest = round2(applied - principal);
  return { principal, interest };
}

/**
 * Posting engine for the immutable financial transaction ledger
 * (tenant_*.ledger_transactions). This is the only code path allowed to
 * write to that table: posted rows are never UPDATE'd except for the
 * status flip a reversal performs on the row it reverses. Corrections are
 * new rows, not edits — see reverseTransaction()/reverseWithClient().
 *
 * Two call shapes:
 *  - postTransaction()/reverseTransaction() open their own connection and
 *    gate on LEDGER_ROLES (Owner/Admin) — for standalone/manual posting.
 *  - postWithClient()/reverseWithClient() run on a caller-supplied client,
 *    so they participate in the caller's own transaction (BEGIN/COMMIT),
 *    and perform NO role check — the caller (e.g. TenantCollectionsService)
 *    has already authorized the underlying business action (an agent
 *    collecting an installment) under its own, broader role set. Re-gating
 *    to Owner/Admin here would wrongly block a legitimate agent collection.
 *
 * Deliberately separate from TenantLedgerService, which still serves the
 * existing credits/debits/principal/transactions UI off fund_transactions
 * and live joins — untouched by this.
 */
@Injectable()
export class TenantLedgerPostingService {
  // Per-process cache of schemas already known to have ledger_transactions,
  // mirroring TenantActivityLogService — avoids a CREATE TABLE IF NOT EXISTS
  // round trip on every post once the table is confirmed present. Provisioned
  // tenants get the table from tenantSchemaDDL(); this is the safety net for
  // tenants that haven't had the repair script re-run against them yet.
  private ensuredSchemas = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private activity: TenantActivityLogService,
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

  private assertLedgerAccess(user: TenantJwtPayload) {
    if (!LEDGER_ROLES.includes(user.role as UserRole)) throw new ForbiddenException('Only Owner or Admin can post ledger transactions');
  }

  async ensureTable(client: import('pg').PoolClient, schemaName: string): Promise<void> {
    if (this.ensuredSchemas.has(schemaName)) return;
    const q = `"${schemaName}"`;
    const s = schemaName.replace(/[^a-zA-Z0-9_]/g, '_');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${q}."ledger_transactions" (
        id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
        business_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
        transaction_type  TEXT          NOT NULL CHECK (transaction_type IN ('DISBURSEMENT','COLLECTION','REFUND','ADJUSTMENT','FEE','OTHER')),
        loan_id           UUID          REFERENCES ${q}."loans" (id) ON DELETE SET NULL,
        customer_id       UUID          REFERENCES ${q}."customers" (id) ON DELETE SET NULL,
        agent_id          UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
        payment_id        UUID          REFERENCES ${q}."payments" (id) ON DELETE SET NULL,
        principal_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
        interest_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
        fee_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
        other_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_amount      NUMERIC(14,2) NOT NULL,
        payment_channel   TEXT          CHECK (payment_channel IN ('AGENT_CASH','AGENT_UPI','BANK_TRANSFER','UPI','PAYMENT_GATEWAY','CASH','CHEQUE','NEFT','RTGS','OTHER')),
        external_reference TEXT,
        status            TEXT          NOT NULL DEFAULT 'POSTED' CHECK (status IN ('PENDING','POSTED','REVERSED','RECONCILED')),
        idempotency_key   TEXT,
        reversal_of_id    UUID          REFERENCES ${q}."ledger_transactions" (id) ON DELETE SET NULL,
        settled_at          TIMESTAMPTZ,
        settlement_reference TEXT,
        remarks           TEXT,
        created_by        UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT ck_${s}_lt_total_matches_components
          CHECK (total_amount = principal_amount + interest_amount + fee_amount + other_amount)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lt_txn_date ON ${q}."ledger_transactions" (transaction_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lt_biz_date ON ${q}."ledger_transactions" (business_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lt_type ON ${q}."ledger_transactions" (transaction_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lt_loan ON ${q}."ledger_transactions" (loan_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lt_customer ON ${q}."ledger_transactions" (customer_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lt_payment ON ${q}."ledger_transactions" (payment_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lt_status ON ${q}."ledger_transactions" (status)`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_${s}_lt_idempotency ON ${q}."ledger_transactions" (idempotency_key) WHERE idempotency_key IS NOT NULL`);
    // The ledger reporting views join payments for the receipt number, so the
    // same provisioning gap that breaks recording a payment also 500s the
    // Collection Ledger and Daily Ledger. Every ledger read already calls
    // through here, which makes this the one place that covers them all.
    await ensureReceiptNumberColumn(client, schemaName);
    this.ensuredSchemas.add(schemaName);
  }

  private mapRow(r: Record<string, unknown>): LedgerTransaction {
    return {
      id: r.id as string,
      transactionDate: r.transaction_date as string,
      businessDate: r.business_date as string,
      transactionType: r.transaction_type as LedgerTransactionType,
      loanId: (r.loan_id as string) ?? null,
      customerId: (r.customer_id as string) ?? null,
      agentId: (r.agent_id as string) ?? null,
      paymentId: (r.payment_id as string) ?? null,
      principalAmount: parseFloat(r.principal_amount as string),
      interestAmount: parseFloat(r.interest_amount as string),
      feeAmount: parseFloat(r.fee_amount as string),
      otherAmount: parseFloat(r.other_amount as string),
      totalAmount: parseFloat(r.total_amount as string),
      paymentChannel: (r.payment_channel as LedgerPaymentChannel) ?? null,
      externalReference: (r.external_reference as string) ?? null,
      status: r.status as LedgerTransactionStatus,
      idempotencyKey: (r.idempotency_key as string) ?? null,
      reversalOfId: (r.reversal_of_id as string) ?? null,
      settledAt: (r.settled_at as string) ?? null,
      settlementReference: (r.settlement_reference as string) ?? null,
      remarks: (r.remarks as string) ?? null,
      createdBy: (r.created_by as string) ?? null,
      createdAt: r.created_at as string,
    };
  }

  /**
   * Core insert, shared by postTransaction() and postWithClient(). Assumes
   * ensureTable() has already run on this client. Idempotent when
   * idempotencyKey is supplied: a replayed call with the same key returns
   * the original row instead of creating a duplicate (checked via a lookup,
   * then a unique-index race guard on insert — see the 23505 catch below).
   */
  private async insertTransaction(
    client: import('pg').PoolClient,
    user: TenantJwtPayload,
    input: PostLedgerTransactionInput,
  ): Promise<LedgerTransaction> {
    const principal = input.principalAmount ?? 0;
    const interest = input.interestAmount ?? 0;
    const fee = input.feeAmount ?? 0;
    const other = input.otherAmount ?? 0;
    const total = round2(principal + interest + fee + other);
    if (total === 0) throw new BadRequestException('Transaction must have a non-zero amount');
    // Controls and audit (requirements doc §10): a manual adjustment must carry
    // its own justification — unlike a COLLECTION/DISBURSEMENT, which is
    // self-explanatory from the operational event that triggered it.
    if (input.transactionType === 'ADJUSTMENT' && !input.remarks?.trim()) {
      throw new BadRequestException('An adjustment requires remarks explaining why it was posted');
    }

    const transactionDate = input.transactionDate ?? new Date().toISOString().slice(0, 10);
    const businessDate = input.businessDate ?? transactionDate;

    if (input.idempotencyKey) {
      const existing = await client.query(
        `SELECT * FROM ledger_transactions WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (existing.rows.length > 0) return this.mapRow(existing.rows[0]);
    }

    try {
      const res = await client.query(
        `INSERT INTO ledger_transactions (
           transaction_date, business_date, transaction_type, loan_id, customer_id, agent_id, payment_id,
           principal_amount, interest_amount, fee_amount, other_amount, total_amount,
           payment_channel, external_reference, idempotency_key, remarks, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          transactionDate, businessDate, input.transactionType,
          input.loanId ?? null, input.customerId ?? null, input.agentId ?? null, input.paymentId ?? null,
          round2(principal), round2(interest), round2(fee), round2(other), total,
          input.paymentChannel ?? null, input.externalReference ?? null,
          input.idempotencyKey ?? null, input.remarks ?? null, user.sub,
        ],
      );
      const txn = this.mapRow(res.rows[0]);
      await this.activity.record(client, user, {
        action: 'ledger.transaction_posted',
        entityType: 'ledger_transaction',
        entityId: txn.id,
        entityLabel: `${txn.transactionType} — ₹${txn.totalAmount}`,
        metadata: {
          principalAmount: txn.principalAmount, interestAmount: txn.interestAmount,
          feeAmount: txn.feeAmount, otherAmount: txn.otherAmount, loanId: txn.loanId, paymentId: txn.paymentId,
        },
      });
      return txn;
    } catch (err) {
      // Unique-violation race: two concurrent calls with the same idempotency
      // key both passed the lookup above before either inserted. Whoever
      // loses the race returns the winner's row instead of erroring.
      if (input.idempotencyKey && (err as { code?: string }).code === '23505') {
        const existing = await client.query(
          `SELECT * FROM ledger_transactions WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        );
        if (existing.rows.length > 0) return this.mapRow(existing.rows[0]);
      }
      throw err;
    }
  }

  /** Standalone post: opens its own connection, gated to Owner/Admin. */
  async postTransaction(user: TenantJwtPayload, input: PostLedgerTransactionInput): Promise<LedgerTransaction> {
    this.assertLedgerAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      return this.insertTransaction(client, user, input);
    });
  }

  /**
   * Post on a caller-supplied client, inside the caller's own transaction.
   * No role check — the caller has already authorized the business action
   * that produced this transaction (e.g. TenantCollectionsService checks
   * AGENT/STAFF/MANAGER access for a collection before calling this).
   */
  async postWithClient(
    client: import('pg').PoolClient,
    user: TenantJwtPayload,
    input: PostLedgerTransactionInput,
  ): Promise<LedgerTransaction> {
    await this.ensureTable(client, user.schemaName);
    return this.insertTransaction(client, user, input);
  }

  private async insertReversal(
    client: import('pg').PoolClient,
    user: TenantJwtPayload,
    transactionId: string,
    reason: string,
  ): Promise<LedgerTransaction> {
    if (!reason?.trim()) throw new BadRequestException('A reason is required to reverse a transaction');

    const originalRes = await client.query(`SELECT * FROM ledger_transactions WHERE id = $1`, [transactionId]);
    if (originalRes.rows.length === 0) throw new NotFoundException('Ledger transaction not found');
    const original = this.mapRow(originalRes.rows[0]);
    if (original.status === 'REVERSED') throw new BadRequestException('Transaction is already reversed');

    const reversalRes = await client.query(
      `INSERT INTO ledger_transactions (
         transaction_date, business_date, transaction_type, loan_id, customer_id, agent_id, payment_id,
         principal_amount, interest_amount, fee_amount, other_amount, total_amount,
         payment_channel, external_reference, reversal_of_id, remarks, created_by
       ) VALUES (CURRENT_DATE, CURRENT_DATE, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        original.transactionType, original.loanId, original.customerId, original.agentId, original.paymentId,
        -original.principalAmount, -original.interestAmount, -original.feeAmount, -original.otherAmount,
        -original.totalAmount, original.paymentChannel, original.externalReference,
        original.id, reason, user.sub,
      ],
    );
    await client.query(`UPDATE ledger_transactions SET status = 'REVERSED' WHERE id = $1`, [original.id]);

    const reversal = this.mapRow(reversalRes.rows[0]);
    await this.activity.record(client, user, {
      action: 'ledger.transaction_reversed',
      entityType: 'ledger_transaction',
      entityId: reversal.id,
      entityLabel: `Reversal of ${original.transactionType} — ₹${original.totalAmount}`,
      metadata: { reversalOfId: original.id, reason },
    });
    return reversal;
  }

  /**
   * Reverses a posted transaction: inserts a new transaction with negated
   * components (linked via reversal_of_id) and flips the original's status
   * to REVERSED. The original's amounts are never touched — this is the
   * only sanctioned way to correct a posted transaction.
   */
  async reverseTransaction(user: TenantJwtPayload, transactionId: string, reason: string): Promise<LedgerTransaction> {
    this.assertLedgerAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      return this.insertReversal(client, user, transactionId, reason);
    });
  }

  /** Reverse on a caller-supplied client — see postWithClient() for why no role check runs here. */
  async reverseWithClient(
    client: import('pg').PoolClient,
    user: TenantJwtPayload,
    transactionId: string,
    reason: string,
  ): Promise<LedgerTransaction> {
    await this.ensureTable(client, user.schemaName);
    return this.insertReversal(client, user, transactionId, reason);
  }

  /** Finds the (at most one) still-POSTED ledger transaction created for a given payment, if any. */
  async findByPaymentIdWithClient(
    client: import('pg').PoolClient,
    schemaName: string,
    paymentId: string,
  ): Promise<LedgerTransaction | null> {
    await this.ensureTable(client, schemaName);
    const res = await client.query(
      `SELECT * FROM ledger_transactions WHERE payment_id = $1 AND status = 'POSTED' AND reversal_of_id IS NULL LIMIT 1`,
      [paymentId],
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async getTransaction(user: TenantJwtPayload, transactionId: string): Promise<LedgerTransaction> {
    this.assertLedgerAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const res = await client.query(`SELECT * FROM ledger_transactions WHERE id = $1`, [transactionId]);
      if (res.rows.length === 0) throw new NotFoundException('Ledger transaction not found');
      return this.mapRow(res.rows[0]);
    });
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
