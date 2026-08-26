import { TenantFundersService } from './tenant-funders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';

function makeUser(overrides: Partial<TenantJwtPayload> = {}): TenantJwtPayload {
  return {
    sub: 'u1',
    email: 'owner@acme.test',
    firstName: 'Ann',
    lastName: 'Owner',
    role: 'OWNER',
    tenantId: 't1',
    subdomain: 'acme',
    schemaName: 'tenant_acme',
    type: 'tenant_user',
    ...overrides,
  };
}

describe('TenantFundersService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let activity: TenantActivityLogService;
  let svc: TenantFundersService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect } } as unknown as PrismaService;
    activity = { record: jest.fn().mockResolvedValue(undefined) } as unknown as TenantActivityLogService;
    svc = new TenantFundersService(prisma, activity);
    // Pre-mark the schema as already having its tables — ensureTables() would
    // otherwise consume the mockResolvedValueOnce queue meant for the real
    // assertions below (same warm-cache state production settles into after
    // the first call in a process).
    (svc as unknown as { ensuredSchemas: Set<string> }).ensuredSchemas.add('tenant_acme');
  });

  describe('access control', () => {
    it.each(['MANAGER', 'AGENT', 'STAFF', 'CUSTOMER'] as const)('rejects %s from listing funders', async (role) => {
      await expect(svc.listFunders(makeUser({ role }), 1, 50)).rejects.toThrow(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });
  });

  describe('createFunder', () => {
    it('rejects a blank name before touching the database', async () => {
      await expect(svc.createFunder(makeUser(), { name: '  ' })).rejects.toThrow(BadRequestException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('trims the name and inserts', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Funder One', email: null, phone: null, is_active: true, created_at: 't', updated_at: 't' }] });

      const result = await svc.createFunder(makeUser(), { name: '  Funder One  ' });

      expect(result.name).toBe('Funder One');
      expect(result.balance).toBe(0);
      const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO funders'));
      expect(insertCall![1]).toEqual(['Funder One', null, null]);
    });
  });

  describe('postFunderTransaction', () => {
    it('rejects a zero amount', async () => {
      await expect(
        svc.postFunderTransaction(makeUser(), 'f1', { transactionType: 'CONTRIBUTION', amount: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a negative amount for CONTRIBUTION (direction comes from type, not sign)', async () => {
      await expect(
        svc.postFunderTransaction(makeUser(), 'f1', { transactionType: 'CONTRIBUTION', amount: -100 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a negative amount for ADJUSTMENT', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'f1', name: 'Funder One' }] }) // funder lookup
        .mockResolvedValueOnce({ rows: [{ id: 'ft1', funder_id: 'f1', transaction_date: '2026-08-24', transaction_type: 'ADJUSTMENT', amount: '-500', reference_number: null, notes: null, status: 'POSTED', reversal_of_id: null, created_by: 'u1', created_at: 't' }] });

      const txn = await svc.postFunderTransaction(makeUser(), 'f1', { transactionType: 'ADJUSTMENT', amount: -500 });
      expect(txn.amount).toBe(-500);
    });

    it('throws NotFoundException for a missing funder', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }); // funder lookup empty
      await expect(
        svc.postFunderTransaction(makeUser(), 'missing', { transactionType: 'CONTRIBUTION', amount: 100 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reverseFunderTransaction', () => {
    it('rejects without a reason', async () => {
      await expect(svc.reverseFunderTransaction(makeUser(), 'f1', 'ft1', '')).rejects.toThrow(BadRequestException);
    });

    it('inserts a negated reversal and flips the original to REVERSED', async () => {
      const original = { id: 'ft1', funder_id: 'f1', transaction_date: '2026-08-24', transaction_type: 'CONTRIBUTION', amount: '5000', reference_number: null, notes: null, status: 'POSTED', reversal_of_id: null, created_by: 'u1', created_at: 't' };
      const reversal = { ...original, id: 'ft2', amount: '-5000', reversal_of_id: 'ft1' };
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [original] }) // SELECT original
        .mockResolvedValueOnce({ rows: [reversal] }) // INSERT reversal
        .mockResolvedValueOnce({ rows: [] }); // UPDATE original status

      const result = await svc.reverseFunderTransaction(makeUser(), 'f1', 'ft1', 'entered twice');
      expect(result.amount).toBe(-5000);
      expect(result.reversalOfId).toBe('ft1');
      const updateCall = query.mock.calls.find((c) => String(c[0]).includes('UPDATE funder_transactions'));
      expect(updateCall![1]).toEqual(['ft1']);
    });
  });

  describe('setLoanAllocations', () => {
    it('rejects allocations that do not sum to the loan principal', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', principal: '100000' }] }); // loan lookup

      await expect(
        svc.setLoanAllocations(makeUser(), 'loan1', [{ funderId: 'f1', amount: 60000 }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a funder listed twice', async () => {
      await expect(
        svc.setLoanAllocations(makeUser(), 'loan1', [{ funderId: 'f1', amount: 500 }, { funderId: 'f1', amount: 500 }]),
      ).rejects.toThrow(BadRequestException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('replaces the allocation set atomically when the sum matches', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', principal: '100000' }] }) // loan lookup
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // DELETE existing
        .mockResolvedValueOnce({ rows: [] }) // INSERT f1
        .mockResolvedValueOnce({ rows: [] }) // INSERT f2
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        // getLoanAllocations() re-fetch opens its own connection:
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', loan_number: 'LN-1', principal: '100000' }] })
        .mockResolvedValueOnce({ rows: [
          { funder_id: 'f1', funder_name: 'Funder One', amount: '60000' },
          { funder_id: 'f2', funder_name: 'Funder Two', amount: '40000' },
        ] });

      const result = await svc.setLoanAllocations(makeUser(), 'loan1', [
        { funderId: 'f1', amount: 60000 },
        { funderId: 'f2', amount: 40000 },
      ]);

      expect(result.allocated).toBe(100000);
      expect(result.unallocated).toBe(0);
      expect(result.allocations).toHaveLength(2);
      const deleteCall = query.mock.calls.find((c) => String(c[0]).includes('DELETE FROM loan_funder_allocations'));
      expect(deleteCall![1]).toEqual(['loan1']);
    });
  });
});
