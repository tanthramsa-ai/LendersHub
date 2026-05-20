import { apiRequest } from './client';
import { CollectionItem, PaymentRecord } from '../types';

export async function fetchTodayCollections(): Promise<CollectionItem[]> {
  const res = await apiRequest<{ data: CollectionItem[] }>('/api/v1/tenant/collections/today');
  return res.data;
}

export async function fetchOverdueCollections(): Promise<CollectionItem[]> {
  const res = await apiRequest<{ data: CollectionItem[] }>('/api/v1/tenant/collections/overdue');
  return res.data;
}

export async function recordPaymentOnline(payment: Omit<PaymentRecord, 'id' | 'syncStatus' | 'createdAt'>) {
  return apiRequest('/api/v1/tenant/loans/' + payment.loanId + '/payments', {
    method: 'POST',
    body: JSON.stringify({
      installmentId: payment.installmentId,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      referenceNumber: payment.referenceNumber,
      paymentDate: payment.paymentDate,
    }),
  });
}

export async function fetchAgentStats() {
  return apiRequest<{
    todayTarget: number;
    todayCollected: number;
    pendingCount: number;
    overdueCount: number;
    collectedCount: number;
  }>('/api/v1/tenant/collections/agent-stats');
}
