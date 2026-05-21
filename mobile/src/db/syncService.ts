import { getPendingPayments, markPaymentSynced, markPaymentFailed, resetFailedPayments } from './database';
import { recordPaymentOnline } from '../api/collections';

export async function syncPendingPayments(): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingPayments();
  let synced = 0;
  let failed = 0;

  for (const payment of pending) {
    try {
      await recordPaymentOnline(payment);
      await markPaymentSynced(payment.id!);
      synced++;
    } catch {
      await markPaymentFailed(payment.id!);
      failed++;
    }
  }

  return { synced, failed };
}

export async function retryFailedPayments(): Promise<{ synced: number; failed: number }> {
  await resetFailedPayments();
  return syncPendingPayments();
}
