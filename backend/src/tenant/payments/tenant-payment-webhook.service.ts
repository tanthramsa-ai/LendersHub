import { Injectable, BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantJwtPayload } from '../auth/strategies/tenant-jwt.strategy';
import { TenantActivityLogService } from '../activity-log/tenant-activity-log.service';
import { TenantLedgerPostingService, splitPrincipalInterest, LedgerPaymentChannel } from '../ledger/tenant-ledger-posting.service';
import { LEDGER_ROLES, UserRole } from '../common/roles';
import { nextReceiptNumber } from '../common/receipt-number';
import { PaymentWebhookAdapter } from './webhook-adapters/payment-webhook-adapter.interface';
import { GenericWebhookAdapter } from './webhook-adapters/generic-webhook-adapter';

export interface IncomingPaymentEvent {
  id: string;
  provider: string;
  externalReference: string;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  payerName: string | null;
  payerContact: string | null;
  occurredAt: string | null;
  status: 'RECEIVED' | 'POSTED' | 'REJECTED';
  matchedLoanId: string | null;
  matchedInstallmentId: string | null;
  matchedCustomerId: string | null;
  paymentId: string | null;
  ledgerTransactionId: string | null;
  rejectionReason: string | null;
  processedBy: string | null;
  processedAt: string | null;
  receivedAt: string;
}

const KNOWN_CHANNELS: LedgerPaymentChannel[] = ['UPI', 'BANK_TRANSFER', 'PAYMENT_GATEWAY', 'CASH', 'CHEQUE', 'NEFT', 'RTGS'];

/**
 * Direct payment ingestion — requirements doc §7.4. Receives provider
 * webhooks into a staging table (incoming_payment_events), then a human
 * matches each event to a loan/installment (Phase 6 scope decision: no
 * provider chosen yet, so no reference-parsing auto-match either — see
 * webhook-adapters/generic-webhook-adapter.ts). Once matched, this posts
 * through the exact same payments + ledger pipeline agent collections use
 * (TenantLedgerPostingService.postWithClient), so a direct payment is
 * indistinguishable from an agent one anywhere else in the system.
 */
