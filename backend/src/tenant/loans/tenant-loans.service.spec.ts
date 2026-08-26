import { TenantLoansService } from './tenant-loans.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantNotificationsService } from '../notifications/tenant-notifications.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantLedgerPostingService } from '../ledger/tenant-ledger-posting.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

function makeUser(overrides: Partial<TenantJwtPayload> = {}): TenantJwtPayload {
  return {
    sub: 'u1', email: 'owner@acme.test', firstName: 'Ann', lastName: 'Owner', role: 'OWNER',
    tenantId: 't1', subdomain: 'acme', schemaName: 'tenant_acme', type: 'tenant_user', ...overrides,
  };
}

describe('TenantLoansService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let notifications: TenantNotificationsService;
  let activity: TenantActivityLogService;
  let ledgerPosting: TenantLedgerPostingService;
  let svc: TenantLoansService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect } } as unknown as PrismaService;
    notifications = {} as unknown as TenantNotificationsService;
    activity = { record: jest.fn().mockResolvedValue(undefined) } as unknown as TenantActivityLogService;
    ledgerPosting = { postWithClient: jest.fn().mockResolvedValue({ id: 'lt1' }) } as unknown as TenantLedgerPostingService;
    svc = new TenantLoansService(prisma, notifications, activity, ledgerPosting);
    // Pre-mark the schema as already having interest_rate widened — withSchema()
    // otherwise runs 3 ALTER TABLE statements first, consuming the
    // mockResolvedValueOnce queue meant for the real assertions below (same
    // warm-cache state production settles into after the first call).
    (svc as unknown as { widenedInterestSchemas: Set<string> }).widenedInterestSchemas.add('tenant_acme');
  });

  describe('approveLoan', () => {
    it('rejects non-manager-tier roles', async () => {
      await expect(svc.approveLoan(makeUser({ role: 'AGENT' }), 'loan1')).rejects.toThrow(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('rejects a loan that is not PENDING', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'DISBURSED', loan_number: 'LN-1', first_due_date: '2026-08-01', principal: '10000', customer_id: 'cust1' }] });
      await expect(svc.approveLoan(makeUser(), 'loan1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for a missing loan', async () => {
      query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      await expect(svc.approveLoan(makeUser(), 'missing')).rejects.toThrow(NotFoundException);
    });

    it('posts a DISBURSEMENT ledger transaction with the loan principal, in the same transaction as the status flip', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'PENDING', loan_number: 'LN-1', first_due_date: '2026-08-01', principal: '15000.00', customer_id: 'cust1' }] })
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // UPDATE loans SET status='APPROVED'
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await svc.approveLoan(makeUser(), 'loan1');

      expect(result).toEqual({ id: 'loan1', status: 'APPROVED', firstDueDate: '2026-08-01' });
      expect(ledgerPosting.postWithClient).toHaveBeenCalledWith(
        expect.objectContaining({ query }),
        expect.anything(),
        expect.objectContaining({
          transactionType: 'DISBURSEMENT',
          loanId: 'loan1',
          customerId: 'cust1',
          principalAmount: 15000,
          paymentChannel: 'CASH',
          idempotencyKey: 'disbursement:loan1',
        }),
      );
      const updateCall = query.mock.calls.find((c) => String(c[0]).includes(`status = 'APPROVED'`));
      expect(updateCall).toBeDefined();
      expect(query.mock.calls.some((c) => c[0] === 'BEGIN')).toBe(true);
      expect(query.mock.calls.some((c) => c[0] === 'COMMIT')).toBe(true);
    });

    it('rolls back if the ledger post fails, leaving the loan un-disbursed', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'PENDING', loan_number: 'LN-1', first_due_date: '2026-08-01', principal: '15000.00', customer_id: 'cust1' }] })
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // UPDATE loans
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
      (ledgerPosting.postWithClient as jest.Mock).mockRejectedValueOnce(new Error('ledger down'));

      await expect(svc.approveLoan(makeUser(), 'loan1')).rejects.toThrow('ledger down');
      expect(query.mock.calls.some((c) => c[0] === 'ROLLBACK')).toBe(true);
      expect(query.mock.calls.some((c) => c[0] === 'COMMIT')).toBe(false);
    });
  });
});
