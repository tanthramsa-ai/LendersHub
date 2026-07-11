import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';

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
      // Agent (LOAN_OFFICER) sees only installments assigned to them or in their loans
      const selfFilter = user.role === 'LOAN_OFFICER'
        ? `AND (i.assigned_to = '${user.sub}' OR l.loan_officer_id = '${user.sub}')`
        : '';
      const searchFilter = search
        ? `AND (c.first_name || ' ' || c.last_name ILIKE $4 OR l.loan_number ILIKE $4 OR c.phone ILIKE $4)`
        : '';
      const dataParams: unknown[] = search ? [today, limit, offset, `%${search}%`] : [today, limit, offset];
      const countParams: unknown[] = search ? [today, `%${search}%`] : [today];
      const countFilter = search
        ? `AND (c.first_name || ' ' || c.last_name ILIKE $2 OR l.loan_number ILIKE $2 OR c.phone ILIKE $2)`
        : '';

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
           ${selfFilter} ${countFilter}`,
        countParams,
      );

      return { data: dataRes.rows.map(this.mapRow), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  async getOverdue(user: TenantJwtPayload, page: number, limit: number, search?: string) {
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const selfFilter = user.role === 'LOAN_OFFICER'
        ? `AND (i.assigned_to = '${user.sub}' OR l.loan_officer_id = '${user.sub}')`
        : '';
      const searchFilter = search
        ? `AND (c.first_name || ' ' || c.last_name ILIKE $3 OR l.loan_number ILIKE $3 OR c.phone ILIKE $3)`
        : '';
      const dataParams: unknown[] = search ? [limit, offset, `%${search}%`] : [limit, offset];
      const countParams: unknown[] = search ? [`%${search}%`] : [];
      const countFilter = search
        ? `AND (c.first_name || ' ' || c.last_name ILIKE $1 OR l.loan_number ILIKE $1 OR c.phone ILIKE $1)`
        : '';

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
           ${selfFilter} ${countFilter}`,
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

  async getAgents(user: TenantJwtPayload) {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `SELECT id, first_name || ' ' || last_name AS name, role
         FROM users
         WHERE role IN ('COLLECTOR','LOAN_OFFICER','ADMIN') AND is_active = TRUE
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
    if (user.role === 'VIEWER') throw new ForbiddenException('You do not have permission to record payments');
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
