import { createHmac } from 'crypto';
import { TenantPaymentWebhookService } from './tenant-payment-webhook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantLedgerPostingService } from '../ledger/tenant-ledger-posting.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { ForbiddenException, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

function makeUser(overrides: Partial<TenantJwtPayload> = {}): TenantJwtPayload {
  return {
    sub: 'u1', email: 'owner@acme.test', firstName: 'Ann', lastName: 'Owner', role: 'OWNER',
    tenantId: 't1', subdomain: 'acme', schemaName: 'tenant_acme', type: 'tenant_user', ...overrides,
  };
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('TenantPaymentWebhookService', () => {
  let query: jest.Mock;
  let client: { query: jest.Mock };
  let poolConnect: jest.Mock;
  let prisma: PrismaService;
  let activity: TenantActivityLogService;
  let ledgerPosting: TenantLedgerPostingService;
  let svc: TenantPaymentWebhookService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    client = { query };
    poolConnect = jest.fn().mockResolvedValue({ ...client, release: jest.fn() });
    prisma = { pool: { connect: poolConnect } } as unknown as PrismaService;
    activity = { record: jest.fn().mockResolvedValue(undefined) } as unknown as TenantActivityLogService;
    ledgerPosting = {
      postWithClient: jest.fn().mockResolvedValue({ id: 'lt1' }),
      ensureTable: jest.fn().mockResolvedValue(undefined),
    } as unknown as TenantLedgerPostingService;
    svc = new TenantPaymentWebhookService(prisma, activity, ledgerPosting);
    (svc as unknown as { ensuredSchemas: Set<string> }).ensuredSchemas.add('tenant_acme');
  });

  describe('ensureTable', () => {
    // Regression: incoming_payment_events has an FK to ledger_transactions,
    // which is itself lazily created — a real Postgres run against a tenant
    // that had never touched any ledger posting code failed with
    // 'relation "ledger_transactions" does not exist' because this ordering
    // was missing.
    it('ensures ledger_transactions exists before creating incoming_payment_events', async () => {
      const calls: string[] = [];
      (ledgerPosting.ensureTable as jest.Mock).mockImplementation(async () => { calls.push('ledger_transactions'); });
      query.mockImplementation(async (sql: string) => { if (sql.includes('incoming_payment_events')) calls.push('incoming_payment_events'); return { rows: [] }; });
      (svc as unknown as { ensuredSchemas: Set<string> }).ensuredSchemas.clear();

      await svc.ensureTable(client as unknown as import('pg').PoolClient, 'tenant_acme');

      expect(calls[0]).toBe('ledger_transactions');
      expect(calls).toContain('incoming_payment_events');
    });
  });

  describe('receiveWebhook', () => {
    it('rejects an unknown provider before touching the database', async () => {
      await expect(svc.receiveWebhook('tenant_acme', 'razorpay', '{}', {})).rejects.toThrow(NotFoundException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('rejects when no secret is configured for this tenant/provider', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [] }); // secret lookup — none configured
      await expect(svc.receiveWebhook('tenant_acme', 'generic', '{}', {})).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid signature', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ value: 'the-secret' }] });
      await expect(
        svc.receiveWebhook('tenant_acme', 'generic', '{}', { 'x-webhook-signature': 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('acknowledges but ignores a non-payment event type', async () => {
      const body = JSON.stringify({ event: 'payment.failed', reference: 'r1', amount: 100 });
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ value: 'the-secret' }] });
      const result = await svc.receiveWebhook('tenant_acme', 'generic', body, { 'x-webhook-signature': sign(body, 'the-secret') });
      expect(result).toEqual({ ignored: true });
    });

    it('stores a new event and returns its id', async () => {
      const body = JSON.stringify({ event: 'payment.completed', reference: 'pay_1', amount: 500, method: 'UPI' });
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ value: 'the-secret' }] }) // secret
        .mockResolvedValueOnce({ rows: [] }) // idempotency lookup — none found
        .mockResolvedValueOnce({ rows: [{ id: 'evt1' }] }); // INSERT RETURNING id

      const result = await svc.receiveWebhook('tenant_acme', 'generic', body, { 'x-webhook-signature': sign(body, 'the-secret') });
      expect(result).toEqual({ received: true, eventId: 'evt1' });
      const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO incoming_payment_events'));
      expect(insertCall![1]).toEqual(['generic', 'pay_1', 500, 'INR', 'UPI', null, null, null, JSON.stringify(JSON.parse(body))]);
    });

    it('returns duplicate:true instead of inserting when the (provider, reference) pair already exists', async () => {
      const body = JSON.stringify({ event: 'payment.completed', reference: 'pay_1', amount: 500 });
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ value: 'the-secret' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'evt-existing' }] }); // already exists

      const result = await svc.receiveWebhook('tenant_acme', 'generic', body, { 'x-webhook-signature': sign(body, 'the-secret') });
      expect(result).toEqual({ duplicate: true, eventId: 'evt-existing' });
      expect(query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO incoming_payment_events'))).toBe(false);
    });
  });

  describe('access control', () => {
    it.each(['MANAGER', 'AGENT', 'STAFF', 'CUSTOMER'] as const)('rejects %s from listing unmatched events', async (role) => {
      await expect(svc.listUnmatched(makeUser({ role }), 1, 50)).rejects.toThrow(ForbiddenException);
      expect(poolConnect).not.toHaveBeenCalled();
    });
  });

  describe('matchToLoan', () => {
    it('rejects an event that is not RECEIVED', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'evt1', status: 'POSTED', provider: 'generic', external_reference: 'pay_1', amount: '500', currency: 'INR' }] });
      await expect(svc.matchToLoan(makeUser(), 'evt1', 'loan1')).rejects.toThrow(BadRequestException);
    });

    it('rejects when the installment amount exceeds the balance', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'evt1', status: 'RECEIVED', provider: 'generic', external_reference: 'pay_1', amount: '9999', currency: 'INR' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'DISBURSED', customer_id: 'cust1', loan_number: 'LN-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'inst1', total_amount: '500', paid_amount: '0', principal_amount: '450', interest_amount: '50' }] });

      await expect(svc.matchToLoan(makeUser(), 'evt1', 'loan1', 'inst1')).rejects.toThrow(BadRequestException);
    });

    it('matches, posts a payment + ledger transaction, and updates the event', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{ id: 'evt1', status: 'RECEIVED', provider: 'generic', external_reference: 'pay_1', amount: '500', currency: 'INR', payment_method: 'UPI', received_at: '2026-08-20T00:00:00Z' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'DISBURSED', customer_id: 'cust1', loan_number: 'LN-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'inst1', total_amount: '500', paid_amount: '0', principal_amount: '450', interest_amount: '50' }] })
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ n: '0' }] }) // nextReceiptNumber's SELECT COUNT(*)
        .mockResolvedValueOnce({ rows: [{ id: 'payment1' }] }) // INSERT payments
        .mockResolvedValueOnce({ rows: [] }) // UPDATE installments
        .mockResolvedValueOnce({ rows: [] }) // UPDATE incoming_payment_events
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        ;

      const result = await svc.matchToLoan(makeUser(), 'evt1', 'loan1', 'inst1');
      expect(result).toEqual({ success: true, paymentId: 'payment1', receiptNumber: expect.any(String), ledgerTransactionId: 'lt1' });
      expect(ledgerPosting.postWithClient).toHaveBeenCalledWith(
        expect.objectContaining({ query }),
        expect.anything(),
        expect.objectContaining({
          transactionType: 'COLLECTION', loanId: 'loan1', customerId: 'cust1', paymentId: 'payment1',
          principalAmount: 450, interestAmount: 50, paymentChannel: 'UPI',
        }),
      );
    });

    // Regression: node-postgres returns TIMESTAMPTZ columns (occurred_at,
    // received_at) as native Date objects, not strings — a real Postgres run
    // of this exact flow threw "(...).slice is not a function" because the
    // event.occurredAt ?? event.receivedAt expression was passed straight
    // into .slice(0, 10). Mocked-string tests elsewhere in this file never
    // caught it since they hand back literal strings, not Date instances.
    it('handles occurredAt/receivedAt coming back as Date instances (real pg driver behavior), not strings', async () => {
      query
        .mockResolvedValueOnce({ rows: [] }) // SET search_path
        .mockResolvedValueOnce({ rows: [{
          id: 'evt1', status: 'RECEIVED', provider: 'generic', external_reference: 'pay_1', amount: '500', currency: 'INR',
          payment_method: 'UPI', occurred_at: null, received_at: new Date('2026-08-20T12:34:56.000Z'),
        }] })
        .mockResolvedValueOnce({ rows: [{ id: 'loan1', status: 'DISBURSED', customer_id: 'cust1', loan_number: 'LN-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'inst1', total_amount: '500', paid_amount: '0', principal_amount: '450', interest_amount: '50' }] })
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ n: '0' }] }) // nextReceiptNumber's SELECT COUNT(*)
        .mockResolvedValueOnce({ rows: [{ id: 'payment1' }] }) // INSERT payments
        .mockResolvedValueOnce({ rows: [] }) // UPDATE installments
        .mockResolvedValueOnce({ rows: [] }) // UPDATE incoming_payment_events
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      await expect(svc.matchToLoan(makeUser(), 'evt1', 'loan1', 'inst1')).resolves.toEqual({
        success: true, paymentId: 'payment1', receiptNumber: expect.any(String), ledgerTransactionId: 'lt1',
      });
      const insertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO payments'));
      expect(insertCall![1]).toContain('2026-08-20');
      expect(ledgerPosting.postWithClient).toHaveBeenCalledWith(
        expect.anything(), expect.anything(),
        expect.objectContaining({ transactionDate: '2026-08-20' }),
      );
      const updateEventCall = query.mock.calls.find((c) => String(c[0]).includes('UPDATE incoming_payment_events'));
      expect(updateEventCall![1]).toEqual(['loan1', 'inst1', 'cust1', 'payment1', 'lt1', 'u1', 'evt1']);
    });
  });

  describe('rejectEvent', () => {
    it('requires a reason', async () => {
      await expect(svc.rejectEvent(makeUser(), 'evt1', '')).rejects.toThrow(BadRequestException);
    });

    it('throws when nothing matched (already processed or missing)', async () => {
      query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      await expect(svc.rejectEvent(makeUser(), 'evt1', 'duplicate of pay_1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setWebhookSecret', () => {
    it('rejects an unknown provider', async () => {
      await expect(svc.setWebhookSecret(makeUser(), 'razorpay', 'abc')).rejects.toThrow(BadRequestException);
      expect(poolConnect).not.toHaveBeenCalled();
    });

    it('upserts the secret for a known provider', async () => {
      query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
      const result = await svc.setWebhookSecret(makeUser(), 'generic', 'shh');
      expect(result).toEqual({ success: true });
      const upsertCall = query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO settings'));
      expect(upsertCall![1]).toEqual(['payment_webhook_secret_generic', 'shh']);
    });
  });
});
