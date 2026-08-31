import { createHmac } from 'crypto';
import { GenericWebhookAdapter } from './generic-webhook-adapter';

describe('GenericWebhookAdapter', () => {
  const adapter = new GenericWebhookAdapter();
  const secret = 'test-secret';

  function sign(body: string): string {
    return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  describe('verifySignature', () => {
    it('accepts a correctly signed body', () => {
      const body = JSON.stringify({ event: 'payment.completed', reference: 'r1', amount: 100 });
      expect(adapter.verifySignature(body, { 'x-webhook-signature': sign(body) }, secret)).toBe(true);
    });

    it('rejects a tampered body', () => {
      const body = JSON.stringify({ event: 'payment.completed', reference: 'r1', amount: 100 });
      const signature = sign(body);
      const tampered = JSON.stringify({ event: 'payment.completed', reference: 'r1', amount: 999999 });
      expect(adapter.verifySignature(tampered, { 'x-webhook-signature': signature }, secret)).toBe(false);
    });

    it('rejects a missing signature header', () => {
      expect(adapter.verifySignature('{}', {}, secret)).toBe(false);
    });

    it('rejects the wrong secret', () => {
      const body = JSON.stringify({ event: 'payment.completed', reference: 'r1', amount: 100 });
      expect(adapter.verifySignature(body, { 'x-webhook-signature': sign(body) }, 'wrong-secret')).toBe(false);
    });
  });

  describe('parseEvent', () => {
    it('parses a payment.completed event', () => {
      const body = JSON.stringify({
        event: 'payment.completed', reference: 'pay_123', amount: 1500.5, currency: 'INR', method: 'UPI',
        occurredAt: '2026-08-24T10:00:00Z', payer: { name: 'Jane Doe', contact: '9876543210' },
      });
      const event = adapter.parseEvent(body, {});
      expect(event).toEqual({
        externalReference: 'pay_123', amount: 1500.5, currency: 'INR', paymentMethod: 'UPI',
        payerName: 'Jane Doe', payerContact: '9876543210', occurredAt: '2026-08-24T10:00:00Z',
        rawPayload: JSON.parse(body),
      });
    });

    it('returns null for a non-payment event type', () => {
      const body = JSON.stringify({ event: 'payment.failed', reference: 'pay_123', amount: 100 });
      expect(adapter.parseEvent(body, {})).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(adapter.parseEvent('not json', {})).toBeNull();
    });

    it('returns null when reference or amount is missing/invalid', () => {
      expect(adapter.parseEvent(JSON.stringify({ event: 'payment.completed', amount: 100 }), {})).toBeNull();
      expect(adapter.parseEvent(JSON.stringify({ event: 'payment.completed', reference: 'r1', amount: 0 }), {})).toBeNull();
    });
  });
});
