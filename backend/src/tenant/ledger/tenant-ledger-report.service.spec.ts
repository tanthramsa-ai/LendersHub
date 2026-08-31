import { TenantLedgerReportService } from './tenant-ledger-report.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantLedgerPostingService } from './tenant-ledger-posting.service';
import { TenantFundersService } from '../funders/tenant-funders.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { ForbiddenException } from '@nestjs/common';

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

describe('TenantLedgerReportService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let ledgerPosting: TenantLedgerPostingService;
  let funders: TenantFundersService;
  let svc: TenantLedgerReportService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect } } as unknown as PrismaService;
    ledgerPosting = { ensureTable: jest.fn().mockResolvedValue(undefined) } as unknown as TenantLedgerPostingService;
    funders = { getTotalCapitalWithClient: jest.fn().mockResolvedValue(10000000) } as unknown as TenantFundersService;
    svc = new TenantLedgerReportService(prisma, ledgerPosting, funders);
  });

  describe('access control', () => {
    it.each(['MANAGER', 'AGENT', 'STAFF', 'CUSTOMER'] as const)('rejects %s from the dashboard', async (role) => {
      await expect(svc.getDashboard(makeUser({ role }))).rejects.toThrow(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });
  });

  // Regression guard for two money-correctness bugs found by probing a live
  // Postgres instance (mocked tests never caught them because they don't model
  // how reversal/reconcile actually mutate rows):
  //
  //  1. Reversal: the original is flipped to REVERSED and a NEW negated row is
  //     inserted. Filtering aggregates to `status = 'POSTED'` dropped the
  //     original (+X) but kept the reversal (−X), so reversing a ₹1,000 txn
  //     moved totals by ₹2,000 in the WRONG direction instead of netting to 0.
  //  2. Reconcile: sets status to RECONCILED, so a POSTED-only filter made a
  //     collection vanish from every total the moment it was marked settled.
  //
  // Both are fixed by LIVE_LEDGER_SQL. These assert the predicate reaches the
  // SQL — the arithmetic itself was verified end-to-end against real Postgres.
  describe('live-rows predicate (reversal + reconciliation regression)', () => {
    async function captureDashboardSql() {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          total_disbursed: '0', outstanding_principal: '0', principal_collected_period: '0',
          interest_collected_period: '0', fee_collected_period: '0', todays_collection: '0',
          this_months_collection: '0', agent_pending_reconciliation: '0',
        }] })
        .mockResolvedValueOnce({ rows: [{ npa_principal: '0' }] })
        .mockResolvedValueOnce({ rows: [{ movement: '0' }] });
      await svc.getDashboard(makeUser());
      return query.mock.calls.map((c) => String(c[0])).join('\n---\n');
    }

    it('counts RECONCILED rows, not just POSTED — settling money must not delete it from totals', async () => {
      const sql = await captureDashboardSql();
      expect(sql).toContain(`status IN ('POSTED','RECONCILED')`);
    });

    it('excludes reversal rows so a reversal nets to zero rather than double-counting', async () => {
      const sql = await captureDashboardSql();
      expect(sql).toContain('reversal_of_id IS NULL');
    });

    it('applies the same predicate to the daily view (opening and movement queries)', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ opening: '0' }] })
        .mockResolvedValueOnce({ rows: [{ new_disbursements: '0', principal_collections: '0', adjustments: '0', interest_collected: '0', cash_bank_movement: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      await svc.getDaily(makeUser(), '2026-08-25', 1, 50);

      const openingSql = String(query.mock.calls[1][0]);
      const movementSql = String(query.mock.calls[2][0]);
      for (const sql of [openingSql, movementSql]) {
        expect(sql).toContain(`status IN ('POSTED','RECONCILED')`);
        expect(sql).toContain('reversal_of_id IS NULL');
      }
    });

    it('applies the same predicate to per-loan and per-customer outstanding principal', async () => {
      query.mockResolvedValue({ rows: [{ outstanding: '0', total: '0' }] });
      await svc.getLoanLedger(makeUser(), 'loan-1', 1, 50);
      const loanSql = String(query.mock.calls[1][0]);
      expect(loanSql).toContain(`status IN ('POSTED','RECONCILED')`);
      expect(loanSql).toContain('reversal_of_id IS NULL');

      query.mockClear();
      query.mockResolvedValue({ rows: [{ outstanding: '0', total: '0' }] });
      await svc.getCustomerLedger(makeUser(), 'cust-1', 1, 50);
      const custSql = String(query.mock.calls[1][0]);
      expect(custSql).toContain(`status IN ('POSTED','RECONCILED')`);
      expect(custSql).toContain('reversal_of_id IS NULL');
    });
  });

  describe('getDashboard', () => {
    it('computes outstanding principal, period collections, and total/available fund', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({
          rows: [{
            total_disbursed: '1650200.00', outstanding_principal: '605000.00',
            principal_collected_period: '110020.00', interest_collected_period: '50560.00', fee_collected_period: '0',
            todays_collection: '5000.00', this_months_collection: '160580.00', agent_pending_reconciliation: '90000.00',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ npa_principal: '25000.00' }] })
        .mockResolvedValueOnce({ rows: [{ movement: '-605000.00' }] }); // lifetime cash movement

      const result = await svc.getDashboard(makeUser(), '2026-08');

      expect(result).toEqual({
        month: '2026-08',
        fundTrackingAvailable: true,
        totalFund: 10000000,
        availableFund: 9395000,
        totalDisbursed: 1650200,
        outstandingPrincipal: 605000,
        principalCollected: 110020,
        interestCollected: 50560,
        totalCollections: 160580,
        todaysCollection: 5000,
        thisMonthsCollection: 160580,
        overdueNpaPrincipal: 25000,
        agentCollectionPendingReconciliation: 90000,
      });
      const dashboardQuery = query.mock.calls[1][0] as string;
      expect(dashboardQuery).toContain(`FILTER (WHERE transaction_type = 'DISBURSEMENT')`);
      expect(query.mock.calls[1][1]).toEqual(['2026-08-01']);
      expect(funders.getTotalCapitalWithClient).toHaveBeenCalledWith(expect.objectContaining({ query }), 'tenant_acme');
    });

    it('defaults to the current month when none is given', async () => {
      const nowMonth = new Date().toISOString().slice(0, 7);
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          total_disbursed: '0', outstanding_principal: '0', principal_collected_period: '0',
          interest_collected_period: '0', fee_collected_period: '0', todays_collection: '0',
          this_months_collection: '0', agent_pending_reconciliation: '0',
        }] })
        .mockResolvedValueOnce({ rows: [{ npa_principal: '0' }] })
        .mockResolvedValueOnce({ rows: [{ movement: '0' }] });

      const result = await svc.getDashboard(makeUser());
      expect(result.month).toBe(nowMonth);
    });
  });

  describe('getDaily', () => {
    it('computes closing = opening + disbursements - collections + adjustments', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ opening: '5500000.00' }] })
        .mockResolvedValueOnce({ rows: [{
          new_disbursements: '20000.00', principal_collections: '15000.00', adjustments: '0',
          interest_collected: '3000.00', cash_bank_movement: '-2000.00',
        }] })
        .mockResolvedValueOnce({ rows: [{ id: 'lt1', transaction_date: '2026-08-10', business_date: '2026-08-10', transaction_type: 'COLLECTION', principal_amount: '15000', interest_amount: '3000', fee_amount: '0', other_amount: '0', total_amount: '18000', status: 'POSTED', created_at: '2026-08-10T00:00:00Z' }] })
        .mockResolvedValueOnce({ rows: [{ total: '1' }] });

      const result = await svc.getDaily(makeUser(), '2026-08-10', 1, 50);

      expect(result.openingOutstandingPrincipal).toBe(5500000);
      expect(result.closingOutstandingPrincipal).toBe(5505000);
      expect(result.transactions).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('listTransactions', () => {
    it('builds WHERE clauses only for the filters actually supplied', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [] }) // data
        .mockResolvedValueOnce({ rows: [{ total: '0' }] }); // count

      await svc.listTransactions(makeUser(), { transactionType: 'COLLECTION', loanId: 'loan-1' }, 1, 50);

      const dataCall = query.mock.calls[1];
      expect(dataCall[0]).toContain('lt.transaction_type = $1');
      expect(dataCall[0]).toContain('lt.loan_id = $2');
      // Filter not supplied — the WHERE clause has no customer_id condition, even
      // though the join fragment itself always mentions customer_id (l.id = lt.customer_id).
      expect(dataCall[0]).not.toContain('lt.customer_id = $');
      expect(dataCall[1]).toEqual(['COLLECTION', 'loan-1', 50, 0]);
    });

    it('resolves loan/customer/agent/receipt/created-by display names via LEFT JOIN (§5.4)', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{
          id: 'lt1', transaction_date: '2026-08-10', business_date: '2026-08-10', transaction_type: 'COLLECTION',
          principal_amount: '850', interest_amount: '150', fee_amount: '0', other_amount: '0', total_amount: '1000',
          status: 'POSTED', created_at: '2026-08-10T00:00:00Z',
          loan_number: 'DL2026000001', customer_name: 'Ramesh Kumar', agent_name: 'Priya Singh',
          receipt_number: 'RCPT2026000001', created_by_name: 'Priya Singh',
        }] })
        .mockResolvedValueOnce({ rows: [{ total: '1' }] });

      const result = await svc.listTransactions(makeUser(), {}, 1, 50);

      expect(result.data[0]).toMatchObject({
        loanNumber: 'DL2026000001', customerName: 'Ramesh Kumar', agentName: 'Priya Singh',
        receiptNumber: 'RCPT2026000001', createdByName: 'Priya Singh',
      });
      const dataQuery = query.mock.calls[1][0] as string;
      expect(dataQuery).toContain('LEFT JOIN loans l ON l.id = lt.loan_id');
      expect(dataQuery).toContain('LEFT JOIN payments p ON p.id = lt.payment_id');
    });

    it('omits the WHERE clause entirely when no filters are given', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      await svc.listTransactions(makeUser(), {}, 1, 50);

      expect(query.mock.calls[1][0]).not.toContain('WHERE');
    });
  });

  describe('getLoanLedger / getCustomerLedger', () => {
    it('scopes both the outstanding-principal figure and the transaction list to the loan', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ outstanding: '42000.00' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await svc.getLoanLedger(makeUser(), 'loan-1', 1, 50);

      expect(result.outstandingPrincipal).toBe(42000);
      expect(query.mock.calls[1][1]).toEqual(['loan-1']);
    });

    it('scopes to the customer', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ outstanding: '7000.00' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '0' }] });

      const result = await svc.getCustomerLedger(makeUser(), 'cust-1', 1, 50);

      expect(result.outstandingPrincipal).toBe(7000);
      expect(query.mock.calls[1][1]).toEqual(['cust-1']);
    });
  });
});
