import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { LEDGER_ROLES, UserRole } from '../common/roles';
import { LIVE_FUNDER_TXN_SQL } from '../ledger/ledger-sql';

export type FunderTransactionType = 'CONTRIBUTION' | 'WITHDRAWAL' | 'ADJUSTMENT';
export type FunderTransactionStatus = 'PENDING' | 'POSTED' | 'REVERSED';

export interface CreateFunderDto {
  name: string;
  email?: string;
  phone?: string;
}

export interface UpdateFunderDto {
  name?: string;
  email?: string;
  phone?: string;
  isActive?: boolean;
}

export interface PostFunderTransactionDto {
  transactionDate?: string;
  transactionType: FunderTransactionType;
  amount: number;
  referenceNumber?: string;
  notes?: string;
}

export interface LoanAllocationInput {
  funderId: string;
  amount: number;
}

/**
 * Funder capital ledger + explicit loan funding allocation (requirements doc
 * §6.1/§6.2/§9, explicit allocation model). Funder capital movements
 * (funder_transactions) follow the same immutability rule as
 * ledger_transactions: corrections are reversal rows, never edits.
 * loan_funder_allocations is different — it's a static declaration of "who
 * funded this loan and how much," not a movement, so setLoanAllocations()
 * replaces the full set atomically rather than requiring reversals.
 */
@Injectable()
export class TenantFundersService {
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

  private assertAccess(user: TenantJwtPayload) {
    if (!LEDGER_ROLES.includes(user.role as UserRole)) throw new ForbiddenException('Only Owner or Admin can manage funders');
  }

