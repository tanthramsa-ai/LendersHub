import { Injectable, ConflictException, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';

export interface CreateUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: 'ADMIN' | 'LOAN_OFFICER' | 'COLLECTOR' | 'VIEWER';
  branchId?: string;
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: 'ADMIN' | 'LOAN_OFFICER' | 'COLLECTOR' | 'VIEWER';
  branchId?: string | null;
}

const VALID_ROLES = ['ADMIN', 'LOAN_OFFICER', 'COLLECTOR', 'VIEWER'];
// Only Owner and Admin can manage users (Matrix: Manager=No for Add User)
const USER_ADMIN_ROLES = ['OWNER', 'ADMIN'];

@Injectable()
export class TenantUsersService {
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

  private assertManager(user: TenantJwtPayload) {
    if (!USER_ADMIN_ROLES.includes(user.role)) throw new ForbiddenException('Only Owner or Admin can manage users');
  }

  async list(user: TenantJwtPayload, page: number, limit: number, search?: string) {
    this.assertManager(user);
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const sp = search ? `%${search}%` : null;
      const searchCond = sp ? `AND (u.first_name ILIKE $3 OR u.last_name ILIKE $3 OR u.email ILIKE $3 OR u.phone ILIKE $3)` : '';
      const dataParams = sp ? [limit, offset, sp] : [limit, offset];
      const countParams = sp ? [sp] : [];
      const countCond = sp ? `WHERE (u.first_name ILIKE $1 OR u.last_name ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1)` : '';

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.role, u.is_active, u.created_at,
                 u.branch_id, b.name AS branch_name,
                 COUNT(DISTINCT l.id) FILTER (WHERE l.status IN ('APPROVED','DISBURSED') AND l.deleted_at IS NULL) AS active_loans,
                 COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'CLOSED' AND l.deleted_at IS NULL) AS closed_loans,
                 COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'DEFAULTED' AND l.deleted_at IS NULL) AS npa_loans
          FROM users u
          LEFT JOIN branches b ON b.id = u.branch_id
          LEFT JOIN loans l ON l.loan_officer_id = u.id
          WHERE 1=1 ${searchCond}
          GROUP BY u.id, b.name
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2
        `, dataParams);
      const countRes = await client.query<{ total: string }>(`
          SELECT COUNT(*) AS total FROM users u ${countCond}
        `, countParams);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, email: r.email,
          firstName: r.first_name, lastName: r.last_name,
          phone: r.phone, role: r.role,
          isActive: r.is_active, createdAt: r.created_at,
          branchId: r.branch_id, branchName: r.branch_name,
          activeLoans: parseInt(r.active_loans) || 0,
          closedLoans: parseInt(r.closed_loans) || 0,
          npaLoans: parseInt(r.npa_loans) || 0,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async findOne(user: TenantJwtPayload, id: string) {
    return this.withSchema(user.schemaName, async (client) => {
      // Sequential: a single pg connection cannot run queries concurrently.
      const userRes = await client.query(`
          SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.role,
                 u.is_active, u.created_at, u.updated_at,
                 u.branch_id, b.name AS branch_name, b.code AS branch_code
          FROM users u LEFT JOIN branches b ON b.id = u.branch_id
          WHERE u.id = $1
        `, [id]);
      const statsRes = await client.query(`
          SELECT
            COUNT(*) FILTER (WHERE l.status IN ('APPROVED','DISBURSED') AND l.deleted_at IS NULL)  AS active_loans,
            COUNT(*) FILTER (WHERE l.status = 'CLOSED' AND l.deleted_at IS NULL)                   AS closed_loans,
            COUNT(*) FILTER (WHERE l.status = 'DEFAULTED' AND l.deleted_at IS NULL)                AS npa_loans,
            COALESCE(SUM(l.principal) FILTER (WHERE l.status IN ('APPROVED','DISBURSED') AND l.deleted_at IS NULL), 0) AS active_principal,
            COALESCE(SUM(l.principal) FILTER (WHERE l.status = 'DEFAULTED' AND l.deleted_at IS NULL), 0) AS npa_principal,
            COUNT(DISTINCT l.customer_id) FILTER (WHERE l.deleted_at IS NULL)                      AS total_customers
          FROM loans l WHERE l.loan_officer_id = $1
        `, [id]);

      if (!userRes.rows[0]) throw new NotFoundException('User not found');
      const r = userRes.rows[0];
      const s = statsRes.rows[0];
      return {
        id: r.id, email: r.email,
        firstName: r.first_name, lastName: r.last_name,
        phone: r.phone, role: r.role,
        isActive: r.is_active,
        createdAt: r.created_at, updatedAt: r.updated_at,
        branchId: r.branch_id, branchName: r.branch_name, branchCode: r.branch_code,
        stats: {
          activeLoans: parseInt(s.active_loans) || 0,
          closedLoans: parseInt(s.closed_loans) || 0,
          npaLoans: parseInt(s.npa_loans) || 0,
          activePrincipal: parseFloat(s.active_principal) || 0,
          npaPrincipal: parseFloat(s.npa_principal) || 0,
          totalCustomers: parseInt(s.total_customers) || 0,
        },
      };
    });
  }

  async getUserLoans(user: TenantJwtPayload, id: string, page: number, limit: number, status?: string) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      // $1=limit  $2=offset  $3=id  $4=status(optional)
      const dataParams: unknown[] = [limit, offset, id, ...(status ? [status] : [])];
      const statusCond = status ? `AND l.status = $4` : '';
      // $1=id  $2=status(optional)
      const countParams: unknown[] = [id, ...(status ? [status] : [])];
      const countStatusCond = status ? `AND l.status = $2` : '';

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT l.id, l.loan_number, l.principal, l.interest_rate, l.term_months, l.status,
                 l.first_due_date, l.disbursed_at, l.created_at,
                 c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
                 COALESCE(SUM(CASE WHEN i.status IN ('PENDING','PARTIALLY_PAID','OVERDUE') THEN i.total_amount - i.paid_amount ELSE 0 END), 0) AS outstanding
          FROM loans l
          JOIN customers c ON c.id = l.customer_id
          LEFT JOIN installments i ON i.loan_id = l.id
          WHERE l.loan_officer_id = $3 AND l.deleted_at IS NULL ${statusCond}
          GROUP BY l.id, c.first_name, c.last_name, c.phone
          ORDER BY l.created_at DESC
          LIMIT $1 OFFSET $2
        `, dataParams);
      const countRes = await client.query<{ total: string }>(`
          SELECT COUNT(*) AS total FROM loans l
          WHERE l.loan_officer_id = $1 AND l.deleted_at IS NULL ${countStatusCond}
        `, countParams);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id, loanNumber: r.loan_number,
          customerName: r.customer_name, customerPhone: r.customer_phone,
          principal: parseFloat(r.principal),
          interestRate: parseFloat(r.interest_rate),
          termMonths: r.term_months, status: r.status,
          outstanding: parseFloat(r.outstanding),
          disbursedAt: r.disbursed_at, firstDueDate: r.first_due_date, createdAt: r.created_at,
        })),
        total: parseInt(countRes.rows[0].total),
        page, limit,
      };
    });
  }

  async create(user: TenantJwtPayload, dto: CreateUserDto) {
    this.assertManager(user);
    if (!VALID_ROLES.includes(dto.role)) throw new BadRequestException('Invalid role');
    if (!dto.phone?.trim()) throw new BadRequestException('Phone number is required');

    const hashed = await bcrypt.hash(dto.password, 10);

    return this.withSchema(user.schemaName, async (client) => {
      const existing = await client.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [dto.email]);
      if (existing.rows.length > 0) throw new ConflictException('Email already in use');

      const res = await client.query(`
        INSERT INTO users (email, password, first_name, last_name, phone, role, branch_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, email, first_name, last_name, phone, role, is_active, branch_id, created_at
      `, [dto.email.trim().toLowerCase(), hashed, dto.firstName, dto.lastName, dto.phone, dto.role, dto.branchId ?? null]);

      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: 'user.created',
        entityType: 'user',
        entityId: r.id,
        entityLabel: `${r.first_name} ${r.last_name} (${r.email})`,
        metadata: { role: r.role },
      });
      return {
        id: r.id, email: r.email,
        firstName: r.first_name, lastName: r.last_name,
        phone: r.phone, role: r.role,
        branchId: r.branch_id,
        isActive: r.is_active, createdAt: r.created_at,
      };
    });
  }

  async update(user: TenantJwtPayload, id: string, dto: UpdateUserDto) {
    this.assertManager(user);
    if (dto.role && !VALID_ROLES.includes(dto.role)) throw new BadRequestException('Invalid role');

    return this.withSchema(user.schemaName, async (client) => {
      const existing = await client.query(`SELECT id FROM users WHERE id = $1`, [id]);
      if (!existing.rows[0]) throw new NotFoundException('User not found');

      const res = await client.query(`
        UPDATE users SET
          first_name = COALESCE($1, first_name),
          last_name  = COALESCE($2, last_name),
          phone      = COALESCE($3, phone),
          role       = COALESCE($4, role),
          branch_id  = CASE WHEN $5::boolean THEN $6::uuid ELSE branch_id END,
          updated_at = NOW()
        WHERE id = $7
        RETURNING id, email, first_name, last_name, phone, role, branch_id, is_active, updated_at
      `, [
        dto.firstName ?? null, dto.lastName ?? null, dto.phone ?? null, dto.role ?? null,
        'branchId' in dto, dto.branchId ?? null, id,
      ]);

      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: 'user.updated',
        entityType: 'user',
        entityId: r.id,
        entityLabel: `${r.first_name} ${r.last_name} (${r.email})`,
        metadata: { changedFields: Object.keys(dto) },
      });
      return {
        id: r.id, email: r.email,
        firstName: r.first_name, lastName: r.last_name,
        phone: r.phone, role: r.role,
        branchId: r.branch_id,
        isActive: r.is_active, updatedAt: r.updated_at,
      };
    });
  }

  async setActive(user: TenantJwtPayload, id: string, isActive: boolean) {
    this.assertManager(user);
    if (user.sub === id) throw new ForbiddenException('Cannot deactivate yourself');

    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_active, email, first_name, last_name`,
        [isActive, id],
      );
      if (!res.rows[0]) throw new NotFoundException('User not found');
      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: isActive ? 'user.activated' : 'user.deactivated',
        entityType: 'user',
        entityId: r.id,
        entityLabel: `${r.first_name} ${r.last_name} (${r.email})`,
      });
      return { id: r.id, isActive: r.is_active };
    });
  }

  async listOfficers(user: TenantJwtPayload) {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(`
        SELECT id, first_name || ' ' || last_name AS name, role
        FROM users
        WHERE role IN ('OWNER','MANAGER','ADMIN','LOAN_OFFICER') AND is_active = TRUE
        ORDER BY first_name, last_name
      `);
      return res.rows.map((r) => ({ id: r.id, name: r.name, role: r.role }));
    });
  }

  async resetPassword(user: TenantJwtPayload, id: string, newPassword: string) {
    this.assertManager(user);
    const hashed = await bcrypt.hash(newPassword, 10);

    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, first_name, last_name`,
        [hashed, id],
      );
      if (!res.rows[0]) throw new NotFoundException('User not found');
      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: 'user.password_reset',
        entityType: 'user',
        entityId: r.id,
        entityLabel: `${r.first_name} ${r.last_name} (${r.email})`,
      });
      return { success: true };
    });
  }
}
