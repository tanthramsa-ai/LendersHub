import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantLoanTypesService } from './tenant-loan-types.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

const user = (role = 'OWNER'): TenantJwtPayload => ({
  sub: 'u1', email: 'o@acme.test', firstName: 'O', lastName: 'Owner', role, tenantId: 't1',
  subdomain: 'acme', schemaName: 'tenant_acme', type: 'tenant_user',
});

describe('TenantLoanTypesService validation', () => {
  let query: jest.Mock;
  let poolConnect: jest.Mock;
  let svc: TenantLoanTypesService;
  let stored: Record<string, unknown>;

  beforeEach(() => {
    stored = { id: 'lt1', min_amount: '1000.00', max_amount: '50000.00', min_interest_rate: null, max_interest_rate: '24', min_term_months: 3, max_term_months: 12 };
    query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT id, min_amount')) return { rows: [stored] };
      if (sql.includes('INSERT INTO') || sql.includes('UPDATE loan_types')) return { rows: [{ id: 'lt1', name: 'Gold', is_active: true, created_at: new Date() }] };
      return { rows: [] };
    });
    poolConnect = jest.fn().mockResolvedValue({ query, release: jest.fn() });
    svc = new TenantLoanTypesService({ pool: { connect: poolConnect } } as unknown as PrismaService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as TenantActivityLogService);
  });

  const create = (dto: Record<string, unknown>) => svc.create(user(), dto as never);

  it('creates a valid loan type', async () => {
    await expect(create({ name: 'Gold loan', minAmount: 1000, maxAmount: 50000, minInterestRate: 12, maxInterestRate: 24, minTermMonths: 3, maxTermMonths: 12 })).resolves.toBeDefined();
  });

  it('accepts the numeric strings the form posts, and blanks as "no limit"', async () => {
    await expect(create({ name: 'Gold', minAmount: '1000', maxAmount: '', minInterestRate: null })).resolves.toBeDefined();
  });

  it.each([
    ['an empty name', { name: '' }], ['a blank name', { name: '   ' }], ['no name', {}], ['a non-text name', { name: 42 }],
    ['an over-long name', { name: 'x'.repeat(101) }],
    ['min amount above max', { name: 'A', minAmount: 500, maxAmount: 100 }],
    ['a negative interest rate', { name: 'A', minInterestRate: -1 }],
    ['an interest rate over 200', { name: 'A', maxInterestRate: 201 }],
    ['min rate above max', { name: 'A', minInterestRate: 30, maxInterestRate: 20 }],
    ['min term above max', { name: 'A', minTermMonths: 24, maxTermMonths: 12 }],
    ['a fractional term', { name: 'A', minTermMonths: 2.5 }],
    ['a non-numeric amount', { name: 'A', minAmount: 'lots' }],
    ['NaN', { name: 'A', maxAmount: NaN }],
    ['an over-long description', { name: 'A', description: 'd'.repeat(501) }],
  ])('refuses %s before touching the database', async (_label, dto) => {
    await expect(create(dto)).rejects.toThrow(BadRequestException);
    expect(poolConnect).not.toHaveBeenCalled();
  });

  it('still limits who may manage loan types', async () => {
    await expect(svc.create(user('AGENT'), { name: 'A' })).rejects.toThrow(ForbiddenException);
  });

  describe('update', () => {
    it('rejects raising the minimum above a maximum that is already stored', async () => {
      await expect(svc.update(user(), 'lt1', { minAmount: 60000 })).rejects.toThrow('Minimum amount cannot be greater than the maximum');
    });

    it('rejects lowering the maximum below a stored minimum', async () => {
      await expect(svc.update(user(), 'lt1', { maxTermMonths: 2 })).rejects.toThrow('Minimum term cannot be greater than the maximum');
    });

    it('allows a change that keeps min <= max', async () => {
      await expect(svc.update(user(), 'lt1', { minAmount: 2000 })).resolves.toBeDefined();
    });

    it('allows toggling isActive without any limit checks', async () => {
      await expect(svc.update(user(), 'lt1', { isActive: false })).resolves.toBeDefined();
    });

    it('rejects blanking the name', async () => {
      await expect(svc.update(user(), 'lt1', { name: '  ' })).rejects.toThrow(BadRequestException);
    });
  });
});
