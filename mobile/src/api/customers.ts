import { apiRequest } from './client';
import { Customer, Loan } from '../types';

export function fetchCustomers(page = 1, limit = 20, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return apiRequest<{ data: Customer[]; total: number }>(`/api/v1/tenant/customers?${params}`);
}

export function fetchCustomer(id: string) {
  return apiRequest<Customer & { totalLoans: number; activeLoans: number; totalPaid: number }>(
    `/api/v1/tenant/customers/${id}`,
  );
}

export function fetchCustomerLoans(customerId: string) {
  return apiRequest<{ data: Loan[]; total: number }>(
    `/api/v1/tenant/loans?customerId=${customerId}&limit=20`,
  );
}
