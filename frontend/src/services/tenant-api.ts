const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('tenant_token');
}

async function tenantFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface TenantUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface TenantInfo {
  id: string;
  companyName: string;
  subdomain: string;
}

export interface LoginResponse {
  accessToken: string;
  user: TenantUser;
  tenant: TenantInfo;
}

export function tenantLogin(email: string, password: string, subdomain: string) {
  return tenantFetch<LoginResponse>('/api/v1/tenant/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, subdomain }),
  });
}

export function saveTenantSession(res: LoginResponse) {
  localStorage.setItem('tenant_token', res.accessToken);
  localStorage.setItem('tenant_user', JSON.stringify(res.user));
  localStorage.setItem('tenant_info', JSON.stringify(res.tenant));
}

export function getTenantSession(): { user: TenantUser; tenant: TenantInfo } | null {
  if (typeof window === 'undefined') return null;
  const user = localStorage.getItem('tenant_user');
  const tenant = localStorage.getItem('tenant_info');
  if (!user || !tenant) return null;
  return { user: JSON.parse(user) as TenantUser, tenant: JSON.parse(tenant) as TenantInfo };
}

export function clearTenantSession() {
  localStorage.removeItem('tenant_token');
  localStorage.removeItem('tenant_user');
  localStorage.removeItem('tenant_info');
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export interface DashboardStats {
  totalCustomers: number;
  totalLoans: number;
  activeLoans: number;
  todaysCollection: number;
  pendingAmount: number;
  overdueInstallments: number;
}

export function getDashboardStats() {
  return tenantFetch<DashboardStats>('/api/v1/tenant/dashboard/stats');
}

export interface ActivityItem {
  type: 'loan' | 'payment';
  id: string;
  loanNumber: string;
  customerName: string;
  amount: number;
  status?: string;
  method?: string;
  paymentDate?: string;
  createdAt: string;
}

export function getRecentActivity() {
  return tenantFetch<{ activity: ActivityItem[] }>('/api/v1/tenant/dashboard/recent-activity');
}

export interface ActiveLoan {
  id: string;
  loanNumber: string;
  customerName: string;
  customerPhone: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  status: string;
  outstanding: number;
  disbursedAt: string | null;
  firstDueDate: string | null;
  createdAt: string;
}

export function getActiveLoans(page = 1, limit = 10) {
  return tenantFetch<{ data: ActiveLoan[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/dashboard/active-loans?page=${page}&limit=${limit}`,
  );
}

// ── Customers ────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  customerCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  panNumber: string | null;
  creditScore: number | null;
  city: string | null;
  state: string | null;
  isActive: boolean;
  createdAt: string;
}

export function getCustomers(page = 1, limit = 20, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return tenantFetch<{ data: Customer[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/customers?${params}`,
  );
}

export function getCustomer(id: string) {
  return tenantFetch<Customer & { totalLoans: number; activeLoans: number; totalPaid: number }>(
    `/api/v1/tenant/customers/${id}`,
  );
}

export function createCustomer(dto: {
  firstName: string; lastName: string; phone: string; email?: string;
  panNumber?: string; aadhaarLast4?: string; dateOfBirth?: string;
  address?: string; city?: string; state?: string; pincode?: string; creditScore?: number;
}) {
  return tenantFetch('/api/v1/tenant/customers', { method: 'POST', body: JSON.stringify(dto) });
}

// ── Loans ────────────────────────────────────────────────────────────────────

export interface Loan {
  id: string;
  loanNumber: string;
  customerName: string;
  customerPhone: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  status: string;
  purpose: string | null;
  outstanding: number;
  disbursedAt: string | null;
  firstDueDate: string | null;
  createdAt: string;
}

export function getLoans(page = 1, limit = 20, status?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set('status', status);
  return tenantFetch<{ data: Loan[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/loans?${params}`,
  );
}

export function getLoan(id: string) {
  return tenantFetch<Loan & { installments: unknown[]; payments: unknown[] }>(`/api/v1/tenant/loans/${id}`);
}

export function createLoan(dto: {
  customerId: string; principal: number; interestRate: number;
  termMonths: number; purpose?: string; firstDueDate?: string;
}) {
  return tenantFetch('/api/v1/tenant/loans', { method: 'POST', body: JSON.stringify(dto) });
}

// ── Collections ──────────────────────────────────────────────────────────────

export interface CollectionStats {
  todayCount: number;
  todayAmount: number;
  overdueCount: number;
  overdueAmount: number;
  collectedToday: number;
  totalPending: number;
}

export interface CollectionItem {
  id: string;
  installmentNumber: number;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: string;
  assignedTo: string | null;
  agentName: string | null;
  loanId: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  phone: string;
  daysOverdue?: number;
}

export interface CollectionAgent {
  id: string;
  name: string;
  role: string;
}

export function getCollectionStats() {
  return tenantFetch<CollectionStats>('/api/v1/tenant/collections/stats');
}

export function getTodayCollections(page = 1, limit = 20, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return tenantFetch<{ data: CollectionItem[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/collections/today?${params}`,
  );
}

export function getOverdueCollections(page = 1, limit = 20, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return tenantFetch<{ data: CollectionItem[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/collections/overdue?${params}`,
  );
}

export function getCollectionAgents() {
  return tenantFetch<CollectionAgent[]>('/api/v1/tenant/collections/agents');
}

export function recordCollectionPayment(
  installmentId: string,
  dto: { amount: number; paymentMethod: string; referenceNumber?: string; paymentDate?: string },
) {
  return tenantFetch(`/api/v1/tenant/collections/${installmentId}/payment`, {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

export function assignCollectionAgent(installmentId: string, agentId: string | null) {
  return tenantFetch(`/api/v1/tenant/collections/${installmentId}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ agentId }),
  });
}
