import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

const MANAGER_ROLES = ['OWNER', 'MANAGER', 'ADMIN'];

@Injectable()
export class TenantDashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats(user: TenantJwtPayload) {
    const s = user.schemaName;
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${s}", public`);

      const today = new Date().toISOString().slice(0, 10);
      const isManager = MANAGER_ROLES.includes(user.role);
      const isCollector = user.role === 'COLLECTOR';

      if (isCollector) {
        // Collectors see only their assigned installments
        const [assignedRes, todayCollectedRes, overdueRes] = await Promise.all([
          client.query<{ total: string; amount: string }>(
            `SELECT COUNT(*) AS total, COALESCE(SUM(total_amount - paid_amount), 0) AS amount
             FROM installments WHERE assigned_to = $1 AND status IN ('PENDING','PARTIALLY_PAID','OVERDUE')`,
            [user.sub],
          ),
          client.query<{ total: string }>(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
             WHERE collected_by = $1 AND payment_date = $2`,
            [user.sub, today],
          ),
          client.query<{ total: string }>(
            `SELECT COUNT(*) AS total FROM installments WHERE assigned_to = $1 AND status = 'OVERDUE'`,
            [user.sub],
          ),
        ]);
        return {
          totalCustomers: 0,
          totalLoans: parseInt(assignedRes.rows[0].total),
          activeLoans: parseInt(assignedRes.rows[0].total),
          todaysCollection: parseFloat(todayCollectedRes.rows[0].total),
          pendingAmount: parseFloat(assignedRes.rows[0].amount),
          overdueInstallments: parseInt(overdueRes.rows[0].total),
          roleView: 'collector',
        };
      }

      const officerCond = `AND l.loan_officer_id = $1`;

      const [
        customersRes,
        loansRes,
        activeLoansRes,
        todayCollectionRes,
        pendingRes,
        overdueInstallmentsRes,
      ] = await Promise.all([
        isManager
          ? client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM customers WHERE is_active = TRUE AND deleted_at IS NULL`)
          : client.query<{ total: string }>(`SELECT COUNT(DISTINCT c.id) AS total FROM customers c JOIN loans l ON l.customer_id = c.id WHERE l.loan_officer_id = $1 AND c.deleted_at IS NULL`, [user.sub]),
        isManager
          ? client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans l WHERE deleted_at IS NULL`)
          : client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans l WHERE deleted_at IS NULL ${officerCond}`, [user.sub]),
        isManager
          ? client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans l WHERE status = 'DISBURSED' AND deleted_at IS NULL`)
          : client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans l WHERE status = 'DISBURSED' AND deleted_at IS NULL ${officerCond}`, [user.sub]),
        isManager
          ? client.query<{ total: string }>(`SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p JOIN loans l ON l.id = p.loan_id WHERE p.payment_date = $1`, [today])
          : client.query<{ total: string }>(`SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p JOIN loans l ON l.id = p.loan_id WHERE p.payment_date = $1 AND l.loan_officer_id = $2`, [today, user.sub]),
        isManager
          ? client.query<{ total: string }>(`SELECT COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS total FROM installments i JOIN loans l ON l.id = i.loan_id WHERE i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE')`)
          : client.query<{ total: string }>(`SELECT COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS total FROM installments i JOIN loans l ON l.id = i.loan_id WHERE i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE') ${officerCond}`, [user.sub]),
        isManager
          ? client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM installments i JOIN loans l ON l.id = i.loan_id WHERE i.status = 'OVERDUE'`)
          : client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM installments i JOIN loans l ON l.id = i.loan_id WHERE i.status = 'OVERDUE' ${officerCond}`, [user.sub]),
      ]);

      return {
        totalCustomers: parseInt(customersRes.rows[0].total),
        totalLoans: parseInt(loansRes.rows[0].total),
        activeLoans: parseInt(activeLoansRes.rows[0].total),
        todaysCollection: parseFloat(todayCollectionRes.rows[0].total),
        pendingAmount: parseFloat(pendingRes.rows[0].total),
        overdueInstallments: parseInt(overdueInstallmentsRes.rows[0].total),
        roleView: isManager ? 'manager' : 'officer',
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
      const isManager = MANAGER_ROLES.includes(user.role);
      const officerParams = isManager ? [] : [user.sub];
      const officerWhere = isManager ? `WHERE l.deleted_at IS NULL` : `WHERE l.deleted_at IS NULL AND l.loan_officer_id = $1`;

      const [loansRes, paymentsRes] = await Promise.all([
        client.query(`
          SELECT l.id, l.loan_number, l.principal, l.status, l.created_at,
                 c.first_name || ' ' || c.last_name AS customer_name
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          ${officerWhere}
          ORDER BY l.created_at DESC LIMIT 5
        `, officerParams),
        client.query(`
          SELECT p.id, p.amount, p.payment_method, p.payment_date, p.created_at,
                 l.loan_number,
                 c.first_name || ' ' || c.last_name AS customer_name
          FROM payments p
          JOIN loans l ON l.id = p.loan_id
          JOIN customers c ON c.id = l.customer_id
          ${officerWhere}
          ORDER BY p.created_at DESC LIMIT 5
        `, officerParams),
      ]);

      const activity = [
        ...loansRes.rows.map((r) => ({
          type: 'loan' as const,
          id: r.id, loanNumber: r.loan_number, customerName: r.customer_name,
          amount: parseFloat(r.principal), status: r.status, createdAt: r.created_at,
        })),
        ...paymentsRes.rows.map((r) => ({
          type: 'payment' as const,
          id: r.id, loanNumber: r.loan_number, customerName: r.customer_name,
          amount: parseFloat(r.amount), method: r.payment_method,
          paymentDate: r.payment_date, createdAt: r.created_at,
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

      const isManager = MANAGER_ROLES.includes(user.role);
      // COLLECTOR sees their assigned loans (via installment assignments)
      const isCollector = user.role === 'COLLECTOR';

      let whereClause: string;
      let countWhere: string;
      let params: unknown[];
      let countParams: unknown[];

      if (isCollector) {
        whereClause = `WHERE l.id IN (SELECT DISTINCT loan_id FROM installments WHERE assigned_to = $3 AND status IN ('PENDING','PARTIALLY_PAID','OVERDUE')) AND l.status = 'DISBURSED' AND l.deleted_at IS NULL`;
        countWhere = `WHERE l.id IN (SELECT DISTINCT loan_id FROM installments WHERE assigned_to = $1 AND status IN ('PENDING','PARTIALLY_PAID','OVERDUE')) AND l.status = 'DISBURSED' AND l.deleted_at IS NULL`;
        params = [limit, offset, user.sub];
        countParams = [user.sub];
      } else if (isManager) {
        whereClause = `WHERE l.status = 'DISBURSED' AND l.deleted_at IS NULL`;
        countWhere = `WHERE l.status = 'DISBURSED' AND l.deleted_at IS NULL`;
        params = [limit, offset];
        countParams = [];
      } else {
        // LOAN_OFFICER: only their loans
        whereClause = `WHERE l.loan_officer_id = $3 AND l.status = 'DISBURSED' AND l.deleted_at IS NULL`;
        countWhere = `WHERE l.loan_officer_id = $1 AND l.status = 'DISBURSED' AND l.deleted_at IS NULL`;
        params = [limit, offset, user.sub];
        countParams = [user.sub];
      }

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
          ${whereClause}
          GROUP BY l.id, c.first_name, c.last_name, c.phone
          ORDER BY l.disbursed_at DESC NULLS LAST, l.created_at DESC
          LIMIT $1 OFFSET $2
        `, params),
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans l ${countWhere}`, countParams),
      ]);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          customerName: r.customer_name, customerPhone: r.customer_phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months, status: r.status,
          outstanding: parseFloat(r.outstanding),
          disbursedAt: r.disbursed_at,
          firstDueDate: r.first_due_date,
          createdAt: r.created_at,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    } finally {
      client.release();
    }
  }
}
