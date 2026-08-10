import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantCollectionsService } from './tenant-collections.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';

// Collection workflow (SCHEDULED -> COLLECTED -> CONFIRMED) tests, spec §16 step 11.
//
// The oldest-first settlement / pending-installment accumulation / concurrency-lock
// behavior in collectPayment and confirmPayment was verified end-to-end against a
// live Postgres instance during implementation (multi-installment partial payment,
// idempotent duplicate submission, agent-confirm rejection, manager confirm,
// already-confirmed re-submission, and a real concurrent double-collect race that
// correctly rejected the second request). Those flows are transaction-heavy enough
// that a mocked pg client would mostly test the mock, not the logic — this file
// covers what's cheap and meaningful to assert without a real database: input
// validation, RBAC gating, idempotency short-circuits, and the pure date-window math.

function makeUser(overrides: Partial<TenantJwtPayload> = {}): TenantJwtPayload {
  return {
    sub: 'agent-1',
    email: 'agent@acme.test',
    firstName: 'Ann',
    lastName: 'Agent',
    role: 'AGENT',
    tenantId: 't1',
    subdomain: 'acme',
    schemaName: 'tenant_acme',
    type: 'tenant_user',
    ...overrides,
  };
}

describe('TenantCollectionsService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let activity: TenantActivityLogService;
  let svc: TenantCollectionsService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect }, $executeRawUnsafe: jest.fn().mockResolvedValue(undefined) } as unknown as PrismaService;
    activity = { record: jest.fn().mockResolvedValue(undefined) } as unknown as TenantActivityLogService;
    svc = new TenantCollectionsService(prisma, activity);
  });

  describe('collectPayment — validation & RBAC (spec §13)', () => {
    it('rejects a zero amount before touching the database', async () => {
      await expect(
        svc.collectPayment(makeUser(), 'inst-1', { amount: 0, paymentMethod: 'CASH' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('rejects a negative amount', async () => {
      await expect(
        svc.collectPayment(makeUser(), 'inst-1', { amount: -5, paymentMethod: 'CASH' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a CUSTOMER role before touching the database', async () => {
      await expect(
        svc.collectPayment(makeUser({ role: 'CUSTOMER' }), 'inst-1', { amount: 100, paymentMethod: 'CASH' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('allows AGENT, STAFF, and every manager-tier role to attempt a collection', async () => {
      // Each of these should get past the role gate and reach the DB (where the
      // mocked client then returns no installment, surfacing as NotFound —
      // proving the RBAC check itself did not block them).
      for (const role of ['AGENT', 'STAFF', 'MANAGER', 'ADMIN', 'OWNER'] as const) {
        query.mockClear();
        query.mockResolvedValue({ rows: [] }); // installment lookup finds nothing
        await expect(
          svc.collectPayment(makeUser({ role }), 'inst-1', { amount: 100, paymentMethod: 'CASH' }),
        ).rejects.toThrow(/not found/i);
      }
    });

    it('returns the original result on a duplicate idempotency key without re-running the collection', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path (withSchema)
        .mockResolvedValueOnce({ rows: [{ id: 'payment-existing' }] }); // idempotency dupe check
      const result = await svc.collectPayment(makeUser(), 'inst-1', {
        amount: 500, paymentMethod: 'CASH', idempotencyKey: 'retry-key-1',
      });
      expect(result).toEqual({ success: true, paymentId: 'payment-existing', duplicate: true });
      // Only SET search_path + the dupe-check query ran — no BEGIN, no installment lookup.
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1][0]).toContain('idempotency_key');
    });

    it('rejects when the installment does not belong to this agent (ownership scoping)', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // instRes: AGENT-scoped WHERE finds nothing
      await expect(
        svc.collectPayment(makeUser({ role: 'AGENT' }), 'inst-not-mine', { amount: 100, paymentMethod: 'CASH' }),
      ).rejects.toThrow(/not assigned to you/i);
    });
  });

  describe('confirmPayment — RBAC & idempotency (spec §5, §15 edge cases 8-10)', () => {
    it('rejects an AGENT attempting to confirm — collection agents can never self-confirm', async () => {
      await expect(
        svc.confirmPayment(makeUser({ role: 'AGENT' }), 'payment-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('rejects a STAFF attempting to confirm', async () => {
      await expect(
        svc.confirmPayment(makeUser({ role: 'STAFF' }), 'payment-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(['MANAGER', 'ADMIN', 'OWNER'] as const)('allows %s to reach the confirmation query', async (role) => {
      query.mockResolvedValueOnce({ rows: [] }); // payment lookup finds nothing -> NotFound, proving RBAC passed
      await expect(svc.confirmPayment(makeUser({ role }), 'payment-1')).rejects.toThrow(/not found/i);
    });

    it('is idempotent on an already-CONFIRMED payment — no error, no duplicate audit row', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', loan_id: 'loan-1', installment_id: 'inst-1', amount: '500', collection_status: 'CONFIRMED' }] })
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await svc.confirmPayment(makeUser({ role: 'MANAGER' }), 'payment-1');

      expect(result).toEqual({ success: true, paymentId: 'payment-1', collectionStatus: 'CONFIRMED', alreadyConfirmed: true });
      // No UPDATE / audit INSERT should have run for an already-confirmed payment.
      const sql = query.mock.calls.map((c) => String(c[0]));
      expect(sql.some((s) => s.includes('UPDATE payments'))).toBe(false);
      expect(sql.some((s) => s.includes('collection_audit'))).toBe(false);
    });

    it('rejects confirming a SCHEDULED (never-collected) payment', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', loan_id: 'loan-1', installment_id: 'inst-1', amount: '500', collection_status: 'SCHEDULED' }] })
        .mockResolvedValueOnce(undefined); // ROLLBACK (via finally)

      await expect(svc.confirmPayment(makeUser({ role: 'MANAGER' }), 'payment-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('never overwrites the original payment amount — writes confirmed_amount alongside it (spec §5)', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', loan_id: 'loan-1', installment_id: 'inst-1', amount: '500', collection_status: 'COLLECTED' }] })
        .mockResolvedValueOnce(undefined) // UPDATE payments
        .mockResolvedValueOnce(undefined) // audit INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      await svc.confirmPayment(makeUser({ role: 'OWNER' }), 'payment-1', 480);

      const updateCall = query.mock.calls.find((c) => String(c[0]).includes('UPDATE payments'));
      expect(updateCall).toBeDefined();
      expect(String(updateCall![0])).not.toMatch(/SET\s+amount\s*=/i); // `amount` column itself is never touched
      expect(updateCall![1]).toEqual(['agent-1', 480, 'payment-1']); // makeUser()'s default sub
    });
  });

  describe('resolvePeriod (spec §11 "Provide an option to choose W/D/M")', () => {
    it('accepts D, W, M in any case and rejects anything else', async () => {
      const anyService = svc as unknown as { resolvePeriod: (p?: string) => string };
      expect(anyService.resolvePeriod('D')).toBe('D');
      expect(anyService.resolvePeriod('w')).toBe('W');
      expect(anyService.resolvePeriod('m')).toBe('M');
      expect(anyService.resolvePeriod(undefined)).toBe('D'); // default
      expect(() => anyService.resolvePeriod('X')).toThrow(BadRequestException);
    });
  });

  describe('rangeForView — Day/Week/Month calendar windows (spec §2, §15 edge case 13)', () => {
    const anyService = () => svc as unknown as { rangeForView: (v: 'day' | 'week' | 'month', d: string) => { start: string; end: string } };

    it('day view is a single-day range', () => {
      expect(anyService().rangeForView('day', '2026-08-10')).toEqual({ start: '2026-08-10', end: '2026-08-10' });
    });

    it('week view is the Monday-start week containing the date', () => {
      // 2026-08-10 is a Monday.
      expect(anyService().rangeForView('week', '2026-08-10')).toEqual({ start: '2026-08-10', end: '2026-08-16' });
      // 2026-08-13 (Thursday) falls in the same week.
      expect(anyService().rangeForView('week', '2026-08-13')).toEqual({ start: '2026-08-10', end: '2026-08-16' });
    });

    it('month view spans the full calendar month', () => {
      expect(anyService().rangeForView('month', '2026-08-15')).toEqual({ start: '2026-08-01', end: '2026-08-31' });
      // February in a non-leap year.
      expect(anyService().rangeForView('month', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    });
  });

  describe('pendingFor — pending-installment accumulation (spec §8)', () => {
    it('counts and sums only unpaid installments strictly before the given due date', async () => {
      query.mockResolvedValueOnce({ rows: [{ count: '2', amount: '1000.00' }] });
      const anyService = svc as unknown as {
        pendingFor: (c: unknown, loanId: string, beforeDueDate: string) => Promise<{ count: number; amount: number }>;
      };
      const result = await anyService.pendingFor(client, 'loan-1', '2026-08-10');
      expect(result).toEqual({ count: 2, amount: 1000 });
      const [sql, params] = query.mock.calls[0];
      expect(sql).toContain("due_date < $2");
      expect(sql).toContain("status IN ('PENDING','PARTIALLY_PAID','OVERDUE')");
      expect(params).toEqual(['loan-1', '2026-08-10']);
    });
  });
});
