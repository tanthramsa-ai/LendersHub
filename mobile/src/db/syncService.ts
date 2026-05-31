import { getPendingPayments, markPaymentSynced, markPaymentFailed, resetFailedPayments } from './database';
import { recordPaymentOnline } from '../api/collections';

// Concurrency lock — prevents simultaneous calls from submitting the same payments twice
let _syncInProgress: Promise<{ synced: number; failed: number }> | null = null;

export function syncPendingPayments(): Promise<{ synced: number; failed: number }> {
  if (_syncInProgress) return _syncInProgress;
  _syncInProgress = _doSync().finally(() => { _syncInProgress = null; });
  return _syncInProgress;
}

async function _doSync(): Promise<{ synced: number; failed: number }> {
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
