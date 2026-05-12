import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

export interface CreateCustomerDto {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  panNumber?: string;
  aadhaarLast4?: string;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  creditScore?: number;
}

@Injectable()
export class TenantCustomersService {
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

  async list(user: TenantJwtPayload, page: number, limit: number, search?: string) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const searchParam = search ? `%${search}%` : null;

      // Data query: $1=limit, $2=offset, $3=search (when present)
      // Count query: $1=search (when present) — separate clause with $1
      const dataWhere = searchParam
        ? `WHERE (first_name ILIKE $3 OR last_name ILIKE $3 OR phone ILIKE $3 OR customer_code ILIKE $3)`
        : '';
      const countWhere = searchParam
        ? `WHERE (first_name ILIKE $1 OR last_name ILIKE $1 OR phone ILIKE $1 OR customer_code ILIKE $1)`
        : '';
      const dataParams = searchParam ? [limit, offset, searchParam] : [limit, offset];
      const countParams = searchParam ? [searchParam] : [];

      const [dataRes, countRes] = await Promise.all([
        client.query(`
          SELECT id, customer_code, first_name, last_name, email, phone,
                 pan_number, credit_score, city, state, is_active, created_at
          FROM customers
          ${dataWhere}
          ORDER BY created_at DESC
          LIMIT $1 OFFSET $2
        `, dataParams),
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM customers ${countWhere}`, countParams),
      ]);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id,
          customerCode: r.customer_code,
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          phone: r.phone,
          panNumber: r.pan_number,
          creditScore: r.credit_score,
          city: r.city,
          state: r.state,
          isActive: r.is_active,
          createdAt: r.created_at,
        })),
        total: parseInt(countRes.rows[0].total),
        page,
        limit,
      };
    });
  }

  async findOne(user: TenantJwtPayload, id: string) {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(`
        SELECT c.*,
          (SELECT COUNT(*) FROM loans WHERE customer_id = c.id) AS total_loans,
          (SELECT COUNT(*) FROM loans WHERE customer_id = c.id AND status = 'DISBURSED') AS active_loans,
          (SELECT COALESCE(SUM(amount), 0) FROM payments p JOIN loans l ON l.id = p.loan_id WHERE l.customer_id = c.id) AS total_paid
        FROM customers c WHERE c.id = $1
      `, [id]);

      if (!res.rows[0]) throw new NotFoundException('Customer not found');
      const r = res.rows[0];
      return {
        id: r.id, customerCode: r.customer_code,
        firstName: r.first_name, lastName: r.last_name,
        email: r.email, phone: r.phone, panNumber: r.pan_number,
        aadhaarLast4: r.aadhaar_last4, dateOfBirth: r.date_of_birth,
        address: r.address, city: r.city, state: r.state, pincode: r.pincode,
        creditScore: r.credit_score, isActive: r.is_active,
        createdAt: r.created_at, updatedAt: r.updated_at,
        totalLoans: parseInt(r.total_loans),
        activeLoans: parseInt(r.active_loans),
        totalPaid: parseFloat(r.total_paid),
      };
    });
  }

  async create(user: TenantJwtPayload, dto: CreateCustomerDto) {
    return this.withSchema(user.schemaName, async (client) => {
      // Generate customer code
      const countRes = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM customers`);
      const seq = parseInt(countRes.rows[0].n) + 1;
      const customerCode = `CUST${String(seq).padStart(5, '0')}`;

      // Check phone uniqueness
      const existing = await client.query(`SELECT id FROM customers WHERE phone = $1`, [dto.phone]);
      if (existing.rows.length > 0) throw new ConflictException('Phone number already registered');

      const res = await client.query(`
        INSERT INTO customers (
          customer_code, first_name, last_name, email, phone, pan_number,
          aadhaar_last4, date_of_birth, address, city, state, pincode,
          credit_score, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING *
      `, [
        customerCode, dto.firstName, dto.lastName, dto.email ?? null, dto.phone,
        dto.panNumber ?? null, dto.aadhaarLast4 ?? null, dto.dateOfBirth ?? null,
        dto.address ?? null, dto.city ?? null, dto.state ?? null, dto.pincode ?? null,
        dto.creditScore ?? null, user.sub,
      ]);

      const r = res.rows[0];
      return {
        id: r.id, customerCode: r.customer_code,
        firstName: r.first_name, lastName: r.last_name,
        email: r.email, phone: r.phone,
      };
    });
  }
}
