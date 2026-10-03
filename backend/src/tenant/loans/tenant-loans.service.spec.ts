import { TenantLoansService } from './tenant-loans.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantNotificationsService } from '../notifications/tenant-notifications.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantLedgerPostingService } from '../ledger/tenant-ledger-posting.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { receiptColumnEnsuredSchemas } from '../common/receipt-number';

/** YYYY-MM-DD, `days` from now (negative = past). Dates in these tests must move with the clock. */
const ymd = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

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
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'PENDING', loan_number: 'LN-1', first_due_date: '2026-08-01', principal: '15000.00', customer_id: 'cust1', customer_status: 'ACTIVE' }] })
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'loan1' }] }) // UPDATE loans SET status='APPROVED' ... RETURNING id
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const result = await svc.approveLoan(makeUser(), 'loan1');

      expect(result).toEqual({ id: 'loan1', status: 'APPROVED', firstDueDate: '2026-08-01', customerVerified: false });
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
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'PENDING', loan_number: 'LN-1', first_due_date: '2026-08-01', principal: '15000.00', customer_id: 'cust1', customer_status: 'ACTIVE' }] })
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'loan1' }] }) // UPDATE loans ... RETURNING id
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK
      (ledgerPosting.postWithClient as jest.Mock).mockRejectedValueOnce(new Error('ledger down'));

      await expect(svc.approveLoan(makeUser(), 'loan1')).rejects.toThrow('ledger down');
      expect(query.mock.calls.some((c) => c[0] === 'ROLLBACK')).toBe(true);
      expect(query.mock.calls.some((c) => c[0] === 'COMMIT')).toBe(false);
    });

    /** Answers each query by its SQL rather than call order, since notifications add their own queries. */
    function answerApproval(loanRow: Record<string, unknown>) {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM loans l JOIN customers c')) return { rows: [loanRow] };
        if (sql.includes(`status = 'APPROVED'`)) return { rows: [{ id: 'loan1' }] };
        if (sql.includes('UPDATE customers SET status')) return { rows: [{ id: 'cust1' }] };
        return { rows: [] };
      });
    }
    const newCustomerLoan = {
      id: 'loan1', status: 'PENDING', loan_number: 'WL-1', first_due_date: '2026-08-01', principal: '20000.00',
      customer_id: 'cust1', cycle_type: 'WEEKLY', loan_officer_id: 'agent1',
      customer_status: 'IN_PROGRESS', customer_has_aadhaar_doc: true, customer_has_photo: true,
      customer_name: 'Ravi Kumar', customer_code: 'CUST00007',
    };

    it("verifies a new customer in the same transaction as their loan's approval", async () => {
      answerApproval(newCustomerLoan);

      const result = await svc.approveLoan(makeUser(), 'loan1');

      expect(result).toEqual(expect.objectContaining({ status: 'APPROVED', customerVerified: true }));
      const sqls = query.mock.calls.map((c) => String(c[0]));
      const begin = sqls.indexOf('BEGIN');
      const verify = sqls.findIndex((s) => s.includes('UPDATE customers SET status'));
      const commit = sqls.indexOf('COMMIT');
      expect(begin).toBeGreaterThan(-1);
      expect(verify).toBeGreaterThan(begin);
      expect(commit).toBeGreaterThan(verify);
      expect(activity.record).toHaveBeenCalledWith(expect.anything(), expect.anything(),
        expect.objectContaining({ action: 'customer.verified', entityId: 'cust1' }));
    });

    it('tells the submitting agent their loan is active', async () => {
      answerApproval(newCustomerLoan);

      await svc.approveLoan(makeUser(), 'loan1');

      const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO notifications'));
      expect(insert?.[1]).toEqual(expect.arrayContaining(['agent1', 'Loan approved — WL-1', '/weekly-loans/loan1']));
    });

    it("refuses to verify a new customer who has no Aadhaar copy on file, before touching anything", async () => {
      answerApproval({ ...newCustomerLoan, customer_has_aadhaar_doc: false });

      await expect(svc.approveLoan(makeUser(), 'loan1')).rejects.toThrow(BadRequestException);
      expect(query.mock.calls.some((c) => c[0] === 'BEGIN')).toBe(false);
      expect(ledgerPosting.postWithClient).not.toHaveBeenCalled();
    });

    it('does nothing when another approver claimed the loan first (the status-guarded UPDATE matches no row)', async () => {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM loans l JOIN customers c')) return { rows: [newCustomerLoan] }; // both approvers saw PENDING
        return { rows: [] };                                                                    // ...but the claim returns nothing
      });

      await expect(svc.approveLoan(makeUser(), 'loan1', { firstDueDate: ymd(30) })).rejects.toThrow(ConflictException);

      const sqls = query.mock.calls.map((c) => String(c[0]));
      expect(sqls).toContain('ROLLBACK');
      expect(sqls).not.toContain('COMMIT');
      // The loser must not shift the schedule, post a second disbursement or notify the agent again.
      expect(sqls.some((q) => q.includes('UPDATE installments'))).toBe(false);
      expect(sqls.some((q) => q.includes('INSERT INTO notifications'))).toBe(false);
      expect(ledgerPosting.postWithClient).not.toHaveBeenCalled();
      expect(activity.record).not.toHaveBeenCalled();
    });

    it('claims the loan before shifting the schedule', async () => {
      answerApproval(newCustomerLoan);

      await svc.approveLoan(makeUser(), 'loan1', { firstDueDate: ymd(30) });

      const sqls = query.mock.calls.map((c) => String(c[0]));
      const claim = sqls.findIndex((q) => q.includes(`status = 'APPROVED'`) && q.includes(`status = 'PENDING'`));
      const shift = sqls.findIndex((q) => q.includes('UPDATE installments'));
      expect(claim).toBeGreaterThan(-1);
      expect(shift).toBeGreaterThan(claim);
    });

    it("refuses to verify a new customer who has no photo on file, before touching anything", async () => {
      answerApproval({ ...newCustomerLoan, customer_has_photo: false });

      await expect(svc.approveLoan(makeUser(), 'loan1')).rejects.toThrow(BadRequestException);
      expect(query.mock.calls.some((c) => c[0] === 'BEGIN')).toBe(false);
      expect(ledgerPosting.postWithClient).not.toHaveBeenCalled();
    });
  });

  describe('rejectLoan', () => {
    it('requires a reason, since the agent needs to know what to fix', async () => {
      await expect(svc.rejectLoan(makeUser(), 'loan1', { reason: '   ' })).rejects.toThrow(BadRequestException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it("sends the loan back to the agent with the reason and leaves the customer's status alone", async () => {
      query.mockImplementation(async (sql: string) =>
        sql.includes('FROM loans l JOIN customers c')
          ? { rows: [{ id: 'loan1', status: 'PENDING', loan_number: 'WL-1', cycle_type: 'WEEKLY', loan_officer_id: 'agent1', customer_name: 'Ravi Kumar' }] }
          : sql.includes(`status = 'REJECTED'`) ? { rows: [{ id: 'loan1' }] }
          : { rows: [] });

      const result = await svc.rejectLoan(makeUser(), 'loan1', { reason: 'Aadhaar copy is blurred' });

      expect(result).toEqual({ id: 'loan1', status: 'REJECTED', reason: 'Aadhaar copy is blurred' });
      const sqls = query.mock.calls.map((c) => String(c[0]));
      expect(sqls.some((s) => s.includes('UPDATE customers'))).toBe(false);
      const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO notifications'));
      expect(insert?.[1]).toEqual(expect.arrayContaining(['agent1', 'Ravi Kumar: Aadhaar copy is blurred']));
    });
  });

  describe('rejectLoan racing an approval', () => {
    it('does not overwrite a loan that was approved after the status check', async () => {
      query.mockImplementation(async (sql: string) =>
        sql.includes('FROM loans l JOIN customers c')
          ? { rows: [{ id: 'loan1', status: 'PENDING', loan_number: 'WL-1', cycle_type: 'WEEKLY', loan_officer_id: 'agent1', customer_name: 'Ravi Kumar' }] }
          : { rows: [] }); // the status-guarded UPDATE matches nothing: the approver committed first

      await expect(svc.rejectLoan(makeUser(), 'loan1', { reason: 'Blurred' })).rejects.toThrow(ConflictException);
      expect(activity.record).not.toHaveBeenCalled();
      expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO notifications'))).toBe(false);
    });
  });

  describe('first due date must not be in the past', () => {
    const weekly = (firstDueDate: string) => ({
      customerId: 'cust1', principal: 10000, interestRate: 24, termWeeks: 10,
      firstDueDate, calculationType: 'FLAT' as const, emiRounding: 0 as const,
      promissoryNoteUrl: 'data:application/pdf;base64,xyz',
    });
    function mockReadyCustomer() {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM customers WHERE id')) {
          return { rows: [{ id: 'cust1', first_name: 'Ravi', last_name: 'Kumar', status: 'ACTIVE', has_aadhaar_doc: true, has_photo: true }] };
        }
        if (sql.includes('COUNT(*)')) return { rows: [{ n: '0' }] };
        if (sql.includes('INSERT INTO loans')) return { rows: [{ id: 'loan1' }] };
        return { rows: [] };
      });
    }
    const agent = () => makeUser({ role: 'AGENT', sub: 'agent1' });

    it.each([[-2], [-30], [-365]])('refuses a weekly loan first due %p days ago, before touching the database', async (days) => {
      await expect(svc.createWeeklyLoan(agent(), weekly(ymd(days)))).rejects.toThrow('firstDueDate cannot be in the past');
      expect(poolConnect).not.toHaveBeenCalled();
    });

    // One day of grace: the server date is UTC, a user in IST can be a calendar day ahead of it.
    it.each([[-1], [0], [1], [90]])('accepts a first due date %p days from today', async (days) => {
      mockReadyCustomer();
      await expect(svc.createWeeklyLoan(agent(), weekly(ymd(days)))).resolves.toBeDefined();
    });

    it('applies to the other loan types too', async () => {
      const base = { customerId: 'cust1', principal: 10000, interestRate: 24, firstDueDate: ymd(-10), promissoryNoteUrl: 'x' };
      await expect(svc.createDailyLoan(agent(), { ...base, termDays: 30, calculationType: 'FLAT', emiRounding: 0, cycleType: 'DAILY_NO_SUNDAY' } as never)).rejects.toThrow('cannot be in the past');
      await expect(svc.createMonthlyLoan(agent(), { ...base, termMonths: 6 } as never)).rejects.toThrow('cannot be in the past');
      await expect(svc.createAgentRiskLoan(agent(), { ...base, termMonths: 6 } as never)).rejects.toThrow('cannot be in the past');
    });

    it('agent-risk loans now require a real date at all (they validated none before)', async () => {
      const base = { customerId: 'cust1', principal: 10000, interestRate: 24, termMonths: 6, promissoryNoteUrl: 'x' };
      await expect(svc.createAgentRiskLoan(agent(), base as never)).rejects.toThrow('firstDueDate must be YYYY-MM-DD');
      await expect(svc.createAgentRiskLoan(agent(), { ...base, firstDueDate: '2026-02-31' } as never)).rejects.toThrow('firstDueDate must be YYYY-MM-DD');
    });

    describe('editing', () => {
      const edit = (firstDueDate: string) => ({
        principal: 10000, interestRate: 24, termWeeks: 10, firstDueDate, calculationType: 'FLAT' as const, emiRounding: 0 as const,
      });
      function mockStoredLoan(storedDue: string) {
        query.mockImplementation(async (sql: string) => {
          if (sql.includes('FROM loans WHERE id')) {
            return { rows: [{ loan_number: 'WL-1', status: 'DISBURSED', cycle_type: 'WEEKLY', pending_closure: false, first_due_ymd: storedDue, loan_type_id: null, security_doc_url: null, promissory_note_url: null }] };
          }
          if (sql.includes('FROM payments')) return { rows: [{ n: '0' }] };
          return { rows: [] };
        });
      }

      it('still lets an old, unpaid loan be edited when its date is left alone', async () => {
        const stored = ymd(-20);
        mockStoredLoan(stored);
        await expect(svc.updateWeeklyLoan(makeUser(), 'loan1', edit(stored))).resolves.toBeDefined();
      });

      it('refuses moving the date to a past one', async () => {
        mockStoredLoan(ymd(-20));
        await expect(svc.updateWeeklyLoan(makeUser(), 'loan1', edit(ymd(-5)))).rejects.toThrow('firstDueDate cannot be in the past');
      });

      it('allows moving it to a future one', async () => {
        mockStoredLoan(ymd(-20));
        await expect(svc.updateWeeklyLoan(makeUser(), 'loan1', edit(ymd(14)))).resolves.toBeDefined();
      });
    });

    describe('approving', () => {
      const loanRow = (due: string) => ({
        id: 'loan1', status: 'PENDING', loan_number: 'WL-1', first_due_date: due, principal: '20000.00',
        customer_id: 'cust1', cycle_type: 'WEEKLY', loan_officer_id: 'agent1',
        customer_status: 'ACTIVE', customer_has_aadhaar_doc: true, customer_has_photo: true,
        customer_name: 'Ravi Kumar', customer_code: 'CUST00007',
      });
      const answer = (due: string) => query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM loans l JOIN customers c')) return { rows: [loanRow(due)] };
        if (sql.includes(`status = 'APPROVED'`)) return { rows: [{ id: 'loan1' }] };
        return { rows: [] };
      });

      it('lets a manager approve an old loan without picking a new date', async () => {
        answer(ymd(-20));
        await expect(svc.approveLoan(makeUser(), 'loan1')).resolves.toEqual(expect.objectContaining({ status: 'APPROVED' }));
      });

      it('refuses a past date chosen at approval', async () => {
        answer(ymd(-20));
        await expect(svc.approveLoan(makeUser(), 'loan1', { firstDueDate: ymd(-5) })).rejects.toThrow('firstDueDate cannot be in the past');
        expect(ledgerPosting.postWithClient).not.toHaveBeenCalled();
      });

      it('accepts re-confirming the stored date even though it is past', async () => {
        const stored = ymd(-20);
        answer(stored);
        await expect(svc.approveLoan(makeUser(), 'loan1', { firstDueDate: stored })).resolves.toBeDefined();
      });
    });
  });

  describe('creating a loan for a customer who is not verified yet', () => {
    const weekly = {
      customerId: 'cust1', principal: 10000, interestRate: 24, termWeeks: 10,
      firstDueDate: ymd(7), calculationType: 'FLAT' as const, emiRounding: 0 as const,
      promissoryNoteUrl: 'data:application/pdf;base64,xyz',
    };
    function mockCustomer(overrides: { has_aadhaar_doc: boolean; has_photo: boolean }) {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM customers WHERE id')) {
          return { rows: [{ id: 'cust1', first_name: 'Ravi', last_name: 'Kumar', status: 'IN_PROGRESS', ...overrides }] };
        }
        if (sql.includes('COUNT(*)')) return { rows: [{ n: '0' }] };
        if (sql.includes('INSERT INTO loans')) return { rows: [{ id: 'loan1' }] };
        return { rows: [] };
      });
    }

    it("is refused until the customer's Aadhaar copy is uploaded", async () => {
      mockCustomer({ has_aadhaar_doc: false, has_photo: true });

      await expect(svc.createWeeklyLoan(makeUser({ role: 'AGENT', sub: 'agent1' }), weekly))
        .rejects.toThrow("Upload the customer's Aadhaar copy before submitting this loan");
      expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO loans'))).toBe(false);
    });

    it('is refused until the customer has a photo on file', async () => {
      mockCustomer({ has_aadhaar_doc: true, has_photo: false });

      await expect(svc.createWeeklyLoan(makeUser({ role: 'AGENT', sub: 'agent1' }), weekly))
        .rejects.toThrow('Upload a photo before submitting this loan');
      expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO loans'))).toBe(false);
    });

    it('is refused until a promissory note is attached, even for an already-verified customer', async () => {
      mockCustomer({ has_aadhaar_doc: true, has_photo: true });

      await expect(svc.createWeeklyLoan(makeUser({ role: 'AGENT', sub: 'agent1' }), { ...weekly, promissoryNoteUrl: undefined }))
        .rejects.toThrow('A promissory note is required before submitting this loan');
      expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO loans'))).toBe(false);
    });

    it('is accepted as a PENDING application once the photo, Aadhaar copy and promissory note are all on file', async () => {
      mockCustomer({ has_aadhaar_doc: true, has_photo: true });

      await svc.createWeeklyLoan(makeUser({ role: 'AGENT', sub: 'agent1' }), weekly);

      const insert = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO loans'));
      expect(String(insert?.[0])).toContain("'PENDING'");
    });
  });

  describe('recordPayment amount validation', () => {
    // These must be refused before a connection is even taken: a NaN that reached the
    // payments table is stored happily by numeric and then poisons every ledger SUM.
    const bad: [string, unknown][] = [
      ['a non-numeric string', 'abc'], ['a boolean', true], ['an array', [5]], ['NaN', NaN],
      ['Infinity', Infinity], ['exponent notation', '1e3'], ['zero', 0], ['a negative number', -50],
      ['a value that rounds to zero', 0.004], ['an absurdly large value', 1e12], ['null', null], ['an object', {}],
    ];
    it.each(bad)('rejects %s as the amount', async (_label, amount) => {
      await expect(svc.recordPayment(makeUser(), 'loan1', {
        installmentId: 'inst17', amount: amount as number, paymentMethod: 'CASH',
      })).rejects.toThrow(BadRequestException);
      expect(poolConnect).not.toHaveBeenCalled();
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
