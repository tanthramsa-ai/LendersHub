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
  const res = await apiRequest<{
    todayCount: number;
    todayAmount: number;
    overdueCount: number;
    overdueAmount: number;
    collectedToday: number;
    totalPending: number;
  }>('/api/v1/tenant/collections/stats');
  return {
    todayTarget:    res.todayAmount,
    todayCollected: res.collectedToday,
    pendingCount:   res.todayCount,
    overdueCount:   res.overdueCount,
    collectedCount: 0,
  };
}
