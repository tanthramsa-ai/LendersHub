import { TenantReportsService } from './tenant-reports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantLedgerPostingService } from '../ledger/tenant-ledger-posting.service';
import { TenantFundersService } from '../funders/tenant-funders.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

function makeUser(overrides: Partial<TenantJwtPayload> = {}): TenantJwtPayload {
  return {
    sub: 'u1', email: 'owner@acme.test', firstName: 'Ann', lastName: 'Owner', role: 'OWNER',
    tenantId: 't1', subdomain: 'acme', schemaName: 'tenant_acme', type: 'tenant_user', ...overrides,
  };
}

describe('TenantReportsService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let ledgerPosting: TenantLedgerPostingService;
  let funders: TenantFundersService;
  let svc: TenantReportsService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect } } as unknown as PrismaService;
    ledgerPosting = { ensureTable: jest.fn().mockResolvedValue(undefined) } as unknown as TenantLedgerPostingService;
    funders = {
      ensureTables: jest.fn().mockResolvedValue(undefined),
      getTotalCapitalWithClient: jest.fn().mockResolvedValue(1000000),
    } as unknown as TenantFundersService;
    svc = new TenantReportsService(prisma, ledgerPosting, funders);
  });

  describe('access control', () => {
    it.each(['MANAGER', 'AGENT', 'STAFF', 'CUSTOMER'] as const)('rejects %s from every report', async (role) => {
      const u = makeUser({ role });
      await expect(svc.dailyCollection(u, '2026-08-25')).rejects.toThrow(ForbiddenException);
      await expect(svc.fundUtilization(u)).rejects.toThrow(ForbiddenException);
      await expect(svc.npaWriteOff(u)).rejects.toThrow(ForbiddenException);
      await expect(svc.adjustmentAudit(u)).rejects.toThrow(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });
  });

  describe('input validation', () => {
    it('rejects a malformed date and a malformed month', async () => {
      await expect(svc.dailyCollection(makeUser(), '25-08-2026')).rejects.toThrow(BadRequestException);
      await expect(svc.monthlyCollection(makeUser(), '2026-8', '2026-09')).rejects.toThrow(BadRequestException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('rejects an unknown outstanding-principal grouping', async () => {
      await expect(
        svc.outstandingPrincipal(makeUser(), 'branch' as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // Every aggregate must go through the shared live-rows predicate, or reports
  // would silently disagree with the dashboard about reversals/reconciliation.
  describe('live-rows predicate', () => {
    it('applies it to the daily collection report', async () => {
      query.mockResolvedValue({ rows: [] });
      await svc.dailyCollection(makeUser(), '2026-08-25');
      const sql = String(query.mock.calls[1][0]);
      expect(sql).toContain(`lt.status IN ('POSTED','RECONCILED')`);
      expect(sql).toContain('lt.reversal_of_id IS NULL');
    });

    it('applies it to the outstanding principal report', async () => {
      query.mockResolvedValue({ rows: [] });
      await svc.outstandingPrincipal(makeUser(), 'agent');
      const sql = String(query.mock.calls[1][0]);
      expect(sql).toContain(`txn.status IN ('POSTED','RECONCILED')`);
      expect(sql).toContain('txn.reversal_of_id IS NULL');
    });

    it('deliberately does NOT apply it to the adjustment audit, which must show reversals', async () => {
      query.mockResolvedValue({ rows: [] });
      await svc.adjustmentAudit(makeUser());
      const sql = String(query.mock.calls[1][0]);
      expect(sql).toContain(`lt.reversal_of_id IS NOT NULL`);
      expect(sql).not.toContain(`lt.status IN ('POSTED','RECONCILED')`);
    });
  });

  describe('dailyCollection', () => {
    it('groups by agent and totals the split', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { agent_id: 'a1', agent_name: 'Priya', transaction_count: '3', principal: '850', interest: '150', fee: '0', total: '1000' },
          { agent_id: 'a2', agent_name: 'Raj', transaction_count: '1', principal: '400', interest: '100', fee: '25', total: '525' },
        ] });

      const r = await svc.dailyCollection(makeUser(), '2026-08-25');

      expect(r.rows).toHaveLength(2);
      expect(r.totals).toEqual({ transactionCount: 4, principal: 1250, interest: 250, fee: 25, total: 1525 });
    });
  });

  describe('fundUtilization', () => {
    it('computes the ratio and available fund against funder capital', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ outstanding: '250000', disbursed: '400000', collected_principal: '150000' }] });

      const r = await svc.fundUtilization(makeUser());

      expect(r.totalFund).toBe(1000000);
      expect(r.outstandingPrincipal).toBe(250000);
      expect(r.availableFund).toBe(750000);
      expect(r.utilizationPct).toBe(25);
    });

    it('reports utilization as null (not 0%) when there is no funder capital', async () => {
      (funders.getTotalCapitalWithClient as jest.Mock).mockResolvedValueOnce(0);
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ outstanding: '5000', disbursed: '5000', collected_principal: '0' }] });

      const r = await svc.fundUtilization(makeUser());

      expect(r.utilizationPct).toBeNull();
      expect(r.availableFund).toBe(-5000);
    });
  });

  describe('funderCapital', () => {
    it('derives current capital as contributions - withdrawals + adjustments', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { id: 'f1', name: 'Funder One', is_active: true, contributions: '2500000', withdrawals: '500000', adjustments: '1000', allocated_principal: '900000' },
        ] });

      const r = await svc.funderCapital(makeUser());

      expect(r.rows[0].currentCapital).toBe(2001000);
      expect(r.totals.currentCapital).toBe(2001000);
    });
  });

  describe('loanStatement', () => {
    it('throws NotFoundException for a missing loan', async () => {
      query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      await expect(svc.loanStatement(makeUser(), 'nope')).rejects.toThrow(NotFoundException);
    });

    it('carries a running outstanding-principal balance using the §7.1 sign rules', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          id: 'loan1', loan_number: 'LN-1', principal: '10000', status: 'DISBURSED',
          disbursed_at: '2026-08-01', interest_rate: '12', cycle_type: 'MONTHLY',
          customer_name: 'Ramesh Kumar', phone: '99999',
        }] })
        .mockResolvedValueOnce({ rows: [
          { id: 't1', business_date: '2026-08-01', transaction_type: 'DISBURSEMENT', principal_amount: '10000', interest_amount: '0', fee_amount: '0', total_amount: '10000' },
          { id: 't2', business_date: '2026-08-10', transaction_type: 'COLLECTION', principal_amount: '2000', interest_amount: '500', fee_amount: '0', total_amount: '2500' },
          { id: 't3', business_date: '2026-08-20', transaction_type: 'ADJUSTMENT', principal_amount: '-1000', interest_amount: '0', fee_amount: '0', total_amount: '-1000' },
        ] });

      const r = await svc.loanStatement(makeUser(), 'loan1');

      expect(r.lines.map((l) => l.runningOutstandingPrincipal)).toEqual([10000, 8000, 7000]);
      expect(r.totals).toEqual({
        disbursed: 10000, principalCollected: 2000, interestCollected: 500, closingOutstandingPrincipal: 7000,
      });
    });
  });

  describe('channelReconciliation', () => {
    it('excludes agent channels and flags that statement matching is unavailable', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { channel: 'UPI', transaction_count: '4', total: '4000', reconciled: '3000', unreconciled: '1000', missing_reference: '1' },
        ] });

      const r = await svc.channelReconciliation(makeUser());

      expect(r.statementMatchingAvailable).toBe(false);
      expect(r.rows[0].missingReference).toBe(1);
      expect(r.totals).toEqual({ total: 4000, reconciled: 3000, unreconciled: 1000 });
      expect(String(query.mock.calls[1][0])).toContain(`NOT IN ('AGENT_CASH','AGENT_UPI')`);
    });
  });

  describe('adjustmentAudit', () => {
    it('labels each row as adjustment, reversal, or reversed original', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [
          { id: 'a', business_date: '2026-08-01', created_at: 't', transaction_type: 'ADJUSTMENT', status: 'POSTED', principal_amount: '-500', total_amount: '-500', reversal_of_id: null },
          { id: 'b', business_date: '2026-08-02', created_at: 't', transaction_type: 'COLLECTION', status: 'REVERSED', principal_amount: '100', total_amount: '100', reversal_of_id: null },
          { id: 'c', business_date: '2026-08-02', created_at: 't', transaction_type: 'COLLECTION', status: 'POSTED', principal_amount: '-100', total_amount: '-100', reversal_of_id: 'b', reversed_type: 'COLLECTION', reversed_amount: '100' },
        ] });

      const r = await svc.adjustmentAudit(makeUser());

      expect(r.rows.map((x) => x.entryKind)).toEqual(['ADJUSTMENT', 'REVERSED_ORIGINAL', 'REVERSAL']);
      expect(r.totals).toEqual({ adjustmentCount: 1, reversalCount: 1 });
    });
  });
});
