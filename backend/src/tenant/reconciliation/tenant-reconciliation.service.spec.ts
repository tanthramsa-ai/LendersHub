import { TenantReconciliationService } from './tenant-reconciliation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantLedgerPostingService } from '../ledger/tenant-ledger-posting.service';
import { TenantFundersService } from '../funders/tenant-funders.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

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

describe('TenantReconciliationService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let activity: TenantActivityLogService;
  let ledgerPosting: TenantLedgerPostingService;
  let funders: TenantFundersService;
  let svc: TenantReconciliationService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect } } as unknown as PrismaService;
    activity = { record: jest.fn().mockResolvedValue(undefined) } as unknown as TenantActivityLogService;
    ledgerPosting = { ensureTable: jest.fn().mockResolvedValue(undefined) } as unknown as TenantLedgerPostingService;
    funders = { getTotalCapitalWithClient: jest.fn().mockResolvedValue(1000000) } as unknown as TenantFundersService;
    svc = new TenantReconciliationService(prisma, activity, ledgerPosting, funders);
    // Pre-mark the schema as already having daily_ledger_snapshot — ensureTable()
    // would otherwise consume the mockResolvedValueOnce queue meant for the
    // real assertions below (same warm-cache state production settles into).
    (svc as unknown as { ensuredSchemas: Set<string> }).ensuredSchemas.add('tenant_acme');
  });

  describe('access control', () => {
    it.each(['MANAGER', 'AGENT', 'STAFF', 'CUSTOMER'] as const)('rejects %s', async (role) => {
      await expect(svc.listUnreconciledCollections(makeUser({ role }), 1, 50)).rejects.toThrow(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });
  });

  describe('listUnreconciledCollections', () => {
    it('filters to POSTED agent-channel collections and sums the total', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'lt1', transaction_type: 'COLLECTION', principal_amount: '850', interest_amount: '150', fee_amount: '0', other_amount: '0', total_amount: '1000', status: 'POSTED', payment_channel: 'AGENT_CASH', created_at: 't' }] })
        .mockResolvedValueOnce({ rows: [{ total: '1', sum: '1000.00' }] });

      const result = await svc.listUnreconciledCollections(makeUser(), 1, 50);
      expect(result.total).toBe(1);
      expect(result.totalAmount).toBe(1000);
      const dataQuery = query.mock.calls[1][0] as string;
      expect(dataQuery).toContain(`payment_channel IN ('AGENT_CASH','AGENT_UPI')`);
      expect(dataQuery).toContain(`status = 'POSTED'`);
    });
  });

  describe('reconcile', () => {
    it('rejects an empty selection', async () => {
      await expect(svc.reconcile(makeUser(), [])).rejects.toThrow(BadRequestException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('marks the matched transactions RECONCILED with a settlement reference', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [
          { id: 'lt1', transaction_type: 'COLLECTION', principal_amount: '850', interest_amount: '150', fee_amount: '0', other_amount: '0', total_amount: '1000', status: 'RECONCILED', created_at: 't' },
        ] });

      const result = await svc.reconcile(makeUser(), ['lt1'], 'DEPOSIT-2026-08-24');
      expect(result.reconciled).toBe(1);
      const updateCall = query.mock.calls[1];
      expect(updateCall[0]).toContain(`SET status = 'RECONCILED'`);
      expect(updateCall[1]).toEqual(['DEPOSIT-2026-08-24', ['lt1']]);
      expect(activity.record).toHaveBeenCalled();
    });

    it('throws when nothing matched (already reconciled/reversed/missing)', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      await expect(svc.reconcile(makeUser(), ['lt-missing'])).rejects.toThrow(BadRequestException);
    });
  });

  describe('listReversedTransactions', () => {
    it('matches rows that are reversed or are themselves reversals', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      await svc.listReversedTransactions(makeUser(), 1, 50);
      const dataQuery = query.mock.calls[1][0] as string;
      expect(dataQuery).toContain(`status = 'REVERSED' OR reversal_of_id IS NOT NULL`);
    });
  });

  describe('generateSnapshot', () => {
    it('computes closing principal and available fund, then upserts', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ opening: '5500000.00' }] })
        .mockResolvedValueOnce({ rows: [{ new_disbursements: '20000', principal_collections: '15000', adjustments: '0', interest_collected: '3000' }] })
        .mockResolvedValueOnce({ rows: [{ movement: '-500000' }] }) // cash movement
        .mockResolvedValueOnce({ rows: [{
          id: 'snap1', business_date: '2026-08-24', opening_outstanding_principal: '5500000', new_disbursement_principal: '20000',
          principal_collected: '15000', interest_collected: '3000', adjustments: '0', closing_outstanding_principal: '5505000',
          available_fund: '500000', generated_by: 'u1', generated_at: 't', locked_at: null, locked_by: null,
        }] });

      const snapshot = await svc.generateSnapshot(makeUser(), '2026-08-24');
      expect(snapshot.closingOutstandingPrincipal).toBe(5505000);
      expect(funders.getTotalCapitalWithClient).toHaveBeenCalledWith(expect.objectContaining({ query }), 'tenant_acme', '2026-08-24');
      const upsertCall = query.mock.calls[4];
      expect(upsertCall[0]).toContain('ON CONFLICT (business_date) DO UPDATE');
      expect(upsertCall[1][0]).toBe('2026-08-24');
      expect(upsertCall[1][6]).toBe(5505000); // closing
    });
  });

  describe('lockDay / unlockDay', () => {
    it('rejects locking a day with no snapshot', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [] }); // no snapshot found
      await expect(svc.lockDay(makeUser(), '2026-08-24')).rejects.toThrow(BadRequestException);
    });

    it('is idempotent when the day is already locked', async () => {
      const already = { id: 'snap1', business_date: '2026-08-24', opening_outstanding_principal: '0', new_disbursement_principal: '0', principal_collected: '0', interest_collected: '0', adjustments: '0', closing_outstanding_principal: '0', available_fund: '0', generated_by: 'u1', generated_at: 't', locked_at: 't', locked_by: 'u1' };
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [already] });

      const result = await svc.lockDay(makeUser(), '2026-08-24');
      expect(result.lockedAt).toBe('t');
      // No UPDATE was issued — only the SELECT.
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('locks an unlocked existing snapshot', async () => {
      const unlocked = { id: 'snap1', business_date: '2026-08-24', opening_outstanding_principal: '0', new_disbursement_principal: '0', principal_collected: '0', interest_collected: '0', adjustments: '0', closing_outstanding_principal: '0', available_fund: '0', generated_by: 'u1', generated_at: 't', locked_at: null, locked_by: null };
      const locked = { ...unlocked, locked_at: 't2', locked_by: 'u1' };
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [unlocked] })
        .mockResolvedValueOnce({ rows: [locked] });

      const result = await svc.lockDay(makeUser(), '2026-08-24');
      expect(result.lockedAt).toBe('t2');
      expect(activity.record).toHaveBeenCalled();
    });

    it('unlocks a locked day', async () => {
      const locked = { id: 'snap1', business_date: '2026-08-24', opening_outstanding_principal: '0', new_disbursement_principal: '0', principal_collected: '0', interest_collected: '0', adjustments: '0', closing_outstanding_principal: '0', available_fund: '0', generated_by: 'u1', generated_at: 't', locked_at: null, locked_by: null };
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [locked] });

      const result = await svc.unlockDay(makeUser(), '2026-08-24');
      expect(result.lockedAt).toBeNull();
    });

    it('throws when unlocking a day with no snapshot', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });
      await expect(svc.unlockDay(makeUser(), '2026-08-24')).rejects.toThrow(BadRequestException);
    });
  });
});
