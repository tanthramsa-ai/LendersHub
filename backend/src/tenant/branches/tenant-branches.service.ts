import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

export interface CreateBranchDto {
  name: string;
  code: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  managerName?: string;
}

export interface UpdateBranchDto {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  managerName?: string;
  isActive?: boolean;
}

@Injectable()
export class TenantBranchesService {
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

  async list(user: TenantJwtPayload) {
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(`
        SELECT b.*,
          (SELECT COUNT(*) FROM users     WHERE branch_id = b.id) AS user_count,
          (SELECT COUNT(*) FROM customers WHERE branch_id = b.id) AS customer_count,
          (SELECT COUNT(*) FROM loans     WHERE branch_id = b.id) AS loan_count
        FROM branches b
        ORDER BY b.name ASC
      `);
      return res.rows.map((b) => ({
        id: b.id, name: b.name, code: b.code,
        address: b.address, city: b.city, state: b.state,
        phone: b.phone, email: b.email, managerName: b.manager_name,
        isActive: b.is_active, createdAt: b.created_at,
        userCount: parseInt(b.user_count), customerCount: parseInt(b.customer_count), loanCount: parseInt(b.loan_count),
      }));
    });
  }

  async create(user: TenantJwtPayload, dto: CreateBranchDto) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only admins can manage branches');

    return this.withSchema(user.schemaName, async (client) => {
      const existing = await client.query(`SELECT id FROM branches WHERE UPPER(code) = UPPER($1)`, [dto.code]);
      if (existing.rows.length > 0) throw new ConflictException('Branch code already exists');

      const res = await client.query(`
        INSERT INTO branches (name, code, address, city, state, phone, email, manager_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [dto.name, dto.code.toUpperCase(), dto.address ?? null, dto.city ?? null,
          dto.state ?? null, dto.phone ?? null, dto.email ?? null, dto.managerName ?? null]);

      const b = res.rows[0];
      return {
        id: b.id, name: b.name, code: b.code,
        address: b.address, city: b.city, state: b.state,
        phone: b.phone, email: b.email, managerName: b.manager_name,
        isActive: b.is_active, createdAt: b.created_at,
      };
    });
  }

  async update(user: TenantJwtPayload, id: string, dto: UpdateBranchDto) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only admins can manage branches');

    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(`
        UPDATE branches SET
          name         = COALESCE($1, name),
          address      = COALESCE($2, address),
          city         = COALESCE($3, city),
          state        = COALESCE($4, state),
          phone        = COALESCE($5, phone),
          email        = COALESCE($6, email),
          manager_name = COALESCE($7, manager_name),
          is_active    = COALESCE($8, is_active),
          updated_at   = NOW()
        WHERE id = $9
        RETURNING *
      `, [dto.name ?? null, dto.address ?? null, dto.city ?? null, dto.state ?? null,
          dto.phone ?? null, dto.email ?? null, dto.managerName ?? null, dto.isActive ?? null, id]);

      if (!res.rows[0]) throw new NotFoundException('Branch not found');
      const b = res.rows[0];
      return {
        id: b.id, name: b.name, code: b.code,
        address: b.address, city: b.city, state: b.state,
        phone: b.phone, email: b.email, managerName: b.manager_name,
        isActive: b.is_active, updatedAt: b.updated_at,
      };
    });
  }
}
