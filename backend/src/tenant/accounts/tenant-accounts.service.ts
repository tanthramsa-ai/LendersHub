import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Injectable()
export class TenantAccountsService {
  constructor(private prisma: PrismaService) {}

  private async withSchema<T>(schemaName: string, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async getSummary(user: TenantJwtPayload) {
    return this.withSchema(user.schemaName, async (client) => {
      const [
        loansRes,
        paymentsRes,
        overdueRes,
        statusRes,
      ] = await Promise.all([
        client.query<{
          total_loans: string; total_principal: string; active_loans: string;
          active_principal: string; closed_loans: string;
        }>(`
          SELECT
            COUNT(*) AS total_loans,
            COALESCE(SUM(principal), 0) AS total_principal,
            COUNT(*) FILTER (WHERE status = 'DISBURSED') AS active_loans,
            COALESCE(SUM(principal) FILTER (WHERE status = 'DISBURSED'), 0) AS active_principal,
            COUNT(*) FILTER (WHERE status = 'CLOSED') AS closed_loans
          FROM loans WHERE deleted_at IS NULL
        `),
        client.query<{ total_collected: string; this_month: string; last_month: string }>(`
          SELECT
            COALESCE(SUM(amount), 0) AS total_collected,
            COALESCE(SUM(amount) FILTER (WHERE payment_date >= date_trunc('month', CURRENT_DATE)), 0) AS this_month,
            COALESCE(SUM(amount) FILTER (
              WHERE payment_date >= date_trunc('month', CURRENT_DATE - interval '1 month')
              AND payment_date < date_trunc('month', CURRENT_DATE)
            ), 0) AS last_month
          FROM payments
        `),
        client.query<{ overdue_count: string; overdue_amount: string }>(`
          SELECT COUNT(*) AS overdue_count,
                 COALESCE(SUM(total_amount - paid_amount), 0) AS overdue_amount
          FROM installments WHERE status = 'OVERDUE'
        `),
        client.query<{ status: string; count: string; principal: string }>(`
          SELECT status, COUNT(*) AS count, COALESCE(SUM(principal), 0) AS principal
          FROM loans WHERE deleted_at IS NULL
          GROUP BY status
        `),
      ]);

      const l = loansRes.rows[0];
      const p = paymentsRes.rows[0];
      const o = overdueRes.rows[0];

      const totalPrincipal = parseFloat(l.total_principal);
      const totalCollected = parseFloat(p.total_collected);
      const activePrincipal = parseFloat(l.active_principal);

      // Outstanding = installments still unpaid across disbursed loans
      const outstandingRes = await client.query<{ outstanding: string }>(`
        SELECT COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS outstanding
        FROM installments i
        JOIN loans l ON l.id = i.loan_id
        WHERE i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE') AND l.deleted_at IS NULL
      `);

      return {
        totalLoans: parseInt(l.total_loans),
        totalPrincipalDisbursed: totalPrincipal,
        activeLoans: parseInt(l.active_loans),
        activePrincipal,
        closedLoans: parseInt(l.closed_loans),
        totalCollected,
        thisMonthCollected: parseFloat(p.this_month),
        lastMonthCollected: parseFloat(p.last_month),
        outstandingBalance: parseFloat(outstandingRes.rows[0].outstanding),
        overdueCount: parseInt(o.overdue_count),
        overdueAmount: parseFloat(o.overdue_amount),
        loansByStatus: statusRes.rows.map((r) => ({
          status: r.status,
          count: parseInt(r.count),
          principal: parseFloat(r.principal),
        })),
      };
    });
  }

  async getMonthlyTrend(user: TenantJwtPayload, months = 6) {
    return this.withSchema(user.schemaName, async (client) => {
      const [disbursedRes, collectedRes] = await Promise.all([
        client.query<{ month: string; count: string; amount: string }>(`
          SELECT to_char(date_trunc('month', disbursed_at), 'YYYY-MM') AS month,
                 COUNT(*) AS count,
                 COALESCE(SUM(principal), 0) AS amount
          FROM loans
          WHERE disbursed_at IS NOT NULL
            AND disbursed_at >= date_trunc('month', CURRENT_DATE - interval '${months - 1} months')
            AND deleted_at IS NULL
          GROUP BY 1
          ORDER BY 1
        `),
        client.query<{ month: string; count: string; amount: string }>(`
          SELECT to_char(date_trunc('month', payment_date), 'YYYY-MM') AS month,
                 COUNT(*) AS count,
                 COALESCE(SUM(amount), 0) AS amount
          FROM payments
          WHERE payment_date >= date_trunc('month', CURRENT_DATE - interval '${months - 1} months')
          GROUP BY 1
          ORDER BY 1
        `),
      ]);

      // Build full month range
      const monthMap: Record<string, { disbursedCount: number; disbursedAmount: number; collectedCount: number; collectedAmount: number }> = {};
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - i);
        const key = d.toISOString().slice(0, 7);
        monthMap[key] = { disbursedCount: 0, disbursedAmount: 0, collectedCount: 0, collectedAmount: 0 };
      }

      for (const r of disbursedRes.rows) {
        if (monthMap[r.month]) {
          monthMap[r.month].disbursedCount = parseInt(r.count);
          monthMap[r.month].disbursedAmount = parseFloat(r.amount);
        }
      }
      for (const r of collectedRes.rows) {
        if (monthMap[r.month]) {
          monthMap[r.month].collectedCount = parseInt(r.count);
          monthMap[r.month].collectedAmount = parseFloat(r.amount);
        }
      }

      return Object.entries(monthMap).map(([month, data]) => ({ month, ...data }));
    });
  }

  async getTopBorrowers(user: TenantJwtPayload, limit = 10) {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(`
        SELECT c.id, c.first_name || ' ' || c.last_name AS name, c.phone,
               COUNT(l.id) AS loan_count,
               COALESCE(SUM(l.principal) FILTER (WHERE l.status = 'DISBURSED'), 0) AS active_principal,
               COALESCE(SUM(i.total_amount - i.paid_amount) FILTER (WHERE i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE')), 0) AS outstanding
        FROM customers c
        LEFT JOIN loans l ON l.customer_id = c.id AND l.deleted_at IS NULL
        LEFT JOIN installments i ON i.loan_id = l.id
        WHERE c.deleted_at IS NULL
        GROUP BY c.id, c.first_name, c.last_name, c.phone
        HAVING COUNT(l.id) > 0
        ORDER BY outstanding DESC NULLS LAST
        LIMIT $1
      `, [limit]);

      return res.rows.map((r) => ({
        id: r.id, name: r.name, phone: r.phone,
        loanCount: parseInt(r.loan_count),
        activePrincipal: parseFloat(r.active_principal),
        outstanding: parseFloat(r.outstanding),
      }));
    });
  }
}