@Injectable()
export class TenantPaymentWebhookService {
  private readonly adapters: Record<string, PaymentWebhookAdapter> = {
    generic: new GenericWebhookAdapter(),
  };
  private ensuredSchemas = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private activity: TenantActivityLogService,
    private ledgerPosting: TenantLedgerPostingService,
  ) {}

  private async withSchema<T>(schemaName: string, fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.prisma.pool.connect();
    try {
      await client.query(`SET search_path = "${schemaName}", public`);
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private assertAccess(user: TenantJwtPayload) {
    if (!LEDGER_ROLES.includes(user.role as UserRole)) throw new ForbiddenException('Only Owner or Admin can manage direct payment matching');
  }

  async ensureTable(client: import('pg').PoolClient, schemaName: string): Promise<void> {
    if (this.ensuredSchemas.has(schemaName)) return;
    // incoming_payment_events FK-references ledger_transactions, which is
    // itself lazily created — a tenant that has never touched any ledger
    // posting path yet won't have it, so it must be ensured first or the
    // CREATE TABLE below fails with "relation ... does not exist".
    await this.ledgerPosting.ensureTable(client, schemaName);
    const q = `"${schemaName}"`;
    const s = schemaName.replace(/[^a-zA-Z0-9_]/g, '_');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${q}."incoming_payment_events" (
        id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        provider               TEXT          NOT NULL,
        external_reference     TEXT          NOT NULL,
        amount                 NUMERIC(14,2) NOT NULL,
        currency               TEXT          NOT NULL DEFAULT 'INR',
        payment_method         TEXT,
        payer_name             TEXT,
        payer_contact          TEXT,
        occurred_at            TIMESTAMPTZ,
        raw_payload            JSONB         NOT NULL,
        status                 TEXT          NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','POSTED','REJECTED')),
        matched_loan_id        UUID          REFERENCES ${q}."loans" (id) ON DELETE SET NULL,
        matched_installment_id UUID          REFERENCES ${q}."installments" (id) ON DELETE SET NULL,
        matched_customer_id    UUID          REFERENCES ${q}."customers" (id) ON DELETE SET NULL,
        payment_id             UUID          REFERENCES ${q}."payments" (id) ON DELETE SET NULL,
        ledger_transaction_id  UUID          REFERENCES ${q}."ledger_transactions" (id) ON DELETE SET NULL,
        rejection_reason       TEXT,
        processed_by           UUID          REFERENCES ${q}."users" (id) ON DELETE SET NULL,
        processed_at           TIMESTAMPTZ,
        received_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_${s}_ipe_provider_ref UNIQUE (provider, external_reference)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ipe_status ON ${q}."incoming_payment_events" (status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_${s}_ipe_received ON ${q}."incoming_payment_events" (received_at DESC)`);
    this.ensuredSchemas.add(schemaName);
  }

  private mapRow(r: Record<string, unknown>): IncomingPaymentEvent {
    return {
      id: r.id as string,
      provider: r.provider as string,
      externalReference: r.external_reference as string,
      amount: parseFloat(r.amount as string),
      currency: r.currency as string,
      paymentMethod: (r.payment_method as string) ?? null,
      payerName: (r.payer_name as string) ?? null,
      payerContact: (r.payer_contact as string) ?? null,
      occurredAt: (r.occurred_at as string) ?? null,
      status: r.status as IncomingPaymentEvent['status'],
      matchedLoanId: (r.matched_loan_id as string) ?? null,
      matchedInstallmentId: (r.matched_installment_id as string) ?? null,
      matchedCustomerId: (r.matched_customer_id as string) ?? null,
      paymentId: (r.payment_id as string) ?? null,
      ledgerTransactionId: (r.ledger_transaction_id as string) ?? null,
      rejectionReason: (r.rejection_reason as string) ?? null,
      processedBy: (r.processed_by as string) ?? null,
      processedAt: (r.processed_at as string) ?? null,
      receivedAt: r.received_at as string,
    };
  }

  /**
   * Entry point for POST /api/v1/tenant/payments/webhook/:subdomain/:provider
   * — deliberately outside TenantJwtGuard (the provider can't obtain our
   * JWTs); authenticity instead comes from the per-tenant shared secret and
   * the adapter's signature check. Every failure mode below maps to the HTTP
   * status a webhook sender expects: 404 unknown org/provider, 400 not
   * configured, 401 bad signature. A recognized-but-uninteresting event type
   * (e.g. "payment.failed") returns {ignored:true} — the controller still
   * acks with 200 so the provider doesn't retry it forever.
   */
  async receiveWebhook(schemaName: string, provider: string, rawBody: string, headers: Record<string, string>) {
    const adapter = this.adapters[provider];
    if (!adapter) throw new NotFoundException(`Unknown payment provider "${provider}"`);

    return this.withSchema(schemaName, async (client) => {
      await this.ensureTable(client, schemaName);

      const secretRes = await client.query<{ value: string }>(`SELECT value FROM settings WHERE key = $1`, [`payment_webhook_secret_${provider}`]);
      const secret = secretRes.rows[0]?.value;
      if (!secret) throw new BadRequestException('Payment webhook is not configured for this organisation');

      if (!adapter.verifySignature(rawBody, headers, secret)) throw new UnauthorizedException('Invalid webhook signature');

      const event = adapter.parseEvent(rawBody, headers);
      if (!event) return { ignored: true as const };

      const existing = await client.query(
        `SELECT id FROM incoming_payment_events WHERE provider = $1 AND external_reference = $2`,
        [provider, event.externalReference],
      );
      if (existing.rows[0]) return { duplicate: true as const, eventId: existing.rows[0].id as string };

      const res = await client.query(
        `INSERT INTO incoming_payment_events (
           provider, external_reference, amount, currency, payment_method, payer_name, payer_contact, occurred_at, raw_payload
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          provider, event.externalReference, event.amount, event.currency ?? 'INR', event.paymentMethod ?? null,
          event.payerName ?? null, event.payerContact ?? null, event.occurredAt ?? null,
          JSON.stringify(event.rawPayload),
        ],
      );
      return { received: true as const, eventId: res.rows[0].id as string };
    });
  }

  async listUnmatched(user: TenantJwtPayload, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const dataRes = await client.query(
        `SELECT * FROM incoming_payment_events WHERE status = 'RECEIVED' ORDER BY received_at ASC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM incoming_payment_events WHERE status = 'RECEIVED'`);
      return { data: dataRes.rows.map((r) => this.mapRow(r)), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  async listProcessed(user: TenantJwtPayload, page: number, limit: number) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const dataRes = await client.query(
        `SELECT * FROM incoming_payment_events WHERE status != 'RECEIVED' ORDER BY processed_at DESC LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit],
      );
      const countRes = await client.query<{ total: string }>(`SELECT COUNT(*) AS total FROM incoming_payment_events WHERE status != 'RECEIVED'`);
      return { data: dataRes.rows.map((r) => this.mapRow(r)), total: parseInt(countRes.rows[0].total), page, limit };
    });
  }

  /**
   * Matches a RECEIVED event to a loan (and optionally one installment on
   * it), then posts through the same payments+ledger pipeline
   * TenantLoansService.recordPayment uses. Without an installmentId the
   * amount is recorded as unallocated (other_amount) — same convention as
   * that service's own no-installment branch, for the same reason: no
   * scheduled principal/interest split exists to allocate it against.
   */
  async matchToLoan(user: TenantJwtPayload, eventId: string, loanId: string, installmentId?: string) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);

      const eventRes = await client.query(`SELECT * FROM incoming_payment_events WHERE id = $1`, [eventId]);
      if (!eventRes.rows[0]) throw new NotFoundException('Payment event not found');
      const event = this.mapRow(eventRes.rows[0]);
      if (event.status !== 'RECEIVED') throw new BadRequestException(`Event is already ${event.status.toLowerCase()}`);

      const loanRes = await client.query<{ id: string; status: string; customer_id: string; loan_number: string }>(
        `SELECT id, status, customer_id, loan_number FROM loans WHERE id = $1`, [loanId],
      );
      if (!loanRes.rows[0]) throw new NotFoundException('Loan not found');
      const loan = loanRes.rows[0];
      if (!['APPROVED', 'DISBURSED'].includes(loan.status)) throw new BadRequestException('Loan is not active');

      let installment: { id: string; total_amount: string; paid_amount: string; principal_amount: string; interest_amount: string } | null = null;
      if (installmentId) {
        const instRes = await client.query(
          `SELECT id, total_amount, paid_amount, principal_amount, interest_amount FROM installments WHERE id = $1 AND loan_id = $2`,
          [installmentId, loanId],
        );
        if (!instRes.rows[0]) throw new BadRequestException('Installment not found on this loan');
        installment = instRes.rows[0];
        const balance = parseFloat(installment!.total_amount) - parseFloat(installment!.paid_amount);
        if (event.amount > balance + 0.01) {
          throw new BadRequestException(`Payment amount ₹${event.amount} exceeds this installment's balance of ₹${round2(balance)}`);
        }
      }

      const channel = channelFor(event);
      // event.occurredAt/receivedAt come back from pg as Date objects (TIMESTAMPTZ
      // columns), not strings — despite IncomingPaymentEvent's type — so this must
      // go through Date parsing rather than assuming a string with .slice().
      const paymentDate = toDateOnly(event.occurredAt ?? event.receivedAt);

      await client.query('BEGIN');
      let committed = false;
      try {
        const receiptNumber = await nextReceiptNumber(client);
        const payRes = await client.query<{ id: string }>(
          `INSERT INTO payments (loan_id, installment_id, amount, payment_method, reference_number, receipt_number, payment_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [
            loanId, installmentId ?? null, event.amount, mapPaymentMethod(event),
            event.externalReference, receiptNumber, paymentDate,
          ],
        );
        const paymentId = payRes.rows[0].id;

        if (installment) {
          await client.query(
            `UPDATE installments
             SET paid_amount = paid_amount + $1,
                 status = CASE
                   WHEN paid_amount + $1 >= total_amount THEN 'PAID'
                   WHEN paid_amount + $1 > 0 THEN 'PARTIALLY_PAID'
                   ELSE status
                 END,
                 paid_at = CASE WHEN paid_amount + $1 >= total_amount THEN NOW() ELSE paid_at END
             WHERE id = $2`,
            [event.amount, installment.id],
          );
        }

        const ledgerInput = installment
          ? splitPrincipalInterest(event.amount, parseFloat(installment.principal_amount), parseFloat(installment.interest_amount))
          : { principal: 0, interest: 0 };

        const txn = await this.ledgerPosting.postWithClient(client, user, {
          transactionDate: paymentDate,
          transactionType: 'COLLECTION',
          loanId, customerId: loan.customer_id, paymentId,
          principalAmount: ledgerInput.principal,
          interestAmount: ledgerInput.interest,
          otherAmount: installment ? 0 : event.amount,
          paymentChannel: channel,
          externalReference: event.externalReference,
          idempotencyKey: `${event.provider}:${event.externalReference}`,
          remarks: `Direct payment via ${event.provider} — matched to ${loan.loan_number}${installment ? ` (installment ${installment.id})` : ''}`,
        });

        await client.query(
          `UPDATE incoming_payment_events
             SET status = 'POSTED', matched_loan_id = $1, matched_installment_id = $2, matched_customer_id = $3,
                 payment_id = $4, ledger_transaction_id = $5, processed_by = $6, processed_at = NOW()
           WHERE id = $7`,
          [loanId, installmentId ?? null, loan.customer_id, paymentId, txn.id, user.sub, eventId],
        );

        await this.activity.record(client, user, {
          action: 'payment.webhook_matched',
          entityType: 'loan',
          entityId: loanId,
          entityLabel: loan.loan_number,
          metadata: { eventId, provider: event.provider, amount: event.amount, installmentId: installmentId ?? null },
        });

        await client.query('COMMIT');
        committed = true;
        return { success: true, paymentId, receiptNumber, ledgerTransactionId: txn.id };
      } finally {
        if (!committed) await client.query('ROLLBACK');
      }
    });
  }

  async rejectEvent(user: TenantJwtPayload, eventId: string, reason: string) {
    this.assertAccess(user);
    if (!reason?.trim()) throw new BadRequestException('A reason is required to reject a payment event');
    return this.withSchema(user.schemaName, async (client) => {
      await this.ensureTable(client, user.schemaName);
      const res = await client.query(
        `UPDATE incoming_payment_events
           SET status = 'REJECTED', rejection_reason = $1, processed_by = $2, processed_at = NOW()
         WHERE id = $3 AND status = 'RECEIVED'
         RETURNING *`,
        [reason, user.sub, eventId],
      );
      if (!res.rows[0]) throw new NotFoundException('Payment event not found or already processed');
      const rejected = this.mapRow(res.rows[0]);
      await this.activity.record(client, user, {
        action: 'payment.webhook_rejected', entityType: 'incoming_payment_event', entityId: eventId,
        entityLabel: `${rejected.provider} — ₹${rejected.amount}`, metadata: { reason },
      });
      return rejected;
    });
  }

  /** Which webhook providers this tenant has a secret configured for, plus the URL to give each one. Never returns the secret itself. */
  async getWebhookConfig(user: TenantJwtPayload, subdomain: string, baseUrl: string) {
    this.assertAccess(user);
    return this.withSchema(user.schemaName, async (client) => {
      const res = await client.query<{ key: string }>(
        `SELECT key FROM settings WHERE key LIKE 'payment_webhook_secret_%'`,
      );
      const configuredProviders = new Set(res.rows.map((r) => r.key.replace('payment_webhook_secret_', '')));
      return Object.keys(this.adapters).map((provider) => ({
        provider,
        configured: configuredProviders.has(provider),
        webhookUrl: `${baseUrl}/api/v1/tenant/payments/webhook/${subdomain}/${provider}`,
      }));
    });
  }

  async setWebhookSecret(user: TenantJwtPayload, provider: string, secret: string) {
    this.assertAccess(user);
    if (!this.adapters[provider]) throw new BadRequestException(`Unknown payment provider "${provider}"`);
    if (!secret?.trim()) throw new BadRequestException('Secret is required');
    return this.withSchema(user.schemaName, async (client) => {
      await client.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [`payment_webhook_secret_${provider}`, secret.trim()],
      );
      await this.activity.record(client, user, {
        action: 'payment.webhook_secret_set', entityType: 'settings', entityLabel: `${provider} webhook secret`,
      });
      return { success: true };
    });
  }
}

function mapPaymentMethod(event: { paymentMethod?: string | null }): 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS' {
  const m = (event.paymentMethod ?? '').toUpperCase();
  if (['UPI', 'BANK_TRANSFER', 'CHEQUE', 'NEFT', 'RTGS'].includes(m)) return m as 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS';
  return 'BANK_TRANSFER'; // safest default for an unrecognized direct-payment method — never CASH for something that arrived electronically.
}

function channelFor(event: { paymentMethod?: string | null }): LedgerPaymentChannel {
  const m = (event.paymentMethod ?? '').toUpperCase();
  const known = KNOWN_CHANNELS.find((c) => c === m);
  return known ?? 'PAYMENT_GATEWAY';
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Formats a value that may be a JS Date (as pg returns TIMESTAMPTZ columns) or an ISO string as YYYY-MM-DD. */
function toDateOnly(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}
