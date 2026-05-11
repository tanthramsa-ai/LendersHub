import { Injectable, ConflictException, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from './email.service';
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

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
  ) {}

  async checkSubdomain(subdomain: string): Promise<{ available: boolean; valid: boolean }> {
    const valid = SUBDOMAIN_RE.test(subdomain);
    if (!valid) return { valid: false, available: false };
    const existing = await this.prisma.tenant.findUnique({ where: { subdomain } });
    return { valid: true, available: !existing };
  }

  async create(dto: CreateTenantDto) {
    this.logger.log(`[CREATE:1] Validating subdomain "${dto.subdomain}"`);
    if (!SUBDOMAIN_RE.test(dto.subdomain)) {
      throw new BadRequestException('Invalid subdomain format');
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

      const loginUrl = process.env.APP_URL
        ? `${process.env.APP_URL}/${dto.subdomain}/login`
        : `http://${dto.subdomain}.lendershub.com/login`;

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
    if (filters.status) where.status = filters.status as Prisma.EnumTenantStatusFilter;
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

  async configureSubscription(id: string, dto: ConfigureSubscriptionDto) {
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
