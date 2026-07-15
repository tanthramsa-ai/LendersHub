import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantNotificationsService } from '../notifications/tenant-notifications.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { safePagination } from '../../common/utils/pagination';
import { assertNoSpecialChars } from '../customers/customer-validation';

export interface CreateLoanDto {
  customerId: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  purpose?: string;
  firstDueDate?: string;
  branchId?: string;
}

export interface CreateWeeklyLoanDto {
  customerId: string;
  principal: number;
  interestRate: number;      // % per annum
  termWeeks: number;         // number of weekly installments
  firstDueDate: string;      // YYYY-MM-DD
  calculationType: 'REDUCING' | 'FLAT';
  emiRounding: 0 | 10 | 50 | 100;  // round EMI up to nearest X
  purpose?: string;
  branchId?: string;
  loanTypeId?: string;
  securityDocUrl?: string;
  promissoryNoteUrl?: string;
}

export interface RecordPaymentDto {
  installmentId?: string;
  amount: number;
  paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS';
  referenceNumber?: string;
  paymentDate?: string;
}

export interface CreateDailyLoanDto {
  customerId: string;
  principal: number;
  interestRate: number;      // % per annum
  termDays: number;          // number of daily installments
  firstDueDate: string;      // YYYY-MM-DD
  cycleType: 'DAILY_NO_SUNDAY' | 'DAILY_WITH_SUNDAY';
  calculationType: 'REDUCING' | 'FLAT';
  emiRounding: 0 | 10 | 50 | 100;
  purpose?: string;
  branchId?: string;
  loanTypeId?: string;
  securityDocUrl?: string;
  promissoryNoteUrl?: string;
}

export interface CreateMonthlyLoanDto {
  customerId: string;
  principal: number;
  interestRate: number;      // % per annum
  termMonths: number;        // number of monthly interest installments
  firstDueDate: string;      // YYYY-MM-DD
  purpose?: string;
  branchId?: string;
  loanTypeId?: string;
  securityDocUrl?: string;
  promissoryNoteUrl?: string;
}

export interface CreateAgentRiskLoanDto {
  customerId: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  firstDueDate: string;
  purpose?: string;
  branchId?: string;
  loanTypeId?: string;
  securityDocUrl?: string;
  promissoryNoteUrl?: string;
}

export interface CreateTermLoanDto {
  customerId: string;
  principal: number;
  interestRate: number;      // % per annum
  termMonths: number;
  firstDueDate: string;      // YYYY-MM-DD
  calculationType: 'REDUCING' | 'FLAT';
  emiRounding: 0 | 10 | 50 | 100;
  purpose?: string;
  branchId?: string;
  loanTypeId?: string;
  securityDocUrl?: string;
  promissoryNoteUrl?: string;
}

function roundUp(amount: number, nearest: number): number {
  if (nearest === 0) return Math.round(amount * 100) / 100;
  return Math.ceil(amount / nearest) * nearest;
}

