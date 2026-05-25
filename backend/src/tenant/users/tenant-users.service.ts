import { Injectable, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

export interface CreateUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: 'ADMIN' | 'LOAN_OFFICER' | 'COLLECTOR' | 'VIEWER';
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  role?: 'ADMIN' | 'LOAN_OFFICER' | 'COLLECTOR' | 'VIEWER';
}

const VALID_ROLES = ['ADMIN', 'LOAN_OFFICER', 'COLLECTOR', 'VIEWER'];

@Injectable()
export class TenantUsersService {
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

  private assertAdmin(user: TenantJwtPayload) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only admins can manage users');
  }

  async list(user: TenantJwtPayload, page: number, limit: number, search?: string) {
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const sp = search ? `%${search}%` : null;
      const dataWhere = sp ? `WHERE (first_name ILIKE $3 OR last_name ILIKE $3 OR email ILIKE $3 OR phone ILIKE $3)` : '';
      const countWhere = sp ? `WHERE (first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1)` : '';
      const dataParams = sp ? [limit, offset, sp] : [limit, offset];
      const countParams = sp ? [sp] : [];

      const [dataRes, countRes] = await Promise.all([
        client.query(`
          SELECT id, email, first_name, last_name, phone, role, is_active, created_at
          FROM users
          ${dataWhere}
          ORDER BY created_at DESC
          LIMIT $1 OFFSET $2
        `, dataParams),
        client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM users ${countWhere}`, countParams),
      ]);

      return {
        data: dataRes.rows.map((r) => ({
          id: r.id,
          email: r.email,
          firstName: r.first_name,
          lastName: r.last_name,
          phone: r.phone,
          role: r.role,
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
      const res = await client.query(
        `SELECT id, email, first_name, last_name, phone, role, is_active, created_at, updated_at
         FROM users WHERE id = $1`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('User not found');
      const r = res.rows[0];
      return {
        id: r.id, email: r.email,
        firstName: r.first_name, lastName: r.last_name,
        phone: r.phone, role: r.role,
        isActive: r.is_active,
        createdAt: r.created_at, updatedAt: r.updated_at,
      };
    });
  }

  async create(user: TenantJwtPayload, dto: CreateUserDto) {
    this.assertAdmin(user);
    if (!VALID_ROLES.includes(dto.role)) throw new ForbiddenException('Invalid role');

    const hashed = await bcrypt.hash(dto.password, 10);

    return this.withSchema(user.schemaName, async (client) => {
      const existing = await client.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [dto.email]);
      if (existing.rows.length > 0) throw new ConflictException('Email already in use');

      const res = await client.query(`
        INSERT INTO users (email, password, first_name, last_name, phone, role)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, email, first_name, last_name, phone, role, is_active, created_at
      `, [dto.email.trim().toLowerCase(), hashed, dto.firstName, dto.lastName, dto.phone ?? null, dto.role]);

      const r = res.rows[0];
      return {
        id: r.id, email: r.email,
        firstName: r.first_name, lastName: r.last_name,
        phone: r.phone, role: r.role,
        isActive: r.is_active, createdAt: r.created_at,
      };
    });
  }

  async update(user: TenantJwtPayload, id: string, dto: UpdateUserDto) {
    this.assertAdmin(user);
    if (dto.role && !VALID_ROLES.includes(dto.role)) throw new ForbiddenException('Invalid role');

    return this.withSchema(user.schemaName, async (client) => {
      const existing = await client.query(`SELECT id FROM users WHERE id = $1`, [id]);
      if (!existing.rows[0]) throw new NotFoundException('User not found');

      const res = await client.query(`
        UPDATE users SET
          first_name = COALESCE($1, first_name),
          last_name  = COALESCE($2, last_name),
          phone      = COALESCE($3, phone),
          role       = COALESCE($4, role),
          updated_at = NOW()
        WHERE id = $5
        RETURNING id, email, first_name, last_name, phone, role, is_active, updated_at
      `, [dto.firstName ?? null, dto.lastName ?? null, dto.phone ?? null, dto.role ?? null, id]);

      const r = res.rows[0];
      return {
        id: r.id, email: r.email,
        firstName: r.first_name, lastName: r.last_name,
        phone: r.phone, role: r.role,
        isActive: r.is_active, updatedAt: r.updated_at,
      };
    });
  }

  async setActive(user: TenantJwtPayload, id: string, isActive: boolean) {
    this.assertAdmin(user);
    if (user.sub === id) throw new ForbiddenException('Cannot deactivate yourself');

    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_active`,
        [isActive, id],
      );
      if (!res.rows[0]) throw new NotFoundException('User not found');
      return { id: res.rows[0].id, isActive: res.rows[0].is_active };
    });
  }

  async resetPassword(user: TenantJwtPayload, id: string, newPassword: string) {
    this.assertAdmin(user);
    const hashed = await bcrypt.hash(newPassword, 10);

    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
        [hashed, id],
      );
      if (!res.rows[0]) throw new NotFoundException('User not found');
      return { success: true };
    });
  }
}
