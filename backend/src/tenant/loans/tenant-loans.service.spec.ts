import { TenantLoansService } from './tenant-loans.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantNotificationsService } from '../notifications/tenant-notifications.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantLedgerPostingService } from '../ledger/tenant-ledger-posting.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { receiptColumnEnsuredSchemas } from '../common/receipt-number';

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
    receiptColumnEnsuredSchemas.clear();
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

  describe('recordPayment', () => {
    /** Queue for the happy path: search_path, loan, installment, arrears, BEGIN, receipt COUNT, payment INSERT. */
    function queueOfficePayment() {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'DISBURSED', customer_id: 'cust1' }] })
        .mockResolvedValueOnce({ rows: [{
          id: 'inst17', installment_number: 17, status: 'PENDING',
          total_amount: '5000.00', paid_amount: '0.00',
          principal_amount: '5000.00', interest_amount: '0.00',
        }] })
        .mockResolvedValueOnce({ rows: [] })              // arrears lookup (none older and due)
        .mockResolvedValueOnce({ rows: [] })              // BEGIN
        .mockResolvedValueOnce({ rows: [] })              // ensureReceiptNumberColumn's ALTER TABLE
        .mockResolvedValueOnce({ rows: [{ n: '5' }] })    // receipt number COUNT
        .mockResolvedValueOnce({ rows: [{ id: 'pay1' }] }); // INSERT payments
    }

    it('settles the installment and commits', async () => {
      queueOfficePayment();

      const result = await svc.recordPayment(makeUser(), 'loan1', {
        installmentId: 'inst17', amount: 5000, paymentMethod: 'CASH',
      });

      expect(result).toEqual(expect.objectContaining({ id: 'pay1', amount: 5000, installmentsPaid: 1 }));
      expect(ledgerPosting.postWithClient).toHaveBeenCalledWith(
        expect.objectContaining({ query }),
        expect.anything(),
        expect.objectContaining({
          transactionType: 'COLLECTION', loanId: 'loan1', customerId: 'cust1',
          paymentId: 'pay1', principalAmount: 5000, interestAmount: 0,
        }),
      );
      expect(query.mock.calls.some((c) => c[0] === 'COMMIT')).toBe(true);
      expect(query.mock.calls.some((c) => c[0] === 'ROLLBACK')).toBe(false);
    });

    it('clears older arrears before the installment that was clicked, so a make-up collection moves the overdue count', async () => {
      // The "+" make-up row is appended after the last installment, and the
      // carry-forward cascade only runs forward — so before arrears-first, paying
      // it settled a future-dated row while the missed EMI stayed overdue.
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'DISBURSED', customer_id: 'cust1' }] })
        .mockResolvedValueOnce({ rows: [{
          id: 'inst11', installment_number: 11, status: 'PENDING',
          total_amount: '1000.00', paid_amount: '0.00',
          principal_amount: '1000.00', interest_amount: '0.00',
        }] })
        .mockResolvedValueOnce({ rows: [{ // arrears older than #11 and already due
          id: 'inst2', installment_number: 2, total_amount: '1030.00', paid_amount: '0.00',
          principal_amount: '988.00', interest_amount: '42.00',
        }] })
        .mockResolvedValueOnce({ rows: [] })              // BEGIN
        .mockResolvedValueOnce({ rows: [] })              // ensureReceiptNumberColumn
        .mockResolvedValueOnce({ rows: [{ n: '0' }] })    // receipt COUNT
        .mockResolvedValueOnce({ rows: [{ id: 'pay1' }] }); // INSERT payments

      const result = await svc.recordPayment(makeUser(), 'loan1', {
        installmentId: 'inst11', amount: 1000, paymentMethod: 'CASH',
      });

      // All of it went to the missed EMI, none to the row that was clicked.
      expect(result.allocations).toEqual([{ installmentNumber: 2, amount: 1000, arrears: true }]);
      expect(result.installmentsPaid).toBe(1);

      const arrearsQuery = query.mock.calls.find((c) => String(c[0]).includes('installment_number < $2'));
      expect(arrearsQuery).toBeDefined();
      // A future installment is not a debt yet and must not jump the queue.
      expect(String(arrearsQuery![0])).toContain('due_date <= CURRENT_DATE');
    });

    it('never allocates a zero amount, which the ledger would reject and take the collection down with it', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'DISBURSED', customer_id: 'cust1' }] })
        .mockResolvedValueOnce({ rows: [{
          id: 'inst11', installment_number: 11, status: 'PENDING',
          total_amount: '1000.00', paid_amount: '0.00',
          principal_amount: '1000.00', interest_amount: '0.00',
        }] })
        .mockResolvedValueOnce({ rows: [{ // arrears swallow the entire payment
          id: 'inst2', installment_number: 2, total_amount: '5000.00', paid_amount: '0.00',
          principal_amount: '5000.00', interest_amount: '0.00',
        }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ n: '0' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'pay1' }] });

      const result = await svc.recordPayment(makeUser(), 'loan1', {
        installmentId: 'inst11', amount: 500, paymentMethod: 'CASH',
      });

      expect(result.allocations).toEqual([{ installmentNumber: 2, amount: 500, arrears: true }]);
      expect(result.allocations.every((a) => a.amount > 0)).toBe(true);
      expect(ledgerPosting.postWithClient).toHaveBeenCalledTimes(1);
    });

    it('does not touch installments.updated_at — the column does not exist, and inside the BEGIN a failed UPDATE aborts the whole payment', async () => {
      queueOfficePayment();

      await svc.recordPayment(makeUser(), 'loan1', {
        installmentId: 'inst17', amount: 5000, paymentMethod: 'CASH',
      });

      const updateCall = query.mock.calls.find((c) => String(c[0]).includes('UPDATE installments'));
      expect(updateCall).toBeDefined();
      expect(String(updateCall![0])).not.toContain('updated_at');
    });
  });
});
