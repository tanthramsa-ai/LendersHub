import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

@Injectable()
export class TenantDashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats(user: TenantJwtPayload) {
    const s = user.schemaName;
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${s}", public`);

      const today = new Date().toISOString().slice(0, 10);

      const [
        customersRes,
        loansRes,
        activeLoansRes,
        todayCollectionRes,
        pendingRes,
        overdueInstallmentsRes,
      ] = await Promise.all([
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM customers WHERE is_active = TRUE`),
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans`),
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans WHERE status = 'DISBURSED'`),
        client.query<{ total: string }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE payment_date = $1`, [today]),
        client.query<{ total: string }>(`SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total FROM installments WHERE status IN ('PENDING','PARTIALLY_PAID','OVERDUE')`),
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM installments WHERE status = 'OVERDUE'`),
      ]);

      return {
        totalCustomers: parseInt(customersRes.rows[0].total),
        totalLoans: parseInt(loansRes.rows[0].total),
        activeLoans: parseInt(activeLoansRes.rows[0].total),
        todaysCollection: parseFloat(todayCollectionRes.rows[0].total),
        pendingAmount: parseFloat(pendingRes.rows[0].total),
        overdueInstallments: parseInt(overdueInstallmentsRes.rows[0].total),
      };
    } finally {
      client.release();
    }
  }

  async getRecentActivity(user: TenantJwtPayload) {
    const s = user.schemaName;
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${s}", public`);

      const [loansRes, paymentsRes] = await Promise.all([
        client.query(`
          SELECT l.id, l.loan_number, l.principal, l.status, l.created_at,
                 c.first_name || ' ' || c.last_name AS customer_name
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          ORDER BY l.created_at DESC LIMIT 5
        `),
        client.query(`
          SELECT p.id, p.amount, p.payment_method, p.payment_date, p.created_at,
                 l.loan_number,
                 c.first_name || ' ' || c.last_name AS customer_name
          FROM payments p
          JOIN loans l ON l.id = p.loan_id
          JOIN customers c ON c.id = l.customer_id
          ORDER BY p.created_at DESC LIMIT 5
        `),
      ]);

      const activity = [
        ...loansRes.rows.map((r) => ({
          type: 'loan' as const,
          id: r.id,
          loanNumber: r.loan_number,
          customerName: r.customer_name,
          amount: parseFloat(r.principal),
          status: r.status,
          createdAt: r.created_at,
        })),
        ...paymentsRes.rows.map((r) => ({
          type: 'payment' as const,
          id: r.id,
          loanNumber: r.loan_number,
          customerName: r.customer_name,
          amount: parseFloat(r.amount),
          method: r.payment_method,
          paymentDate: r.payment_date,
          createdAt: r.created_at,
        })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);

      return { activity };
    } finally {
      client.release();
    }
  }

  async getActiveLoans(user: TenantJwtPayload, page = 1, limit = 10) {
    const s = user.schemaName;
    const offset = (page - 1) * limit;
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${s}", public`);

      const [dataRes, countRes] = await Promise.all([
        client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate, l.term_months,
                 l.status, l.disbursed_at, l.first_due_date, l.created_at,
                 c.first_name || ' ' || c.last_name AS customer_name,
                 c.phone AS customer_phone,
                 COALESCE(SUM(CASE WHEN i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE') THEN i.total_amount - i.paid_amount ELSE 0 END), 0) AS outstanding
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN installments i ON i.loan_id = l.id
          WHERE l.status = 'DISBURSED'
          GROUP BY l.id, c.first_name, c.last_name, c.phone
          ORDER BY l.created_at DESC
          LIMIT $1 OFFSET $2
        `, [limit, offset]),
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans WHERE status = 'DISBURSED'`),
      ]);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id,
          loanNumber: r.loan_number,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months,
          status: r.status,
          outstanding: parseFloat(r.outstanding),
          disbursedAt: r.disbursed_at,
          firstDueDate: r.first_due_date,
          createdAt: r.created_at,
        })),
        total: parseInt(countRes.rows[0].total),
        page,
        limit,
      };
    } finally {
      client.release();
    }
  }
}
