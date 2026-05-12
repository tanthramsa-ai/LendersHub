import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

export interface CreateLoanDto {
  customerId: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  purpose?: string;
  firstDueDate?: string;
}

export interface RecordPaymentDto {
  installmentId?: string;
  amount: number;
  paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS';
  referenceNumber?: string;
  paymentDate?: string;
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

@Injectable()
export class TenantLoansService {
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

  async list(user: TenantJwtPayload, page: number, limit: number, status?: string) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const dataWhere = status ? `WHERE l.status = $3` : '';
      const countWhere = status ? `WHERE l.status = $1` : '';
      const dataParams = status ? [limit, offset, status] : [limit, offset];
      const countParams = status ? [status] : [];

      const [dataRes, countRes] = await Promise.all([
        client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate, l.term_months,
                 l.status, l.purpose, l.disbursed_at, l.first_due_date, l.created_at,
                 c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
                 COALESCE(SUM(CASE WHEN i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE') THEN i.total_amount - i.paid_amount ELSE 0 END), 0) AS outstanding
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN installments i ON i.loan_id = l.id
          ${dataWhere}
          GROUP BY l.id, c.first_name, c.last_name, c.phone
          ORDER BY l.created_at DESC
          LIMIT $1 OFFSET $2
        `, dataParams),
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM loans l ${countWhere}`, countParams),
      ]);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          customerName: r.customer_name, customerPhone: r.customer_phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months, status: r.status, purpose: r.purpose,
          outstanding: parseFloat(r.outstanding),
          disbursedAt: r.disbursed_at, firstDueDate: r.first_due_date, createdAt: r.created_at,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async findOne(user: TenantJwtPayload, id: string) {
    return this.withSchema(user.schemaName, async (client) => {
      const [loanRes, installmentsRes, paymentsRes] = await Promise.all([
        client.query(`
          SELECT l.*, c.first_name || ' ' || c.last_name AS customer_name,
                 c.phone AS customer_phone, c.id AS customer_id_ref
          FROM loans l JOIN customers c ON c.id = l.customer_id WHERE l.id = $1
        `, [id]),
        client.query(`SELECT * FROM installments WHERE loan_id = $1 ORDER BY installment_number`, [id]),
        client.query(`SELECT * FROM payments WHERE loan_id = $1 ORDER BY created_at DESC`, [id]),
      ]);

      if (!loanRes.rows[0]) throw new NotFoundException('Loan not found');
      const l = loanRes.rows[0];
      return {
        id: l.id, loanNumber: l.loan_number,
        customerId: l.customer_id_ref, customerName: l.customer_name, customerPhone: l.customer_phone,
        principal: parseFloat(l.principal),
        interestRate: parseFloat(l.interest_rate),
        termMonths: l.term_months, status: l.status, purpose: l.purpose,
        disbursedAt: l.disbursed_at, firstDueDate: l.first_due_date,
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
    if (dto.principal <= 0) throw new BadRequestException('Principal must be positive');
    if (dto.interestRate < 0 || dto.interestRate > 100) throw new BadRequestException('Invalid interest rate');
    if (dto.termMonths < 1 || dto.termMonths > 360) throw new BadRequestException('Term must be 1–360 months');

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
        INSERT INTO loans (loan_number, customer_id, loan_officer_id, principal, interest_rate, term_months, status, purpose, first_due_date)
        VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8)
        RETURNING *
      `, [loanNumber, dto.customerId, user.sub, dto.principal, dto.interestRate, dto.termMonths, dto.purpose ?? null, firstDueDate.toISOString().slice(0, 10)]);

      const loan = loanRes.rows[0];

      // Generate and insert installments
      const installments = generateInstallments(dto.principal, dto.interestRate, dto.termMonths, firstDueDate);
      for (const inst of installments) {
        await client.query(`
          INSERT INTO installments (loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [loan.id, inst.number, inst.dueDate, inst.principal, inst.interest, inst.total]);
      }

      return {
        id: loan.id, loanNumber: loan.loan_number,
        principal: parseFloat(loan.principal),
        interestRate: parseFloat(loan.interest_rate),
        termMonths: loan.term_months, status: loan.status,
        firstDueDate: loan.first_due_date,
        installmentCount: installments.length,
        monthlyEmi: installments[0]?.total,
      };
    });
  }

  async recordPayment(user: TenantJwtPayload, loanId: string, dto: RecordPaymentDto) {
    return this.withSchema(user.schemaName, async (client) => {
      const loanRes = await client.query(`SELECT id, status FROM loans WHERE id = $1`, [loanId]);
      if (!loanRes.rows[0]) throw new NotFoundException('Loan not found');
      if (!['APPROVED', 'DISBURSED'].includes(loanRes.rows[0].status)) {
        throw new BadRequestException('Payment can only be recorded on active loans');
      }

      const paymentDate = dto.paymentDate ?? new Date().toISOString().slice(0, 10);

      const payRes = await client.query(`
        INSERT INTO payments (loan_id, installment_id, amount, payment_method, reference_number, collected_by, payment_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
      `, [loanId, dto.installmentId ?? null, dto.amount, dto.paymentMethod, dto.referenceNumber ?? null, user.sub, paymentDate]);

      // Update installment if linked
      if (dto.installmentId) {
        await client.query(`
          UPDATE installments
          SET paid_amount = paid_amount + $1,
              status = CASE
                WHEN paid_amount + $1 >= total_amount THEN 'PAID'
                WHEN paid_amount + $1 > 0 THEN 'PARTIALLY_PAID'
                ELSE status
              END,
              paid_at = CASE WHEN paid_amount + $1 >= total_amount THEN NOW() ELSE paid_at END,
              updated_at = NOW()  -- only if you have updated_at on installments
          WHERE id = $2
        `, [dto.amount, dto.installmentId]).catch(() => {
          // installments table may not have updated_at — retry without it
          return client.query(`
            UPDATE installments
            SET paid_amount = paid_amount + $1,
                status = CASE
                  WHEN paid_amount + $1 >= total_amount THEN 'PAID'
                  WHEN paid_amount + $1 > 0 THEN 'PARTIALLY_PAID'
                  ELSE status
                END,
                paid_at = CASE WHEN paid_amount + $1 >= total_amount THEN NOW() ELSE paid_at END
            WHERE id = $2
          `, [dto.amount, dto.installmentId]);
        });
      }

      return { id: payRes.rows[0].id, amount: dto.amount, paymentDate };
    });
  }
}