export function computeDailySchedule(
  principal: number,
  annualRate: number,
  termDays: number,
  firstDueDateStr: string,
  calculationType: 'REDUCING' | 'FLAT',
  emiRounding: number,
  cycleType: 'DAILY_NO_SUNDAY' | 'DAILY_WITH_SUNDAY',
) {
  const dailyRate = annualRate / 100 / 365;
  const skipSundays = cycleType === 'DAILY_NO_SUNDAY';

  let emi: number;
  if (calculationType === 'FLAT' || dailyRate === 0) {
    const totalInterest = principal * dailyRate * termDays;
    emi = (principal + totalInterest) / termDays;
  } else {
    emi = dailyRate === 0
      ? principal / termDays
      : (principal * dailyRate * Math.pow(1 + dailyRate, termDays)) /
        (Math.pow(1 + dailyRate, termDays) - 1);
  }
  if (emiRounding > 0) emi = Math.ceil(emi / emiRounding) * emiRounding;

  const schedule: Array<{ number: number; dueDate: string; principalAmount: number; interestAmount: number; totalAmount: number }> = [];
  let balance = principal;

  // Parse first due date using UTC to avoid timezone shifts
  const [yr, mo, dy] = firstDueDateStr.split('-').map(Number);
  const currentDate = new Date(Date.UTC(yr, mo - 1, dy));

  // Advance past Sunday if skipping
  if (skipSundays) {
    while (currentDate.getUTCDay() === 0) currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  for (let i = 0; i < termDays; i++) {
    const dueDate = currentDate.toISOString().slice(0, 10);
    let interestAmount: number;
    let principalAmount: number;

    if (calculationType === 'FLAT') {
      interestAmount = principal * dailyRate;
      principalAmount = i < termDays - 1 ? principal / termDays : balance;
    } else {
      interestAmount = balance * dailyRate;
      principalAmount = i < termDays - 1 ? Math.max(0, emi - interestAmount) : balance;
    }

    principalAmount = Math.round(principalAmount * 100) / 100;
    interestAmount = Math.round(interestAmount * 100) / 100;
    balance = Math.max(0, Math.round((balance - principalAmount) * 100) / 100);

    schedule.push({
      number: i + 1,
      dueDate,
      principalAmount,
      interestAmount,
      totalAmount: Math.round((principalAmount + interestAmount) * 100) / 100,
    });

    // Advance to next collection day
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    if (skipSundays) {
      while (currentDate.getUTCDay() === 0) currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }
  }

  return { schedule, emi, dailyRate };
}

export function computeWeeklySchedule(
  principal: number,
  annualRate: number,
  termWeeks: number,
  firstDueDateStr: string,
  calculationType: 'REDUCING' | 'FLAT',
  emiRounding: number,
) {
  const weeklyRate = annualRate / 100 / 52;
  let emi: number;

  if (calculationType === 'FLAT' || weeklyRate === 0) {
    const totalInterest = principal * weeklyRate * termWeeks;
    emi = (principal + totalInterest) / termWeeks;
  } else {
    emi = (principal * weeklyRate * Math.pow(1 + weeklyRate, termWeeks)) /
          (Math.pow(1 + weeklyRate, termWeeks) - 1);
  }

  const roundedEmi = roundUp(emi, emiRounding);

  let balance = principal;
  const schedule: Array<{
    number: number; dueDate: string;
    principalAmount: number; interestAmount: number; totalAmount: number;
  }> = [];

  for (let i = 1; i <= termWeeks; i++) {
    let interest: number;
    let principalAmt: number;
    let total: number;

    if (i === termWeeks) {
      // Last installment: clear remaining balance
      if (calculationType === 'FLAT' || weeklyRate === 0) {
        interest = Math.round(principal * weeklyRate * 100) / 100;
        principalAmt = Math.round(balance * 100) / 100;
      } else {
        interest = Math.round(balance * weeklyRate * 100) / 100;
        principalAmt = Math.round(balance * 100) / 100;
      }
      total = Math.round((principalAmt + interest) * 100) / 100;
    } else {
      if (calculationType === 'FLAT' || weeklyRate === 0) {
        principalAmt = Math.round((principal / termWeeks) * 100) / 100;
        interest = Math.round(principal * weeklyRate * 100) / 100;
        total = roundedEmi;
      } else {
        interest = Math.round(balance * weeklyRate * 100) / 100;
        principalAmt = Math.round((roundedEmi - interest) * 100) / 100;
        total = roundedEmi;
      }
      balance = Math.round((balance - principalAmt) * 100) / 100;
    }

    const dueDate = new Date(firstDueDateStr);
    dueDate.setDate(dueDate.getDate() + (i - 1) * 7);

    schedule.push({
      number: i,
      dueDate: dueDate.toISOString().slice(0, 10),
      principalAmount: principalAmt,
      interestAmount: interest,
      totalAmount: total,
    });
  }

  return { schedule, emi: roundedEmi, weeklyRate };
}

function computeMonthlySchedule(
  principal: number,
  annualRate: number,
  termMonths: number,
  firstDueDateStr: string,
): { schedule: Array<{ number: number; dueDate: string; principalAmount: number; interestAmount: number; totalAmount: number }>; monthlyInterest: number } {
  const monthlyInterest = Math.round(principal * (annualRate / 100 / 12) * 100) / 100;
  const [yr, mo, dy] = firstDueDateStr.split('-').map(Number);
  const schedule: Array<{ number: number; dueDate: string; principalAmount: number; interestAmount: number; totalAmount: number }> = [];

  for (let i = 0; i < termMonths; i++) {
    const totalM0 = (mo - 1) + i;
    const year = yr + Math.floor(totalM0 / 12);
    const monthIdx = totalM0 % 12;
    const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
    const day = Math.min(dy, lastDay);
    const dueDate = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    schedule.push({ number: i + 1, dueDate, principalAmount: 0, interestAmount: monthlyInterest, totalAmount: monthlyInterest });
  }

  return { schedule, monthlyInterest };
}

export function computeTermLoanSchedule(
  principal: number,
  annualRate: number,
  termMonths: number,
  firstDueDateStr: string,
  calculationType: 'REDUCING' | 'FLAT',
  emiRounding: number,
): { schedule: Array<{ number: number; dueDate: string; principalAmount: number; interestAmount: number; totalAmount: number }>; emi: number } {
  const monthlyRate = annualRate / 100 / 12;

  let emi: number;
  if (calculationType === 'FLAT') {
    const totalInterest = principal * monthlyRate * termMonths;
    emi = (principal + totalInterest) / termMonths;
  } else {
    emi = monthlyRate === 0
      ? principal / termMonths
      : (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
        (Math.pow(1 + monthlyRate, termMonths) - 1);
  }
  if (emiRounding > 0) emi = Math.ceil(emi / emiRounding) * emiRounding;

  const [yr, mo, dy] = firstDueDateStr.split('-').map(Number);
  let balance = principal;
  const schedule: Array<{ number: number; dueDate: string; principalAmount: number; interestAmount: number; totalAmount: number }> = [];

  for (let i = 0; i < termMonths; i++) {
    const totalM0 = (mo - 1) + i;
    const year = yr + Math.floor(totalM0 / 12);
    const monthIdx = totalM0 % 12;
    const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
    const day = Math.min(dy, lastDay);
    const dueDate = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    let interestAmount: number;
    let principalAmount: number;

    if (calculationType === 'FLAT') {
      interestAmount = Math.round(principal * monthlyRate * 100) / 100;
      principalAmount = i < termMonths - 1
        ? Math.round((principal / termMonths) * 100) / 100
        : Math.round(balance * 100) / 100;
    } else {
      interestAmount = Math.round(balance * monthlyRate * 100) / 100;
      principalAmount = i < termMonths - 1
        ? Math.round((emi - interestAmount) * 100) / 100
        : Math.round(balance * 100) / 100;
    }

    const totalAmount = i < termMonths - 1 ? emi : Math.round((principalAmount + interestAmount) * 100) / 100;
    balance = Math.round((balance - principalAmount) * 100) / 100;

    schedule.push({ number: i + 1, dueDate, principalAmount, interestAmount, totalAmount });
  }

  return { schedule, emi };
}

function generateInstallments(principal: number, annualRate: number, termMonths: number, firstDueDate: Date) {
  const monthlyRate = annualRate / 100 / 12;
  const emi = monthlyRate === 0
    ? principal / termMonths
    : (principal * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / (Math.pow(1 + monthlyRate, termMonths) - 1);

  let balance = principal;
  const installments: Array<{ number: number; dueDate: string; principal: number; interest: number; total: number }> = [];

  for (let i = 1; i <= termMonths; i++) {
    const interestAmt = balance * monthlyRate;
    const principalAmt = i < termMonths ? emi - interestAmt : balance;
    const total = principalAmt + interestAmt;
    balance -= principalAmt;

    const dueDate = new Date(firstDueDate);
    dueDate.setMonth(dueDate.getMonth() + (i - 1));

    installments.push({
      number: i,
      dueDate: dueDate.toISOString().slice(0, 10),
      principal: Math.round(principalAmt * 100) / 100,
      interest: Math.round(interestAmt * 100) / 100,
      total: Math.round(total * 100) / 100,
    });
  }
  return installments;
}

function loanDetailLink(cycleType: string | null | undefined, loanId: string): string {
  switch (cycleType) {
    case 'WEEKLY':
      return `/weekly-loans/${loanId}`;
    case 'DAILY_NO_SUNDAY':
    case 'DAILY_WITH_SUNDAY':
      return `/daily-loans/${loanId}`;
    case 'MONTHLY':
      return `/monthly-loans/${loanId}`;
    case 'AGENT_RISK':
      return `/agent-risk-loans/${loanId}`;
    case 'TERM_LOAN':
    default:
      return `/loans/${loanId}`;
  }
}

@Injectable()
export class TenantLoansService {
  // Schemas that already have interest_rate widened to NUMERIC(7,4)
  private widenedInterestSchemas = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private notifications: TenantNotificationsService,
    private activity: TenantActivityLogService,
  ) {}

  private async withSchema<T>(schemaName: string, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      await this.ensureInterestRatePrecision(client, schemaName);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /** NUMERIC(6,4) only fits ≤99.9999; app allows up to 200% p.a. */
  private async ensureInterestRatePrecision(client: import('pg').PoolClient, schemaName: string): Promise<void> {
    if (this.widenedInterestSchemas.has(schemaName)) return;
    await client.query(`ALTER TABLE loans ALTER COLUMN interest_rate TYPE NUMERIC(7,4)`);
    await client.query(`ALTER TABLE loan_types ALTER COLUMN min_interest_rate TYPE NUMERIC(7,4)`).catch(() => undefined);
    await client.query(`ALTER TABLE loan_types ALTER COLUMN max_interest_rate TYPE NUMERIC(7,4)`).catch(() => undefined);
    await client.query(`ALTER TABLE loans ADD COLUMN IF NOT EXISTS close_comment TEXT`).catch(() => undefined);
    await client.query(`ALTER TABLE loans ADD COLUMN IF NOT EXISTS reopen_comment TEXT`).catch(() => undefined);
    this.widenedInterestSchemas.add(schemaName);
  }

  async list(user: TenantJwtPayload, page: number, limit: number, opts: {
    status?: string; search?: string; branchId?: string; loanTypeId?: string; officerId?: string; customerId?: string;
  } = {}) {
    ({ page, limit } = safePagination(page, limit));
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;

      const conditions: string[] = ['l.deleted_at IS NULL'];
      const filterParams: unknown[] = [];
      let idx = 1;

      // Role-based visibility: Agent (LOAN_OFFICER) sees only their own loans
      if (user.role === 'LOAN_OFFICER') {
        conditions.push(`l.loan_officer_id = $${idx++}`);
        filterParams.push(user.sub);
      }

      if (opts.status) { conditions.push(`l.status = $${idx++}`); filterParams.push(opts.status); }
      if (opts.customerId) { conditions.push(`l.customer_id = $${idx++}`); filterParams.push(opts.customerId); }
      if (opts.branchId) { conditions.push(`l.branch_id = $${idx++}`); filterParams.push(opts.branchId); }
      if (opts.loanTypeId) { conditions.push(`l.loan_type_id = $${idx++}`); filterParams.push(opts.loanTypeId); }
      // Only OWNER/ADMIN/MANAGER can filter by officer; for LOAN_OFFICER it's always self
      if (opts.officerId && user.role !== 'LOAN_OFFICER') {
        conditions.push(`l.loan_officer_id = $${idx++}`);
        filterParams.push(opts.officerId);
      }
      if (opts.search) {
        conditions.push(`(c.first_name || ' ' || c.last_name ILIKE $${idx} OR l.loan_number ILIKE $${idx} OR c.phone ILIKE $${idx})`);
        filterParams.push(`%${opts.search}%`);
        idx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const dataParams = [...filterParams, limit, offset];
      const countParams = [...filterParams];
      const limitIdx = idx;
      const offsetIdx = idx + 1;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate, l.term_months,
                 l.status, l.purpose, l.disbursed_at, l.first_due_date, l.created_at, l.cycle_type,
                 c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
                 COALESCE(SUM(CASE WHEN i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE') THEN i.total_amount - i.paid_amount ELSE 0 END), 0) AS outstanding
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN installments i ON i.loan_id = l.id
          ${whereClause}
          GROUP BY l.id, c.first_name, c.last_name, c.phone
          ORDER BY l.loan_number ASC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, dataParams);
      const countRes = await client.query<{ total: string }>(`
          SELECT COUNT(*) AS total FROM loans l
          JOIN customers c ON c.id = l.customer_id
          ${whereClause}
        `, countParams);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          customerName: r.customer_name, customerPhone: r.customer_phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months, status: r.status, purpose: r.purpose,
          outstanding: parseFloat(r.outstanding),
          disbursedAt: r.disbursed_at, firstDueDate: r.first_due_date, createdAt: r.created_at,
          cycleType: r.cycle_type,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async findOne(user: TenantJwtPayload, id: string) {
    return this.withSchema(user.schemaName, async (client) => {
      // Sequential: a single pg connection cannot run queries concurrently.
      const loanRes = await client.query(`
          SELECT l.*, c.first_name || ' ' || c.last_name AS customer_name,
                 c.phone AS customer_phone, c.id AS customer_id_ref,
                 b.name AS branch_name
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN branches b ON b.id = l.branch_id
          WHERE l.id = $1
        `, [id]);
      const installmentsRes = await client.query(`SELECT * FROM installments WHERE loan_id = $1 ORDER BY installment_number`, [id]);
      const paymentsRes = await client.query(`SELECT * FROM payments WHERE loan_id = $1 ORDER BY created_at DESC`, [id]);

      if (!loanRes.rows[0]) throw new NotFoundException('Loan not found');
      const l = loanRes.rows[0];
      return {
        id: l.id, loanNumber: l.loan_number,
        customerId: l.customer_id_ref, customerName: l.customer_name, customerPhone: l.customer_phone,
        principal: parseFloat(l.principal),
        interestRate: parseFloat(l.interest_rate),
        termMonths: l.term_months, termWeeks: l.term_months,
        status: l.status, purpose: l.purpose,
        cycleType: l.cycle_type,
        calculationType: l.calculation_type,
        emiAmount: l.emi_amount ? parseFloat(l.emi_amount) : null,
        securityDocUrl: l.security_doc_url ?? null,
        promissoryNoteUrl: l.promissory_note_url ?? null,
        branchId: l.branch_id ?? null,
        branchName: l.branch_name ?? null,
        loanTypeId: l.loan_type_id ?? null,
        disbursedAt: l.disbursed_at, firstDueDate: l.first_due_date,
        closedAt: l.closed_at ?? null,
        closeComment: l.close_comment ?? null,
        reopenComment: l.reopen_comment ?? null,
        createdAt: l.created_at, updatedAt: l.updated_at,
        installments: installmentsRes.rows.map((i) => ({
          id: i.id, number: i.installment_number, dueDate: i.due_date,
          principal: parseFloat(i.principal_amount), interest: parseFloat(i.interest_amount),
          total: parseFloat(i.total_amount), paid: parseFloat(i.paid_amount),
          status: i.status, paidAt: i.paid_at,
        })),
        payments: paymentsRes.rows.map((p) => ({
          id: p.id, amount: parseFloat(p.amount),
          method: p.payment_method, referenceNumber: p.reference_number,
          paymentDate: p.payment_date, createdAt: p.created_at,
        })),
      };
    });
  }

  async create(user: TenantJwtPayload, dto: CreateLoanDto) {
    if (!['ADMIN', 'LOAN_OFFICER'].includes(user.role)) throw new ForbiddenException('Only Admins and Loan Officers can create loans');
    if (dto.principal <= 0) throw new BadRequestException('Principal must be positive');
    if (dto.interestRate < 0 || dto.interestRate > 100) throw new BadRequestException('Invalid interest rate');
    if (dto.termMonths < 1 || dto.termMonths > 360) throw new BadRequestException('Term must be 1–360 months');
    if (dto.firstDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dto.firstDueDate)) throw new BadRequestException('firstDueDate must be YYYY-MM-DD');
    assertNoSpecialChars(dto.purpose, 'Loan purpose');

    return this.withSchema(user.schemaName, async (client) => {
      // Validate customer
      const custRes = await client.query(`SELECT id FROM customers WHERE id = $1 AND is_active = TRUE`, [dto.customerId]);
      if (!custRes.rows[0]) throw new NotFoundException('Customer not found');

      // Generate loan number
      const countRes = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM loans`);
      const seq = parseInt(countRes.rows[0].n) + 1;
      const loanNumber = `LN${new Date().getFullYear()}${String(seq).padStart(6, '0')}`;

      // Create loan
      const firstDueDate = dto.firstDueDate
        ? new Date(dto.firstDueDate)
        : new Date(Date.now() + 30 * 86400000);

      const loanRes = await client.query(`
        INSERT INTO loans (loan_number, customer_id, loan_officer_id, branch_id, principal, interest_rate, term_months, status, purpose, first_due_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9)
        RETURNING *
      `, [loanNumber, dto.customerId, user.sub, dto.branchId ?? null, dto.principal, dto.interestRate, dto.termMonths, dto.purpose ?? null, firstDueDate.toISOString().slice(0, 10)]);

      const loan = loanRes.rows[0];

      // Generate and insert installments
      const installments = generateInstallments(dto.principal, dto.interestRate, dto.termMonths, firstDueDate);
      for (const inst of installments) {
        await client.query(`
          INSERT INTO installments (loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [loan.id, inst.number, inst.dueDate, inst.principal, inst.interest, inst.total]);
      }

      const result = {
        id: loan.id, loanNumber: loan.loan_number,
        principal: parseFloat(loan.principal),
        interestRate: parseFloat(loan.interest_rate),
        termMonths: loan.term_months, status: loan.status,
        firstDueDate: loan.first_due_date,
        installmentCount: installments.length,
        monthlyEmi: installments[0]?.total,
      };

      await this.activity.record(client, user, {
        action: 'loan.created',
        entityType: 'loan',
        entityId: loan.id,
        entityLabel: loan.loan_number,
        metadata: { cycleType: 'MONTHLY', principal: result.principal, termMonths: result.termMonths },
      });

      // Notify managers about new loan
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      for (const mgr of mgrsRes.rows) {
        await TenantNotificationsService.insertNotification(client, {
          userId: mgr.id,
          title: `New loan created — ${loanNumber}`,
          body: `${custRes.rows[0] ? '' : ''}Loan of ₹${dto.principal.toLocaleString('en-IN')} created for customer.`,
          type: 'loan',
          entityType: 'loan',
          entityId: loan.id,
          link: `/loans/${loan.id}`,
        });
      }

      return result;
    });
  }

  async closeLoan(user: TenantJwtPayload, loanId: string, dto: { comment?: string } = {}) {
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(user.role)) {
      throw new BadRequestException('Only Owner, Manager or Admin can close a loan');
    }

    const comment = (dto.comment ?? '').trim();
    if (!comment) {
      throw new BadRequestException('Comment is required when closing a loan');
    }
    if (comment.length > 1000) {
      throw new BadRequestException('Comment must be 1000 characters or fewer');
    }

    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query<{
        id: string;
        status: string;
        loan_number: string;
        loan_officer_id: string | null;
        cycle_type: string | null;
        first_name: string | null;
        last_name: string | null;
      }>(
        `SELECT l.id, l.status, l.loan_number, l.loan_officer_id, l.cycle_type,
                c.first_name, c.last_name
         FROM loans l
         LEFT JOIN customers c ON c.id = l.customer_id
         WHERE l.id = $1 AND l.deleted_at IS NULL`,
        [loanId],
      );
      if (!res.rows[0]) throw new NotFoundException('Loan not found');

      const {
        status,
        loan_number: loanNumber,
        loan_officer_id: loanOfficerId,
        cycle_type: cycleType,
        first_name: firstName,
        last_name: lastName,
      } = res.rows[0];
      if (status === 'CLOSED') throw new BadRequestException('Loan is already closed');
      if (!['APPROVED', 'DISBURSED', 'ACTIVE'].includes(status)) {
        throw new BadRequestException(`Cannot close a loan in ${status} status`);
      }

      const duesRes = await client.query<{ outstanding: string; unpaid_count: string }>(
        `SELECT
           COALESCE(SUM(total_amount - paid_amount), 0) AS outstanding,
           COUNT(*) AS unpaid_count
         FROM installments
         WHERE loan_id = $1 AND status IN ('PENDING','PARTIALLY_PAID','OVERDUE')`,
        [loanId],
      );
      const outstanding = parseFloat(duesRes.rows[0]?.outstanding ?? '0');
      const unpaidCount = parseInt(duesRes.rows[0]?.unpaid_count ?? '0', 10);
      const closedWithPendingDues = unpaidCount > 0 || outstanding > 0;

      await client.query(
        `UPDATE loans
         SET status = 'CLOSED', closed_at = NOW(), close_comment = $2, updated_at = NOW()
         WHERE id = $1`,
        [loanId, comment],
      );

      // Mark remaining unpaid installments as WAIVED
      await client.query(
        `UPDATE installments SET status = 'WAIVED'
         WHERE loan_id = $1 AND status IN ('PENDING','PARTIALLY_PAID','OVERDUE')`,
        [loanId],
      );

      await this.activity.record(client, user, {
        action: 'loan.closed',
        entityType: 'loan',
        entityId: loanId,
        entityLabel: loanNumber,
        metadata: {
          previousStatus: status,
          closedWithPendingDues,
          outstanding,
          unpaidInstallments: unpaidCount,
          comment,
        },
      });

      // Notify loan officer + managers (except the person who closed it)
      const notifyIds = new Set<string>();
      if (loanOfficerId) notifyIds.add(loanOfficerId);
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      for (const m of mgrsRes.rows) notifyIds.add(m.id);

      const closerName = `${user.firstName} ${user.lastName}`.trim() || user.email;
      const customerName = [firstName, lastName].filter(Boolean).join(' ') || 'customer';
      const body = closedWithPendingDues
        ? `Closed by ${closerName} for ${customerName}. ₹${outstanding.toLocaleString('en-IN')} outstanding waived across ${unpaidCount} installment${unpaidCount === 1 ? '' : 's'}.`
        : `Closed by ${closerName} for ${customerName} with no pending dues.`;

      for (const uid of notifyIds) {
        await TenantNotificationsService.insertNotification(client, {
          userId: uid,
          title: `Loan closed — ${loanNumber}`,
          body,
          type: 'loan',
          entityType: 'loan',
          entityId: loanId,
          link: loanDetailLink(cycleType, loanId),
        });
      }

      return {
        id: loanId,
        status: 'CLOSED',
        closedAt: new Date(),
        closeComment: comment,
        closedWithPendingDues,
        outstanding,
      };
    });
  }

  async reopenLoan(user: TenantJwtPayload, loanId: string, dto: { comment?: string } = {}) {
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(user.role)) {
      throw new BadRequestException('Only Owner, Manager or Admin can reopen a loan');
    }

    const comment = (dto.comment ?? '').trim();
    if (!comment) {
      throw new BadRequestException('Comment is required when reopening a loan');
    }
    if (comment.length > 1000) {
      throw new BadRequestException('Comment must be 1000 characters or fewer');
    }

    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query<{
        id: string;
        status: string;
        loan_number: string;
        close_comment: string | null;
        loan_officer_id: string | null;
        cycle_type: string | null;
        first_name: string | null;
        last_name: string | null;
      }>(
        `SELECT l.id, l.status, l.loan_number, l.close_comment, l.loan_officer_id, l.cycle_type,
                c.first_name, c.last_name
         FROM loans l
         LEFT JOIN customers c ON c.id = l.customer_id
         WHERE l.id = $1 AND l.deleted_at IS NULL`,
        [loanId],
      );
      if (!res.rows[0]) throw new NotFoundException('Loan not found');

      const {
        status,
        loan_number: loanNumber,
        close_comment: previousCloseComment,
        loan_officer_id: loanOfficerId,
        cycle_type: cycleType,
        first_name: firstName,
        last_name: lastName,
      } = res.rows[0];
      if (status !== 'CLOSED') {
        throw new BadRequestException('Only closed loans can be reopened');
      }

      const waivedRes = await client.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM installments WHERE loan_id = $1 AND status = 'WAIVED'`,
        [loanId],
      );
      const restoredCount = parseInt(waivedRes.rows[0]?.n ?? '0', 10);

      await client.query(
        `UPDATE loans
         SET status = 'DISBURSED',
             closed_at = NULL,
             reopen_comment = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [loanId, comment],
      );

      // Restore previously waived installments based on payment + due date
      await client.query(
        `UPDATE installments
         SET status = (CASE
           WHEN paid_amount >= total_amount THEN 'PAID'
           WHEN paid_amount > 0 THEN 'PARTIALLY_PAID'
           WHEN due_date < CURRENT_DATE THEN 'OVERDUE'
           ELSE 'PENDING'
         END)::installment_status
         WHERE loan_id = $1 AND status = 'WAIVED'`,
        [loanId],
      );

      await this.activity.record(client, user, {
        action: 'loan.reopened',
        entityType: 'loan',
        entityId: loanId,
        entityLabel: loanNumber,
        metadata: {
          comment,
          restoredInstallments: restoredCount,
          previousCloseComment: previousCloseComment ?? null,
        },
      });

      // Notify loan officer + managers (except the person who reopened it)
      const notifyIds = new Set<string>();
      if (loanOfficerId) notifyIds.add(loanOfficerId);
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      for (const m of mgrsRes.rows) notifyIds.add(m.id);

      const reopenerName = `${user.firstName} ${user.lastName}`.trim() || user.email;
      const customerName = [firstName, lastName].filter(Boolean).join(' ') || 'customer';
      const body = `Reopened by ${reopenerName} for ${customerName}. ${restoredCount} installment${restoredCount === 1 ? '' : 's'} restored.`;

      for (const uid of notifyIds) {
        await TenantNotificationsService.insertNotification(client, {
          userId: uid,
          title: `Loan reopened — ${loanNumber}`,
          body,
          type: 'loan',
          entityType: 'loan',
          entityId: loanId,
          link: loanDetailLink(cycleType, loanId),
        });
      }

      return {
        id: loanId,
        status: 'DISBURSED',
        reopenComment: comment,
        restoredInstallments: restoredCount,
      };
    });
  }

  previewWeeklySchedule(dto: Pick<CreateWeeklyLoanDto, 'principal' | 'interestRate' | 'termWeeks' | 'firstDueDate' | 'calculationType' | 'emiRounding'>) {
    const { schedule, emi, weeklyRate } = computeWeeklySchedule(
      dto.principal, dto.interestRate, dto.termWeeks,
      dto.firstDueDate, dto.calculationType, dto.emiRounding,
    );
    const totalInterest = schedule.reduce((s, i) => s + i.interestAmount, 0);
    const totalPayable = schedule.reduce((s, i) => s + i.totalAmount, 0);
    return {
      emi, weeklyRate,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalPayable: Math.round(totalPayable * 100) / 100,
      schedule,
    };
  }

  async listWeeklyLoans(user: TenantJwtPayload, page: number, limit: number, opts: {
    search?: string; branchId?: string; status?: string;
  } = {}) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const conditions: string[] = [`l.deleted_at IS NULL`, `l.cycle_type = 'WEEKLY'`];
      const filterParams: unknown[] = [];
      let idx = 1;

      if (user.role === 'LOAN_OFFICER') {
        conditions.push(`l.loan_officer_id = $${idx++}`);
        filterParams.push(user.sub);
      }
      if (opts.status) { conditions.push(`l.status = $${idx++}`); filterParams.push(opts.status); }
      if (opts.branchId) { conditions.push(`l.branch_id = $${idx++}`); filterParams.push(opts.branchId); }
      if (opts.search) {
        conditions.push(`(c.first_name||' '||c.last_name ILIKE $${idx} OR l.loan_number ILIKE $${idx} OR c.phone ILIKE $${idx})`);
        filterParams.push(`%${opts.search}%`); idx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const dataParams = [...filterParams, limit, offset];
      const limitIdx = idx; const offsetIdx = idx + 1;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate,
                 l.term_months AS term_weeks, l.emi_amount, l.status,
                 l.cycle_type, l.calculation_type,
                 l.disbursed_at, l.first_due_date, l.created_at,
                 l.branch_id, b.name AS branch_name,
                 c.id AS customer_id, c.first_name||' '||c.last_name AS customer_name, c.phone,
                 -- Financial breakdown
                 COALESCE(SUM(CASE WHEN i.status='PAID' THEN i.principal_amount ELSE 0 END)
                   + SUM(CASE WHEN i.status='PARTIALLY_PAID' THEN GREATEST(0,i.paid_amount-i.interest_amount) ELSE 0 END), 0) AS principal_received,
                 COALESCE(SUM(CASE WHEN i.status='PAID' THEN i.interest_amount ELSE 0 END)
                   + SUM(CASE WHEN i.status='PARTIALLY_PAID' THEN LEAST(i.paid_amount,i.interest_amount) ELSE 0 END), 0) AS interest_received,
                 COALESCE(SUM(CASE WHEN i.status IN('PENDING','OVERDUE') THEN i.principal_amount
                   WHEN i.status='PARTIALLY_PAID' THEN i.principal_amount-GREATEST(0,i.paid_amount-i.interest_amount)
                   ELSE 0 END), 0) AS principal_outstanding,
                 COALESCE(SUM(CASE WHEN i.status IN('PENDING','OVERDUE') THEN i.interest_amount
                   WHEN i.status='PARTIALLY_PAID' THEN i.interest_amount-LEAST(i.paid_amount,i.interest_amount)
                   ELSE 0 END), 0) AS interest_outstanding,
                 COUNT(i.id) AS total_installments,
                 COUNT(i.id) FILTER (WHERE i.status='PAID') AS paid_installments,
                 COUNT(i.id) FILTER (WHERE i.status='OVERDUE') AS overdue_count
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN branches b ON b.id = l.branch_id
          LEFT JOIN installments i ON i.loan_id = l.id
          ${whereClause}
          GROUP BY l.id, c.id, c.first_name, c.last_name, c.phone, b.name
          ORDER BY l.loan_number ASC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, dataParams);
      const countRes = await client.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM loans l JOIN customers c ON c.id = l.customer_id ${whereClause}`,
          filterParams,
        );

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          customerId: r.customer_id, customerName: r.customer_name, phone: r.phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termWeeks: r.term_weeks, emiAmount: r.emi_amount ? parseFloat(r.emi_amount) : null,
          status: r.status, cycleType: r.cycle_type, calculationType: r.calculation_type,
          branchId: r.branch_id, branchName: r.branch_name,
          disbursedAt: r.disbursed_at, firstDueDate: r.first_due_date, createdAt: r.created_at,
          principalReceived: parseFloat(r.principal_received),
          interestReceived: parseFloat(r.interest_received),
          principalOutstanding: parseFloat(r.principal_outstanding),
          interestOutstanding: parseFloat(r.interest_outstanding),
          totalInstallments: parseInt(r.total_installments),
          paidInstallments: parseInt(r.paid_installments),
          overdueCount: parseInt(r.overdue_count),
          isNpa: r.status === 'DEFAULTED' || parseInt(r.overdue_count) > 2,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async createWeeklyLoan(user: TenantJwtPayload, dto: CreateWeeklyLoanDto) {
    if (!['ADMIN', 'LOAN_OFFICER'].includes(user.role)) throw new ForbiddenException('Only Admins and Loan Officers can create loans');
    if (dto.principal <= 0) throw new BadRequestException('Principal must be positive');
    if (dto.interestRate < 0 || dto.interestRate > 200) throw new BadRequestException('Invalid interest rate');
    if (dto.termWeeks < 1 || dto.termWeeks > 99) throw new BadRequestException('Term must be 1–99 weeks');
    if (!dto.firstDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dto.firstDueDate)) throw new BadRequestException('firstDueDate must be YYYY-MM-DD');
    if (!['FLAT', 'REDUCING'].includes(dto.calculationType)) throw new BadRequestException('calculationType must be FLAT or REDUCING');
    assertNoSpecialChars(dto.purpose, 'Loan purpose');

    return this.withSchema(user.schemaName, async (client) => {
      const custRes = await client.query(`SELECT id, first_name, last_name FROM customers WHERE id = $1 AND is_active = TRUE`, [dto.customerId]);
      if (!custRes.rows[0]) throw new NotFoundException('Customer not found');

      const countRes = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM loans`);
      const seq = parseInt(countRes.rows[0].n) + 1;
      const loanNumber = `WL${new Date().getFullYear()}${String(seq).padStart(6, '0')}`;

      const { schedule, emi } = computeWeeklySchedule(
        dto.principal, dto.interestRate, dto.termWeeks,
        dto.firstDueDate, dto.calculationType, dto.emiRounding,
      );

      const loanRes = await client.query(`
        INSERT INTO loans (
          loan_number, customer_id, loan_officer_id, branch_id, loan_type_id,
          principal, interest_rate, term_months, status, purpose,
          first_due_date, cycle_type, calculation_type, emi_amount,
          security_doc_url, promissory_note_url
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'DISBURSED',$9,$10,'WEEKLY',$11,$12,$13,$14)
        RETURNING *
      `, [
        loanNumber, dto.customerId, user.sub, dto.branchId ?? null, dto.loanTypeId ?? null,
        dto.principal, dto.interestRate, dto.termWeeks, dto.purpose ?? null,
        dto.firstDueDate, dto.calculationType, emi,
        dto.securityDocUrl ?? null, dto.promissoryNoteUrl ?? null,
      ]);

      const loan = loanRes.rows[0];

      for (const inst of schedule) {
        await client.query(`
          INSERT INTO installments (loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [loan.id, inst.number, inst.dueDate, inst.principalAmount, inst.interestAmount, inst.totalAmount]);
      }

      // Notify managers
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      const custName = `${custRes.rows[0].first_name} ${custRes.rows[0].last_name}`;
      for (const mgr of mgrsRes.rows) {
        await TenantNotificationsService.insertNotification(client, {
          userId: mgr.id,
          title: `New weekly loan — ${loanNumber}`,
          body: `₹${dto.principal.toLocaleString('en-IN')} weekly loan created for ${custName}.`,
          type: 'loan', entityType: 'loan', entityId: loan.id,
          link: `/weekly-loans/${loan.id}`,
        });
      }

      await this.activity.record(client, user, {
        action: 'loan.created',
        entityType: 'loan',
        entityId: loan.id,
        entityLabel: loanNumber,
        metadata: { cycleType: 'WEEKLY', principal: dto.principal, termWeeks: dto.termWeeks },
      });

      return {
        id: loan.id, loanNumber, principal: dto.principal,
        emi, termWeeks: dto.termWeeks, installmentCount: schedule.length,
        firstDueDate: dto.firstDueDate, status: 'DISBURSED',
      };
    });
  }

  // ── DAILY LOANS ──────────────────────────────────────────────────────────────

  previewDailySchedule(dto: Pick<CreateDailyLoanDto, 'principal' | 'interestRate' | 'termDays' | 'firstDueDate' | 'calculationType' | 'emiRounding' | 'cycleType'>) {
    const { schedule, emi, dailyRate } = computeDailySchedule(
      dto.principal, dto.interestRate, dto.termDays,
      dto.firstDueDate, dto.calculationType, dto.emiRounding, dto.cycleType,
    );
    const totalInterest = schedule.reduce((s, i) => s + i.interestAmount, 0);
    const totalPayable = schedule.reduce((s, i) => s + i.totalAmount, 0);
    return {
      emi, dailyRate,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalPayable: Math.round(totalPayable * 100) / 100,
      schedule,
    };
  }

  async listDailyLoans(user: TenantJwtPayload, page: number, limit: number, opts: {
    search?: string; branchId?: string; status?: string; cycleType?: string;
  } = {}) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const conditions: string[] = [
        `l.deleted_at IS NULL`,
        `l.cycle_type IN ('DAILY_NO_SUNDAY','DAILY_WITH_SUNDAY')`,
      ];
      const filterParams: unknown[] = [];
      let idx = 1;

      if (user.role === 'LOAN_OFFICER') { conditions.push(`l.loan_officer_id = $${idx++}`); filterParams.push(user.sub); }
      if (opts.status)    { conditions.push(`l.status = $${idx++}`);    filterParams.push(opts.status); }
      if (opts.branchId)  { conditions.push(`l.branch_id = $${idx++}`); filterParams.push(opts.branchId); }
      if (opts.cycleType) { conditions.push(`l.cycle_type = $${idx++}`); filterParams.push(opts.cycleType); }
      if (opts.search) {
        conditions.push(`(c.first_name||' '||c.last_name ILIKE $${idx} OR l.loan_number ILIKE $${idx} OR c.phone ILIKE $${idx})`);
        filterParams.push(`%${opts.search}%`); idx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const dataParams = [...filterParams, limit, offset];
      const limitIdx = idx; const offsetIdx = idx + 1;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate,
                 l.term_months AS term_days, l.emi_amount, l.status,
                 l.cycle_type, l.calculation_type,
                 l.disbursed_at, l.first_due_date, l.created_at,
                 l.branch_id, b.name AS branch_name,
                 c.id AS customer_id, c.first_name||' '||c.last_name AS customer_name, c.phone,
                 COALESCE(SUM(CASE WHEN i.status='PAID' THEN i.principal_amount ELSE 0 END)
                   + SUM(CASE WHEN i.status='PARTIALLY_PAID' THEN GREATEST(0,i.paid_amount-i.interest_amount) ELSE 0 END), 0) AS principal_received,
                 COALESCE(SUM(CASE WHEN i.status='PAID' THEN i.interest_amount ELSE 0 END)
                   + SUM(CASE WHEN i.status='PARTIALLY_PAID' THEN LEAST(i.paid_amount,i.interest_amount) ELSE 0 END), 0) AS interest_received,
                 COALESCE(SUM(CASE WHEN i.status IN('PENDING','OVERDUE') THEN i.principal_amount
                   WHEN i.status='PARTIALLY_PAID' THEN i.principal_amount-GREATEST(0,i.paid_amount-i.interest_amount)
                   ELSE 0 END), 0) AS principal_outstanding,
                 COALESCE(SUM(CASE WHEN i.status IN('PENDING','OVERDUE') THEN i.interest_amount
                   WHEN i.status='PARTIALLY_PAID' THEN i.interest_amount-LEAST(i.paid_amount,i.interest_amount)
                   ELSE 0 END), 0) AS interest_outstanding,
                 COUNT(i.id) AS total_installments,
                 COUNT(i.id) FILTER (WHERE i.status='PAID') AS paid_installments,
                 COUNT(i.id) FILTER (WHERE i.status='OVERDUE') AS overdue_count
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN branches b ON b.id = l.branch_id
          LEFT JOIN installments i ON i.loan_id = l.id
          ${whereClause}
          GROUP BY l.id, c.id, c.first_name, c.last_name, c.phone, b.name
          ORDER BY l.loan_number ASC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, dataParams);
      const countRes = await client.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM loans l JOIN customers c ON c.id = l.customer_id ${whereClause}`,
          filterParams,
        );

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          customerId: r.customer_id, customerName: r.customer_name, phone: r.phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termDays: r.term_days, emiAmount: r.emi_amount ? parseFloat(r.emi_amount) : null,
          status: r.status, cycleType: r.cycle_type, calculationType: r.calculation_type,
          branchId: r.branch_id, branchName: r.branch_name,
          disbursedAt: r.disbursed_at, firstDueDate: r.first_due_date, createdAt: r.created_at,
          principalReceived: parseFloat(r.principal_received),
          interestReceived: parseFloat(r.interest_received),
          principalOutstanding: parseFloat(r.principal_outstanding),
          interestOutstanding: parseFloat(r.interest_outstanding),
          totalInstallments: parseInt(r.total_installments),
          paidInstallments: parseInt(r.paid_installments),
          overdueCount: parseInt(r.overdue_count),
          isNpa: r.status === 'DEFAULTED' || parseInt(r.overdue_count) > 2,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async createDailyLoan(user: TenantJwtPayload, dto: CreateDailyLoanDto) {
    if (!['ADMIN', 'LOAN_OFFICER'].includes(user.role)) throw new ForbiddenException('Only Admins and Loan Officers can create loans');
    if (dto.principal <= 0) throw new BadRequestException('Principal must be positive');
    if (dto.interestRate < 0 || dto.interestRate > 200) throw new BadRequestException('Invalid interest rate');
    if (dto.termDays < 1 || dto.termDays > 3650) throw new BadRequestException('Term must be 1–3650 days');
    if (!dto.firstDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dto.firstDueDate)) throw new BadRequestException('firstDueDate must be YYYY-MM-DD');
    if (!['FLAT', 'REDUCING'].includes(dto.calculationType)) throw new BadRequestException('calculationType must be FLAT or REDUCING');
    if (!['DAILY_NO_SUNDAY', 'DAILY_WITH_SUNDAY'].includes(dto.cycleType)) throw new BadRequestException('cycleType must be DAILY_NO_SUNDAY or DAILY_WITH_SUNDAY');
    assertNoSpecialChars(dto.purpose, 'Loan purpose');

    return this.withSchema(user.schemaName, async (client) => {
      const custRes = await client.query(`SELECT id, first_name, last_name FROM customers WHERE id = $1 AND is_active = TRUE`, [dto.customerId]);
      if (!custRes.rows[0]) throw new NotFoundException('Customer not found');

      const countRes = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM loans`);
      const seq = parseInt(countRes.rows[0].n) + 1;
      const loanNumber = `DL${new Date().getFullYear()}${String(seq).padStart(6, '0')}`;

      const { schedule, emi } = computeDailySchedule(
        dto.principal, dto.interestRate, dto.termDays,
        dto.firstDueDate, dto.calculationType, dto.emiRounding, dto.cycleType,
      );

      const loanRes = await client.query(`
        INSERT INTO loans (
          loan_number, customer_id, loan_officer_id, branch_id, loan_type_id,
          principal, interest_rate, term_months, status, purpose,
          first_due_date, cycle_type, calculation_type, emi_amount,
          security_doc_url, promissory_note_url
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'DISBURSED',$9,$10,$11,$12,$13,$14,$15)
        RETURNING *
      `, [
        loanNumber, dto.customerId, user.sub, dto.branchId ?? null, dto.loanTypeId ?? null,
        dto.principal, dto.interestRate, dto.termDays, dto.purpose ?? null,
        dto.firstDueDate, dto.cycleType, dto.calculationType, emi,
        dto.securityDocUrl ?? null, dto.promissoryNoteUrl ?? null,
      ]);

      const loan = loanRes.rows[0];
      for (const inst of schedule) {
        await client.query(`
          INSERT INTO installments (loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [loan.id, inst.number, inst.dueDate, inst.principalAmount, inst.interestAmount, inst.totalAmount]);
      }

      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      const custName = `${custRes.rows[0].first_name} ${custRes.rows[0].last_name}`;
      const cycleLabel = dto.cycleType === 'DAILY_NO_SUNDAY' ? 'daily (no sun)' : 'daily';
      for (const mgr of mgrsRes.rows) {
        await TenantNotificationsService.insertNotification(client, {
          userId: mgr.id,
          title: `New ${cycleLabel} loan — ${loanNumber}`,
          body: `₹${dto.principal.toLocaleString('en-IN')} ${cycleLabel} loan created for ${custName}.`,
          type: 'loan', entityType: 'loan', entityId: loan.id,
          link: `/daily-loans/${loan.id}`,
        });
      }

      await this.activity.record(client, user, {
        action: 'loan.created',
        entityType: 'loan',
        entityId: loan.id,
        entityLabel: loanNumber,
        metadata: { cycleType: dto.cycleType, principal: dto.principal, termDays: dto.termDays },
      });

      return {
        id: loan.id, loanNumber, principal: dto.principal,
        emi, termDays: dto.termDays, installmentCount: schedule.length,
        firstDueDate: dto.firstDueDate, status: 'DISBURSED',
      };
    });
  }

  // ── MONTHLY LOANS ─────────────────────────────────────────────────────────────

  previewMonthlySchedule(dto: Pick<CreateMonthlyLoanDto, 'principal' | 'interestRate' | 'termMonths' | 'firstDueDate'>) {
    const { schedule, monthlyInterest } = computeMonthlySchedule(
      dto.principal, dto.interestRate, dto.termMonths, dto.firstDueDate,
    );
    return {
      monthlyInterest,
      totalInterest: Math.round(monthlyInterest * dto.termMonths * 100) / 100,
      schedule,
    };
  }

  async listMonthlyLoans(user: TenantJwtPayload, page: number, limit: number, opts: {
    search?: string; branchId?: string; status?: string;
  } = {}) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const conditions: string[] = [
        `l.deleted_at IS NULL`,
        `l.cycle_type = 'MONTHLY'`,
      ];
      const filterParams: unknown[] = [];
      let idx = 1;

      if (user.role === 'LOAN_OFFICER') { conditions.push(`l.loan_officer_id = $${idx++}`); filterParams.push(user.sub); }
      if (opts.status)   { conditions.push(`l.status = $${idx++}`);    filterParams.push(opts.status); }
      if (opts.branchId) { conditions.push(`l.branch_id = $${idx++}`); filterParams.push(opts.branchId); }
      if (opts.search) {
        conditions.push(`(c.first_name||' '||c.last_name ILIKE $${idx} OR l.loan_number ILIKE $${idx} OR c.phone ILIKE $${idx})`);
        filterParams.push(`%${opts.search}%`); idx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const dataParams = [...filterParams, limit, offset];
      const limitIdx = idx; const offsetIdx = idx + 1;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate,
                 l.term_months, l.emi_amount, l.status,
                 l.disbursed_at, l.first_due_date, l.created_at,
                 l.branch_id, b.name AS branch_name,
                 c.id AS customer_id, c.first_name||' '||c.last_name AS customer_name, c.phone,
                 COALESCE(SUM(CASE WHEN i.status='PAID' THEN i.interest_amount ELSE 0 END)
                   + SUM(CASE WHEN i.status='PARTIALLY_PAID' THEN LEAST(i.paid_amount,i.interest_amount) ELSE 0 END), 0) AS interest_received,
                 COALESCE(SUM(CASE WHEN i.status IN('PENDING','OVERDUE') THEN i.interest_amount
                   WHEN i.status='PARTIALLY_PAID' THEN i.interest_amount-LEAST(i.paid_amount,i.interest_amount)
                   ELSE 0 END), 0) AS interest_outstanding,
                 COUNT(i.id) AS total_installments,
                 COUNT(i.id) FILTER (WHERE i.status='PAID') AS paid_installments,
                 COUNT(i.id) FILTER (WHERE i.status='OVERDUE') AS overdue_count
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN branches b ON b.id = l.branch_id
          LEFT JOIN installments i ON i.loan_id = l.id
          ${whereClause}
          GROUP BY l.id, c.id, c.first_name, c.last_name, c.phone, b.name
          ORDER BY l.loan_number ASC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, dataParams);
      const countRes = await client.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM loans l JOIN customers c ON c.id = l.customer_id ${whereClause}`,
          filterParams,
        );

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          customerId: r.customer_id, customerName: r.customer_name, phone: r.phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months,
          monthlyInterest: r.emi_amount ? parseFloat(r.emi_amount) : null,
          status: r.status,
          branchId: r.branch_id, branchName: r.branch_name,
          disbursedAt: r.disbursed_at, firstDueDate: r.first_due_date, createdAt: r.created_at,
          principalOutstanding: parseFloat(r.principal),
          interestReceived: parseFloat(r.interest_received),
          interestOutstanding: parseFloat(r.interest_outstanding),
          totalInstallments: parseInt(r.total_installments),
          paidInstallments: parseInt(r.paid_installments),
          overdueCount: parseInt(r.overdue_count),
          isNpa: r.status === 'DEFAULTED' || parseInt(r.overdue_count) > 2,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async createMonthlyLoan(user: TenantJwtPayload, dto: CreateMonthlyLoanDto) {
    if (!['ADMIN', 'LOAN_OFFICER'].includes(user.role)) throw new ForbiddenException('Only Admins and Loan Officers can create loans');
    if (dto.principal <= 0) throw new BadRequestException('Principal must be positive');
    if (dto.interestRate < 0) throw new BadRequestException('Invalid interest rate');
    if (dto.termMonths < 1 || dto.termMonths > 360) throw new BadRequestException('Term must be 1–360 months');
    if (!dto.firstDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dto.firstDueDate)) throw new BadRequestException('firstDueDate must be YYYY-MM-DD');
    assertNoSpecialChars(dto.purpose, 'Loan purpose');

    return this.withSchema(user.schemaName, async (client) => {
      const custRes = await client.query(`SELECT id FROM customers WHERE id = $1 AND is_active = TRUE`, [dto.customerId]);
      if (!custRes.rows[0]) throw new NotFoundException('Customer not found');
      if (dto.branchId) {
        const brRes = await client.query(`SELECT id FROM branches WHERE id = $1 AND is_active = TRUE`, [dto.branchId]);
        if (!brRes.rows[0]) throw new NotFoundException('Branch not found');
      }

      const countRes = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM loans WHERE cycle_type = 'MONTHLY'`);
      const seq = parseInt(countRes.rows[0].n) + 1;
      const loanNumber = `ML${new Date().getFullYear()}${String(seq).padStart(6, '0')}`;

      const { schedule, monthlyInterest } = computeMonthlySchedule(
        dto.principal, dto.interestRate, dto.termMonths, dto.firstDueDate,
      );

      const loanRes = await client.query(`
        INSERT INTO loans (
          loan_number, customer_id, loan_officer_id, branch_id, loan_type_id,
          principal, interest_rate, term_months, emi_amount,
          cycle_type, status, purpose, first_due_date,
          security_doc_url, promissory_note_url, disbursed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MONTHLY','DISBURSED',$10,$11,$12,$13,NOW())
        RETURNING *
      `, [
        loanNumber, dto.customerId, user.sub, dto.branchId || null, dto.loanTypeId ?? null,
        dto.principal, dto.interestRate, dto.termMonths, monthlyInterest,
        dto.purpose ?? null, dto.firstDueDate,
        dto.securityDocUrl ?? null, dto.promissoryNoteUrl ?? null,
]);

      const loan = loanRes.rows[0];

      for (const inst of schedule) {
        await client.query(`
          INSERT INTO installments (loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [loan.id, inst.number, inst.dueDate, inst.principalAmount, inst.interestAmount, inst.totalAmount]);
      }

      const custNameRes = await client.query<{ name: string }>(
        `SELECT first_name || ' ' || last_name AS name FROM customers WHERE id = $1`, [dto.customerId],
      );
      const custName = custNameRes.rows[0]?.name ?? 'Customer';
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      for (const mgr of mgrsRes.rows) {
        await TenantNotificationsService.insertNotification(client, {
          userId: mgr.id,
          title: `New Monthly loan — ${loanNumber}`,
          body: `₹${dto.principal.toLocaleString('en-IN')} monthly loan created for ${custName}.`,
          type: 'loan', entityType: 'loan', entityId: loan.id,
          link: `/monthly-loans/${loan.id}`,
        });
      }

      await this.activity.record(client, user, {
        action: 'loan.created',
        entityType: 'loan',
        entityId: loan.id,
        entityLabel: loanNumber,
        metadata: { cycleType: 'MONTHLY', principal: dto.principal, termMonths: dto.termMonths },
      });

      return {
        id: loan.id, loanNumber, principal: dto.principal,
        monthlyInterest, termMonths: dto.termMonths,
        installmentCount: schedule.length,
        firstDueDate: dto.firstDueDate, status: 'DISBURSED',
      };
    });
  }

  // ── AGENT RISK LOANS ──────────────────────────────────────────────────────────

  previewAgentRiskSchedule(dto: Pick<CreateAgentRiskLoanDto, 'principal' | 'interestRate' | 'termMonths' | 'firstDueDate'>) {
    const { schedule, monthlyInterest } = computeMonthlySchedule(
      dto.principal, dto.interestRate, dto.termMonths, dto.firstDueDate,
    );
    return {
      monthlyInterest,
      totalInterest: Math.round(monthlyInterest * dto.termMonths * 100) / 100,
      schedule,
    };
  }

  async listAgentRiskLoans(user: TenantJwtPayload, page: number, limit: number, opts: {
    search?: string; branchId?: string; status?: string;
  } = {}) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const conditions: string[] = [`l.deleted_at IS NULL`, `l.cycle_type = 'AGENT_RISK'`];
      const filterParams: unknown[] = [];
      let idx = 1;

      if (user.role === 'LOAN_OFFICER') { conditions.push(`l.loan_officer_id = $${idx++}`); filterParams.push(user.sub); }
      if (opts.status)   { conditions.push(`l.status = $${idx++}`);    filterParams.push(opts.status); }
      if (opts.branchId) { conditions.push(`l.branch_id = $${idx++}`); filterParams.push(opts.branchId); }
      if (opts.search) {
        conditions.push(`(c.first_name||' '||c.last_name ILIKE $${idx} OR l.loan_number ILIKE $${idx} OR c.phone ILIKE $${idx})`);
        filterParams.push(`%${opts.search}%`); idx++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;
      const dataParams = [...filterParams, limit, offset];
      const limitIdx = idx; const offsetIdx = idx + 1;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate,
                 l.term_months, l.emi_amount, l.status,
                 l.disbursed_at, l.first_due_date, l.created_at,
                 l.branch_id, b.name AS branch_name,
                 c.id AS customer_id, c.first_name||' '||c.last_name AS customer_name, c.phone,
                 COALESCE(SUM(CASE WHEN i.status='PAID' THEN i.interest_amount ELSE 0 END)
                   + SUM(CASE WHEN i.status='PARTIALLY_PAID' THEN LEAST(i.paid_amount,i.interest_amount) ELSE 0 END), 0) AS interest_received,
                 COALESCE(SUM(CASE WHEN i.status IN('PENDING','OVERDUE') THEN i.interest_amount
                   WHEN i.status='PARTIALLY_PAID' THEN i.interest_amount-LEAST(i.paid_amount,i.interest_amount)
                   ELSE 0 END), 0) AS interest_outstanding,
                 COUNT(i.id) AS total_installments,
                 COUNT(i.id) FILTER (WHERE i.status='PAID') AS paid_installments,
                 COUNT(i.id) FILTER (WHERE i.status='OVERDUE') AS overdue_count
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN branches b ON b.id = l.branch_id
          LEFT JOIN installments i ON i.loan_id = l.id
          ${whereClause}
          GROUP BY l.id, c.id, c.first_name, c.last_name, c.phone, b.name
          ORDER BY l.loan_number ASC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, dataParams);
      const countRes = await client.query<{ total: string }>(
          `SELECT COUNT(*) AS total FROM loans l JOIN customers c ON c.id = l.customer_id ${whereClause}`,
          filterParams,
        );

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          customerId: r.customer_id, customerName: r.customer_name, phone: r.phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months,
          monthlyInterest: r.emi_amount ? parseFloat(r.emi_amount) : null,
          status: r.status,
          branchId: r.branch_id, branchName: r.branch_name,
          disbursedAt: r.disbursed_at, firstDueDate: r.first_due_date, createdAt: r.created_at,
          principalOutstanding: parseFloat(r.principal),
          interestReceived: parseFloat(r.interest_received),
          interestOutstanding: parseFloat(r.interest_outstanding),
          totalInstallments: parseInt(r.total_installments),
          paidInstallments: parseInt(r.paid_installments),
          overdueCount: parseInt(r.overdue_count),
          isNpa: r.status === 'DEFAULTED' || parseInt(r.overdue_count) > 2,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async createAgentRiskLoan(user: TenantJwtPayload, dto: CreateAgentRiskLoanDto) {
    if (!['ADMIN', 'LOAN_OFFICER'].includes(user.role)) throw new ForbiddenException('Only Admins and Loan Officers can create loans');
    if (dto.principal <= 0) throw new BadRequestException('Principal must be positive');
    if (dto.interestRate < 0) throw new BadRequestException('Invalid interest rate');
    if (dto.termMonths < 1 || dto.termMonths > 360) throw new BadRequestException('Term must be 1–360 months');
    assertNoSpecialChars(dto.purpose, 'Loan purpose');

    return this.withSchema(user.schemaName, async (client) => {
      const custRes = await client.query(`SELECT id FROM customers WHERE id = $1 AND is_active = TRUE`, [dto.customerId]);
      if (!custRes.rows[0]) throw new NotFoundException('Customer not found');
      if (dto.branchId) {
        const brRes = await client.query(`SELECT id FROM branches WHERE id = $1 AND is_active = TRUE`, [dto.branchId]);
        if (!brRes.rows[0]) throw new NotFoundException('Branch not found');
      }

      const countRes = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM loans WHERE cycle_type = 'AGENT_RISK'`);
      const seq = parseInt(countRes.rows[0].n) + 1;
      const loanNumber = `AR${new Date().getFullYear()}${String(seq).padStart(6, '0')}`;

      const { schedule, monthlyInterest } = computeMonthlySchedule(
        dto.principal, dto.interestRate, dto.termMonths, dto.firstDueDate,
      );

      const loanRes = await client.query(`
        INSERT INTO loans (
          loan_number, customer_id, loan_officer_id, branch_id, loan_type_id,
          principal, interest_rate, term_months, emi_amount,
          cycle_type, status, purpose, first_due_date,
          security_doc_url, promissory_note_url, disbursed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AGENT_RISK','DISBURSED',$10,$11,$12,$13,NOW())
        RETURNING *
      `, [
        loanNumber, dto.customerId, user.sub, dto.branchId || null, dto.loanTypeId ?? null,
        dto.principal, dto.interestRate, dto.termMonths, monthlyInterest,
        dto.purpose ?? null, dto.firstDueDate,
        dto.securityDocUrl ?? null, dto.promissoryNoteUrl ?? null,
]);

      const loan = loanRes.rows[0];

      for (const inst of schedule) {
        await client.query(`
          INSERT INTO installments (loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [loan.id, inst.number, inst.dueDate, inst.principalAmount, inst.interestAmount, inst.totalAmount]);
      }

      const custNameRes = await client.query<{ name: string }>(
        `SELECT first_name || ' ' || last_name AS name FROM customers WHERE id = $1`, [dto.customerId],
      );
      const custName = custNameRes.rows[0]?.name ?? 'Customer';
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      for (const mgr of mgrsRes.rows) {
        await TenantNotificationsService.insertNotification(client, {
          userId: mgr.id,
          title: `New Agent Risk loan — ${loanNumber}`,
          body: `₹${dto.principal.toLocaleString('en-IN')} agent risk loan created for ${custName}.`,
          type: 'loan', entityType: 'loan', entityId: loan.id,
          link: `/agent-risk-loans/${loan.id}`,
        });
      }

      await this.activity.record(client, user, {
        action: 'loan.created',
        entityType: 'loan',
        entityId: loan.id,
        entityLabel: loanNumber,
        metadata: { cycleType: 'AGENT_RISK', principal: dto.principal, termMonths: dto.termMonths },
      });

      return {
        id: loan.id, loanNumber, principal: dto.principal,
        monthlyInterest, termMonths: dto.termMonths,
        installmentCount: schedule.length,
        firstDueDate: dto.firstDueDate, status: 'DISBURSED',
      };
    });
  }

  previewTermLoanSchedule(dto: Pick<CreateTermLoanDto, 'principal' | 'interestRate' | 'termMonths' | 'firstDueDate' | 'calculationType' | 'emiRounding'>) {
    const { schedule, emi } = computeTermLoanSchedule(
      dto.principal, dto.interestRate, dto.termMonths, dto.firstDueDate, dto.calculationType, dto.emiRounding,
    );
    return {
      emi,
      totalInterest: Math.round(schedule.reduce((s, i) => s + i.interestAmount, 0) * 100) / 100,
      totalAmount: Math.round(schedule.reduce((s, i) => s + i.totalAmount, 0) * 100) / 100,
      schedule,
    };
  }

  async listTermLoans(user: TenantJwtPayload, page: number, limit: number, opts: {
    search?: string; branchId?: string; status?: string;
  } = {}) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const conditions = [`l.deleted_at IS NULL`, `l.cycle_type = 'TERM_LOAN'`];
      const filterParams: unknown[] = [];
      let idx = 1;

      if (user.role === 'LOAN_OFFICER') { conditions.push(`l.loan_officer_id = $${idx++}`); filterParams.push(user.sub); }
      if (opts.status) { conditions.push(`l.status = $${idx++}`); filterParams.push(opts.status); }
      if (opts.branchId) { conditions.push(`l.branch_id = $${idx++}`); filterParams.push(opts.branchId); }
      if (opts.search) {
        conditions.push(`(c.first_name || ' ' || c.last_name ILIKE $${idx} OR l.loan_number ILIKE $${idx} OR c.phone ILIKE $${idx})`);
        filterParams.push(`%${opts.search}%`); idx++;
      }

      const where = `WHERE ${conditions.join(' AND ')}`;
      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT l.id, l.loan_number, l.customer_id, l.principal, l.interest_rate,
                 l.term_months, l.emi_amount, l.status, l.disbursed_at, l.first_due_date,
                 l.calculation_type, l.branch_id, l.created_at,
                 c.first_name || ' ' || c.last_name AS customer_name, c.phone,
                 b.name AS branch_name,
                 COALESCE(SUM(CASE WHEN i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE') THEN i.total_amount - i.paid_amount ELSE 0 END), 0) AS outstanding,
                 COUNT(CASE WHEN i.status IN ('PAID','PARTIALLY_PAID') AND i.paid_amount >= i.total_amount THEN 1 END) AS paid_count,
                 COUNT(i.id) AS total_count,
                 COUNT(CASE WHEN i.status = 'OVERDUE' THEN 1 END) AS overdue_count
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN branches b ON b.id = l.branch_id
          LEFT JOIN installments i ON i.loan_id = l.id
          ${where}
          GROUP BY l.id, c.first_name, c.last_name, c.phone, b.name
          ORDER BY l.loan_number ASC
          LIMIT $${idx} OFFSET $${idx + 1}
        `, [...filterParams, limit, offset]);
      const countRes = await client.query<{ total: string }>(`
          SELECT COUNT(*) AS total FROM loans l
          JOIN customers c ON c.id = l.customer_id
          ${where}
        `, filterParams);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number, customerId: r.customer_id,
          customerName: r.customer_name, phone: r.phone,
          principal: parseFloat(r.principal), interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months, emi: r.emi_amount ? parseFloat(r.emi_amount) : null,
          status: r.status, branchId: r.branch_id, branchName: r.branch_name,
          calculationType: r.calculation_type,
          outstanding: parseFloat(r.outstanding),
          paidInstallments: parseInt(r.paid_count), totalInstallments: parseInt(r.total_count),
          overdueCount: parseInt(r.overdue_count),
          isNpa: r.status === 'DEFAULTED' || parseInt(r.overdue_count) > 2,
          disbursedAt: r.disbursed_at, firstDueDate: r.first_due_date, createdAt: r.created_at,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async createTermLoan(user: TenantJwtPayload, dto: CreateTermLoanDto) {
    if (!['ADMIN', 'LOAN_OFFICER'].includes(user.role)) throw new ForbiddenException('Only Admins and Loan Officers can create loans');
    if (dto.principal <= 0) throw new BadRequestException('Principal must be positive');
    if (dto.interestRate < 0 || dto.interestRate > 100) throw new BadRequestException('Invalid interest rate');
    if (dto.termMonths < 1 || dto.termMonths > 360) throw new BadRequestException('Term must be 1–360 months');
    assertNoSpecialChars(dto.purpose, 'Loan purpose');

    return this.withSchema(user.schemaName, async (client) => {
      const custRes = await client.query(`SELECT id FROM customers WHERE id = $1 AND is_active = TRUE`, [dto.customerId]);
      if (!custRes.rows[0]) throw new NotFoundException('Customer not found');
      if (dto.branchId) {
        const brRes = await client.query(`SELECT id FROM branches WHERE id = $1 AND is_active = TRUE`, [dto.branchId]);
        if (!brRes.rows[0]) throw new NotFoundException('Branch not found');
      }

      const countRes = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM loans WHERE cycle_type = 'TERM_LOAN'`);
      const seq = parseInt(countRes.rows[0].n) + 1;
      const year = new Date().getFullYear();
      const loanNumber = `TL${year}${String(seq).padStart(6, '0')}`;

      const { schedule, emi } = computeTermLoanSchedule(
        dto.principal, dto.interestRate, dto.termMonths, dto.firstDueDate, dto.calculationType, dto.emiRounding,
      );

      const loanRes = await client.query(`
        INSERT INTO loans (
          loan_number, customer_id, loan_officer_id, branch_id, loan_type_id,
          principal, interest_rate, term_months, emi_amount, status,
          purpose, first_due_date, disbursed_at, cycle_type, calculation_type,
          security_doc_url, promissory_note_url
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'DISBURSED',$10,$11,NOW(),'TERM_LOAN',$12,$13,$14)
        RETURNING id, loan_number
      `, [
        loanNumber, dto.customerId, user.sub, dto.branchId || null, dto.loanTypeId ?? null,
        dto.principal, dto.interestRate, dto.termMonths, emi,
        dto.purpose ?? null, dto.firstDueDate, dto.calculationType,
        dto.securityDocUrl ?? null, dto.promissoryNoteUrl ?? null,
      ]);

      const loan = loanRes.rows[0];

      for (const inst of schedule) {
        await client.query(`
          INSERT INTO installments (loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [loan.id, inst.number, inst.dueDate, inst.principalAmount, inst.interestAmount, inst.totalAmount]);
      }

      const custNameRes = await client.query<{ name: string }>(
        `SELECT first_name || ' ' || last_name AS name FROM customers WHERE id = $1`, [dto.customerId],
      );
      const custName = custNameRes.rows[0]?.name ?? 'Customer';
      const mgrsRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      for (const mgr of mgrsRes.rows) {
        await TenantNotificationsService.insertNotification(client, {
          userId: mgr.id,
          title: `New term loan — ${loanNumber}`,
          body: `₹${dto.principal.toLocaleString('en-IN')} term loan (${dto.termMonths} months) created for ${custName}.`,
          type: 'loan', entityType: 'loan', entityId: loan.id,
          link: `/loans/${loan.id}`,
        });
      }

      await this.activity.record(client, user, {
        action: 'loan.created',
        entityType: 'loan',
        entityId: loan.id,
        entityLabel: loanNumber,
        metadata: { cycleType: 'TERM_LOAN', principal: dto.principal, termMonths: dto.termMonths },
      });

      return {
        id: loan.id, loanNumber, principal: dto.principal, emi,
        termMonths: dto.termMonths, installmentCount: schedule.length,
        firstDueDate: dto.firstDueDate, status: 'DISBURSED',
      };
    });
  }

  async deleteLoan(user: TenantJwtPayload, loanId: string) {
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(user.role)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can delete a loan');
    }
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `SELECT id, status, loan_number FROM loans WHERE id = $1 AND deleted_at IS NULL`,
        [loanId],
      );
      if (!res.rows[0]) throw new NotFoundException('Loan not found');
      if (res.rows[0].status === 'DISBURSED') {
        throw new BadRequestException('Cannot delete an active (DISBURSED) loan. Close it first.');
      }
      await client.query(
        `UPDATE loans SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [loanId],
      );
      await this.activity.record(client, user, {
        action: 'loan.deleted',
        entityType: 'loan',
        entityId: loanId,
        entityLabel: res.rows[0].loan_number,
      });
      return { id: loanId, deleted: true };
    });
  }

  async recordPayment(user: TenantJwtPayload, loanId: string, dto: RecordPaymentDto) {
    if (user.role === 'VIEWER') throw new ForbiddenException('Viewers cannot record payments');

    const VALID_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'NEFT', 'RTGS'];
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('Payment amount must be greater than zero');
    if (!dto.paymentMethod || !VALID_METHODS.includes(dto.paymentMethod)) {
      throw new BadRequestException(`paymentMethod must be one of: ${VALID_METHODS.join(', ')}`);
    }
    if (dto.paymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(dto.paymentDate)) {
      throw new BadRequestException('paymentDate must be YYYY-MM-DD');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (dto.paymentDate && dto.paymentDate > today) {
      throw new BadRequestException('paymentDate cannot be in the future');
    }

    return this.withSchema(user.schemaName, async (client) => {
      const loanRes = await client.query(`SELECT id, status FROM loans WHERE id = $1`, [loanId]);
      if (!loanRes.rows[0]) throw new NotFoundException('Loan not found');
      if (!['APPROVED', 'DISBURSED'].includes(loanRes.rows[0].status)) {
        throw new BadRequestException('Payment can only be recorded on active loans');
      }

      const paymentDate = dto.paymentDate ?? today;

      // Allocate the payment across installments: the target installment first, then — if the
      // amount exceeds its outstanding balance — the excess cascades onto subsequent unpaid
      // installments on the same loan (lets a customer clear more than one EMI in one payment).
      const allocations: { installmentId: string; amount: number }[] = [];

      if (dto.installmentId) {
        const instRes = await client.query(
          `SELECT id, installment_number, status, total_amount, paid_amount FROM installments WHERE id = $1 AND loan_id = $2`,
          [dto.installmentId, loanId],
        );
        if (!instRes.rows[0]) throw new BadRequestException('Installment not found');
        const inst = instRes.rows[0];
        if (inst.status === 'PAID') throw new BadRequestException('This installment has already been fully paid');

        let remaining = dto.amount;
        const targetOutstanding = parseFloat(inst.total_amount) - parseFloat(inst.paid_amount);
        const applyToTarget = Math.min(remaining, targetOutstanding);
        allocations.push({ installmentId: inst.id, amount: applyToTarget });
        remaining = Math.round((remaining - applyToTarget) * 100) / 100;

        if (remaining > 0.01) {
          const nextRes = await client.query<{ id: string; total_amount: string; paid_amount: string }>(
            `SELECT id, total_amount, paid_amount FROM installments
             WHERE loan_id = $1 AND installment_number > $2 AND status IN ('PENDING','PARTIALLY_PAID','OVERDUE')
             ORDER BY installment_number ASC`,
            [loanId, inst.installment_number],
          );
          for (const next of nextRes.rows) {
            if (remaining <= 0.01) break;
            const outstanding = parseFloat(next.total_amount) - parseFloat(next.paid_amount);
            const apply = Math.min(remaining, outstanding);
            if (apply <= 0) continue;
            allocations.push({ installmentId: next.id, amount: apply });
            remaining = Math.round((remaining - apply) * 100) / 100;
          }
          if (remaining > 0.01) {
            throw new BadRequestException(`Amount exceeds total outstanding on this loan by ₹${remaining.toFixed(2)}`);
          }
        }
      }

      let paymentId = '';
      if (allocations.length > 0) {
        for (const a of allocations) {
          const payRes = await client.query(`
            INSERT INTO payments (loan_id, installment_id, amount, payment_method, reference_number, collected_by, payment_date)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id
          `, [loanId, a.installmentId, a.amount, dto.paymentMethod, dto.referenceNumber ?? null, user.sub, paymentDate]);
          paymentId = payRes.rows[0].id;

          await client.query(`
            UPDATE installments
            SET paid_amount = paid_amount + $1,
                status = CASE
                  WHEN paid_amount + $1 >= total_amount THEN 'PAID'
                  WHEN paid_amount + $1 > 0 THEN 'PARTIALLY_PAID'
                  ELSE status
                END,
                paid_at = CASE WHEN paid_amount + $1 >= total_amount THEN NOW() ELSE paid_at END,
                updated_at = NOW()
            WHERE id = $2
          `, [a.amount, a.installmentId]).catch(() => client.query(`
            UPDATE installments
            SET paid_amount = paid_amount + $1,
                status = CASE
                  WHEN paid_amount + $1 >= total_amount THEN 'PAID'
                  WHEN paid_amount + $1 > 0 THEN 'PARTIALLY_PAID'
                  ELSE status
                END,
                paid_at = CASE WHEN paid_amount + $1 >= total_amount THEN NOW() ELSE paid_at END
            WHERE id = $2
          `, [a.amount, a.installmentId]));
        }
      } else {
        const payRes = await client.query(`
          INSERT INTO payments (loan_id, installment_id, amount, payment_method, reference_number, collected_by, payment_date)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING id
        `, [loanId, null, dto.amount, dto.paymentMethod, dto.referenceNumber ?? null, user.sub, paymentDate]);
        paymentId = payRes.rows[0].id;
      }

      // Notify loan officer + managers about payment
      const loanDetailRes = await client.query<{ loan_officer_id: string | null; loan_number: string }>(
        `SELECT loan_officer_id, loan_number FROM loans WHERE id = $1`, [loanId],
      );
      const loanDetail = loanDetailRes.rows[0];
      const notifyIds = new Set<string>();
      if (loanDetail?.loan_officer_id) notifyIds.add(loanDetail.loan_officer_id);
      const mgrsRes2 = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('OWNER','MANAGER','ADMIN') AND is_active = TRUE`,
      );
      for (const m of mgrsRes2.rows) notifyIds.add(m.id);

      for (const uid of notifyIds) {
        await TenantNotificationsService.insertNotification(client, {
          userId: uid,
          title: `Payment received — ${loanDetail?.loan_number ?? loanId}`,
          body: `₹${dto.amount.toLocaleString('en-IN')} collected via ${dto.paymentMethod.replace('_', ' ')}.`,
          type: 'payment',
          entityType: 'loan',
          entityId: loanId,
          link: `/loans/${loanId}`,
        });
      }

      await this.activity.record(client, user, {
        action: 'payment.recorded',
        entityType: 'loan',
        entityId: loanId,
        entityLabel: loanDetail?.loan_number ?? loanId,
        metadata: { amount: dto.amount, paymentMethod: dto.paymentMethod, installmentId: dto.installmentId ?? null },
      });

      return { id: paymentId, amount: dto.amount, paymentDate, installmentsPaid: allocations.length };
    });
  }

  async undoInstallmentPayment(user: TenantJwtPayload, loanId: string, installmentId: string) {
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(user.role)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can undo a payment');
    }

    return this.withSchema(user.schemaName, async (client) => {
      const instRes = await client.query<{
        id: string; status: string; total_amount: string; paid_amount: string; due_date: string;
      }>(
        `SELECT id, status, total_amount, paid_amount, due_date FROM installments WHERE id = $1 AND loan_id = $2`,
        [installmentId, loanId],
      );
      if (!instRes.rows[0]) throw new NotFoundException('Installment not found');
      const inst = instRes.rows[0];

      const lastPaymentRes = await client.query<{ id: string; amount: string }>(
        `SELECT id, amount FROM payments WHERE installment_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [installmentId],
      );
      if (!lastPaymentRes.rows[0]) throw new BadRequestException('No payment recorded on this installment to undo');
      const lastPayment = lastPaymentRes.rows[0];

      const remainingPaid = Math.max(0, parseFloat(inst.paid_amount) - parseFloat(lastPayment.amount));
      const totalAmount = parseFloat(inst.total_amount);
      const today = new Date().toISOString().slice(0, 10);
      const newStatus = remainingPaid >= totalAmount ? 'PAID'
        : remainingPaid > 0 ? 'PARTIALLY_PAID'
        : (inst.due_date && inst.due_date < today ? 'OVERDUE' : 'PENDING');

      // Transactional: a failed status recompute must not leave the payment deleted
      // but the installment still showing it as paid. installments has no updated_at
      // column, unlike most other tenant tables.
      await client.query('BEGIN');
      try {
        await client.query(`DELETE FROM payments WHERE id = $1`, [lastPayment.id]);
        await client.query(
          `UPDATE installments
           SET paid_amount = $1, status = $2::installment_status, paid_at = CASE WHEN $2::installment_status = 'PAID' THEN paid_at ELSE NULL END
           WHERE id = $3`,
          [remainingPaid, newStatus, installmentId],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }

      const loanRes = await client.query<{ loan_number: string }>(`SELECT loan_number FROM loans WHERE id = $1`, [loanId]);

      await this.activity.record(client, user, {
        action: 'payment.undone',
        entityType: 'loan',
        entityId: loanId,
        entityLabel: loanRes.rows[0]?.loan_number ?? loanId,
        metadata: { installmentId, undoneAmount: parseFloat(lastPayment.amount), newStatus },
      });

      return { installmentId, status: newStatus, paidAmount: remainingPaid };
    });
  }
}
