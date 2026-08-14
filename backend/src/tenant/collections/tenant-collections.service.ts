import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { FIELD_ROLES, MANAGER_ROLES, UserRole } from '../common/roles';

export type CollectionPeriod = 'D' | 'W' | 'M';

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
  private workflowMigratedSchemas = new Set<string>();

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

  /**
   * Day / Week / Month window used by the Collection Reminder and Pending
   * Collections views. "Week" and "Month" are rolling from today rather than
   * calendar-aligned, so the agent always sees the next 7 / 30 days of work.
   */
  private resolvePeriod(period?: string): CollectionPeriod {
    const p = (period ?? 'D').toUpperCase();
    if (p !== 'D' && p !== 'W' && p !== 'M') {
      throw new BadRequestException("period must be one of 'D', 'W', 'M'");
    }
    return p;
  }

  private rangeFor(period: CollectionPeriod): { start: string; end: string } {
    const start = new Date();
    const end = new Date(start);
    if (period === 'W') end.setDate(end.getDate() + 6);
    if (period === 'M') end.setDate(end.getDate() + 29);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { start: iso(start), end: iso(end) };
  }

  /**
   * An AGENT only ever sees their own book; STAFF and the manager roles see
   * every user's collections. Returns '' for the unscoped roles.
   * Pushes user.sub onto `params` (bound, never interpolated).
   */
  private selfScope(user: TenantJwtPayload, params: unknown[]): string {
    if (user.role !== 'AGENT') return '';
    params.push(user.sub);
    const p = `$${params.length}`;
    return `AND (i.assigned_to = ${p} OR l.loan_officer_id = ${p})`;
  }

  private async ensureAssignedTo(schemaName: string): Promise<void> {
    if (this.migratedSchemas.has(schemaName)) return;
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE "${schemaName}".installments ADD COLUMN IF NOT EXISTS assigned_to UUID`,
    );
    this.migratedSchemas.add(schemaName);
  }

  /**
   * Collection workflow (SCHEDULED -> COLLECTED -> CONFIRMED) rides on the
   * existing payments row rather than a parallel financial model: a payment IS
   * the collection transaction. SCHEDULED is derived (an installment with no
   * live payment), so only COLLECTED/CONFIRMED/CANCELLED are ever stored.
   *
   * Confirmation never overwrites the agent's original figures — amount stays
   * put and confirmed_amount is recorded alongside it, with the transition
   * written to collection_audit.
   */
  private async ensureCollectionWorkflow(schemaName: string): Promise<void> {
    if (this.workflowMigratedSchemas.has(schemaName)) return;
    const q = `"${schemaName}"`;
    const stmts = [
      `ALTER TABLE ${q}.payments ADD COLUMN IF NOT EXISTS collection_status TEXT NOT NULL DEFAULT 'COLLECTED'`,
      `ALTER TABLE ${q}.payments ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES ${q}.users (id) ON DELETE SET NULL`,
      `ALTER TABLE ${q}.payments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`,
      `ALTER TABLE ${q}.payments ADD COLUMN IF NOT EXISTS confirmed_amount NUMERIC(14,2)`,
      `ALTER TABLE ${q}.payments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
      // Idempotency: a retried "Collect" submission reuses the key and is
      // absorbed instead of double-crediting the borrower.
      `ALTER TABLE ${q}.payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_${schemaName}_payments_idem
         ON ${q}.payments (idempotency_key) WHERE idempotency_key IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_${schemaName}_payments_collection_status
         ON ${q}.payments (collection_status)`,
      `CREATE TABLE IF NOT EXISTS ${q}."collection_audit" (
         id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
         payment_id    UUID        REFERENCES ${q}.payments (id) ON DELETE SET NULL,
         installment_id UUID       REFERENCES ${q}.installments (id) ON DELETE SET NULL,
         loan_id       UUID        NOT NULL REFERENCES ${q}.loans (id) ON DELETE CASCADE,
         from_status   TEXT,
         to_status     TEXT        NOT NULL,
         amount        NUMERIC(14,2),
         performed_by  UUID        REFERENCES ${q}.users (id) ON DELETE SET NULL,
         performed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         reference     TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS idx_${schemaName}_collection_audit_loan
         ON ${q}."collection_audit" (loan_id)`,
    ];
    for (const s of stmts) await this.prisma.$executeRawUnsafe(s);
    this.workflowMigratedSchemas.add(schemaName);
  }

  private async recordAudit(
    client: import('pg').PoolClient,
    entry: {
      paymentId?: string | null; installmentId?: string | null; loanId: string;
      fromStatus: string | null; toStatus: string; amount?: number | null;
      performedBy: string; reference?: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO collection_audit
         (payment_id, installment_id, loan_id, from_status, to_status, amount, performed_by, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        entry.paymentId ?? null, entry.installmentId ?? null, entry.loanId,
        entry.fromStatus, entry.toStatus, entry.amount ?? null,
        entry.performedBy, entry.reference ?? null,
      ],
    );
  }

  async getStats(user: TenantJwtPayload, period?: string) {
    const p = this.resolvePeriod(period);
    const { start, end } = this.rangeFor(p);
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      // Every figure below is scoped the same way as the lists: an AGENT sees
      // only their own book, STAFF/managers see all users'.
      const dueParams: unknown[] = [start, end];
      const dueSelf = this.selfScope(user, dueParams);
      // Sequential: a single pg connection cannot run queries concurrently.
      const dueRes = await client.query<{ count: string; amount: string }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS amount
           FROM installments i JOIN loans l ON l.id = i.loan_id
           WHERE i.due_date BETWEEN $1 AND $2 AND i.status IN ('PENDING','PARTIALLY_PAID') ${dueSelf}`,
        dueParams,
      );
      const overdueParams: unknown[] = [];
      const overdueSelf = this.selfScope(user, overdueParams);
      const overdueRes = await client.query<{ count: string; amount: string }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS amount
           FROM installments i JOIN loans l ON l.id = i.loan_id
           WHERE i.status = 'OVERDUE' ${overdueSelf}`,
        overdueParams,
      );
      // Payments carry no assigned_to, so the agent scope keys off the loan
      // officer or the installment the payment settled.
      const collectedParams: unknown[] = [start, end];
      const collectedSelf = this.selfScope(user, collectedParams);
      const collectedRes = await client.query<{ amount: string }>(
        `SELECT COALESCE(SUM(p.amount), 0) AS amount
           FROM payments p
           JOIN loans l ON l.id = p.loan_id
           LEFT JOIN installments i ON i.id = p.installment_id
           WHERE p.payment_date BETWEEN $1 AND $2 ${collectedSelf}`,
        collectedParams,
      );
      const pendingParams: unknown[] = [end];
      const pendingSelf = this.selfScope(user, pendingParams);
      const pendingRes = await client.query<{ count: string; amount: string }>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS amount
           FROM installments i JOIN loans l ON l.id = i.loan_id
           WHERE i.due_date <= $1 AND i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE') ${pendingSelf}`,
        pendingParams,
      );
      return {
        period: p, start, end,
        // Reminder = falling due inside the window; kept as today*/ for the
        // existing callers that still read the day-scoped shape.
        todayCount: parseInt(dueRes.rows[0].count),
        todayAmount: parseFloat(dueRes.rows[0].amount),
        reminderCount: parseInt(dueRes.rows[0].count),
        reminderAmount: parseFloat(dueRes.rows[0].amount),
        overdueCount: parseInt(overdueRes.rows[0].count),
        overdueAmount: parseFloat(overdueRes.rows[0].amount),
        collectedToday: parseFloat(collectedRes.rows[0].amount),
        pendingCount: parseInt(pendingRes.rows[0].count),
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

  /**
   * Collection Reminder — installments falling due inside the selected
   * Day/Week/Month window. Forward-looking only: nothing already overdue.
   */
  async getReminder(user: TenantJwtPayload, period: string | undefined, page: number, limit: number, search?: string) {
    const p = this.resolvePeriod(period);
    const { start, end } = this.rangeFor(p);
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const where = `WHERE i.due_date BETWEEN $1 AND $2 AND i.status IN ('PENDING','PARTIALLY_PAID')`;

      const dataParams: unknown[] = [start, end, limit, offset];
      const selfFilter = this.selfScope(user, dataParams);
      let searchFilter = '';
      if (search) {
        dataParams.push(`%${search}%`);
        const s = `$${dataParams.length}`;
        searchFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${s} OR l.loan_number ILIKE ${s} OR c.phone ILIKE ${s})`;
      }
      const countParams: unknown[] = [start, end];
      const countSelf = this.selfScope(user, countParams);
      let countFilter = '';
      if (search) {
        countParams.push(`%${search}%`);
        const s = `$${countParams.length}`;
        countFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${s} OR l.loan_number ILIKE ${s} OR c.phone ILIKE ${s})`;
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
         ${where} ${selfFilter} ${searchFilter}
         ORDER BY i.due_date ASC, c.first_name
         LIMIT $3 OFFSET $4`,
        dataParams,
      );
      const countRes = await client.query<{ total: string; amount: string }>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS amount
         FROM installments i
         JOIN loans l ON l.id = i.loan_id
         JOIN customers c ON c.id = l.customer_id
         ${where} ${countSelf} ${countFilter}`,
        countParams,
      );

      return {
        data: dataRes.rows.map(this.mapRow),
        total: parseInt(countRes.rows[0].total),
        totalAmount: parseFloat(countRes.rows[0].amount),
        period: p, start, end, page, limit,
      };
    });
  }

  /**
   * Pending Collections — everything still owed as at the end of the selected
   * window. Unlike the reminder this *includes* already-overdue installments,
   * since money outstanding from last week is still pending today.
   */
  async getPending(user: TenantJwtPayload, period: string | undefined, page: number, limit: number, search?: string) {
    const p = this.resolvePeriod(period);
    const { end } = this.rangeFor(p);
    await this.ensureAssignedTo(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const where = `WHERE i.due_date <= $1 AND i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE')`;

      const dataParams: unknown[] = [end, limit, offset];
      const selfFilter = this.selfScope(user, dataParams);
      let searchFilter = '';
      if (search) {
        dataParams.push(`%${search}%`);
        const s = `$${dataParams.length}`;
        searchFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${s} OR l.loan_number ILIKE ${s} OR c.phone ILIKE ${s})`;
      }
      const countParams: unknown[] = [end];
      const countSelf = this.selfScope(user, countParams);
      let countFilter = '';
      if (search) {
        countParams.push(`%${search}%`);
        const s = `$${countParams.length}`;
        countFilter = `AND (c.first_name || ' ' || c.last_name ILIKE ${s} OR l.loan_number ILIKE ${s} OR c.phone ILIKE ${s})`;
      }

      const dataRes = await client.query(
        `SELECT i.id, i.installment_number, i.due_date, i.total_amount, i.paid_amount,
                i.total_amount - i.paid_amount AS balance, i.status, i.assigned_to,
                GREATEST(CURRENT_DATE - i.due_date, 0) AS days_overdue,
                l.id AS loan_id, l.loan_number,
                c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.phone,
                u.first_name || ' ' || u.last_name AS agent_name
         FROM installments i
         JOIN loans l ON l.id = i.loan_id
         JOIN customers c ON c.id = l.customer_id
         LEFT JOIN users u ON u.id = i.assigned_to
         ${where} ${selfFilter} ${searchFilter}
         ORDER BY i.due_date ASC, c.first_name
         LIMIT $2 OFFSET $3`,
        dataParams,
      );
      const countRes = await client.query<{ total: string; amount: string }>(
        `SELECT COUNT(*) AS total, COALESCE(SUM(i.total_amount - i.paid_amount), 0) AS amount
         FROM installments i
         JOIN loans l ON l.id = i.loan_id
         JOIN customers c ON c.id = l.customer_id
         ${where} ${countSelf} ${countFilter}`,
        countParams,
      );

      return {
        data: dataRes.rows.map(this.mapRow),
        total: parseInt(countRes.rows[0].total),
        totalAmount: parseFloat(countRes.rows[0].amount),
        period: p, end, page, limit,
      };
    });
  }

  // ── Collection workflow (calendar + collect + confirm) ──────────────────────

  /**
   * Pending-installment accumulation (spec §8). Installments are pre-generated
   * per loan at disbursement regardless of frequency (daily/weekly/monthly/...),
   * so "how many unpaid installments came due before this one" is a plain
   * schedule query — no frequency-specific branching, and no fabricated rows.
   */
  private async pendingFor(
    client: import('pg').PoolClient,
    loanId: string,
    beforeDueDate: string,
  ): Promise<{ count: number; amount: number }> {
    const res = await client.query<{ count: string; amount: string }>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount - paid_amount), 0) AS amount
         FROM installments
        WHERE loan_id = $1 AND due_date < $2 AND status IN ('PENDING','PARTIALLY_PAID','OVERDUE')`,
      [loanId, beforeDueDate],
    );
    return { count: parseInt(res.rows[0].count), amount: parseFloat(res.rows[0].amount) };
  }

  /**
   * Derives the collection workflow status for an installment from its most
   * recent payment. No live payment => SCHEDULED (never stored). This keeps
   * SCHEDULED/COLLECTED/CONFIRMED off the installment row entirely, so the
   * installment's own PENDING/PARTIALLY_PAID/PAID status (spec §6) is untouched.
   */
  private collectionStatusExpr(alias = 'i'): string {
    return `COALESCE(
      (SELECT p.collection_status FROM payments p
        WHERE p.installment_id = ${alias}.id AND p.cancelled_at IS NULL
        ORDER BY p.created_at DESC LIMIT 1),
      'SCHEDULED'
    )`;
  }

  private rangeForView(view: 'day' | 'week' | 'month', date: string): { start: string; end: string } {
    const d = new Date(`${date}T00:00:00Z`);
    if (view === 'day') return { start: date, end: date };
    if (view === 'week') {
      // Monday-start week containing `date`.
      const dow = (d.getUTCDay() + 6) % 7; // 0=Mon
      const start = new Date(d); start.setUTCDate(d.getUTCDate() - dow);
      const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
    }
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }

  /** Collection Calendar — the agent's (or, for staff/managers, everyone's) items for a Day/Week/Month range. */
  async getCalendarItems(user: TenantJwtPayload, view: 'day' | 'week' | 'month', date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    await this.ensureAssignedTo(user.schemaName);
    await this.ensureCollectionWorkflow(user.schemaName);
    const { start, end } = this.rangeForView(view, date);
    return this.withSchema(user.schemaName, async (client) => {
      const params: unknown[] = [start, end];
      const selfFilter = this.selfScope(user, params);

      const res = await client.query(
        // due_date cast to text: the pg driver returns DATE columns as JS Date
        // objects, and comparing those against the plain 'YYYY-MM-DD' `today`
        // string below silently does the wrong thing (Date > string coerces via
        // Date#toString(), not by calendar day) — cast keeps it a plain string
        // all the way through.
        `SELECT i.id, i.installment_number, i.due_date::text AS due_date, i.total_amount, i.paid_amount,
                i.total_amount - i.paid_amount AS balance, i.status AS installment_status,
                ${this.collectionStatusExpr('i')} AS collection_status,
                l.id AS loan_id, l.loan_number,
                c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.phone
         FROM installments i
         JOIN loans l ON l.id = i.loan_id
         JOIN customers c ON c.id = l.customer_id
         WHERE i.due_date BETWEEN $1 AND $2 ${selfFilter}
         ORDER BY i.due_date ASC, c.first_name`,
        params,
      );

      const today = new Date().toISOString().slice(0, 10);
      const items: Array<Record<string, unknown>> = [];
      for (const r of res.rows) {
        const pending = await this.pendingFor(client, r.loan_id, r.due_date);
        const currentBalance = parseFloat(r.balance);
        items.push({
          installmentId: r.id,
          installmentNumber: r.installment_number,
          dueDate: r.due_date,
          loanId: r.loan_id,
          loanNumber: r.loan_number,
          customerId: r.customer_id,
          customerName: r.customer_name,
          phone: r.phone,
          scheduledAmount: parseFloat(r.total_amount),
          installmentStatus: r.installment_status,
          collectionStatus: r.collection_status,
          pendingInstallments: pending.count,
          totalInstallmentsDue: pending.count + (currentBalance > 0 ? 1 : 0),
          totalAmountDue: Math.round((pending.amount + currentBalance) * 100) / 100,
          // Due-date framing (spec §7): Upcoming / Due today / Overdue, independent
          // of collection status so the two concepts never collapse into one badge.
          dueBucket: r.due_date > today ? 'UPCOMING' : r.due_date === today ? 'DUE_TODAY' : 'OVERDUE',
        });
      }
      return { view, start, end, items };
    });
  }

  /** Calendar Summary (spec §10) — authoritative backend totals for the selected range. */
  async getCalendarSummary(user: TenantJwtPayload, view: 'day' | 'week' | 'month', date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    await this.ensureAssignedTo(user.schemaName);
    await this.ensureCollectionWorkflow(user.schemaName);
    const { start, end } = this.rangeForView(view, date);
    return this.withSchema(user.schemaName, async (client) => {
      const instParams: unknown[] = [start, end];
      const instSelf = this.selfScope(user, instParams);
      const instRes = await client.query<{
        scheduled: string; collected: string; confirmed: string; partially_collected: string; pending: string;
        expected: string; collected_amount: string; confirmed_amount: string;
      }>(
        `SELECT
           -- "Scheduled" = not yet due, nothing collected against it yet.
           COUNT(*) FILTER (WHERE cs = 'SCHEDULED' AND due_date >= CURRENT_DATE) AS scheduled,
           COUNT(*) FILTER (WHERE cs = 'COLLECTED') AS collected,
           COUNT(*) FILTER (WHERE cs = 'CONFIRMED') AS confirmed,
           COUNT(*) FILTER (WHERE cs = 'PARTIALLY_COLLECTED') AS partially_collected,
           -- "Pending" = still owed as of today and not yet touched by any
           -- collection action: scheduled items whose due date has passed.
           COUNT(*) FILTER (WHERE cs = 'SCHEDULED' AND due_date < CURRENT_DATE) AS pending,
           COALESCE(SUM(i.total_amount), 0) AS expected,
           COALESCE(SUM(i.paid_amount) FILTER (WHERE cs IN ('COLLECTED','PARTIALLY_COLLECTED')), 0) AS collected_amount,
           COALESCE(SUM(i.paid_amount) FILTER (WHERE cs = 'CONFIRMED'), 0) AS confirmed_amount
         FROM (
           SELECT i.*, ${this.collectionStatusExpr('i')} AS cs
           FROM installments i JOIN loans l ON l.id = i.loan_id
           WHERE i.due_date BETWEEN $1 AND $2 ${instSelf}
         ) i`,
        instParams,
      );
      const row = instRes.rows[0];
      // Mutually exclusive buckets (spec: "4 Scheduled, 3 Completed, 1 Pending"):
      // completed rolls up Collected + Confirmed (both mean the money's in,
      // just at different stages of office confirmation); scheduled/pending/
      // partiallyCollected are each their own bucket. Every item lands in
      // exactly one.
      return {
        view, start, end,
        scheduled: parseInt(row.scheduled),
        collected: parseInt(row.collected),
        confirmed: parseInt(row.confirmed),
        completed: parseInt(row.collected) + parseInt(row.confirmed),
        partiallyCollected: parseInt(row.partially_collected),
        pending: parseInt(row.pending),
        amountExpected: parseFloat(row.expected),
        amountCollected: parseFloat(row.collected_amount),
        amountConfirmed: parseFloat(row.confirmed_amount),
      };
    });
  }

  /**
   * Collection detail — everything the agent needs from one call so opening a
   * collection from the calendar never forces Customer -> Loan -> Installments
   * navigation (spec §3).
   */
  async getCollectionDetail(user: TenantJwtPayload, installmentId: string) {
    await this.ensureAssignedTo(user.schemaName);
    await this.ensureCollectionWorkflow(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      const params: unknown[] = [installmentId];
      const selfFilter = this.selfScope(user, params);
      const instRes = await client.query(
        `SELECT i.id, i.installment_number, i.due_date, i.total_amount, i.paid_amount,
                i.total_amount - i.paid_amount AS balance, i.status AS installment_status,
                ${this.collectionStatusExpr('i')} AS collection_status,
                l.id AS loan_id, l.loan_number, l.status AS loan_status, l.principal, l.interest_rate,
                c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name,
                c.phone, c.locality, c.city
         FROM installments i
         JOIN loans l ON l.id = i.loan_id
         JOIN customers c ON c.id = l.customer_id
         WHERE i.id = $1 ${selfFilter}`,
        params,
      );
      if (!instRes.rows[0]) throw new NotFoundException('Collection not found');
      const inst = instRes.rows[0];

      const pending = await this.pendingFor(client, inst.loan_id, inst.due_date);
      const currentBalance = parseFloat(inst.balance);

      const prevRes = await client.query(
        `SELECT status FROM installments WHERE loan_id = $1 AND installment_number = $2`,
        [inst.loan_id, inst.installment_number - 1],
      );
      const historyRes = await client.query(
        `SELECT p.id, p.amount, p.payment_method, p.reference_number, p.payment_date, p.created_at,
                p.collection_status, p.confirmed_amount, p.confirmed_at,
                u.first_name || ' ' || u.last_name AS collected_by_name,
                cu.first_name || ' ' || cu.last_name AS confirmed_by_name
         FROM payments p
         LEFT JOIN users u ON u.id = p.collected_by
         LEFT JOIN users cu ON cu.id = p.confirmed_by
         WHERE p.loan_id = $1 AND p.cancelled_at IS NULL
         ORDER BY p.created_at DESC
         LIMIT 20`,
        [inst.loan_id],
      );

      return {
        installment: {
          id: inst.id,
          installmentNumber: inst.installment_number,
          dueDate: inst.due_date,
          scheduledAmount: parseFloat(inst.total_amount),
          paidAmount: parseFloat(inst.paid_amount),
          balance: currentBalance,
          installmentStatus: inst.installment_status,
          collectionStatus: inst.collection_status,
          previousInstallmentStatus: prevRes.rows[0]?.status ?? null,
        },
        loan: {
          id: inst.loan_id, loanNumber: inst.loan_number, status: inst.loan_status,
          principal: parseFloat(inst.principal), interestRate: parseFloat(inst.interest_rate),
        },
        customer: {
          id: inst.customer_id, name: inst.customer_name, phone: inst.phone,
          locality: inst.locality, city: inst.city,
        },
        pendingInstallments: pending.count,
        totalInstallmentsDue: pending.count + (currentBalance > 0 ? 1 : 0),
        totalAmountDue: Math.round((pending.amount + currentBalance) * 100) / 100,
        history: historyRes.rows.map((h) => ({
          id: h.id, amount: parseFloat(h.amount), method: h.payment_method,
          referenceNumber: h.reference_number, paymentDate: h.payment_date, createdAt: h.created_at,
          collectionStatus: h.collection_status,
          confirmedAmount: h.confirmed_amount !== null ? parseFloat(h.confirmed_amount) : null,
          confirmedAt: h.confirmed_at, collectedByName: h.collected_by_name, confirmedByName: h.confirmed_by_name,
        })),
      };
    });
  }

  /**
   * Collect Payment (spec §4). Creates the payment row in COLLECTED status —
   * this means the agent has the money in hand, not that the office has it.
   * Idempotent on `idempotencyKey`: a retried submission (network retry,
   * double-tap) returns the original result instead of double-crediting.
   */
  async collectPayment(
    user: TenantJwtPayload,
    installmentId: string,
    dto: RecordCollectionPaymentDto & { idempotencyKey?: string },
  ) {
    if (!['AGENT', ...MANAGER_ROLES, 'STAFF'].includes(user.role)) {
      throw new ForbiddenException('You do not have permission to record collections');
    }
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('Amount must be positive');
    await this.ensureAssignedTo(user.schemaName);
    await this.ensureCollectionWorkflow(user.schemaName);

    return this.withSchema(user.schemaName, async (client) => {
      if (dto.idempotencyKey) {
        const dupe = await client.query(
          `SELECT id FROM payments WHERE idempotency_key = $1`,
          [dto.idempotencyKey],
        );
        if (dupe.rows[0]) return { success: true, paymentId: dupe.rows[0].id, duplicate: true };
      }

      // AGENT ownership check: assigned OR loan officer, matching every other
      // AGENT-scoped read in this service — an agent cannot collect on a loan
      // that isn't theirs.
      const ownerParams: unknown[] = [installmentId];
      let ownerFilter = '';
      if (user.role === 'AGENT') {
        ownerParams.push(user.sub);
        ownerFilter = `AND (i.assigned_to = $2 OR l.loan_officer_id = $2)`;
      }
      const instRes = await client.query(
        `SELECT i.*, l.id AS loan_id, l.status AS loan_status, l.loan_number
         FROM installments i JOIN loans l ON l.id = i.loan_id
         WHERE i.id = $1 ${ownerFilter}`,
        ownerParams,
      );
      if (!instRes.rows[0]) throw new NotFoundException('Collection not found or not assigned to you');
      const inst = instRes.rows[0];
      if (!['APPROVED', 'DISBURSED'].includes(inst.loan_status)) {
        throw new BadRequestException('Payment can only be recorded on active loans');
      }

      // Two concurrent "Collect" submissions on the same loan (spec edge case
      // #19) must not both read the same balance and both succeed — that would
      // double-credit the customer. BEGIN + FOR UPDATE locks every installment
      // this submission could touch before any balance is read, so the second
      // concurrent transaction blocks here until the first commits and sees
      // the first one's updated paid_amount.
      await client.query('BEGIN');
      let committed = false;
      try {
        await client.query(
          `SELECT id FROM installments WHERE loan_id = $1 AND due_date <= $2 FOR UPDATE`,
          [inst.loan_id, inst.due_date],
        );

        const currentBalance = Math.round((parseFloat(inst.total_amount) - parseFloat(inst.paid_amount)) * 100) / 100;
        const pending = await this.pendingFor(client, inst.loan_id, inst.due_date);
        const totalDue = Math.round((pending.amount + currentBalance) * 100) / 100;
        // Amount can cover this installment plus any accumulated pending ones
        // (spec §8's "customer pays multiple pending installments together"),
        // but never more than what's actually owed.
        if (dto.amount > totalDue) {
          throw new BadRequestException(`Amount exceeds total due of ₹${totalDue} (including ${pending.count} pending installment${pending.count === 1 ? '' : 's'})`);
        }

        const paymentDate = dto.paymentDate ?? new Date().toISOString().slice(0, 10);

        // Oldest-first settlement across this installment and any earlier unpaid
        // ones, so the ₹400-short partial in spec §9 stays outstanding rather
        // than silently applying to the wrong installment.
        const settleRes = await client.query<{ id: string; balance: string; due_date: string }>(
          `SELECT id, total_amount - paid_amount AS balance, due_date
             FROM installments
            WHERE loan_id = $1 AND due_date <= $2 AND status IN ('PENDING','PARTIALLY_PAID','OVERDUE')
            ORDER BY due_date ASC`,
          [inst.loan_id, inst.due_date],
        );
        const result = await this.applyCollectionSettlement(client, user, inst, settleRes.rows, dto, paymentDate, installmentId);
        await client.query('COMMIT');
        committed = true;
        return result;
      } finally {
        if (!committed) await client.query('ROLLBACK');
      }
    });
  }

  /** Payment-insertion + installment-update loop shared by collectPayment's locked section. */
  private async applyCollectionSettlement(
    client: import('pg').PoolClient,
    user: TenantJwtPayload,
    inst: { loan_id: string; loan_number: string },
    settleRows: { id: string; balance: string; due_date: string }[],
    dto: RecordCollectionPaymentDto & { idempotencyKey?: string },
    paymentDate: string,
    installmentId: string,
  ): Promise<{ success: true; paymentId: string | null; collectionStatus: 'COLLECTED' | 'PARTIALLY_COLLECTED' }> {
      let remaining = dto.amount;
      let primaryPaymentId: string | null = null;
      let primaryStatus: 'COLLECTED' | 'PARTIALLY_COLLECTED' = 'COLLECTED';
      for (const row of settleRows) {
        if (remaining <= 0) break;
        const rowBalance = parseFloat(row.balance);
        const applied = Math.min(remaining, rowBalance);
        if (applied <= 0) continue;
        remaining = Math.round((remaining - applied) * 100) / 100;
        // Short of what was still owed on this installment at collection time
        // (not the installment's original total) => a partial collection.
        const rowStatus: 'COLLECTED' | 'PARTIALLY_COLLECTED' = applied < rowBalance ? 'PARTIALLY_COLLECTED' : 'COLLECTED';

        const payRes = await client.query<{ id: string }>(
          `INSERT INTO payments
             (loan_id, installment_id, amount, payment_method, reference_number, collected_by, payment_date,
              collection_status, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            inst.loan_id, row.id, applied, dto.paymentMethod, dto.referenceNumber ?? null,
            user.sub, paymentDate, rowStatus,
            // Only the payment tied to the requested installment carries the
            // idempotency key; settlement of older pending rows in the same
            // submission is inherent to that one request.
            row.id === installmentId ? (dto.idempotencyKey ?? null) : null,
          ],
        );
        primaryPaymentId ??= payRes.rows[0].id;
        if (row.id === installmentId) { primaryPaymentId = payRes.rows[0].id; primaryStatus = rowStatus; }

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
          [applied, row.id],
        );

        await this.recordAudit(client, {
          paymentId: payRes.rows[0].id, installmentId: row.id, loanId: inst.loan_id,
          fromStatus: 'SCHEDULED', toStatus: rowStatus, amount: applied,
          performedBy: user.sub, reference: dto.referenceNumber,
        });
      }

      await this.activity.record(client, user, {
        action: 'payment.recorded',
        entityType: 'loan',
        entityId: inst.loan_id,
        entityLabel: inst.loan_number,
        metadata: { amount: dto.amount, paymentMethod: dto.paymentMethod, installmentId, source: 'collections' },
      });

      return { success: true, paymentId: primaryPaymentId, collectionStatus: primaryStatus };
  }

  /**
   * Office Confirmation (spec §5). Manager/Owner-only — enforced here, not
   * just hidden in the UI. Never mutates the original payment amount; writes
   * confirmed_amount/confirmed_by/confirmed_at alongside it and audits the
   * transition, so COLLECTED -> CONFIRMED is always reconstructable.
   */
  async confirmPayment(user: TenantJwtPayload, paymentId: string, confirmedAmount?: number) {
    if (!MANAGER_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can confirm a collection');
    }
    await this.ensureCollectionWorkflow(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      await client.query('BEGIN');
      let committed = false;
      try {
        // FOR UPDATE: a concurrent confirm (or a second manager double-tapping)
        // on the same payment must see the first transaction's result rather
        // than both racing on the CONFIRMED check.
        const res = await client.query(
          `SELECT id, loan_id, installment_id, amount, collection_status FROM payments WHERE id = $1 FOR UPDATE`,
          [paymentId],
        );
        if (!res.rows[0]) throw new NotFoundException('Collection not found');
        const payment = res.rows[0];
        if (payment.collection_status === 'CONFIRMED') {
          // Idempotent no-op — resubmitting an already-confirmed collection
          // (spec edge case #10) must not error or double-audit.
          await client.query('COMMIT');
          committed = true;
          return { success: true, paymentId, collectionStatus: 'CONFIRMED' as const, alreadyConfirmed: true };
        }
        if (payment.collection_status !== 'COLLECTED') {
          throw new BadRequestException(`Cannot confirm a payment in ${payment.collection_status} status`);
        }

        const amount = confirmedAmount ?? parseFloat(payment.amount);
        await client.query(
          `UPDATE payments
             SET collection_status = 'CONFIRMED', confirmed_by = $1, confirmed_at = NOW(), confirmed_amount = $2
           WHERE id = $3`,
          [user.sub, amount, paymentId],
        );

        await this.recordAudit(client, {
          paymentId, installmentId: payment.installment_id, loanId: payment.loan_id,
          fromStatus: 'COLLECTED', toStatus: 'CONFIRMED', amount,
          performedBy: user.sub,
        });

        await client.query('COMMIT');
        committed = true;
        return { success: true, paymentId, collectionStatus: 'CONFIRMED' as const };
      } finally {
        if (!committed) await client.query('ROLLBACK');
      }
    });
  }

  /**
   * Undo a collection (Aug_13 sheet item — undo was only reachable from the
   * older loan-detail-page flow, not from the Collection Calendar). Manager/
   * Owner/Admin-only, allowed even after office Confirmation per product
   * decision: a confirmed collection can still be a genuine mistake.
   *
   * Soft-cancels the payment (cancelled_at) rather than deleting it, so the
   * audit trail and collection_status derivation (collectionStatusExpr
   * already filters cancelled_at IS NULL) both fall back to whatever the
   * next most recent payment implies — no separate "undo" status needed.
   */
  async undoCollection(user: TenantJwtPayload, installmentId: string) {
    if (!MANAGER_ROLES.includes(user.role as UserRole)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can undo a collection');
    }
    await this.ensureCollectionWorkflow(user.schemaName);
    return this.withSchema(user.schemaName, async (client) => {
      await client.query('BEGIN');
      let committed = false;
      try {
        const instRes = await client.query<{
          id: string; loan_id: string; loan_number: string; paid_amount: string; total_amount: string; is_past_due: boolean;
        }>(
          `SELECT i.id, i.loan_id, l.loan_number, i.paid_amount, i.total_amount, (i.due_date < CURRENT_DATE) AS is_past_due
           FROM installments i JOIN loans l ON l.id = i.loan_id
           WHERE i.id = $1 FOR UPDATE`,
          [installmentId],
        );
        if (!instRes.rows[0]) throw new NotFoundException('Installment not found');
        const inst = instRes.rows[0];

        // FOR UPDATE: a concurrent confirm (or a second manager double-tapping
        // undo) on the same payment must see this transaction's result rather
        // than both racing on the cancelled_at check.
        const payRes = await client.query<{ id: string; amount: string; collection_status: string }>(
          `SELECT id, amount, collection_status FROM payments
            WHERE installment_id = $1 AND cancelled_at IS NULL
            ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [installmentId],
        );
        if (!payRes.rows[0]) throw new BadRequestException('No collection recorded on this installment to undo');
        const payment = payRes.rows[0];

        const remainingPaid = Math.max(0, parseFloat(inst.paid_amount) - parseFloat(payment.amount));
        const totalAmount = parseFloat(inst.total_amount);
        const newStatus = remainingPaid >= totalAmount ? 'PAID'
          : remainingPaid > 0 ? 'PARTIALLY_PAID'
          : (inst.is_past_due ? 'OVERDUE' : 'PENDING');

        await client.query(
          `UPDATE installments
             SET paid_amount = $1, status = $2::installment_status,
                 paid_at = CASE WHEN $2::installment_status = 'PAID' THEN paid_at ELSE NULL END
           WHERE id = $3`,
          [remainingPaid, newStatus, installmentId],
        );
        await client.query(`UPDATE payments SET cancelled_at = NOW() WHERE id = $1`, [payment.id]);

        await this.recordAudit(client, {
          paymentId: payment.id, installmentId, loanId: inst.loan_id,
          fromStatus: payment.collection_status, toStatus: 'CANCELLED', amount: parseFloat(payment.amount),
          performedBy: user.sub,
        });
        await this.activity.record(client, user, {
          action: 'collection.undone',
          entityType: 'loan',
          entityId: inst.loan_id,
          entityLabel: inst.loan_number,
          metadata: { installmentId, undonePaymentId: payment.id, undoneAmount: parseFloat(payment.amount), fromStatus: payment.collection_status },
        });

        await client.query('COMMIT');
        committed = true;
        return { success: true, installmentId, paidAmount: remainingPaid, installmentStatus: newStatus };
      } finally {
        if (!committed) await client.query('ROLLBACK');
      }
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
