import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { FIELD_ROLES } from '../common/roles';

export interface RecordCollectionPaymentDto {
  amount: number;
  paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS';
  referenceNumber?: string;
  paymentDate?: string;
}

@Injectable()
export class TenantCollectionsService {
  constructor(
    private prisma: PrismaService,
    private activity: TenantActivityLogService,
  ) {}

  // In-memory cache — avoids repeated ALTER TABLE calls per schema per process lifetime
  private migratedSchemas = new Set<string>();

  private async withSchema<T>(
    schemaName: string,
    fn: (client: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async ensureAssignedTo(schemaName: string): Promise<void> {
    if (this.migratedSchemas.has(schemaName)) return;
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE "${schemaName}".installments ADD COLUMN IF NOT EXISTS assigned_to UUID`,
    );
    this.migratedSchemas.add(schemaName);
  }

  async getStats(user: TenantJwtPayload) {
    return this.withSchema(user.schemaName, async (client) => {
      const today = new Date().toISOString().slice(0, 10);
      // Sequential: a single pg connection cannot run queries concurrently.
      const todayRes = await client.query<{ count: string; amount: string }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount - paid_amount), 0) AS amount
           FROM installments WHERE due_date = $1 AND status IN ('PENDING','PARTIALLY_PAID')`,
        [today],
      );
      const overdueRes = await client.query<{ count: string; amount: string }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount - paid_amount), 0) AS amount
           FROM installments WHERE status = 'OVERDUE'`,
      );
      const collectedRes = await client.query<{ amount: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE payment_date = $1`,
        [today],
      );
      const pendingRes = await client.query<{ amount: string }>(
        `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS amount
           FROM installments WHERE status IN ('PENDING','PARTIALLY_PAID','OVERDUE')`,
      );
      return {
        todayCount: parseInt(todayRes.rows[0].count),
        todayAmount: parseFloat(todayRes.rows[0].amount),
        overdueCount: parseInt(overdueRes.rows[0].count),
        overdueAmount: parseFloat(overdueRes.rows[0].amount),
        collectedToday: parseFloat(collectedRes.rows[0].amount),
        totalPending: parseFloat(pendingRes.rows[0].amount),
      };
    });
  }

  async getToday(user: TenantJwtPayload, page: number, limit: number, search?: string) {
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const today = new Date().toISOString().slice(0, 10);
      const offset = (page - 1) * limit;
      // Agent sees only installments assigned to them or in their loans.
      // user.sub is bound as a parameter (not interpolated) — data and count queries
      // have independent parameter lists, so they build filters separately.
      const dataParams: unknown[] = [today, limit, offset];
      let selfFilter = '';
      if (user.role === 'AGENT') {
        dataParams.push(user.sub);
        const p = `$${dataParams.length}`;
        selfFilter = `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
      }
      let searchFilter = '';
      if (search) {
        dataParams.push(`%${search}%`);
        const p = `$${dataParams.length}`;
        searchFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${p} OR l.loan_number ILIKE ${p} OR c.phone ILIKE ${p})`;
      }
      const countParams: unknown[] = [today];
      let countSelf = '';
      if (user.role === 'AGENT') {
        countParams.push(user.sub);
        const p = `$${countParams.length}`;
        countSelf = `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
      }
      let countFilter = '';
      if (search) {
        countParams.push(`%${search}%`);
        const p = `$${countParams.length}`;
        countFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${p} OR l.loan_number ILIKE ${p} OR c.phone ILIKE ${p})`;
      }

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(
        `SELECT i.id, i.installment_number, i.due_date, i.total_amount, i.paid_amount,
                  i.total_amount - i.paid_amount AS balance, i.status, i.assigned_to,
                  l.id AS loan_id, l.loan_number,
                  c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.phone,
                  u.first_name || ' ' || u.last_name AS agent_name
           FROM installments i
           JOIN loans l ON l.id = i.loan_id
           JOIN customers c ON c.id = l.customer_id
           LEFT JOIN users u ON u.id = i.assigned_to
           WHERE i.due_date = $1 AND i.status IN ('PENDING','PARTIALLY_PAID')
           ${selfFilter} ${searchFilter}
           ORDER BY c.first_name, l.loan_number
           LIMIT $2 OFFSET $3`,
        dataParams,
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM installments i
           JOIN loans l ON l.id = i.loan_id
           JOIN customers c ON c.id = l.customer_id
           WHERE i.due_date = $1 AND i.status IN ('PENDING','PARTIALLY_PAID')
           ${countSelf} ${countFilter}`,
        countParams,
      );

      return { data: dataRes.rows.map(this.mapRow), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  async getOverdue(user: TenantJwtPayload, page: number, limit: number, search?: string) {
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      // user.sub bound as a parameter (not interpolated); data/count queries build
      // their filters against independent parameter lists.
      const dataParams: unknown[] = [limit, offset];
      let selfFilter = '';
      if (user.role === 'AGENT') {
        dataParams.push(user.sub);
        const p = `$${dataParams.length}`;
        selfFilter = `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
      }
      let searchFilter = '';
      if (search) {
        dataParams.push(`%${search}%`);
        const p = `$${dataParams.length}`;
        searchFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${p} OR l.loan_number ILIKE ${p} OR c.phone ILIKE ${p})`;
      }
      const countParams: unknown[] = [];
      let countSelf = '';
      if (user.role === 'AGENT') {
        countParams.push(user.sub);
        const p = `$${countParams.length}`;
        countSelf = `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
      }
      let countFilter = '';
      if (search) {
        countParams.push(`%${search}%`);
        const p = `$${countParams.length}`;
        countFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${p} OR l.loan_number ILIKE ${p} OR c.phone ILIKE ${p})`;
      }

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(
        `SELECT i.id, i.installment_number, i.due_date, i.total_amount, i.paid_amount,
                  i.total_amount - i.paid_amount AS balance, i.status, i.assigned_to,
                  CURRENT_DATE - i.due_date AS days_overdue,
                  l.id AS loan_id, l.loan_number,
                  c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.phone,
                  u.first_name || ' ' || u.last_name AS agent_name
           FROM installments i
           JOIN loans l ON l.id = i.loan_id
           JOIN customers c ON c.id = l.customer_id
           LEFT JOIN users u ON u.id = i.assigned_to
           WHERE i.status = 'OVERDUE'
           ${selfFilter} ${searchFilter}
           ORDER BY i.due_date ASC
           LIMIT $1 OFFSET $2`,
        dataParams,
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM installments i
           JOIN loans l ON l.id = i.loan_id
           JOIN customers c ON c.id = l.customer_id
           WHERE i.status = 'OVERDUE'
           ${countSelf} ${countFilter}`,
        countParams,
      );

      return {
        data: dataRes.rows.map((r) => ({ ...this.mapRow(r), daysOverdue: parseInt(r.days_overdue ?? 0) })),
        total: parseInt(countRes.rows[0].total),
        page,
        limit,
      };
    });
  }

  async getCalendar(user: TenantJwtPayload, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const start = `${month}-01`;
      const dueParams: unknown[] = [start];
      let dueSelfFilter = '';
      if (user.role === 'AGENT') {
        dueParams.push(user.sub);
        const p = `$${dueParams.length}`;
        dueSelfFilter = `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
      }
      // Sequential: a single pg connection cannot run queries concurrently.
      const dueRes = await client.query<{
        due_date: string; due_count: string; overdue_count: string; paid_count: string; due_amount: string;
      }>(
        `SELECT i.due_date::text AS due_date,
                COUNT(*) FILTER (WHERE i.status IN ('PENDING','PARTIALLY_PAID')) AS due_count,
                COUNT(*) FILTER (WHERE i.status = 'OVERDUE') AS overdue_count,
                COUNT(*) FILTER (WHERE i.status = 'PAID') AS paid_count,
                COALESCE(SUM(i.total_amount - i.paid_amount) FILTER (WHERE i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE')), 0) AS due_amount
         FROM installments i
         JOIN loans l ON l.id = i.loan_id
         WHERE date_trunc('month', i.due_date) = $1::date
         ${dueSelfFilter}
         GROUP BY i.due_date`,
        dueParams,
      );

      const collectedParams: unknown[] = [start];
      let collectedSelfFilter = '';
      if (user.role === 'AGENT') {
        collectedParams.push(user.sub);
        const p = `$${collectedParams.length}`;
        collectedSelfFilter = `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
      }
      const collectedRes = await client.query<{ payment_date: string; collected_amount: string }>(
        `SELECT p.payment_date::text AS payment_date,
                COALESCE(SUM(p.amount), 0) AS collected_amount
         FROM payments p
         JOIN loans l ON l.id = p.loan_id
         LEFT JOIN installments i ON i.id = p.installment_id
         WHERE date_trunc('month', p.payment_date) = $1::date
         ${collectedSelfFilter}
         GROUP BY p.payment_date`,
        collectedParams,
      );

      const byDate = new Map<string, { date: string; dueCount: number; overdueCount: number; paidCount: number; dueAmount: number; collectedAmount: number }>();
      for (const r of dueRes.rows) {
        byDate.set(r.due_date, {
          date: r.due_date,
          dueCount: parseInt(r.due_count),
          overdueCount: parseInt(r.overdue_count),
          paidCount: parseInt(r.paid_count),
          dueAmount: parseFloat(r.due_amount),
          collectedAmount: 0,
        });
      }
      for (const r of collectedRes.rows) {
        const existing = byDate.get(r.payment_date);
        if (existing) existing.collectedAmount = parseFloat(r.collected_amount);
        else byDate.set(r.payment_date, {
          date: r.payment_date, dueCount: 0, overdueCount: 0, paidCount: 0, dueAmount: 0,
          collectedAmount: parseFloat(r.collected_amount),
        });
      }

      return { month, days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
    });
  }

  async getByDate(user: TenantJwtPayload, date: string, page: number, limit: number, search?: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const dataParams: unknown[] = [date, limit, offset];
      let selfFilter = '';
      if (user.role === 'AGENT') {
        dataParams.push(user.sub);
        const p = `$${dataParams.length}`;
        selfFilter = `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
      }
      let searchFilter = '';
      if (search) {
        dataParams.push(`%${search}%`);
        const p = `$${dataParams.length}`;
        searchFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${p} OR l.loan_number ILIKE ${p} OR c.phone ILIKE ${p})`;
      }
      const countParams: unknown[] = [date];
      let countSelf = '';
      if (user.role === 'AGENT') {
        countParams.push(user.sub);
        const p = `$${countParams.length}`;
        countSelf = `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
      }
      let countFilter = '';
      if (search) {
        countParams.push(`%${search}%`);
        const p = `$${countParams.length}`;
        countFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${p} OR l.loan_number ILIKE ${p} OR c.phone ILIKE ${p})`;
      }

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(
        `SELECT i.id, i.installment_number, i.due_date, i.total_amount, i.paid_amount,
                  i.total_amount - i.paid_amount AS balance, i.status, i.assigned_to,
                  l.id AS loan_id, l.loan_number,
                  c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.phone,
                  u.first_name || ' ' || u.last_name AS agent_name
           FROM installments i
           JOIN loans l ON l.id = i.loan_id
           JOIN customers c ON c.id = l.customer_id
           LEFT JOIN users u ON u.id = i.assigned_to
           WHERE i.due_date = $1
           ${selfFilter} ${searchFilter}
           ORDER BY c.first_name, l.loan_number
           LIMIT $2 OFFSET $3`,
        dataParams,
      );
      const countRes = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM installments i
           JOIN loans l ON l.id = i.loan_id
           JOIN customers c ON c.id = l.customer_id
           WHERE i.due_date = $1
           ${countSelf} ${countFilter}`,
        countParams,
      );

      return { data: dataRes.rows.map(this.mapRow), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  async getAgents(user: TenantJwtPayload) {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `SELECT id, first_name || ' ' || last_name AS name, role
         FROM users
         WHERE role IN (${[...FIELD_ROLES, 'ADMIN'].map((r) => `'${r}'`).join(',')}) AND is_active = TRUE
         ORDER BY first_name`,
      );
      return res.rows.map((r) => ({ id: r.id, name: r.name, role: r.role }));
    });
  }

  async assignAgent(user: TenantJwtPayload, installmentId: string, agentId: string | null) {
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE installments SET assigned_to = $1 WHERE id = $2
         RETURNING id, (SELECT loan_number FROM loans WHERE id = installments.loan_id) AS loan_number`,
        [agentId ?? null, installmentId],
      );
      if (!res.rows[0]) throw new NotFoundException('Installment not found');
      await this.activity.record(client, user, {
        action: agentId ? 'installment.agent_assigned' : 'installment.agent_unassigned',
        entityType: 'installment',
        entityId: installmentId,
        entityLabel: res.rows[0].loan_number,
        metadata: { agentId },
      });
      return { success: true };
    });
  }

  async recordPayment(user: TenantJwtPayload, installmentId: string, dto: RecordCollectionPaymentDto) {
    if (user.role === 'CUSTOMER') throw new ForbiddenException('You do not have permission to record payments');
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('Amount must be positive');
    return this.withSchema(user.schemaName, async (client) => {
      const instRes = await client.query(
        `SELECT i.*, l.id AS loan_id, l.status AS loan_status, l.loan_number
         FROM installments i JOIN loans l ON l.id = i.loan_id WHERE i.id = $1`,
        [installmentId],
      );
      if (!instRes.rows[0]) throw new NotFoundException('Installment not found');
      const inst = instRes.rows[0];
      if (!['APPROVED', 'DISBURSED'].includes(inst.loan_status)) {
        throw new BadRequestException('Payment can only be recorded on active loans');
      }

      const balance = Math.round((parseFloat(inst.total_amount) - parseFloat(inst.paid_amount)) * 100) / 100;
      if (dto.amount > balance) throw new BadRequestException(`Amount exceeds balance due of ₹${balance}`);

      const paymentDate = dto.paymentDate ?? new Date().toISOString().slice(0, 10);

      await client.query(
        `INSERT INTO payments (loan_id, installment_id, amount, payment_method, reference_number, collected_by, payment_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [inst.loan_id, installmentId, dto.amount, dto.paymentMethod, dto.referenceNumber ?? null, user.sub, paymentDate],
      );

      await client.query(
        `UPDATE installments
         SET paid_amount = paid_amount + $1,
             status = CASE
               WHEN paid_amount + $1 >= total_amount THEN 'PAID'
               WHEN paid_amount + $1 > 0             THEN 'PARTIALLY_PAID'
               ELSE status
             END,
             paid_at = CASE WHEN paid_amount + $1 >= total_amount THEN NOW() ELSE paid_at END
         WHERE id = $2`,
        [dto.amount, installmentId],
      );

      await this.activity.record(client, user, {
        action: 'payment.recorded',
        entityType: 'loan',
        entityId: inst.loan_id,
        entityLabel: inst.loan_number,
        metadata: { amount: dto.amount, paymentMethod: dto.paymentMethod, installmentId, source: 'collections' },
      });

      return { success: true };
    });
  }

  private mapRow(r: Record<string, unknown>) {
    return {
      id: r.id as string,
      installmentNumber: r.installment_number as number,
      dueDate: r.due_date as string,
      totalAmount: parseFloat(r.total_amount as string),
      paidAmount: parseFloat(r.paid_amount as string),
      balance: parseFloat(r.balance as string),
      status: r.status as string,
      assignedTo: (r.assigned_to as string) ?? null,
      agentName: (r.agent_name as string) ?? null,
      loanId: r.loan_id as string,
      loanNumber: r.loan_number as string,
      customerId: r.customer_id as string,
      customerName: r.customer_name as string,
      phone: r.phone as string,
    };
  }
}
