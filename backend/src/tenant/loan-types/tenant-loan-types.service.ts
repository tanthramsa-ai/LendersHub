import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';

export interface CreateLoanTypeDto {
  name: string;
  description?: string;
  minAmount?: number;
  maxAmount?: number;
  minInterestRate?: number;
  maxInterestRate?: number;
  minTermMonths?: number;
  maxTermMonths?: number;
}

const MANAGER_ROLES = ['OWNER', 'MANAGER', 'ADMIN'];

@Injectable()
export class TenantLoanTypesService {
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

  async list(user: TenantJwtPayload) {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(`
        SELECT lt.id, lt.name, lt.description,
               lt.min_amount, lt.max_amount,
               lt.min_interest_rate, lt.max_interest_rate,
               lt.min_term_months, lt.max_term_months,
               lt.is_active, lt.created_at,
               COUNT(DISTINCT l.id) FILTER (WHERE l.deleted_at IS NULL) AS loan_count,
               COUNT(DISTINCT l.customer_id) FILTER (WHERE l.deleted_at IS NULL) AS customer_count
        FROM loan_types lt
        LEFT JOIN loans l ON l.loan_type_id = lt.id
        WHERE lt.deleted_at IS NULL
        GROUP BY lt.id
        ORDER BY lt.name ASC
      `);
      return res.rows.map((r) => ({
        id: r.id, name: r.name, description: r.description,
        minAmount: r.min_amount ? parseFloat(r.min_amount) : null,
        maxAmount: r.max_amount ? parseFloat(r.max_amount) : null,
        minInterestRate: r.min_interest_rate ? parseFloat(r.min_interest_rate) : null,
        maxInterestRate: r.max_interest_rate ? parseFloat(r.max_interest_rate) : null,
        minTermMonths: r.min_term_months, maxTermMonths: r.max_term_months,
        isActive: r.is_active, createdAt: r.created_at,
        loanCount: parseInt(r.loan_count ?? 0),
        customerCount: parseInt(r.customer_count ?? 0),
      }));
    });
  }

  async findOne(user: TenantJwtPayload, id: string) {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(`
        SELECT lt.*,
               COUNT(DISTINCT l.id) FILTER (WHERE l.deleted_at IS NULL) AS loan_count,
               COUNT(DISTINCT l.customer_id) FILTER (WHERE l.deleted_at IS NULL) AS customer_count,
               COALESCE(SUM(l.principal) FILTER (WHERE l.deleted_at IS NULL AND l.status IN ('DISBURSED','APPROVED')), 0) AS active_principal
        FROM loan_types lt
        LEFT JOIN loans l ON l.loan_type_id = lt.id
        WHERE lt.id = $1 AND lt.deleted_at IS NULL
        GROUP BY lt.id
      `, [id]);
      if (!res.rows[0]) throw new NotFoundException('Loan type not found');
      const r = res.rows[0];
      return {
        id: r.id, name: r.name, description: r.description,
        minAmount: r.min_amount ? parseFloat(r.min_amount) : null,
        maxAmount: r.max_amount ? parseFloat(r.max_amount) : null,
        minInterestRate: r.min_interest_rate ? parseFloat(r.min_interest_rate) : null,
        maxInterestRate: r.max_interest_rate ? parseFloat(r.max_interest_rate) : null,
        minTermMonths: r.min_term_months, maxTermMonths: r.max_term_months,
        isActive: r.is_active, createdAt: r.created_at,
        loanCount: parseInt(r.loan_count ?? 0),
        customerCount: parseInt(r.customer_count ?? 0),
        activePrincipal: parseFloat(r.active_principal ?? 0),
      };
    });
  }

  async getLoansByType(user: TenantJwtPayload, id: string, page: number, limit: number, search?: string) {
    if (!MANAGER_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can view loan-type breakdowns');
    }
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      // id is passed as a bound parameter ($3) — never interpolated (prevents SQL injection).
      const conditions = [`l.loan_type_id = $3`, `l.deleted_at IS NULL`];
      const dataParams: unknown[] = [limit, offset, id];
      const countParams: unknown[] = [id];

      if (search) {
        const sp = `%${search}%`;
        conditions.push(`(c.first_name || ' ' || c.last_name ILIKE $4 OR l.loan_number ILIKE $4 OR c.phone ILIKE $4)`);
        dataParams.push(sp);
        countParams.push(sp);
      }
      const where = `WHERE ${conditions.join(' AND ')}`;
      const countWhere = search
        ? `WHERE l.loan_type_id = $1 AND l.deleted_at IS NULL AND (c.first_name || ' ' || c.last_name ILIKE $2 OR l.loan_number ILIKE $2 OR c.phone ILIKE $2)`
        : `WHERE l.loan_type_id = $1 AND l.deleted_at IS NULL`;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate, l.term_months,
                 l.status, l.disbursed_at, l.created_at,
                 c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.phone
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          ${where}
          ORDER BY l.created_at DESC
          LIMIT $1 OFFSET $2
        `, dataParams);
      const countRes = await client.query<{ total: string }>(`
          SELECT COUNT(*) AS total FROM loans l
          JOIN customers c ON c.id = l.customer_id
          ${countWhere}
        `, countParams);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months, status: r.status,
          disbursedAt: r.disbursed_at, createdAt: r.created_at,
          customerId: r.customer_id, customerName: r.customer_name, phone: r.phone,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async getCustomersByType(user: TenantJwtPayload, id: string, page: number, limit: number, search?: string) {
    if (!MANAGER_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can view loan-type breakdowns');
    }
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      // id is passed as a bound parameter ($3) — never interpolated (prevents SQL injection).
      const conditions = [`l.loan_type_id = $3`, `l.deleted_at IS NULL`];
      const dataParams: unknown[] = [limit, offset, id];
      const countParams: unknown[] = [id];

      if (search) {
        const sp = `%${search}%`;
        conditions.push(`(c.first_name || ' ' || c.last_name ILIKE $4 OR c.phone ILIKE $4 OR c.customer_code ILIKE $4)`);
        dataParams.push(sp);
        countParams.push(sp);
      }
      const where = `WHERE ${conditions.join(' AND ')}`;
      const countWhere = search
        ? `WHERE l.loan_type_id = $1 AND l.deleted_at IS NULL AND (c.first_name || ' ' || c.last_name ILIKE $2 OR c.phone ILIKE $2 OR c.customer_code ILIKE $2)`
        : `WHERE l.loan_type_id = $1 AND l.deleted_at IS NULL`;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT c.id, c.customer_code, c.first_name || ' ' || c.last_name AS name, c.phone,
                 COUNT(l.id) AS loan_count,
                 SUM(l.principal) FILTER (WHERE l.status IN ('DISBURSED','APPROVED')) AS active_principal
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          ${where}
          GROUP BY c.id, c.customer_code, c.first_name, c.last_name, c.phone
          ORDER BY c.first_name
          LIMIT $1 OFFSET $2
        `, dataParams);
      const countRes = await client.query<{ total: string }>(`
          SELECT COUNT(DISTINCT c.id) AS total FROM loans l
          JOIN customers c ON c.id = l.customer_id
          ${countWhere}
        `, countParams);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, customerCode: r.customer_code, name: r.name, phone: r.phone,
          loanCount: parseInt(r.loan_count),
          activePrincipal: r.active_principal ? parseFloat(r.active_principal) : 0,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async create(user: TenantJwtPayload, dto: CreateLoanTypeDto) {
    if (!MANAGER_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can manage loan types');
    }
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(`
        INSERT INTO loan_types (name, description, min_amount, max_amount,
          min_interest_rate, max_interest_rate, min_term_months, max_term_months)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [
        dto.name, dto.description ?? null,
        dto.minAmount ?? null, dto.maxAmount ?? null,
        dto.minInterestRate ?? null, dto.maxInterestRate ?? null,
        dto.minTermMonths ?? null, dto.maxTermMonths ?? null,
      ]);
      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: 'loan_type.created',
        entityType: 'loan_type',
        entityId: r.id,
        entityLabel: r.name,
      });
      return { id: r.id, name: r.name, description: r.description, isActive: r.is_active, createdAt: r.created_at };
    });
  }

  async update(user: TenantJwtPayload, id: string, dto: Partial<CreateLoanTypeDto> & { isActive?: boolean }) {
    if (!MANAGER_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can manage loan types');
    }
    return this.withSchema(user.schemaName, async (client) => {
      const existing = await client.query(`SELECT id FROM loan_types WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!existing.rows[0]) throw new NotFoundException('Loan type not found');

      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let i = 1;

      if (dto.name !== undefined) { sets.push(`name = $${i++}`); params.push(dto.name); }
      if (dto.description !== undefined) { sets.push(`description = $${i++}`); params.push(dto.description); }
      if (dto.minAmount !== undefined) { sets.push(`min_amount = $${i++}`); params.push(dto.minAmount); }
      if (dto.maxAmount !== undefined) { sets.push(`max_amount = $${i++}`); params.push(dto.maxAmount); }
      if (dto.minInterestRate !== undefined) { sets.push(`min_interest_rate = $${i++}`); params.push(dto.minInterestRate); }
      if (dto.maxInterestRate !== undefined) { sets.push(`max_interest_rate = $${i++}`); params.push(dto.maxInterestRate); }
      if (dto.minTermMonths !== undefined) { sets.push(`min_term_months = $${i++}`); params.push(dto.minTermMonths); }
      if (dto.maxTermMonths !== undefined) { sets.push(`max_term_months = $${i++}`); params.push(dto.maxTermMonths); }
      if (dto.isActive !== undefined) { sets.push(`is_active = $${i++}`); params.push(dto.isActive); }

      params.push(id);
      const res = await client.query(
        `UPDATE loan_types SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params,
      );
      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: 'loan_type.updated',
        entityType: 'loan_type',
        entityId: r.id,
        entityLabel: r.name,
        metadata: { changedFields: Object.keys(dto) },
      });
      return {
        id: r.id, name: r.name, description: r.description,
        minAmount: r.min_amount ? parseFloat(r.min_amount) : null,
        maxAmount: r.max_amount ? parseFloat(r.max_amount) : null,
        minInterestRate: r.min_interest_rate ? parseFloat(r.min_interest_rate) : null,
        maxInterestRate: r.max_interest_rate ? parseFloat(r.max_interest_rate) : null,
        minTermMonths: r.min_term_months, maxTermMonths: r.max_term_months,
        isActive: r.is_active, createdAt: r.created_at,
      };
    });
  }

  async remove(user: TenantJwtPayload, id: string) {
    if (!MANAGER_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can manage loan types');
    }
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE loan_types SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, name`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Loan type not found');
      await this.activity.record(client, user, {
        action: 'loan_type.deleted',
        entityType: 'loan_type',
        entityId: res.rows[0].id,
        entityLabel: res.rows[0].name,
      });
      return { id };
    });
  }
}
