import { TenantLedgerPostingService } from './tenant-ledger-posting.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';

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

function ledgerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lt1',
    transaction_date: '2026-08-24',
    business_date: '2026-08-24',
    transaction_type: 'COLLECTION',
    loan_id: 'loan1',
    customer_id: 'cust1',
    agent_id: null,
    principal_amount: '850.00',
    interest_amount: '150.00',
    fee_amount: '0.00',
    other_amount: '0.00',
    total_amount: '1000.00',
    payment_channel: 'AGENT_CASH',
    external_reference: null,
    status: 'POSTED',
    idempotency_key: null,
    reversal_of_id: null,
    remarks: null,
    created_by: 'u1',
    created_at: '2026-08-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('TenantLedgerPostingService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let activity: TenantActivityLogService;
  let svc: TenantLedgerPostingService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect } } as unknown as PrismaService;
    activity = { record: jest.fn().mockResolvedValue(undefined) } as unknown as TenantActivityLogService;
    svc = new TenantLedgerPostingService(prisma, activity);
  });

  describe('ensureTable', () => {
    // The Collection Ledger and Daily Ledger join payments for the receipt
    // number, and payments.receipt_number only exists on tenants provisioned
    // after the ledger shipped — every ledger read funnels through here, so
    // this is what keeps those pages from 500ing on an older tenant.
    it('backfills payments.receipt_number alongside the ledger table', async () => {
      await svc.ensureTable(client as unknown as import('pg').PoolClient, 'tenant_cold');

      const alter = query.mock.calls.find((c) => String(c[0]).includes('ADD COLUMN IF NOT EXISTS receipt_number'));
      expect(alter).toBeDefined();
      expect(String(alter![0])).toContain('"tenant_cold"."payments"');
    });

    it('does not re-run once a schema is warm', async () => {
      const pgClient = client as unknown as import('pg').PoolClient;
      await svc.ensureTable(pgClient, 'tenant_warm');
      const callsAfterFirst = query.mock.calls.length;
      await svc.ensureTable(pgClient, 'tenant_warm');
      expect(query.mock.calls.length).toBe(callsAfterFirst);
    });
  });

  describe('postTransaction', () => {
    it('rejects non-Owner/Admin roles', async () => {
      await expect(
        svc.postTransaction(makeUser({ role: 'AGENT' }), { transactionType: 'COLLECTION', principalAmount: 100 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a transaction with zero total amount', async () => {
      await expect(
        svc.postTransaction(makeUser(), { transactionType: 'COLLECTION' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an ADJUSTMENT with no remarks (§10: manual adjustments must be justified)', async () => {
      await expect(
        svc.postTransaction(makeUser(), { transactionType: 'ADJUSTMENT', principalAmount: -500 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        svc.postTransaction(makeUser(), { transactionType: 'ADJUSTMENT', principalAmount: -500, remarks: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('computes total_amount server-side and inserts the split', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })                    // SET search_path
        .mockResolvedValueOnce({ rows: [] })                    // ensure CREATE TABLE
        .mockResolvedValueOnce({ rows: [] })                    // ...indexes (x8)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [ledgerRow()] });         // INSERT ... RETURNING

      const txn = await svc.postTransaction(makeUser(), {
        transactionDate: '2026-08-24',
        transactionType: 'COLLECTION',
        loanId: 'loan1',
        customerId: 'cust1',
        principalAmount: 850,
        interestAmount: 150,
        paymentChannel: 'AGENT_CASH',
      });

      expect(txn.totalAmount).toBe(1000);
      expect(txn.principalAmount).toBe(850);
      expect(txn.interestAmount).toBe(150);
      expect(activity.record).toHaveBeenCalledWith(
        expect.objectContaining({ query }),
        expect.anything(),
        expect.objectContaining({ action: 'ledger.transaction_posted', entityId: 'lt1' }),
      );

      const insertCall = query.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO ledger_transactions'));
      expect(insertCall![1]).toEqual([
        '2026-08-24', '2026-08-24', 'COLLECTION', 'loan1', 'cust1', null, null,
        850, 150, 0, 0, 1000, 'AGENT_CASH', null, null, null, 'u1',
      ]);
    });

    it('replays an existing row instead of inserting when idempotencyKey already exists', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })                    // SET search_path
        .mockResolvedValueOnce({ rows: [] })                    // ensure CREATE TABLE
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [ledgerRow({ idempotency_key: 'pay-123' })] }); // idempotency lookup

      const txn = await svc.postTransaction(makeUser(), {
        transactionType: 'COLLECTION',
        principalAmount: 850,
        interestAmount: 150,
        idempotencyKey: 'pay-123',
      });

      expect(txn.id).toBe('lt1');
      const insertCall = query.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO ledger_transactions'));
      expect(insertCall).toBeUndefined();
      expect(activity.record).not.toHaveBeenCalled();
    });

    it('skips CREATE TABLE/INDEX on the second call for the same schema (cached)', async () => {
      query.mockResolvedValue({ rows: [ledgerRow()] });
      await svc.postTransaction(makeUser(), { transactionType: 'COLLECTION', principalAmount: 100 });
      query.mockClear();
      query.mockResolvedValue({ rows: [ledgerRow()] });

      await svc.postTransaction(makeUser(), { transactionType: 'COLLECTION', principalAmount: 100 });

      // SET search_path + INSERT only — no CREATE TABLE/INDEX this time.
      expect(query).toHaveBeenCalledTimes(2);
    });
  });

  describe('reverseTransaction', () => {
    it('rejects without a reason', async () => {
      await expect(svc.reverseTransaction(makeUser(), 'lt1', '')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the original transaction does not exist', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [] }) // ensure CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }); // SELECT original -> not found

      await expect(svc.reverseTransaction(makeUser(), 'missing', 'typo')).rejects.toThrow(NotFoundException);
    });

    it('inserts a negated reversal row and flips the original to REVERSED', async () => {
      const original = ledgerRow();
      const reversal = ledgerRow({ id: 'lt2', principal_amount: '-850.00', interest_amount: '-150.00', total_amount: '-1000.00', reversal_of_id: 'lt1' });
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [] }) // ensure CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [original] })   // SELECT original
        .mockResolvedValueOnce({ rows: [reversal] })   // INSERT reversal RETURNING
        .mockResolvedValueOnce({ rows: [] });          // UPDATE original status

      const result = await svc.reverseTransaction(makeUser(), 'lt1', 'duplicate posting');

      expect(result.id).toBe('lt2');
      expect(result.reversalOfId).toBe('lt1');
      expect(result.totalAmount).toBe(-1000);

      const updateCall = query.mock.calls.find((c) => (c[0] as string).includes('UPDATE ledger_transactions'));
      expect(updateCall![0]).toContain(`status = 'REVERSED'`);
      expect(updateCall![1]).toEqual(['lt1']);
      expect(activity.record).toHaveBeenCalledWith(
        expect.objectContaining({ query }),
        expect.anything(),
        expect.objectContaining({ action: 'ledger.transaction_reversed', entityId: 'lt2' }),
      );
    });

    it('rejects reversing an already-reversed transaction', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [ledgerRow({ status: 'REVERSED' })] });

      await expect(svc.reverseTransaction(makeUser(), 'lt1', 'again')).rejects.toThrow(BadRequestException);
    });
  });
});
