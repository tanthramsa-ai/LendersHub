import { Injectable, ConflictException, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';
import { VercelDomainService } from './vercel-domain.service';
import { AuditLogService, AuditActor } from '../audit-log/audit-log.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ConfigureSubscriptionDto } from './dto/configure-subscription.dto';
import { tenantSchemaDDL } from './tenant-schema';

const PLAN_BASE_PRICE: Record<string, number> = {
  STARTER: 12000,
  PROFESSIONAL: 25000,
  ENTERPRISE: 45000,
};

const BILLING_DISCOUNT: Record<string, number> = {
  MONTHLY: 0,
  QUARTERLY: 0.05,
  ANNUALLY: 0.15,
};

const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9]|[a-z0-9]{0,18})$/;

// Platform-reserved labels a tenant must never be allowed to claim — these are
// used by the app/marketing/infra hosts and are excluded in the frontend middleware.
const RESERVED_SUBDOMAINS = new Set([
  'app', 'www', 'api', 'admin', 'super-admin', 'mail', 'smtp', 'ftp',
  'ns', 'ns1', 'ns2', 'cdn', 'static', 'assets', 'status', 'blog', 'shop',
  'sandbox', 'demo', 'staging',
]);

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private vercel: VercelDomainService,
    private auditLog: AuditLogService,
  ) {}

  async checkSubdomain(subdomain: string): Promise<{ available: boolean; valid: boolean }> {
    const valid = SUBDOMAIN_RE.test(subdomain);
    if (!valid) return { valid: false, available: false };
    if (RESERVED_SUBDOMAINS.has(subdomain)) return { valid: false, available: false };
    const existing = await this.prisma.tenant.findUnique({ where: { subdomain } });
    return { valid: true, available: !existing };
  }

  async create(dto: CreateTenantDto, actor: AuditActor, ipAddress: string) {
    this.logger.log(`[CREATE:1] Validating subdomain "${dto.subdomain}"`);
    if (!SUBDOMAIN_RE.test(dto.subdomain)) {
      throw new BadRequestException('Invalid subdomain format');
    }
    if (RESERVED_SUBDOMAINS.has(dto.subdomain)) {
      throw new BadRequestException('This subdomain is reserved and cannot be used');
    }

    this.logger.log(`[CREATE:2] Checking for existing tenant`);
    const existing = await this.prisma.tenant.findUnique({ where: { subdomain: dto.subdomain } });
    if (existing) {
      if (existing.status !== 'FAILED') throw new ConflictException('Subdomain is already taken');
      this.logger.log(`[CREATE:2] Deleting previous FAILED tenant`);
      await this.prisma.tenant.delete({ where: { id: existing.id } });
    }

    this.logger.log(`[CREATE:3] Checking email uniqueness for ${dto.adminEmail}`);
    const emailInUse = await this.runWithBypass(async (client) => {
      const result = await client.query(
        'SELECT COUNT(*)::int AS n FROM users WHERE email = $1',
        [dto.adminEmail],
      );
      return (result.rows[0].n as number) > 0;
    });
    if (emailInUse) throw new ConflictException('Admin email is already registered');

    const provisionStart = Date.now();
    const schemaName = `tenant_${dto.subdomain.replace(/-/g, '_')}`;

    this.logger.log(`[CREATE:4] Creating tenant record (PROVISIONING)`);
    const tenant = await this.prisma.tenant.create({
      data: {
        companyName: dto.companyName,
        subdomain: dto.subdomain,
        registrationNumber: dto.registrationNumber,
        gstNumber: dto.gstNumber,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        primaryColor: dto.primaryColor,
        customDomain: dto.customDomain,
        features: dto.features ?? undefined,
        adminEmail: dto.adminEmail,
        schemaName,
        status: 'PROVISIONING',
      },
    });
    this.logger.log(`[CREATE:4] Tenant record created id=${tenant.id}`);

    try {
      this.logger.log(`[CREATE:5] Generating password and creating admin user`);
      const temporaryPassword = this.generatePassword();
      const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

      const adminUserRow = await this.runWithBypass(async (client) => {
        const result = await client.query(
          `INSERT INTO users (id, email, password, first_name, last_name, role, tenant_id, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'LENDER', $5, NOW(), NOW())
           RETURNING id, email, first_name, last_name, role, tenant_id, created_at`,
          [dto.adminEmail, hashedPassword, dto.adminFirstName, dto.adminLastName, tenant.id],
        );
        return result.rows[0] as { id: string; email: string; first_name: string; last_name: string; role: string; tenant_id: string; created_at: Date };
      });
      const adminUser = {
        id: adminUserRow.id,
        email: adminUserRow.email,
        firstName: adminUserRow.first_name,
        lastName: adminUserRow.last_name,
        role: adminUserRow.role,
        tenantId: adminUserRow.tenant_id,
        createdAt: adminUserRow.created_at,
      };
      this.logger.log(`[CREATE:5] Admin user created id=${adminUser.id}`);

      this.logger.log(`[CREATE:6] Provisioning schema "${schemaName}"`);
      await this.provisionSchema(schemaName);

      this.logger.log(`[CREATE:7] Seeding admin into tenant schema`);
      await this.seedTenantAdmin(schemaName, dto.adminEmail, hashedPassword, dto.adminFirstName, dto.adminLastName);

      // Register the subdomain with Vercel so it routes + gets a TLS cert.
      // Non-fatal: a failure here shouldn't abort an otherwise-provisioned tenant.
      this.logger.log(`[CREATE:7b] Registering Vercel domain`);
      await this.vercel.addSubdomain(dto.subdomain);

      let subscriptionData = {};
      if (dto.plan && dto.billingCycle) {
        const basePrice = PLAN_BASE_PRICE[dto.plan];
        const discount = BILLING_DISCOUNT[dto.billingCycle] ?? 0;
        const monthlyAmount = +(basePrice * (1 - discount)).toFixed(2);
        const hasTrial = dto.trialDays && dto.trialDays > 0;
        const now = new Date();
        const trialEndsAt = hasTrial ? new Date(now.getTime() + dto.trialDays! * 86_400_000) : null;
        subscriptionData = {
          plan: dto.plan,
          billingCycle: dto.billingCycle,
          trialDays: dto.trialDays ?? null,
          trialEndsAt,
          subscriptionStartsAt: hasTrial ? trialEndsAt : now,
          monthlyAmount,
          subscriptionStatus: hasTrial ? 'TRIAL' : 'ACTIVE',
        };
      }

      this.logger.log(`[CREATE:8] Marking tenant ACTIVE`);
      const activeTenant = await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', ...subscriptionData },
      });

      const provisionMs = Date.now() - provisionStart;
      this.logger.log(`[CREATE:DONE] Tenant ${dto.subdomain} provisioned in ${provisionMs}ms`);

      await this.auditLog.record({
        actor, ipAddress,
        action: 'tenant.created',
        targetType: 'tenant',
        targetId: tenant.id,
        targetLabel: dto.companyName,
        metadata: { subdomain: dto.subdomain, plan: dto.plan ?? null, provisionedInMs: provisionMs },
      });

      const loginUrl = process.env.APP_URL
        ? `${process.env.APP_URL}/${dto.subdomain}/login`
        : `http://${dto.subdomain}.lendershub.in/login`;

      let emailPreviewUrl: string | null = null;
      try {
        emailPreviewUrl = await this.email.sendWelcomeEmail({
          to: dto.adminEmail,
          companyName: dto.companyName,
          subdomain: dto.subdomain,
          temporaryPassword,
          loginUrl,
        });
      } catch (err) {
        this.logger.error(`Failed to send welcome email to ${dto.adminEmail}: ${err}`);
      }

      return {
        tenant: activeTenant,
        admin: adminUser,
        temporaryPassword,
        loginUrl,
        ...(emailPreviewUrl ? { emailPreviewUrl } : {}),
        provisionedInMs: provisionMs,
      };
    } catch (err) {
      this.logger.error(
        `[CREATE:FAILED] Tenant ${dto.subdomain} failed: ${(err as Error)?.message}`,
        (err as Error)?.stack,
      );
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'FAILED' },
      }).catch(() => {});
      throw err;
    }
  }

  // Acquires a dedicated pg connection, wraps the callback in BEGIN/set_config/COMMIT
  // so every query inside sees app.bypass_rls='true' on the same connection.
  // ── Branch management ────────────────────────────────────────────────────────

  private async withTenantSchema<T>(tenantId: string, fn: (client: import('pg').PoolClient, schemaName: string) => Promise<T>): Promise<T> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true } });
    if (!tenant?.schemaName) throw new NotFoundException('Tenant schema not found');
    const schemaName = tenant.schemaName;
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      // Ensure branches/loan_types tables exist (idempotent for existing tenants)
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}"."branches" (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL, code TEXT NOT NULL,
          address TEXT, city TEXT, state TEXT,
          phone TEXT, email TEXT, manager_name TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_${schemaName}_branches_code UNIQUE (code)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS "${schemaName}"."loan_types" (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL, description TEXT,
          min_amount NUMERIC(14,2), max_amount NUMERIC(14,2),
          min_interest_rate NUMERIC(7,4), max_interest_rate NUMERIC(7,4),
          min_term_months SMALLINT, max_term_months SMALLINT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_${schemaName}_loan_types_name UNIQUE (name)
        )
      `);
      return await fn(client, schemaName);
    } finally {
      client.release();
    }
  }

  async listBranches(tenantId: string) {
    return this.withTenantSchema(tenantId, async (client) => {
      // Sequential: a single pg connection cannot run queries concurrently.
      const branchRes = await client.query(`SELECT * FROM branches ORDER BY created_at ASC`);
      const userCount = await client.query<{ branch_id: string | null; n: string }>(`SELECT branch_id, COUNT(*) AS n FROM users GROUP BY branch_id`);
      const customerCount = await client.query<{ branch_id: string | null; n: string }>(`SELECT branch_id, COUNT(*) AS n FROM customers GROUP BY branch_id`);
      const loanCount = await client.query<{ branch_id: string | null; n: string }>(`SELECT branch_id, COUNT(*) AS n FROM loans GROUP BY branch_id`).catch(() => ({ rows: [] as { branch_id: string | null; n: string }[] }));
      const uMap = Object.fromEntries(userCount.rows.map((r) => [r.branch_id ?? 'null', parseInt(r.n)]));
      const cMap = Object.fromEntries(customerCount.rows.map((r) => [r.branch_id ?? 'null', parseInt(r.n)]));
      const lMap = Object.fromEntries(loanCount.rows.map((r) => [r.branch_id ?? 'null', parseInt(r.n)]));
      return branchRes.rows.map((b) => ({
        id: b.id, name: b.name, code: b.code,
        address: b.address, city: b.city, state: b.state,
        phone: b.phone, email: b.email, managerName: b.manager_name,
        isActive: b.is_active, createdAt: b.created_at,
        userCount: uMap[b.id] ?? 0,
        customerCount: cMap[b.id] ?? 0,
        loanCount: lMap[b.id] ?? 0,
      }));
    });
  }

  async createBranch(tenantId: string, dto: {
    name: string; code: string;
    address?: string; city?: string; state?: string;
    phone?: string; email?: string; managerName?: string;
  }, actor: AuditActor, ipAddress: string) {
    const branch = await this.withTenantSchema(tenantId, async (client) => {
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

    await this.auditLog.record({
      actor, ipAddress,
      action: 'branch.created',
      targetType: 'branch',
      targetId: branch.id,
      targetLabel: `${branch.name} (${branch.code})`,
      metadata: { tenantId },
    });

    return branch;
  }

  // ── Tenant user management (super-admin bootstrap) ──────────────────────────

  async listTenantUsers(tenantId: string) {
    return this.withTenantSchema(tenantId, async (client) => {
      const res = await client.query(`
        SELECT id, email, first_name, last_name, phone, role, is_active, created_at
        FROM users
        ORDER BY created_at ASC
      `);
      return res.rows.map((u) => ({
        id: u.id, email: u.email,
        firstName: u.first_name, lastName: u.last_name,
        phone: u.phone, role: u.role,
        isActive: u.is_active, createdAt: u.created_at,
      }));
    });
  }

  async createTenantUser(
    tenantId: string,
    dto: { email: string; password: string; firstName: string; lastName: string; phone?: string; role: string },
    actor: AuditActor,
    ipAddress: string,
  ) {
    const VALID_ROLES = ['OWNER', 'MANAGER', 'ADMIN', 'LOAN_OFFICER', 'COLLECTOR', 'VIEWER'];
    if (!dto.email?.trim()) throw new BadRequestException('Email is required');
    if (!dto.firstName?.trim() || !dto.lastName?.trim()) throw new BadRequestException('First and last name are required');
    if (!dto.password || dto.password.length < 6) throw new BadRequestException('Password must be at least 6 characters');
    if (!VALID_ROLES.includes(dto.role)) throw new BadRequestException('Invalid role');

    const hashed = await bcrypt.hash(dto.password, 10);
    const phone = dto.phone?.replace(/\s|-/g, '').trim() || null;

    const user = await this.withTenantSchema(tenantId, async (client) => {
      const existing = await client.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [dto.email.trim()]);
      if (existing.rows.length > 0) throw new ConflictException('A user with this email already exists in this tenant');

      const res = await client.query(
        `INSERT INTO users (email, password, first_name, last_name, phone, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, first_name, last_name, phone, role, is_active, created_at`,
        [dto.email.trim().toLowerCase(), hashed, dto.firstName.trim(), dto.lastName.trim(), phone, dto.role],
      );
      return res.rows[0];
    });

    await this.auditLog.record({
      actor, ipAddress,
      action: 'tenant.user.created',
      targetType: 'tenant_user',
      targetId: user.id,
      targetLabel: `${user.email} (${user.role})`,
      metadata: { tenantId },
    });

    return {
      id: user.id, email: user.email,
      firstName: user.first_name, lastName: user.last_name,
      phone: user.phone, role: user.role,
      isActive: user.is_active, createdAt: user.created_at,
    };
  }

  async resetTenantUserPassword(
    tenantId: string,
    userId: string,
    newPassword: string,
    actor: AuditActor,
    ipAddress: string,
  ) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    const user = await this.withTenantSchema(tenantId, async (client) => {
      const res = await client.query(
        `UPDATE users SET password = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, email, first_name, last_name, role`,
        [hashed, userId],
      );
      if (!res.rows[0]) throw new NotFoundException('User not found');
      return res.rows[0];
    });

    await this.auditLog.record({
      actor,
      ipAddress,
      action: 'tenant.user.password_reset',
      targetType: 'tenant_user',
      targetId: user.id,
      targetLabel: `${user.email} (${user.role})`,
      metadata: { tenantId, firstName: user.first_name, lastName: user.last_name },
    });

    return { success: true };
  }

  async getBranch(tenantId: string, branchId: string) {
    return this.withTenantSchema(tenantId, async (client) => {
      // Sequential: a single pg connection cannot run queries concurrently.
      const branchRes = await client.query(`SELECT * FROM branches WHERE id = $1`, [branchId]);
      const counts = await client.query<{ users: string; customers: string; loans: string }>(`
          SELECT
            (SELECT COUNT(*) FROM users     WHERE branch_id = $1) AS users,
            (SELECT COUNT(*) FROM customers WHERE branch_id = $1) AS customers,
            (SELECT COUNT(*) FROM loans     WHERE branch_id = $1) AS loans
        `, [branchId]);
      const loanTypes = await client.query(`SELECT id, name, description, min_amount, max_amount, min_interest_rate, max_interest_rate, min_term_months, max_term_months, is_active FROM loan_types ORDER BY name`).catch(() => ({ rows: [] }));
      if (!branchRes.rows[0]) throw new NotFoundException('Branch not found');
      const b = branchRes.rows[0];
      const c = counts.rows[0];
      return {
        id: b.id, name: b.name, code: b.code,
        address: b.address, city: b.city, state: b.state,
        phone: b.phone, email: b.email, managerName: b.manager_name,
        isActive: b.is_active, createdAt: b.created_at, updatedAt: b.updated_at,
        stats: {
          users: parseInt(c.users), customers: parseInt(c.customers), loans: parseInt(c.loans),
        },
        loanTypes: loanTypes.rows.map((lt) => ({
          id: lt.id, name: lt.name, description: lt.description,
          minAmount: lt.min_amount, maxAmount: lt.max_amount,
          minInterestRate: lt.min_interest_rate, maxInterestRate: lt.max_interest_rate,
          minTermMonths: lt.min_term_months, maxTermMonths: lt.max_term_months,
          isActive: lt.is_active,
        })),
      };
    });
  }

  async updateBranch(tenantId: string, branchId: string, dto: {
    name?: string; address?: string; city?: string; state?: string;
    phone?: string; email?: string; managerName?: string; isActive?: boolean;
  }, actor: AuditActor, ipAddress: string) {
    const branch = await this.withTenantSchema(tenantId, async (client) => {
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
          dto.phone ?? null, dto.email ?? null, dto.managerName ?? null, dto.isActive ?? null, branchId]);
      if (!res.rows[0]) throw new NotFoundException('Branch not found');
      const b = res.rows[0];
      return { id: b.id, name: b.name, code: b.code, isActive: b.is_active };
    });

    await this.auditLog.record({
      actor, ipAddress,
      action: 'branch.updated',
      targetType: 'branch',
      targetId: branch.id,
      targetLabel: `${branch.name} (${branch.code})`,
      metadata: { tenantId, changes: dto },
    });

    return branch;
  }

  async createLoanType(tenantId: string, dto: {
    name: string; description?: string;
    minAmount?: number; maxAmount?: number;
    minInterestRate?: number; maxInterestRate?: number;
    minTermMonths?: number; maxTermMonths?: number;
  }, actor: AuditActor, ipAddress: string) {
    const loanType = await this.withTenantSchema(tenantId, async (client) => {
      const res = await client.query(`
        INSERT INTO loan_types (name, description, min_amount, max_amount, min_interest_rate, max_interest_rate, min_term_months, max_term_months)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [dto.name, dto.description ?? null, dto.minAmount ?? null, dto.maxAmount ?? null,
          dto.minInterestRate ?? null, dto.maxInterestRate ?? null, dto.minTermMonths ?? null, dto.maxTermMonths ?? null]);
      const lt = res.rows[0];
      return { id: lt.id, name: lt.name, description: lt.description, isActive: lt.is_active };
    });

    await this.auditLog.record({
      actor, ipAddress,
      action: 'loan_type.created',
      targetType: 'loan_type',
      targetId: loanType.id,
      targetLabel: loanType.name,
      metadata: { tenantId },
    });

    return loanType;
  }

  private async runWithBypass<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.bypass_rls', 'true', TRUE)");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async list(
    page = 1,
    limit = 20,
    filters: {
      search?: string;
      plan?: string;
      status?: string;
      subscriptionStatus?: string;
      sortBy?: string;
      sortDir?: 'asc' | 'desc';
    } = {},
  ) {
    const skip = (page - 1) * limit;
    const dir = filters.sortDir ?? 'desc';

    const where: Prisma.TenantWhereInput = {};
    if (filters.status) {
      where.status = filters.status as Prisma.EnumTenantStatusFilter;
    } else {
      // Deleted tenants are hidden by default; explicitly filter status=DELETED to see them.
      where.status = { not: 'DELETED' };
    }
    if (filters.plan) where.plan = filters.plan as Prisma.EnumSubscriptionPlanNullableFilter;
    if (filters.subscriptionStatus) where.subscriptionStatus = filters.subscriptionStatus as Prisma.EnumSubscriptionStatusNullableFilter;
    if (filters.search) {
      where.OR = [
        { companyName: { contains: filters.search, mode: 'insensitive' } },
        { subdomain: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    let orderBy: Prisma.TenantOrderByWithRelationInput = { createdAt: dir };
    if (filters.sortBy === 'mrr') orderBy = { monthlyAmount: dir };
    else if (filters.sortBy === 'users') orderBy = { users: { _count: dir } };
    else if (filters.sortBy === 'createdAt') orderBy = { createdAt: dir };

    const [total, tenants] = await Promise.all([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: { _count: { select: { users: true, loans: true } } },
      }),
    ]);
    return { total, page, limit, tenants };
  }

  /** Locks out an ACTIVE tenant — login is blocked (tenant-auth requires status === 'ACTIVE'). Reversible via reactivate(). */
  async suspend(id: string, actor: AuditActor, ipAddress: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'DELETED') throw new BadRequestException('Tenant has been deleted');
    if (tenant.status === 'SUSPENDED') throw new ConflictException('Tenant is already suspended');

    const updated = await this.prisma.tenant.update({ where: { id }, data: { status: 'SUSPENDED' } });

    await this.auditLog.record({
      actor, ipAddress,
      action: 'tenant.suspended',
      targetType: 'tenant',
      targetId: id,
      targetLabel: tenant.companyName,
      metadata: { previousStatus: tenant.status },
    });

    return updated;
  }

  /** Restores a SUSPENDED tenant to ACTIVE, re-enabling login. */
  async reactivate(id: string, actor: AuditActor, ipAddress: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'DELETED') throw new BadRequestException('Tenant has been deleted');
    if (tenant.status !== 'SUSPENDED') throw new ConflictException('Only a suspended tenant can be reactivated');

    const updated = await this.prisma.tenant.update({ where: { id }, data: { status: 'ACTIVE' } });

    await this.auditLog.record({
      actor, ipAddress,
      action: 'tenant.reactivated',
      targetType: 'tenant',
      targetId: id,
      targetLabel: tenant.companyName,
    });

    return updated;
  }

  /**
   * Soft-delete only — the tenant's schema and data are NOT dropped. Sets
   * status to DELETED (blocks login, same as SUSPENDED) and hides the tenant
   * from the default list. Requires the caller to type the exact subdomain
   * as confirmation (checked here, not just in the UI) since this is
   * effectively irreversible from the product surface — there is no
   * "undelete" endpoint, matching how destructive actions should require
   * explicit, hard-to-fat-finger confirmation.
   */
  async softDelete(id: string, confirmSubdomain: string, actor: AuditActor, ipAddress: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'DELETED') throw new ConflictException('Tenant is already deleted');
    if (confirmSubdomain !== tenant.subdomain) {
      throw new BadRequestException('Confirmation subdomain does not match');
    }

    const updated = await this.prisma.tenant.update({ where: { id }, data: { status: 'DELETED' } });

    await this.auditLog.record({
      actor, ipAddress,
      action: 'tenant.deleted',
      targetType: 'tenant',
      targetId: id,
      targetLabel: tenant.companyName,
      metadata: { previousStatus: tenant.status, subdomain: tenant.subdomain },
    });

    return updated;
  }

  async findOne(id: string) {
    return this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, loans: true } },
        users: {
          select: { id: true, email: true, firstName: true, lastName: true, role: true, createdAt: true },
          take: 20,
        },
      },
    });
  }

  async configureSubscription(id: string, dto: ConfigureSubscriptionDto, actor: AuditActor, ipAddress: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const basePrice = PLAN_BASE_PRICE[dto.plan];
    const discount = BILLING_DISCOUNT[dto.billingCycle];
    const monthlyAmount = +(basePrice * (1 - discount)).toFixed(2);

    const hasTrial = dto.trialDays && dto.trialDays > 0;
    const now = new Date();
    const trialEndsAt = hasTrial ? new Date(now.getTime() + dto.trialDays! * 86_400_000) : null;
    const subscriptionStartsAt = hasTrial ? trialEndsAt : now;

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        plan: dto.plan as any,
        billingCycle: dto.billingCycle as any,
        trialDays: dto.trialDays ?? null,
        trialEndsAt,
        subscriptionStartsAt,
        monthlyAmount,
        subscriptionStatus: hasTrial ? 'TRIAL' : 'ACTIVE',
      },
    });

    await this.auditLog.record({
      actor, ipAddress,
      action: 'tenant.subscription_updated',
      targetType: 'tenant',
      targetId: id,
      targetLabel: tenant.companyName,
      metadata: {
        fromPlan: tenant.plan, toPlan: dto.plan,
        fromBillingCycle: tenant.billingCycle, toBillingCycle: dto.billingCycle,
        monthlyAmount,
      },
    });

    return {
      tenant: updated,
      monthlyAmount,
      effectivePrice: monthlyAmount,
      discountApplied: discount,
      trialEndsAt,
      subscriptionStartsAt,
    };
  }

  getPlans() {
    return [
      {
        id: 'STARTER',
        name: 'Starter',
        basePrice: 12000,
        features: ['Up to 50 users', '5 GB storage', 'Core features', 'Basic support'],
      },
      {
        id: 'PROFESSIONAL',
        name: 'Professional',
        basePrice: 25000,
        popular: true,
        features: ['Up to 200 users', '50 GB storage', 'Advanced features', 'Priority support', 'API access'],
      },
      {
        id: 'ENTERPRISE',
        name: 'Enterprise',
        basePrice: 45000,
        features: ['Unlimited users', '500 GB storage', 'White-labeling', '24/7 support', 'SLA guarantee'],
      },
    ];
  }

  private async provisionSchema(schemaName: string): Promise<void> {
    const start = Date.now();
    for (const sql of tenantSchemaDDL(schemaName)) {
      await this.prisma.$executeRawUnsafe(sql);
    }
    this.logger.log(`Schema "${schemaName}" provisioned in ${Date.now() - start}ms`);
  }

  private async seedTenantAdmin(
    schemaName: string,
    email: string,
    hashedPassword: string,
    firstName: string,
    lastName: string,
  ): Promise<void> {
    // Schema name goes into the identifier (validated subdomain — safe to interpolate).
    // All user-supplied values are passed as positional parameters to prevent injection.
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}"."users" (email, password, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, 'ADMIN')
       ON CONFLICT (email) DO NOTHING`,
      email,
      hashedPassword,
      firstName,
      lastName,
    );
    this.logger.log(`Admin user seeded into "${schemaName}"`);
  }

  private generatePassword(): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const special = '!@#$%&*';
    const all = upper + lower + digits + special;
    const bytes = randomBytes(20);
    // Guarantee at least one of each category
    const pwd = [
      upper[bytes[0] % upper.length],
      lower[bytes[1] % lower.length],
      digits[bytes[2] % digits.length],
      special[bytes[3] % special.length],
      ...Array.from({ length: 12 }, (_, i) => all[bytes[4 + i] % all.length]),
    ];
    // Fisher-Yates shuffle
    for (let i = pwd.length - 1; i > 0; i--) {
      const j = bytes[i] % (i + 1);
      [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
    }
    return pwd.join('');
  }
}
