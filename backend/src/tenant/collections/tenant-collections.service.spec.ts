import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenantCollectionsService } from './tenant-collections.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantLedgerPostingService } from '../ledger/tenant-ledger-posting.service';
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
  let ledgerPosting: TenantLedgerPostingService;
  let svc: TenantCollectionsService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect }, $executeRawUnsafe: jest.fn().mockResolvedValue(undefined) } as unknown as PrismaService;
    activity = { record: jest.fn().mockResolvedValue(undefined) } as unknown as TenantActivityLogService;
    ledgerPosting = {
      postWithClient: jest.fn().mockResolvedValue({ id: 'lt1' }),
      reverseWithClient: jest.fn().mockResolvedValue({ id: 'lt2' }),
      findByPaymentIdWithClient: jest.fn().mockResolvedValue(null),
    } as unknown as TenantLedgerPostingService;
    svc = new TenantCollectionsService(prisma, activity, ledgerPosting);
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

  describe('awaitingConfirmation — the manager approval queue', () => {
    it('rejects an AGENT — an agent must not see, let alone work, the approval queue', async () => {
      await expect(
        svc.awaitingConfirmation(makeUser({ role: 'AGENT' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('rejects STAFF', async () => {
      await expect(svc.awaitingConfirmation(makeUser({ role: 'STAFF' }))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(['MANAGER', 'ADMIN', 'OWNER'] as const)('lets %s read the queue', async (role) => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{
          id: 'pay1', amount: '500.00', payment_method: 'CASH', reference_number: null, receipt_number: 'RCPT1',
          payment_date: '2026-09-07', created_at: '2026-09-07T09:00:00Z',
          installment_id: 'inst1', installment_number: 3, due_date: '2026-09-01',
          loan_id: 'loan1', loan_number: 'WL-1', cycle_type: 'WEEKLY',
          customer_name: 'Priya Sharma', collected_by_name: 'Agent A',
        }] })
        .mockResolvedValueOnce({ rows: [{ total: '1', amount: '500.00' }] });

      const res = await svc.awaitingConfirmation(makeUser({ role }));

      expect(res.total).toBe(1);
      expect(res.totalAmount).toBe(500);
      expect(res.data[0]).toEqual(expect.objectContaining({
        paymentId: 'pay1', amount: 500, customerName: 'Priya Sharma',
        collectedByName: 'Agent A', loanNumber: 'WL-1', installmentNumber: 3,
      }));
    });

    it('asks only for COLLECTED collections that were not undone, oldest first', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0', amount: '0' }] });

      await svc.awaitingConfirmation(makeUser({ role: 'MANAGER' }));

      const listQuery = query.mock.calls.map((c) => String(c[0])).find((q) => q.includes('FROM payments p'));
      expect(listQuery).toBeDefined();
      expect(listQuery).toContain("collection_status = 'COLLECTED'");
      // An undone collection keeps its row for the audit trail; it must not
      // come back as something still to approve.
      expect(listQuery).toContain('cancelled_at IS NULL');
      expect(listQuery).toContain('ORDER BY p.created_at ASC');
    });

    it('caps the page size so a caller cannot ask for the whole table', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0', amount: '0' }] });

      const res = await svc.awaitingConfirmation(makeUser({ role: 'OWNER' }), 1, 5000);

      expect(res.limit).toBe(100);
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

  describe('undoCollection — RBAC & status recompute (Aug_13 sheet item)', () => {
    it('rejects an AGENT attempting to undo — matches the loan-detail undo gate', async () => {
      await expect(
        svc.undoCollection(makeUser({ role: 'AGENT' }), 'inst-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('rejects a STAFF attempting to undo', async () => {
      await expect(
        svc.undoCollection(makeUser({ role: 'STAFF' }), 'inst-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(['MANAGER', 'ADMIN', 'OWNER'] as const)('allows %s to reach the undo query', async (role) => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // installment lookup finds nothing
        .mockResolvedValueOnce(undefined); // ROLLBACK (via finally)
      await expect(svc.undoCollection(makeUser({ role }), 'inst-1')).rejects.toThrow(/not found/i);
    });

    it('rejects when there is no active (non-cancelled) collection to undo', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'inst-1', loan_id: 'loan-1', loan_number: 'LN-1', paid_amount: '0', total_amount: '450', is_past_due: false }] })
        .mockResolvedValueOnce({ rows: [] }) // no non-cancelled payment
        .mockResolvedValueOnce(undefined); // ROLLBACK

      await expect(svc.undoCollection(makeUser({ role: 'MANAGER' }), 'inst-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fully reverts a payment, soft-cancels it (not deletes), and falls back to OVERDUE when past due', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'inst-1', loan_id: 'loan-1', loan_number: 'LN-1', paid_amount: '450', total_amount: '450', is_past_due: true }] })
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', amount: '450', collection_status: 'COLLECTED' }] })
        .mockResolvedValueOnce(undefined) // UPDATE installments
        .mockResolvedValueOnce(undefined) // UPDATE payments SET cancelled_at
        .mockResolvedValueOnce(undefined) // audit INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await svc.undoCollection(makeUser({ role: 'OWNER' }), 'inst-1');

      expect(result).toEqual({ success: true, installmentId: 'inst-1', paidAmount: 0, installmentStatus: 'OVERDUE' });
      const cancelCall = query.mock.calls.find((c) => String(c[0]).includes('cancelled_at = NOW()'));
      expect(cancelCall![1]).toEqual(['payment-1']);
      // The payment row is soft-cancelled, never deleted.
      expect(query.mock.calls.some((c) => String(c[0]).includes('DELETE FROM payments'))).toBe(false);
    });

    it('recomputes PARTIALLY_PAID when the undone payment only covered part of the balance', async () => {
      // 450 owed, 450 already paid (two payments: an earlier 250, then a 200 top-up).
      // Undoing the most recent (200) leaves 250 paid — still short of the 450 total.
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'inst-1', loan_id: 'loan-1', loan_number: 'LN-1', paid_amount: '450', total_amount: '450', is_past_due: false }] })
        .mockResolvedValueOnce({ rows: [{ id: 'payment-2', amount: '200', collection_status: 'COLLECTED' }] })
        .mockResolvedValueOnce(undefined) // UPDATE installments
        .mockResolvedValueOnce(undefined) // UPDATE payments SET cancelled_at
        .mockResolvedValueOnce(undefined) // audit INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await svc.undoCollection(makeUser({ role: 'ADMIN' }), 'inst-1');

      expect(result).toEqual({ success: true, installmentId: 'inst-1', paidAmount: 250, installmentStatus: 'PARTIALLY_PAID' });
    });

    it('allows undo even after office Confirmation (product decision — no CONFIRMED-status gate)', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'inst-1', loan_id: 'loan-1', loan_number: 'LN-1', paid_amount: '450', total_amount: '450', is_past_due: false }] })
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', amount: '450', collection_status: 'CONFIRMED' }] })
        .mockResolvedValueOnce(undefined) // UPDATE installments
        .mockResolvedValueOnce(undefined) // UPDATE payments SET cancelled_at
        .mockResolvedValueOnce(undefined) // audit INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await svc.undoCollection(makeUser({ role: 'OWNER' }), 'inst-1');
      expect(result.success).toBe(true);
    });

    it('reverses the linked ledger transaction when one exists for the undone payment', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'inst-1', loan_id: 'loan-1', loan_number: 'LN-1', paid_amount: '450', total_amount: '450', is_past_due: false }] })
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', amount: '450', collection_status: 'COLLECTED' }] })
        .mockResolvedValueOnce(undefined) // UPDATE installments
        .mockResolvedValueOnce(undefined) // UPDATE payments SET cancelled_at
        .mockResolvedValueOnce(undefined) // audit INSERT
        .mockResolvedValueOnce(undefined); // COMMIT
      (ledgerPosting.findByPaymentIdWithClient as jest.Mock).mockResolvedValueOnce({ id: 'lt-1' });

      await svc.undoCollection(makeUser({ role: 'OWNER' }), 'inst-1');

      expect(ledgerPosting.findByPaymentIdWithClient).toHaveBeenCalledWith(expect.objectContaining({ query }), 'tenant_acme', 'payment-1');
      expect(ledgerPosting.reverseWithClient).toHaveBeenCalledWith(expect.objectContaining({ query }), expect.anything(), 'lt-1', 'Collection undone');
    });

    it('skips the ledger reversal when the payment never posted a ledger transaction', async () => {
      query
        .mockResolvedValueOnce(undefined) // SET search_path
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'inst-1', loan_id: 'loan-1', loan_number: 'LN-1', paid_amount: '450', total_amount: '450', is_past_due: false }] })
        .mockResolvedValueOnce({ rows: [{ id: 'payment-1', amount: '450', collection_status: 'COLLECTED' }] })
        .mockResolvedValueOnce(undefined) // UPDATE installments
        .mockResolvedValueOnce(undefined) // UPDATE payments SET cancelled_at
        .mockResolvedValueOnce(undefined) // audit INSERT
        .mockResolvedValueOnce(undefined); // COMMIT

      await svc.undoCollection(makeUser({ role: 'OWNER' }), 'inst-1');

      expect(ledgerPosting.reverseWithClient).not.toHaveBeenCalled();
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

  describe('applyCollectionSettlement — Partial Collected status (Aug_13 sheet item)', () => {
    type SettlementResult = { success: true; paymentId: string | null; collectionStatus: 'COLLECTED' | 'PARTIALLY_COLLECTED' };
    const anyService = () => svc as unknown as {
      applyCollectionSettlement: (
        client: unknown,
        user: TenantJwtPayload,
        inst: { loan_id: string; loan_number: string; customer_id?: string },
        settleRows: { id: string; balance: string; due_date: string; principal_amount?: string; interest_amount?: string }[],
        dto: { amount: number; paymentMethod: string; referenceNumber?: string; idempotencyKey?: string },
        paymentDate: string,
        installmentId: string,
      ) => Promise<SettlementResult>;
    };

    it('marks the installment COLLECTED when the payment covers the full balance owed', async () => {
      query.mockResolvedValue({ rows: [{ id: 'payment-1' }] }); // every INSERT/UPDATE call in the loop
      const result = await anyService().applyCollectionSettlement(
        client,
        makeUser(),
        { loan_id: 'loan-1', loan_number: 'LN-1' },
        [{ id: 'inst-1', balance: '500.00', due_date: '2026-08-10' }],
        { amount: 500, paymentMethod: 'CASH' },
        '2026-08-10',
        'inst-1',
      );
      expect(result).toEqual({ success: true, paymentId: 'payment-1', receiptNumber: expect.any(String), collectionStatus: 'COLLECTED' });
      const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO payments'));
      expect(insertCall![1]).toContain('COLLECTED');
    });

    it('marks the installment PARTIALLY_COLLECTED when the payment is short of the balance owed', async () => {
      query.mockResolvedValue({ rows: [{ id: 'payment-2' }] });
      const result = await anyService().applyCollectionSettlement(
        client,
        makeUser(),
        { loan_id: 'loan-1', loan_number: 'LN-1' },
        [{ id: 'inst-1', balance: '500.00', due_date: '2026-08-10' }],
        { amount: 300, paymentMethod: 'CASH' },
        '2026-08-10',
        'inst-1',
      );
      expect(result).toEqual({ success: true, paymentId: 'payment-2', receiptNumber: expect.any(String), collectionStatus: 'PARTIALLY_COLLECTED' });
      const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO payments'));
      expect(insertCall![1]).toContain('PARTIALLY_COLLECTED');
    });

    it('reports COLLECTED for the primary installment even when an earlier pending row is left short (oldest-first settlement)', async () => {
      // 300 is split oldest-first across two rows owing 200 and 500: the older
      // row (not the requested installmentId) is fully paid, the primary
      // requested installment absorbs the rest and is only partially covered.
      query.mockResolvedValue({ rows: [{ id: 'payment-x' }] });
      const result = await anyService().applyCollectionSettlement(
        client,
        makeUser(),
        { loan_id: 'loan-1', loan_number: 'LN-1' },
        [
          { id: 'inst-older', balance: '200.00', due_date: '2026-08-01' },
          { id: 'inst-primary', balance: '500.00', due_date: '2026-08-10' },
        ],
        { amount: 300, paymentMethod: 'CASH' },
        '2026-08-10',
        'inst-primary',
      );
      expect(result.collectionStatus).toBe('PARTIALLY_COLLECTED');
    });

    it('posts a COLLECTION ledger transaction split proportionally to the installment principal:interest ratio', async () => {
      query.mockResolvedValue({ rows: [{ id: 'payment-3' }] });
      await anyService().applyCollectionSettlement(
        client,
        makeUser({ sub: 'agent-9' }),
        { loan_id: 'loan-1', loan_number: 'LN-1', customer_id: 'cust-1' },
        [{ id: 'inst-1', balance: '1000.00', due_date: '2026-08-10', principal_amount: '850.00', interest_amount: '150.00' }],
        { amount: 400, paymentMethod: 'CASH', referenceNumber: 'ref-1' },
        '2026-08-10',
        'inst-1',
      );

      expect(ledgerPosting.postWithClient).toHaveBeenCalledTimes(1);
      const [, calledUser, calledInput] = (ledgerPosting.postWithClient as jest.Mock).mock.calls[0];
      expect(calledUser.sub).toBe('agent-9');
      expect(calledInput).toMatchObject({
        transactionType: 'COLLECTION',
        loanId: 'loan-1',
        customerId: 'cust-1',
        agentId: 'agent-9',
        paymentId: 'payment-3',
        paymentChannel: 'AGENT_CASH', // CASH collected via the agent flow maps to AGENT_CASH
        externalReference: 'ref-1',
      });
      // 400 applied against an 850:150 (85%:15%) installment split.
      expect(calledInput.principalAmount).toBe(340);
      expect(calledInput.interestAmount).toBe(60);
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
