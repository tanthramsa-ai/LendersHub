import { Injectable, ConflictException, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { sanitizeStrings } from '../../common/utils/sanitize';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { validateCustomerFields } from './customer-validation';

export interface CreateCustomerDto {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  panNumber?: string;
  aadhaarLast4?: string;
  aadhaarDocUrl?: string;
  dateOfBirth?: string;
  address: string;
  locality: string;
  city?: string;
  state?: string;
  pincode?: string;
  occupation?: string;
  loanPurpose?: string;
  altContact?: string;
  altContactName?: string;
  altContactRelation?: string;
  creditScore?: number;
  branchId?: string;
}

export interface UpdateCustomerDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  panNumber?: string;
  aadhaarLast4?: string;
  aadhaarDocUrl?: string;
  dateOfBirth?: string;
  address?: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
  occupation?: string;
  loanPurpose?: string;
  altContact?: string;
  altContactName?: string;
  altContactRelation?: string;
  creditScore?: number;
  branchId?: string | null;
  isActive?: boolean;
}

@Injectable()
export class TenantCustomersService {
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

  async list(user: TenantJwtPayload, page: number, limit: number, search?: string, branchId?: string) {
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 20)), 200);
    page = safePage; limit = safeLimit;
    return this.withSchema(user.schemaName, async (client) => {
      const offset = (page - 1) * limit;
      const conditions: string[] = [];
      const filterParams: unknown[] = [];
      let idx = 1;

      if (user.role === 'LOAN_OFFICER') {
        conditions.push(`c.id IN (SELECT DISTINCT customer_id FROM loans WHERE loan_officer_id = $${idx++})`);
        filterParams.push(user.sub);
      }
      if (branchId) {
        conditions.push(`c.branch_id = $${idx++}`);
        filterParams.push(branchId);
      }
      if (search) {
        conditions.push(`(c.first_name ILIKE $${idx} OR c.last_name ILIKE $${idx} OR c.phone ILIKE $${idx} OR c.customer_code ILIKE $${idx})`);
        filterParams.push(`%${search}%`);
        idx++;
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const countWhere = whereClause;
      const countParams = filterParams;
      const dataParams = [...filterParams, limit, offset];
      const limitIdx = idx; const offsetIdx = idx + 1;

      // Sequential: a single pg connection cannot run queries concurrently.
      const dataRes = await client.query(`
          SELECT c.id, c.customer_code, c.first_name, c.last_name, c.email, c.phone,
                 c.pan_number, c.credit_score, c.city, c.state, c.locality, c.branch_id,
                 c.is_active, c.created_at,
                 b.name AS branch_name
          FROM customers c
          LEFT JOIN branches b ON b.id = c.branch_id
          ${whereClause}
          ORDER BY c.customer_code ASC
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `, dataParams);
      const countRes = await client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM customers c ${countWhere}`, countParams);

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
          locality: r.locality,
          branchId: r.branch_id,
          branchName: r.branch_name,
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
          b.name AS branch_name, b.code AS branch_code,
          (SELECT COUNT(*) FROM loans WHERE customer_id = c.id) AS total_loans,
          (SELECT COUNT(*) FROM loans WHERE customer_id = c.id AND status = 'DISBURSED') AS active_loans,
          (SELECT COALESCE(SUM(amount), 0) FROM payments p JOIN loans l ON l.id = p.loan_id WHERE l.customer_id = c.id) AS total_paid
        FROM customers c
        LEFT JOIN branches b ON b.id = c.branch_id
        WHERE c.id = $1
      `, [id]);

      if (!res.rows[0]) throw new NotFoundException('Customer not found');
      const r = res.rows[0];
      return {
        id: r.id, customerCode: r.customer_code,
        firstName: r.first_name, lastName: r.last_name,
        email: r.email, phone: r.phone, panNumber: r.pan_number,
        aadhaarLast4: r.aadhaar_last4, aadhaarDocUrl: r.aadhaar_doc_url,
        dateOfBirth: r.date_of_birth,
        address: r.address, locality: r.locality,
        city: r.city, state: r.state, pincode: r.pincode,
        occupation: r.occupation, loanPurpose: r.loan_purpose,
        altContact: r.alt_contact, altContactName: r.alt_contact_name,
        altContactRelation: r.alt_contact_relation,
        creditScore: r.credit_score, isActive: r.is_active,
        branchId: r.branch_id, branchName: r.branch_name, branchCode: r.branch_code,
        createdAt: r.created_at, updatedAt: r.updated_at,
        totalLoans: parseInt(r.total_loans),
        activeLoans: parseInt(r.active_loans),
        totalPaid: parseFloat(r.total_paid),
      };
    });
  }

  async create(user: TenantJwtPayload, dto: CreateCustomerDto) {
    if (user.role === 'VIEWER') throw new ForbiddenException('Customers cannot add customers');
    dto = sanitizeStrings(dto);
    validateCustomerFields({ ...dto, requireCore: true });

    return this.withSchema(user.schemaName, async (client) => {
      const countRes = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM customers`);
      const seq = parseInt(countRes.rows[0].n) + 1;
      const customerCode = `CUST${String(seq).padStart(5, '0')}`;

      const existing = await client.query(`SELECT id FROM customers WHERE phone = $1`, [dto.phone]);
      if (existing.rows.length > 0) throw new ConflictException('Phone number already registered');

      const res = await client.query(`
        INSERT INTO customers (
          customer_code, first_name, last_name, email, phone, pan_number,
          aadhaar_last4, aadhaar_doc_url, date_of_birth,
          address, locality, city, state, pincode,
          occupation, loan_purpose,
          alt_contact, alt_contact_name, alt_contact_relation,
          credit_score, branch_id, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        RETURNING *
      `, [
        customerCode, dto.firstName, dto.lastName, dto.email ?? null, dto.phone,
        dto.panNumber ?? null, dto.aadhaarLast4 ?? null, dto.aadhaarDocUrl ?? null,
        dto.dateOfBirth ?? null,
        dto.address, dto.locality, dto.city ?? null, dto.state ?? null, dto.pincode ?? null,
        dto.occupation ?? null, dto.loanPurpose ?? null,
        dto.altContact?.trim() || null, dto.altContactName ?? null, dto.altContactRelation ?? null,
        dto.creditScore ?? null, dto.branchId ?? null, user.sub,
      ]);

      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: 'customer.created',
        entityType: 'customer',
        entityId: r.id,
        entityLabel: `${r.customer_code} — ${r.first_name} ${r.last_name ?? ''}`.trim(),
      });
      return {
        id: r.id, customerCode: r.customer_code,
        firstName: r.first_name, lastName: r.last_name,
        email: r.email, phone: r.phone,
      };
    });
  }

  async setActive(user: TenantJwtPayload, id: string, isActive: boolean) {
    if (user.role === 'VIEWER') throw new ForbiddenException('Viewers cannot modify customers');
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query(
        `UPDATE customers SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_active, customer_code, first_name, last_name`,
        [isActive, id],
      );
      if (!res.rows[0]) throw new NotFoundException('Customer not found');
      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: isActive ? 'customer.activated' : 'customer.deactivated',
        entityType: 'customer',
        entityId: r.id,
        entityLabel: `${r.customer_code} — ${r.first_name} ${r.last_name ?? ''}`.trim(),
      });
      return { id: r.id, isActive: r.is_active };
    });
  }

  async softDelete(user: TenantJwtPayload, id: string) {
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(user.role)) {
      throw new ForbiddenException('Only Owner, Manager or Admin can delete customers');
    }
    return this.withSchema(user.schemaName, async (client) => {
      const loanRes = await client.query(
        `SELECT COUNT(*) AS n FROM loans WHERE customer_id = $1 AND status IN ('DISBURSED','APPROVED') AND deleted_at IS NULL`,
        [id],
      );
      if (parseInt(loanRes.rows[0].n) > 0) {
        throw new BadRequestException('Cannot delete customer with active loans. Close all loans first.');
      }
      const res = await client.query(
        `UPDATE customers SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, customer_code, first_name, last_name`,
        [id],
      );
      if (!res.rows[0]) throw new NotFoundException('Customer not found');
      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: 'customer.deleted',
        entityType: 'customer',
        entityId: r.id,
        entityLabel: `${r.customer_code} — ${r.first_name} ${r.last_name ?? ''}`.trim(),
      });
      return { id: r.id, deleted: true };
    });
  }

  async update(user: TenantJwtPayload, id: string, dto: UpdateCustomerDto) {
    if (user.role === 'VIEWER') throw new ForbiddenException('You do not have permission to update customers');
    dto = sanitizeStrings(dto);
    validateCustomerFields({ ...dto, requireCore: false });

    return this.withSchema(user.schemaName, async (client) => {
      const existing = await client.query(
        `SELECT id, phone, pan_number, aadhaar_last4 FROM customers WHERE id = $1`,
        [id],
      );
      if (!existing.rows[0]) throw new NotFoundException('Customer not found');

      const nextPan = dto.panNumber !== undefined ? dto.panNumber : existing.rows[0].pan_number;
      const nextAadhaar = dto.aadhaarLast4 !== undefined ? dto.aadhaarLast4 : existing.rows[0].aadhaar_last4;
      if (!String(nextPan ?? '').trim() && !String(nextAadhaar ?? '').trim()) {
        throw new BadRequestException('At least one of PAN number or Aadhaar number is required');
      }

      if (dto.phone && dto.phone !== existing.rows[0].phone) {
        const dup = await client.query(`SELECT id FROM customers WHERE phone = $1 AND id != $2`, [dto.phone, id]);
        if (dup.rows.length > 0) throw new ConflictException('Phone number already registered to another customer');
      }

      const sets: string[] = [];
      const params: unknown[] = [];

      function addSet(col: string, val: unknown) {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }

      if (dto.firstName !== undefined) addSet('first_name', dto.firstName);
      if (dto.lastName !== undefined) addSet('last_name', dto.lastName);
      if (dto.phone !== undefined) addSet('phone', dto.phone);
      if (dto.email !== undefined) addSet('email', dto.email || null);
      if (dto.panNumber !== undefined) addSet('pan_number', dto.panNumber || null);
      if (dto.aadhaarLast4 !== undefined) addSet('aadhaar_last4', dto.aadhaarLast4 || null);
      if (dto.aadhaarDocUrl !== undefined) addSet('aadhaar_doc_url', dto.aadhaarDocUrl || null);
      if (dto.dateOfBirth !== undefined) addSet('date_of_birth', dto.dateOfBirth || null);
      if (dto.address !== undefined) addSet('address', dto.address);
      if (dto.locality !== undefined) addSet('locality', dto.locality);
      if (dto.city !== undefined) addSet('city', dto.city || null);
      if (dto.state !== undefined) addSet('state', dto.state || null);
      if (dto.pincode !== undefined) addSet('pincode', dto.pincode || null);
      if (dto.occupation !== undefined) addSet('occupation', dto.occupation || null);
      if (dto.loanPurpose !== undefined) addSet('loan_purpose', dto.loanPurpose || null);
      if (dto.altContact !== undefined) addSet('alt_contact', dto.altContact);
      if (dto.altContactName !== undefined) addSet('alt_contact_name', dto.altContactName || null);
      if (dto.altContactRelation !== undefined) addSet('alt_contact_relation', dto.altContactRelation || null);
      if (dto.creditScore !== undefined) addSet('credit_score', dto.creditScore);
      if ('branchId' in dto) addSet('branch_id', dto.branchId ?? null);
      if (dto.isActive !== undefined) addSet('is_active', dto.isActive);

      if (sets.length === 0) throw new BadRequestException('No fields to update');
      addSet('updated_at', new Date().toISOString());
      addSet('updated_by', user.sub);

      params.push(id);
      const res = await client.query(
        `UPDATE customers SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, customer_code, first_name, last_name`,
        params,
      );
      if (!res.rows[0]) throw new NotFoundException('Customer not found');
      const r = res.rows[0];
      await this.activity.record(client, user, {
        action: 'customer.updated',
        entityType: 'customer',
        entityId: r.id,
        entityLabel: `${r.customer_code} — ${r.first_name} ${r.last_name ?? ''}`.trim(),
        metadata: { changedFields: Object.keys(dto) },
      });
      return { id: r.id };
    });
  }
}
