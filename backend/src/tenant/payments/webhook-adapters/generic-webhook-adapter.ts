import { createHmac, timingSafeEqual } from 'crypto';
import { PaymentWebhookAdapter, NormalizedPaymentEvent } from './payment-webhook-adapter.interface';

/**
 * Reference/placeholder adapter — NOT any real gateway's actual webhook
 * format. No payment provider has been chosen yet (see Phase 6 discussion),
 * so this exists to prove the ingestion → matching → ledger-posting pipeline
 * end to end with something testable, using a simple, documented shape:
 *
 *   Header:  X-Webhook-Signature: hex(HMAC-SHA256(rawBody, secret))
 *   Body:    { "event": "payment.completed", "reference": "...", "amount": 1234.56,
 *              "currency": "INR", "method": "UPI", "occurredAt": "...",
 *              "payer": { "name": "...", "contact": "..." } }
 *
 * Only "event": "payment.completed" produces a NormalizedPaymentEvent — any
 * other event value is acknowledged and ignored.
 *
 * When a real gateway is picked, add a new adapter class next to this one
 * (e.g. razorpay-webhook-adapter.ts implementing the same interface with
 * that provider's actual signature scheme and payload shape) and register
 * it in TenantPaymentWebhookService's adapter map — this file and the
 * pipeline that calls it don't need to change.
 */
export class GenericWebhookAdapter implements PaymentWebhookAdapter {
  readonly provider = 'generic';

  verifySignature(rawBody: string, headers: Record<string, string>, secret: string): boolean {
    const provided = headers['x-webhook-signature'];
    if (!provided) return false;
    const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    const a = Buffer.from(provided, 'hex');
    const b = Buffer.from(expected, 'hex');
    // Different lengths would throw in timingSafeEqual rather than just returning false.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  parseEvent(rawBody: string, _headers: Record<string, string>): NormalizedPaymentEvent | null {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (body.event !== 'payment.completed') return null;
    const amount = typeof body.amount === 'number' ? body.amount : parseFloat(String(body.amount));
    if (!body.reference || !amount || amount <= 0) return null;

    const payer = (body.payer as Record<string, unknown>) ?? {};
    return {
      externalReference: String(body.reference),
      amount,
      currency: typeof body.currency === 'string' ? body.currency : undefined,
      paymentMethod: typeof body.method === 'string' ? body.method : undefined,
      payerName: typeof payer.name === 'string' ? payer.name : undefined,
      payerContact: typeof payer.contact === 'string' ? payer.contact : undefined,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
      rawPayload: body,
    };
  }
}
