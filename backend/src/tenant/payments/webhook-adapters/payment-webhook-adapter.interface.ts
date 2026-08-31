/**
 * One payment gateway's webhook shape, normalized to what the posting
 * pipeline actually needs. No concrete provider (Razorpay, Cashfree, PayU,
 * ...) is wired up yet — see generic-webhook-adapter.ts for why, and add a
 * new adapter class alongside it when a real provider is chosen. The
 * pipeline (TenantPaymentWebhookService) never changes for that — it only
 * ever talks to this interface.
 */
export interface NormalizedPaymentEvent {
  /** The provider's own unique id for this payment — the idempotency key. */
  externalReference: string;
  amount: number;
  currency?: string;
  /** Maps to ledger_transactions.payment_channel where recognized; PAYMENT_GATEWAY otherwise. */
  paymentMethod?: string;
  payerName?: string;
  payerContact?: string;
  occurredAt?: string;
  rawPayload: unknown;
}

export interface PaymentWebhookAdapter {
  readonly provider: string;

  /**
   * Verifies the webhook actually came from the provider, using the
   * tenant-configured shared secret. Must run against the exact raw request
   * bytes — re-serializing a parsed JSON body before hashing will not match
   * the provider's own signature.
   */
  verifySignature(rawBody: string, headers: Record<string, string>, secret: string): boolean;

  /**
   * Returns null for event types this pipeline doesn't act on (e.g. a
   * "payment.failed" or "refund.created" callback) — the webhook handler
   * acks those with 200 and does nothing, rather than erroring and inviting
   * the provider to retry forever.
   */
  parseEvent(rawBody: string, headers: Record<string, string>): NormalizedPaymentEvent | null;
}