  async ensureTables(client: import('pg').PoolClient, schemaName: string): Promise<void> {
    if (this.ensuredSchemas.has(schemaName)) return;
    const q = `"${schemaName}"`;
    const s = schemaName.replace(/[^a-zA-Z0-9_]/g, '_');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${q}."funders" (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT        NOT NULL,
        email       TEXT,
        phone       TEXT,
        is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_funders_active ON ${q}."funders" (is_active)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${q}."funder_transactions" (
        id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        funder_id         UUID          NOT NULL REFERENCES ${q}."funders" (id) ON DELETE RESTRICT,
        transaction_date  DATE          NOT NULL DEFAULT CURRENT_DATE,
        transaction_type  TEXT          NOT NULL CHECK (transaction_type IN ('CONTRIBUTION','WITHDRAWAL','ADJUSTMENT')),
        amount            NUMERIC(14,2) NOT NULL,
        reference_number  TEXT,
        notes             TEXT,
        status            TEXT          NOT NULL DEFAULT 'POSTED' CHECK (status IN ('PENDING','POSTED','REVERSED')),
        reversal_of_id    UUID          REFERENCES ${q}."funder_transactions" (id) ON DELETE SET NULL,
        created_by        UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_funder_txn_funder ON ${q}."funder_transactions" (funder_id, transaction_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_funder_txn_status ON ${q}."funder_transactions" (status)`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${q}."loan_funder_allocations" (
        id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        loan_id     UUID          NOT NULL REFERENCES ${q}."loans" (id) ON DELETE CASCADE,
        funder_id   UUID          NOT NULL REFERENCES ${q}."funders" (id) ON DELETE RESTRICT,
        amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
        created_by  UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_${s}_lfa_loan_funder UNIQUE (loan_id, funder_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lfa_loan ON ${q}."loan_funder_allocations" (loan_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_lfa_funder ON ${q}."loan_funder_allocations" (funder_id)`);
    this.ensuredSchemas.add(schemaName);
  }

  /** Net posted capital across every funder — used by the ledger dashboard's Total Fund card. */
  async getTotalCapitalWithClient(client: import('pg').PoolClient, schemaName: string, asOfDate?: string): Promise<number> {
    await this.ensureTables(client, schemaName);
    const res = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(CASE transaction_type
         WHEN 'CONTRIBUTION' THEN amount
         WHEN 'ADJUSTMENT'   THEN amount
         WHEN 'WITHDRAWAL'   THEN -amount
       END), 0) AS total
       FROM funder_transactions WHERE ${LIVE_FUNDER_TXN_SQL} ${asOfDate ? 'AND transaction_date <= $1' : ''}`,
      asOfDate ? [asOfDate] : [],
    );
    return parseFloat(res.rows[0].total);
  }

  async listFunders(user: TenantJwtPayload, page: number, limit: number, activeOnly?: boolean) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTables(client, user.schemaName);
      const where = activeOnly ? `WHERE f.is_active = TRUE` : '';
      const dataRes = await client.query(
        `SELECT f.*,
           COALESCE((SELECT SUM(CASE ft.transaction_type
             WHEN 'CONTRIBUTION' THEN ft.amount WHEN 'ADJUSTMENT' THEN ft.amount ELSE -ft.amount END)
             FROM funder_transactions ft WHERE ft.funder_id = f.id AND ft.status = 'POSTED' AND ft.reversal_of_id IS NULL), 0) AS balance,
           COALESCE((SELECT SUM(lfa.amount) FROM loan_funder_allocations lfa
             JOIN loans l ON l.id = lfa.loan_id
             WHERE lfa.funder_id = f.id AND l.status IN ('APPROVED','DISBURSED')), 0) AS allocated_principal
         FROM funders f ${where}
         ORDER BY f.name ASC
         LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM funders f ${where}`);
      return {
        data: dataRes.rows.map((r) => this.mapFunderRow(r)),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async createFunder(user: TenantJwtPayload, dto: CreateFunderDto) {
    this.assertAccess(user);
    if (!dto.name?.trim()) throw new BadRequestException('Funder name is required');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTables(client, user.schemaName);
      const res = await client.query(
        `INSERT INTO funders (name, email, phone) VALUES ($1,$2,$3) RETURNING *`,
        [dto.name.trim(), dto.email ?? null, dto.phone ?? null],
      );
      const funder = this.mapFunderRow({ ...res.rows[0], balance: '0', allocated_principal: '0' });
      await this.activity.record(client, user, {
        action: 'funder.created', entityType: 'funder', entityId: funder.id, entityLabel: funder.name,
      });
      return funder;
    });
  }

  async updateFunder(user: TenantJwtPayload, funderId: string, dto: UpdateFunderDto) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTables(client, user.schemaName);
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (dto.name !== undefined) { sets.push(`name = $${idx++}`); params.push(dto.name.trim()); }
      if (dto.email !== undefined) { sets.push(`email = $${idx++}`); params.push(dto.email || null); }
      if (dto.phone !== undefined) { sets.push(`phone = $${idx++}`); params.push(dto.phone || null); }
      if (dto.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(dto.isActive); }
      if (sets.length === 0) throw new BadRequestException('No fields to update');
      sets.push(`updated_at = NOW()`);
      params.push(funderId);
      const res = await client.query(`UPDATE funders SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
      if (!res.rows[0]) throw new NotFoundException('Funder not found');
      await this.activity.record(client, user, {
        action: 'funder.updated', entityType: 'funder', entityId: funderId, entityLabel: res.rows[0].name,
        metadata: { ...dto },
      });
      return this.mapFunderRow({ ...res.rows[0], balance: '0', allocated_principal: '0' });
    });
  }

  async getFunder(user: TenantJwtPayload, funderId: string, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTables(client, user.schemaName);
      const funderRes = await client.query(`SELECT * FROM funders WHERE id = $1`, [funderId]);
      if (!funderRes.rows[0]) throw new NotFoundException('Funder not found');

      const balanceRes = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(CASE transaction_type
           WHEN 'CONTRIBUTION' THEN amount WHEN 'ADJUSTMENT' THEN amount ELSE -amount END), 0) AS balance
         FROM funder_transactions WHERE funder_id = $1 AND ${LIVE_FUNDER_TXN_SQL}`,
        [funderId],
      );
      const allocatedRes = await client.query<{ allocated: string }>(
        `SELECT COALESCE(SUM(lfa.amount), 0) AS allocated
         FROM loan_funder_allocations lfa JOIN loans l ON l.id = lfa.loan_id
         WHERE lfa.funder_id = $1 AND l.status IN ('APPROVED','DISBURSED')`,
        [funderId],
      );
      const txnRes = await client.query(
        `SELECT * FROM funder_transactions WHERE funder_id = $1 ORDER BY transaction_date DESC, created_at DESC LIMIT $2 OFFSET $3`,
        [funderId, limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM funder_transactions WHERE funder_id = $1`, [funderId],
      );

      return {
        funder: this.mapFunderRow({ ...funderRes.rows[0], balance: balanceRes.rows[0].balance, allocated_principal: allocatedRes.rows[0].allocated }),
        transactions: txnRes.rows.map((r) => this.mapTxnRow(r)),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async postFunderTransaction(user: TenantJwtPayload, funderId: string, dto: PostFunderTransactionDto) {
    this.assertAccess(user);
    if (!dto.amount || dto.amount === 0) throw new BadRequestException('Amount must be non-zero');
    if (dto.transactionType !== 'ADJUSTMENT' && dto.amount < 0) {
      throw new BadRequestException('Contribution/withdrawal amount must be positive — direction comes from the transaction type');
    }
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTables(client, user.schemaName);
      const funderRes = await client.query(`SELECT id, name FROM funders WHERE id = $1`, [funderId]);
      if (!funderRes.rows[0]) throw new NotFoundException('Funder not found');

      const res = await client.query(
        `INSERT INTO funder_transactions (funder_id, transaction_date, transaction_type, amount, reference_number, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          funderId, dto.transactionDate ?? new Date().toISOString().slice(0, 10), dto.transactionType,
          dto.amount, dto.referenceNumber ?? null, dto.notes ?? null, user.sub,
        ],
      );
      const txn = this.mapTxnRow(res.rows[0]);
      await this.activity.record(client, user, {
        action: 'funder.transaction_posted', entityType: 'funder_transaction', entityId: txn.id,
        entityLabel: `${funderRes.rows[0].name} — ${txn.transactionType} ₹${txn.amount}`,
        metadata: { funderId, transactionType: txn.transactionType, amount: txn.amount },
      });
      return txn;
    });
  }

  async reverseFunderTransaction(user: TenantJwtPayload, funderId: string, transactionId: string, reason: string) {
    this.assertAccess(user);
    if (!reason?.trim()) throw new BadRequestException('A reason is required to reverse a transaction');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTables(client, user.schemaName);
      const originalRes = await client.query(`SELECT * FROM funder_transactions WHERE id = $1 AND funder_id = $2`, [transactionId, funderId]);
      if (!originalRes.rows[0]) throw new NotFoundException('Funder transaction not found');
      const original = this.mapTxnRow(originalRes.rows[0]);
      if (original.status === 'REVERSED') throw new BadRequestException('Transaction is already reversed');

      const reversalRes = await client.query(
        `INSERT INTO funder_transactions (funder_id, transaction_date, transaction_type, amount, reference_number, notes, reversal_of_id, created_by)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [funderId, original.transactionType, -original.amount, original.referenceNumber, reason, original.id, user.sub],
      );
      await client.query(`UPDATE funder_transactions SET status = 'REVERSED', updated_at = NOW() WHERE id = $1`, [original.id]);

      const reversal = this.mapTxnRow(reversalRes.rows[0]);
      await this.activity.record(client, user, {
        action: 'funder.transaction_reversed', entityType: 'funder_transaction', entityId: reversal.id,
        entityLabel: `Reversal of ${original.transactionType} — ₹${original.amount}`,
        metadata: { reversalOfId: original.id, reason },
      });
      return reversal;
    });
  }

  async getLoanAllocations(user: TenantJwtPayload, loanId: string) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTables(client, user.schemaName);
      const loanRes = await client.query<{ id: string; loan_number: string; principal: string }>(
        `SELECT id, loan_number, principal FROM loans WHERE id = $1`, [loanId],
      );
      if (!loanRes.rows[0]) throw new NotFoundException('Loan not found');
      const allocRes = await client.query(
        `SELECT lfa.*, f.name AS funder_name FROM loan_funder_allocations lfa
         JOIN funders f ON f.id = lfa.funder_id WHERE lfa.loan_id = $1 ORDER BY f.name`,
        [loanId],
      );
      const allocations = allocRes.rows.map((r) => ({
        funderId: r.funder_id as string, funderName: r.funder_name as string, amount: parseFloat(r.amount),
      }));
      const principal = parseFloat(loanRes.rows[0].principal);
      const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
      return {
        loanId, loanNumber: loanRes.rows[0].loan_number, principal,
        allocated, unallocated: round2(principal - allocated), allocations,
      };
    });
  }

  /**
   * Replaces this loan's full allocation set atomically. Requires the
   * allocations to sum exactly to the loan's principal (±1 paisa rounding
   * tolerance) — the point of the explicit model is that every rupee
   * disbursed is accounted for to a specific funder, not partially tracked.
   */
  async setLoanAllocations(user: TenantJwtPayload, loanId: string, allocations: LoanAllocationInput[]) {
    this.assertAccess(user);
    if (allocations.some((a) => !a.funderId || !a.amount || a.amount <= 0)) {
      throw new BadRequestException('Each allocation needs a funderId and a positive amount');
    }
    const funderIds = allocations.map((a) => a.funderId);
    if (new Set(funderIds).size !== funderIds.length) {
      throw new BadRequestException('Each funder can only appear once in a loan\'s allocation');
    }

    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTables(client, user.schemaName);
      const loanRes = await client.query<{ id: string; principal: string }>(`SELECT id, principal FROM loans WHERE id = $1`, [loanId]);
      if (!loanRes.rows[0]) throw new NotFoundException('Loan not found');
      const principal = parseFloat(loanRes.rows[0].principal);
      const sum = round2(allocations.reduce((s, a) => s + a.amount, 0));
      if (Math.abs(sum - principal) > 0.01) {
        throw new BadRequestException(`Allocations must sum to the loan principal of ₹${principal} (got ₹${sum})`);
      }

      await client.query('BEGIN');
      let committed = false;
      try {
        await client.query(`DELETE FROM loan_funder_allocations WHERE loan_id = $1`, [loanId]);
        for (const a of allocations) {
          await client.query(
            `INSERT INTO loan_funder_allocations (loan_id, funder_id, amount, created_by) VALUES ($1,$2,$3,$4)`,
            [loanId, a.funderId, round2(a.amount), user.sub],
          );
        }
        await this.activity.record(client, user, {
          action: 'funder.loan_allocated', entityType: 'loan', entityId: loanId,
          entityLabel: `Funder allocation set (${allocations.length} funder${allocations.length === 1 ? '' : 's'})`,
          metadata: { allocations },
        });
        await client.query('COMMIT');
        committed = true;
        return this.getLoanAllocations(user, loanId);
      } finally {
        if (!committed) await client.query('ROLLBACK');
      }
    });
  }

  private mapFunderRow(r: Record<string, unknown>) {
    return {
      id: r.id as string,
      name: r.name as string,
      email: (r.email as string) ?? null,
      phone: (r.phone as string) ?? null,
      isActive: r.is_active as boolean,
      balance: parseFloat(r.balance as string),
      allocatedPrincipal: parseFloat(r.allocated_principal as string),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  private mapTxnRow(r: Record<string, unknown>) {
    return {
      id: r.id as string,
      funderId: r.funder_id as string,
      transactionDate: r.transaction_date as string,
      transactionType: r.transaction_type as FunderTransactionType,
      amount: parseFloat(r.amount as string),
      referenceNumber: (r.reference_number as string) ?? null,
      notes: (r.notes as string) ?? null,
      status: r.status as FunderTransactionStatus,
      reversalOfId: (r.reversal_of_id as string) ?? null,
      createdBy: (r.created_by as string) ?? null,
      createdAt: r.created_at as string,
    };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
