import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';

export interface CreateTransactionDto {
  transactionDate: string;   // YYYY-MM-DD
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  category: string;
  accountName?: string;
  entityType?: 'customer' | 'agent' | 'loan';
  entityId?: string;
  entityName?: string;
  description?: string;
  referenceNumber?: string;
}

@Injectable()
export class TenantLedgerService {
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

  // Ensure table exists (idempotent for older tenants)
  private async ensureTable(client: import('pg').PoolClient, schemaName: string) {
    const q = `"${schemaName}"`;
    const s = schemaName.replace(/[^a-zA-Z0-9_]/g, '_');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${q}."fund_transactions" (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_date DATE        NOT NULL DEFAULT CURRENT_DATE,
        type             TEXT        NOT NULL CHECK (type IN ('CREDIT','DEBIT')),
        amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
        category         TEXT        NOT NULL,
        account_name     TEXT,
        entity_type      TEXT,
        entity_id        TEXT,
        entity_name      TEXT,
        description      TEXT,
        reference_number TEXT,
        created_by       UUID        REFERENCES ${q}."users" (id) ON DELETE SET NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ft_date ON ${q}."fund_transactions" (transaction_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ft_type ON ${q}."fund_transactions" (type, transaction_date DESC)`);
  }

  async listCredits(user: TenantJwtPayload, page: number, limit: number, month?: string) {
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const offset = (page - 1) * limit;

      // Build month filter
      const monthFilter = month ? `AND DATE_TRUNC('month', p.payment_date) = DATE_TRUNC('month', $1::date)` : '';
      const monthFilterFt = month ? `AND DATE_TRUNC('month', ft.transaction_date) = DATE_TRUNC('month', $1::date)` : '';
      const params: unknown[] = month ? [month + '-01', limit, offset] : [limit, offset];
      const limitIdx = month ? 2 : 1;
      const offsetIdx = month ? 3 : 2;

      // Sequential: a single pg connection cannot run queries concurrently.
      const paymentsRes = await client.query(`
          SELECT
            p.id, p.payment_date AS txn_date, p.amount,
            p.payment_method::TEXT AS account_name,
            CASE WHEN p.payment_method::TEXT = 'CASH' THEN 'Cash' ELSE p.payment_method::TEXT END AS display_account,
            c.first_name || ' ' || c.last_name AS entity_name,
            'customer' AS entity_type, l.customer_id AS entity_id,
            l.loan_number AS description,
            p.reference_number,
            'LOAN_PAYMENT' AS category,
            'payment' AS source
          FROM payments p
          JOIN loans l ON l.id = p.loan_id
          JOIN customers c ON c.id = l.customer_id
          WHERE 1=1 ${monthFilter}
          ORDER BY p.payment_date DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, params);
      const ftRes = await client.query(`
          SELECT
            ft.id, ft.transaction_date AS txn_date, ft.amount,
            COALESCE(ft.account_name, 'CASH') AS account_name,
            CASE WHEN ft.account_name IS NULL OR ft.account_name = 'CASH' THEN 'Cash' ELSE ft.account_name END AS display_account,
            ft.entity_name, ft.entity_type, ft.entity_id,
            ft.description, ft.reference_number, ft.category,
            'manual' AS source
          FROM fund_transactions ft
          WHERE ft.type = 'CREDIT' ${monthFilterFt}
          ORDER BY ft.transaction_date DESC
        `, month ? [month + '-01'] : []);
      const countRes = await client.query(`
          SELECT
            (SELECT COUNT(*) FROM payments p WHERE 1=1 ${monthFilter.replace('p.payment_date', 'p.payment_date')}) +
            (SELECT COUNT(*) FROM fund_transactions ft WHERE ft.type = 'CREDIT' ${monthFilterFt}) AS total
        `, month ? [month + '-01'] : []);

      const combined = [
        ...paymentsRes.rows.map((r) => ({
          id: r.id, date: r.txn_date, amount: parseFloat(r.amount),
          accountName: r.account_name, displayAccount: r.display_account,
          entityName: r.entity_name, entityType: r.entity_type, entityId: r.entity_id,
          description: r.description, referenceNumber: r.reference_number,
          category: r.category, source: r.source, isCash: r.account_name === 'CASH',
        })),
        ...ftRes.rows.map((r) => ({
          id: r.id, date: r.txn_date, amount: parseFloat(r.amount),
          accountName: r.account_name, displayAccount: r.display_account,
          entityName: r.entity_name, entityType: r.entity_type, entityId: r.entity_id,
          description: r.description, referenceNumber: r.reference_number,
          category: r.category, source: r.source, isCash: !r.account_name || r.account_name === 'CASH',
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        data: combined.slice(0, limit),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async listDebits(user: TenantJwtPayload, page: number, limit: number, month?: string) {
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);

      const monthFilter = month ? `AND DATE_TRUNC('month', l.disbursed_at) = DATE_TRUNC('month', $1::date)` : '';
      const monthFilterFt = month ? `AND DATE_TRUNC('month', ft.transaction_date) = DATE_TRUNC('month', $1::date)` : '';
      const params: unknown[] = month ? [month + '-01'] : [];

      // Sequential: a single pg connection cannot run queries concurrently.
      const loansRes = await client.query(`
          SELECT
            l.id, DATE(l.disbursed_at) AS txn_date, l.principal AS amount,
            'CASH' AS account_name, 'Cash / Bank' AS display_account,
            c.first_name || ' ' || c.last_name AS entity_name,
            'customer' AS entity_type, l.customer_id AS entity_id,
            l.loan_number AS description, NULL AS reference_number,
            'LOAN_DISBURSEMENT' AS category, 'disbursement' AS source
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          WHERE l.deleted_at IS NULL AND l.disbursed_at IS NOT NULL ${monthFilter}
          ORDER BY l.disbursed_at DESC
        `, params);
      const ftRes = await client.query(`
          SELECT
            ft.id, ft.transaction_date AS txn_date, ft.amount,
            COALESCE(ft.account_name, 'CASH') AS account_name,
            CASE WHEN ft.account_name IS NULL OR ft.account_name = 'CASH' THEN 'Cash' ELSE ft.account_name END AS display_account,
            ft.entity_name, ft.entity_type, ft.entity_id,
            ft.description, ft.reference_number, ft.category, 'manual' AS source
          FROM fund_transactions ft
          WHERE ft.type = 'DEBIT' ${monthFilterFt}
          ORDER BY ft.transaction_date DESC
        `, params);

      const combined = [
        ...loansRes.rows.map((r) => ({
          id: r.id, date: r.txn_date, amount: parseFloat(r.amount),
          accountName: r.account_name, displayAccount: r.display_account,
          entityName: r.entity_name, entityType: r.entity_type, entityId: r.entity_id,
          description: r.description, referenceNumber: r.reference_number,
          category: r.category, source: r.source, isCash: true,
        })),
        ...ftRes.rows.map((r) => ({
          id: r.id, date: r.txn_date, amount: parseFloat(r.amount),
          accountName: r.account_name, displayAccount: r.display_account,
          entityName: r.entity_name, entityType: r.entity_type, entityId: r.entity_id,
          description: r.description, referenceNumber: r.reference_number,
          category: r.category, source: r.source, isCash: !r.account_name || r.account_name === 'CASH',
        })),
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const offset = (page - 1) * limit;
      return {
        data: combined.slice(offset, offset + limit),
        total: combined.length,
        page, limit,
      };
    });
  }

  async listPrincipalTransactions(user: TenantJwtPayload, page: number, limit: number, month?: string) {
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);

      const monthFilter = month ? `DATE_TRUNC('month', txn_date) = DATE_TRUNC('month', '${month}-01'::date) AND` : '';

      // Disbursements (DEBIT) + Principal repayments (CREDIT)
      const res = await client.query(`
        SELECT * FROM (
          -- Loan disbursements: principal going OUT
          SELECT
            l.id, DATE(l.disbursed_at) AS txn_date, l.principal AS amount,
            'DEBIT' AS direction,
            c.first_name || ' ' || c.last_name AS entity_name, l.loan_number AS ref,
            'Loan Disbursed' AS description
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          WHERE l.deleted_at IS NULL AND l.disbursed_at IS NOT NULL

          UNION ALL

          -- Principal repayments: principal coming IN
          SELECT
            p.id, p.payment_date AS txn_date,
            COALESCE(i.principal_amount, 0) AS amount,
            'CREDIT' AS direction,
            c.first_name || ' ' || c.last_name AS entity_name,
            l.loan_number AS ref,
            'Principal Repayment' AS description
          FROM payments p
          JOIN loans l ON l.id = p.loan_id
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN installments i ON i.id = p.installment_id
          WHERE COALESCE(i.principal_amount, 0) > 0
        ) t
        WHERE ${monthFilter} TRUE
        ORDER BY txn_date DESC, direction
        LIMIT $1 OFFSET $2
      `, [limit, (page - 1) * limit]);

      const countRes = await client.query(`
        SELECT COUNT(*) AS total FROM (
          SELECT l.id FROM loans l WHERE l.deleted_at IS NULL AND l.disbursed_at IS NOT NULL
          UNION ALL
          SELECT p.id FROM payments p
          JOIN installments i ON i.id = p.installment_id
          WHERE COALESCE(i.principal_amount, 0) > 0
        ) t
      `);

      return {
        data: res.rows.map((r) => ({
          id: r.id, date: r.txn_date, amount: parseFloat(r.amount),
          direction: r.direction, entityName: r.entity_name,
          reference: r.ref, description: r.description,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async addTransaction(user: TenantJwtPayload, dto: CreateTransactionDto) {
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(user.role)) {
      throw new BadRequestException('Only Owner, Manager or Admin can add transactions');
    }
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('Amount must be positive');

    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const res = await client.query(`
        INSERT INTO fund_transactions (
          transaction_date, type, amount, category, account_name,
          entity_type, entity_id, entity_name, description, reference_number, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *
      `, [
        dto.transactionDate, dto.type, dto.amount, dto.category,
        dto.accountName || null, dto.entityType || null, dto.entityId || null,
        dto.entityName || null, dto.description || null, dto.referenceNumber || null,
        user.sub,
      ]);
      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: r.type === 'CREDIT' ? 'ledger.credit_added' : 'ledger.debit_added',
        entityType: 'fund_transaction',
        entityId: r.id,
        entityLabel: `${r.category} — ₹${r.amount}`,
        metadata: { amount: parseFloat(r.amount), category: r.category, entityType: r.entity_type, entityId: r.entity_id },
      });
      return {
        id: r.id, date: r.transaction_date, type: r.type, amount: parseFloat(r.amount),
        category: r.category, accountName: r.account_name,
        entityType: r.entity_type, entityId: r.entity_id, entityName: r.entity_name,
        description: r.description, referenceNumber: r.reference_number,
        createdAt: r.created_at,
      };
    });
  }

  async listManualTransactions(user: TenantJwtPayload, page: number, limit: number, month?: string) {
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const monthFilter = month ? `AND DATE_TRUNC('month', ft.transaction_date) = DATE_TRUNC('month', $1::date)` : '';
      const params: unknown[] = month ? [month + '-01', limit, (page - 1) * limit] : [limit, (page - 1) * limit];
      const limitIdx = month ? 2 : 1;
      const offsetIdx = month ? 3 : 2;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT ft.*, u.first_name || ' ' || u.last_name AS created_by_name
          FROM fund_transactions ft
          LEFT JOIN users u ON u.id = ft.created_by
          WHERE 1=1 ${monthFilter}
          ORDER BY ft.transaction_date DESC, ft.created_at DESC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, params);
      const countRes = await client.query(`SELECT COUNT(*) AS total FROM fund_transactions ft WHERE 1=1 ${monthFilter}`, month ? [month + '-01'] : []);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, date: r.transaction_date, type: r.type, amount: parseFloat(r.amount),
          category: r.category, accountName: r.account_name,
          entityType: r.entity_type, entityId: r.entity_id, entityName: r.entity_name,
          description: r.description, referenceNumber: r.reference_number,
          createdByName: r.created_by_name, createdAt: r.created_at,
          isCash: !r.account_name || r.account_name === 'CASH',
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }
}
