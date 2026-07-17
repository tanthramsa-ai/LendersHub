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
    const body = await res.json().catch(() => ({})) as { message?: string | string[] };
    const raw = body?.message;
    const message = Array.isArray(raw)
      ? raw.join('; ')
      : (raw ?? `Request failed: ${res.status}`);
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export type UserRole = 'OWNER' | 'MANAGER' | 'ADMIN' | 'LOAN_OFFICER' | 'COLLECTOR' | 'VIEWER';

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  ADMIN: 'Admin',
  LOAN_OFFICER: 'Loan Officer',
  COLLECTOR: 'Collector',
  VIEWER: 'Viewer',
};

/** Roles that can approve/close loans and manage settings */
export const MANAGER_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'ADMIN'];

/** Only Owner and Admin can add/edit/deactivate users (Manager cannot) */
export const USER_ADMIN_ROLES: UserRole[] = ['OWNER', 'ADMIN'];

/** Roles that can VIEW loan pages (includes COLLECTOR who can see but not create) */
export const LOAN_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'ADMIN', 'LOAN_OFFICER', 'COLLECTOR'];

/** Roles that can CREATE loans — COLLECTOR excluded (backend enforces this too) */
export const LOAN_CREATE_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'ADMIN', 'LOAN_OFFICER'];

/** Roles that can record collection payments (all except VIEWER) */
export const COLLECTION_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'ADMIN', 'LOAN_OFFICER', 'COLLECTOR'];

/** Roles that can add customers (all except VIEWER) */
export const CUSTOMER_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'ADMIN', 'LOAN_OFFICER', 'COLLECTOR'];

/** Roles that can view everything */
export const READ_ROLES: UserRole[] = ['OWNER', 'MANAGER', 'ADMIN', 'LOAN_OFFICER', 'COLLECTOR', 'VIEWER'];

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface TenantUser {
  id: string;
  email: string;
  phone?: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface TenantInfo {
  id: string;
  companyName: string;
  subdomain: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: TenantUser;
  tenant: TenantInfo;
}

export interface OtpRequiredResponse {
  requiresOtp: true;
  tempToken: string;
  maskedPhone: string;
  tenant: TenantInfo;
}

export function tenantLoginWithPhone(phone: string, password: string, subdomain: string) {
  return tenantFetch<LoginResponse | OtpRequiredResponse>('/api/v1/tenant/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password, subdomain }),
  });
}

export function tenantLoginWithEmail(email: string, password: string, subdomain: string) {
  return tenantFetch<LoginResponse | OtpRequiredResponse>('/api/v1/tenant/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, subdomain }),
  });
}

export function verifyLoginOtp(tempToken: string, otp: string) {
  return tenantFetch<LoginResponse>('/api/v1/tenant/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ tempToken, otp }),
  });
}

export function forgotPassword(phone: string, subdomain: string) {
  return tenantFetch<{ message: string }>('/api/v1/tenant/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ phone, subdomain }),
  });
}

export function resetPassword(phone: string, otp: string, newPassword: string, subdomain: string) {
  return tenantFetch<{ message: string }>('/api/v1/tenant/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ phone, otp, newPassword, subdomain }),
  });
}

// Keep legacy email login for backwards compat (super-admin-created accounts without phone)
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
  roleView?: 'manager' | 'officer' | 'collector';
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
  locality: string | null;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  activeLoans: number;
  closedLoans: number;
  createdAt: string;
}

export interface CustomerDetail extends Customer {
  aadhaarLast4: string | null;
  aadhaarDocUrl: string | null;
  dateOfBirth: string | null;
  address: string | null;
  pincode: string | null;
  occupation: string | null;
  loanPurpose: string | null;
  altContact: string | null;
  altContactName: string | null;
  altContactRelation: string | null;
  branchCode: string | null;
  updatedAt: string;
  totalLoans: number;
  activeLoans: number;
  totalPaid: number;
}

export function getCustomers(page = 1, limit = 20, search?: string, branchId?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  if (branchId) params.set('branchId', branchId);
  return tenantFetch<{ data: Customer[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/customers?${params}`,
  );
}

export function getCustomer(id: string) {
  return tenantFetch<CustomerDetail>(`/api/v1/tenant/customers/${id}`);
}

export interface CreateCustomerPayload {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  panNumber?: string;
  aadhaarLast4?: string;
  aadhaarDocUrl?: string;
  dateOfBirth?: string;
  address: string;
  locality: string;
  city?: string;
  state?: string;
  pincode?: string;
  occupation?: string;
  loanPurpose?: string;
  altContact?: string;
  altContactName?: string;
  altContactRelation?: string;
  creditScore?: number;
  branchId?: string;
}

export function createCustomer(dto: CreateCustomerPayload) {
  return tenantFetch('/api/v1/tenant/customers', { method: 'POST', body: JSON.stringify(dto) });
}

export interface UpdateCustomerPayload {
  firstName?: string; lastName?: string; phone?: string; email?: string;
  panNumber?: string; aadhaarLast4?: string; aadhaarDocUrl?: string;
  dateOfBirth?: string; address?: string; locality?: string;
  city?: string; state?: string; pincode?: string;
  occupation?: string; loanPurpose?: string;
  altContact?: string; altContactName?: string; altContactRelation?: string;
  creditScore?: number; branchId?: string | null; isActive?: boolean;
}

export function updateCustomer(id: string, dto: UpdateCustomerPayload) {
  return tenantFetch(`/api/v1/tenant/customers/${id}`, { method: 'PUT', body: JSON.stringify(dto) });
}

export function activateCustomer(id: string) {
  return tenantFetch<{ id: string; isActive: boolean }>(`/api/v1/tenant/customers/${id}/activate`, { method: 'PATCH' });
}

export function deactivateCustomer(id: string) {
  return tenantFetch<{ id: string; isActive: boolean }>(`/api/v1/tenant/customers/${id}/deactivate`, { method: 'PATCH' });
}

export function deleteCustomer(id: string) {
  return tenantFetch<{ id: string; deleted: boolean }>(`/api/v1/tenant/customers/${id}`, { method: 'DELETE' });
}

export function deleteLoan(id: string) {
  return tenantFetch<{ id: string; deleted: boolean }>(`/api/v1/tenant/loans/${id}`, { method: 'DELETE' });
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
  cycleType: string | null;
}

/** Route prefix for a loan's type-specific detail page, mirroring the backend's loanDetailLink(). */
export function loanDetailPath(cycleType: string | null | undefined, loanId: string): string {
  switch (cycleType) {
    case 'WEEKLY': return `weekly-loans/${loanId}`;
    case 'DAILY_NO_SUNDAY':
    case 'DAILY_WITH_SUNDAY': return `daily-loans/${loanId}`;
    case 'MONTHLY': return `monthly-loans/${loanId}`;
    case 'AGENT_RISK': return `agent-risk-loans/${loanId}`;
    case 'TERM_LOAN':
    default: return `loans/${loanId}`;
  }
}

export function getLoans(page = 1, limit = 20, filters: {
  status?: string; search?: string; branchId?: string; loanTypeId?: string; officerId?: string; customerId?: string;
} = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.loanTypeId) params.set('loanTypeId', filters.loanTypeId);
  if (filters.officerId) params.set('officerId', filters.officerId);
  if (filters.customerId) params.set('customerId', filters.customerId);
  return tenantFetch<{ data: Loan[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/loans?${params}`,
  );
}

export function getLoan(id: string) {
  return tenantFetch<Loan & { installments: unknown[]; payments: unknown[] }>(`/api/v1/tenant/loans/${id}`);
}

// ── Weekly Loans ──────────────────────────────────────────────────────────────

export interface WeeklyLoan {
  id: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  phone: string;
  principal: number;
  interestRate: number;
  termWeeks: number;
  emiAmount: number | null;
  status: string;
  cycleType: string;
  calculationType: string;
  branchId: string | null;
  branchName: string | null;
  disbursedAt: string | null;
  firstDueDate: string | null;
  createdAt: string;
  principalReceived: number;
  interestReceived: number;
  principalOutstanding: number;
  interestOutstanding: number;
  totalInstallments: number;
  paidInstallments: number;
  overdueCount: number;
  isNpa: boolean;
}

export interface WeeklyInstallment {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  paid: number;
  status: string;
  paidAt: string | null;
}

export interface WeeklySchedulePreview {
  emi: number;
  weeklyRate: number;
  totalInterest: number;
  totalPayable: number;
  schedule: Array<{
    number: number; dueDate: string;
    principalAmount: number; interestAmount: number; totalAmount: number;
  }>;
}

export function getWeeklyLoans(page = 1, limit = 20, filters: {
  search?: string; branchId?: string; status?: string;
} = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.search) params.set('search', filters.search);
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.status) params.set('status', filters.status);
  return tenantFetch<{ data: WeeklyLoan[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/loans/weekly?${params}`,
  );
}

export function previewWeeklySchedule(dto: {
  principal: number; interestRate: number; termWeeks: number;
  firstDueDate: string; calculationType: 'REDUCING' | 'FLAT'; emiRounding: number;
}) {
  return tenantFetch<WeeklySchedulePreview>('/api/v1/tenant/loans/weekly/preview', {
    method: 'POST', body: JSON.stringify(dto),
  });
}

export function createWeeklyLoan(dto: {
  customerId: string; principal: number; interestRate: number; termWeeks: number;
  firstDueDate: string; calculationType: 'REDUCING' | 'FLAT'; emiRounding: number;
  purpose?: string; branchId?: string; loanTypeId?: string;
  securityDocUrl?: string; promissoryNoteUrl?: string;
}) {
  return tenantFetch<{ id: string; loanNumber: string; emi: number; termWeeks: number }>(
    '/api/v1/tenant/loans/weekly', { method: 'POST', body: JSON.stringify(dto) },
  );
}

export interface WeeklyLoanDetail extends WeeklyLoan {
  purpose?: string | null;
  cycleType: string;
  calculationType: string;
  emiAmount: number | null;
  termWeeks: number;
  securityDocUrl?: string | null;
  promissoryNoteUrl?: string | null;
  loanTypeId?: string | null;
  customerPhone: string;
  closedAt?: string | null;
  closeComment?: string | null;
  reopenComment?: string | null;
  installments: WeeklyInstallment[];
  payments: Array<{
    id: string; amount: number; method: string;
    referenceNumber?: string | null; paymentDate: string; createdAt: string;
  }>;
}

export function getWeeklyLoan(id: string) {
  return tenantFetch<WeeklyLoanDetail>(`/api/v1/tenant/loans/${id}`);
}

export function recordPayment(loanId: string, dto: {
  installmentId?: string; amount: number;
  paymentMethod: 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS';
  referenceNumber?: string; paymentDate?: string;
}) {
  return tenantFetch<{ id: string; installmentsPaid: number }>(`/api/v1/tenant/loans/${loanId}/payments`, {
    method: 'POST', body: JSON.stringify(dto),
  });
}

export function undoInstallmentPayment(loanId: string, installmentId: string) {
  return tenantFetch<{ installmentId: string; status: string; paidAmount: number }>(
    `/api/v1/tenant/loans/${loanId}/installments/${installmentId}/undo-payment`,
    { method: 'POST' },
  );
}

export function createLoan(dto: {
  customerId: string; principal: number; interestRate: number;
  termMonths: number; purpose?: string; firstDueDate?: string; branchId?: string;
}) {
  return tenantFetch('/api/v1/tenant/loans', { method: 'POST', body: JSON.stringify(dto) });
}

// ── Daily Loans ───────────────────────────────────────────────────────────────

export interface DailyLoan {
  id: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  phone: string;
  principal: number;
  interestRate: number;
  termDays: number;
  emiAmount: number | null;
  status: string;
  cycleType: string;
  calculationType: string;
  branchId: string | null;
  branchName: string | null;
  disbursedAt: string | null;
  firstDueDate: string | null;
  createdAt: string;
  principalReceived: number;
  interestReceived: number;
  principalOutstanding: number;
  interestOutstanding: number;
  totalInstallments: number;
  paidInstallments: number;
  overdueCount: number;
  isNpa: boolean;
}

export interface DailyInstallment {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  paid: number;
  status: string;
  paidAt: string | null;
}

export interface DailySchedulePreview {
  emi: number;
  dailyRate: number;
  totalInterest: number;
  totalPayable: number;
  schedule: Array<{
    number: number; dueDate: string;
    principalAmount: number; interestAmount: number; totalAmount: number;
  }>;
}

export interface DailyLoanDetail extends DailyLoan {
  purpose?: string | null;
  cycleType: string;
  calculationType: string;
  emiAmount: number | null;
  termDays: number;
  securityDocUrl?: string | null;
  promissoryNoteUrl?: string | null;
  loanTypeId?: string | null;
  customerPhone: string;
  closedAt?: string | null;
  closeComment?: string | null;
  reopenComment?: string | null;
  installments: DailyInstallment[];
  payments: Array<{
    id: string; amount: number; method: string;
    referenceNumber?: string | null; paymentDate: string; createdAt: string;
  }>;
}

export function getDailyLoans(page = 1, limit = 20, filters: {
  search?: string; branchId?: string; status?: string; cycleType?: string;
} = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.search) params.set('search', filters.search);
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.status) params.set('status', filters.status);
  if (filters.cycleType) params.set('cycleType', filters.cycleType);
  return tenantFetch<{ data: DailyLoan[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/loans/daily?${params}`,
  );
}

export function previewDailySchedule(dto: {
  principal: number; interestRate: number; termDays: number;
  firstDueDate: string; calculationType: 'REDUCING' | 'FLAT'; emiRounding: number;
  cycleType: 'DAILY_NO_SUNDAY' | 'DAILY_WITH_SUNDAY';
}) {
  return tenantFetch<DailySchedulePreview>('/api/v1/tenant/loans/daily/preview', {
    method: 'POST', body: JSON.stringify(dto),
  });
}

export function createDailyLoan(dto: {
  customerId: string; principal: number; interestRate: number; termDays: number;
  firstDueDate: string; calculationType: 'REDUCING' | 'FLAT'; emiRounding: number;
  cycleType: 'DAILY_NO_SUNDAY' | 'DAILY_WITH_SUNDAY';
  purpose?: string; branchId?: string; loanTypeId?: string;
  securityDocUrl?: string; promissoryNoteUrl?: string;
}) {
  return tenantFetch<{ id: string; loanNumber: string; emi: number; termDays: number }>(
    '/api/v1/tenant/loans/daily', { method: 'POST', body: JSON.stringify(dto) },
  );
}

export function getDailyLoan(id: string) {
  return tenantFetch<DailyLoanDetail>(`/api/v1/tenant/loans/${id}`);
}

// ── Monthly Loans ─────────────────────────────────────────────────────────────

export interface MonthlyLoan {
  id: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  phone: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  monthlyInterest: number | null;
  status: string;
  branchId: string | null;
  branchName: string | null;
  disbursedAt: string | null;
  firstDueDate: string | null;
  createdAt: string;
  principalOutstanding: number;
  interestReceived: number;
  interestOutstanding: number;
  totalInstallments: number;
  paidInstallments: number;
  overdueCount: number;
  isNpa: boolean;
}

export interface MonthlyInstallment {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  paid: number;
  status: string;
  paidAt: string | null;
}

export interface MonthlyLoanDetail extends MonthlyLoan {
  purpose?: string | null;
  calculationType?: string;
  emiAmount: number | null;
  securityDocUrl?: string | null;
  promissoryNoteUrl?: string | null;
  loanTypeId?: string | null;
  customerPhone: string;
  closedAt?: string | null;
  closeComment?: string | null;
  reopenComment?: string | null;
  installments: MonthlyInstallment[];
  payments: Array<{
    id: string; amount: number; method: string;
    referenceNumber?: string | null; paymentDate: string; createdAt: string;
  }>;
}

export interface MonthlySchedulePreview {
  monthlyInterest: number;
  totalInterest: number;
  schedule: Array<{
    number: number; dueDate: string;
    principalAmount: number; interestAmount: number; totalAmount: number;
  }>;
}

export function getMonthlyLoans(page = 1, limit = 20, filters: {
  search?: string; branchId?: string; status?: string;
} = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.search) params.set('search', filters.search);
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.status) params.set('status', filters.status);
  return tenantFetch<{ data: MonthlyLoan[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/loans/monthly?${params}`,
  );
}

export function previewMonthlySchedule(dto: {
  principal: number; interestRate: number; termMonths: number; firstDueDate: string;
}) {
  return tenantFetch<MonthlySchedulePreview>('/api/v1/tenant/loans/monthly/preview', {
    method: 'POST', body: JSON.stringify(dto),
  });
}

export function createMonthlyLoan(dto: {
  customerId: string; principal: number; interestRate: number; termMonths: number;
  firstDueDate: string; branchId?: string;
  purpose?: string; loanTypeId?: string;
  securityDocUrl?: string; promissoryNoteUrl?: string;
}) {
  return tenantFetch<{ id: string; loanNumber: string; monthlyInterest: number; termMonths: number }>(
    '/api/v1/tenant/loans/monthly', { method: 'POST', body: JSON.stringify(dto) },
  );
}

export function getMonthlyLoan(id: string) {
  return tenantFetch<MonthlyLoanDetail>(`/api/v1/tenant/loans/${id}`);
}

// ── Agent Risk Loans ──────────────────────────────────────────────────────────

export interface AgentRiskLoan {
  id: string; loanNumber: string; customerId: string; customerName: string; phone: string;
  principal: number; interestRate: number; termMonths: number; monthlyInterest: number | null;
  status: string; branchId: string | null; branchName: string | null;
  disbursedAt: string | null; firstDueDate: string | null; createdAt: string;
  principalOutstanding: number; interestReceived: number; interestOutstanding: number;
  totalInstallments: number; paidInstallments: number; overdueCount: number; isNpa: boolean;
}

export interface AgentRiskLoanDetail extends AgentRiskLoan {
  purpose?: string | null; emiAmount: number | null;
  securityDocUrl?: string | null; promissoryNoteUrl?: string | null;
  loanTypeId?: string | null; customerPhone: string;
  closedAt?: string | null;
  closeComment?: string | null;
  reopenComment?: string | null;
  installments: MonthlyInstallment[];
  payments: Array<{ id: string; amount: number; method: string; referenceNumber?: string | null; paymentDate: string; createdAt: string }>;
}

export function getAgentRiskLoans(page = 1, limit = 20, filters: { search?: string; branchId?: string; status?: string } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.search) params.set('search', filters.search);
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.status) params.set('status', filters.status);
  return tenantFetch<{ data: AgentRiskLoan[]; total: number; page: number; limit: number }>(`/api/v1/tenant/loans/agent-risk?${params}`);
}

export function previewAgentRiskSchedule(dto: { principal: number; interestRate: number; termMonths: number; firstDueDate: string }) {
  return tenantFetch<MonthlySchedulePreview>('/api/v1/tenant/loans/agent-risk/preview', { method: 'POST', body: JSON.stringify(dto) });
}

export function createAgentRiskLoan(dto: {
  customerId: string; principal: number; interestRate: number; termMonths: number;
  firstDueDate: string; branchId?: string; purpose?: string; loanTypeId?: string;
  securityDocUrl?: string; promissoryNoteUrl?: string;
}) {
  return tenantFetch<{ id: string; loanNumber: string; monthlyInterest: number; termMonths: number }>(
    '/api/v1/tenant/loans/agent-risk', { method: 'POST', body: JSON.stringify(dto) },
  );
}

export function getAgentRiskLoan(id: string) {
  return tenantFetch<AgentRiskLoanDetail>(`/api/v1/tenant/loans/${id}`);
}

// ── Term Loans ────────────────────────────────────────────────────────────────

export interface TermLoan {
  id: string; loanNumber: string; customerId: string; customerName: string; phone: string;
  principal: number; interestRate: number; termMonths: number; emi: number | null;
  calculationType: string; status: string; branchId: string | null; branchName: string | null;
  outstanding: number; paidInstallments: number; totalInstallments: number;
  overdueCount: number; isNpa: boolean; disbursedAt: string; firstDueDate: string; createdAt: string;
}

export interface TermInstallment {
  id: string; number: number; dueDate: string;
  principal: number; interest: number; total: number;
  paid: number; status: string; paidAt: string | null;
}

export interface TermLoanDetail extends TermLoan {
  purpose?: string | null; emiAmount: number | null;
  securityDocUrl?: string | null; promissoryNoteUrl?: string | null;
  loanTypeId?: string | null; customerPhone: string;
  closedAt?: string | null;
  closeComment?: string | null;
  reopenComment?: string | null;
  installments: TermInstallment[];
  payments: Array<{ id: string; amount: number; method: string; referenceNumber?: string; paymentDate: string; createdAt: string }>;
}

export interface TermSchedulePreview {
  emi: number; totalInterest: number; totalAmount: number;
  schedule: Array<{ number: number; dueDate: string; principalAmount: number; interestAmount: number; totalAmount: number }>;
}

export function getTermLoans(page = 1, limit = 20, filters: { search?: string; branchId?: string; status?: string } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.search) params.set('search', filters.search);
  if (filters.branchId) params.set('branchId', filters.branchId);
  if (filters.status) params.set('status', filters.status);
  return tenantFetch<{ data: TermLoan[]; total: number; page: number; limit: number }>(`/api/v1/tenant/loans/term-loan?${params}`);
}

export function previewTermLoanSchedule(dto: {
  principal: number; interestRate: number; termMonths: number;
  firstDueDate: string; calculationType: 'REDUCING' | 'FLAT'; emiRounding: number;
}) {
  return tenantFetch<TermSchedulePreview>('/api/v1/tenant/loans/term-loan/preview', {
    method: 'POST', body: JSON.stringify(dto),
  });
}

export function createTermLoan(dto: {
  customerId: string; principal: number; interestRate: number; termMonths: number;
  firstDueDate: string; calculationType: 'REDUCING' | 'FLAT'; emiRounding: number;
  branchId?: string; purpose?: string; loanTypeId?: string;
  securityDocUrl?: string; promissoryNoteUrl?: string;
}) {
  return tenantFetch<{ id: string; loanNumber: string; emi: number }>('/api/v1/tenant/loans/term-loan', {
    method: 'POST', body: JSON.stringify(dto),
  });
}

export function getTermLoan(id: string) {
  return tenantFetch<TermLoanDetail>(`/api/v1/tenant/loans/${id}`);
}

// ── Branches (tenant-level) ───────────────────────────────────────────────────

export interface TenantBranch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  managerName: string | null;
  isActive: boolean;
  createdAt: string;
  userCount: number;
  customerCount: number;
  loanCount: number;
}

export function getBranches() {
  return tenantFetch<TenantBranch[]>('/api/v1/tenant/branches');
}

export function createBranch(dto: {
  name: string; code: string; address?: string; city?: string;
  state?: string; phone?: string; email?: string; managerName?: string;
}) {
  return tenantFetch<TenantBranch>('/api/v1/tenant/branches', { method: 'POST', body: JSON.stringify(dto) });
}

export function updateBranch(id: string, dto: {
  name?: string; address?: string; city?: string; state?: string;
  phone?: string; email?: string; managerName?: string; isActive?: boolean;
}) {
  return tenantFetch<TenantBranch>(`/api/v1/tenant/branches/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
}

export interface BranchMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
}

export function getBranchMembers(branchId: string) {
  return tenantFetch<BranchMember[]>(`/api/v1/tenant/branches/${branchId}/members`);
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

// ── Tenant Users ──────────────────────────────────────────────────────────────

export interface TenantTeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  branchId: string | null;
  branchName: string | null;
  activeLoans: number;
  closedLoans: number;
  npaLoans: number;
}

export interface TenantTeamMemberDetail extends TenantTeamMember {
  branchCode: string | null;
  updatedAt: string;
  stats: {
    activeLoans: number;
    closedLoans: number;
    npaLoans: number;
    activePrincipal: number;
    npaPrincipal: number;
    totalCustomers: number;
  };
}

export function getTenantUsers(page = 1, limit = 20, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return tenantFetch<{ data: TenantTeamMember[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/users?${params}`,
  );
}

export function getTenantUser(id: string) {
  return tenantFetch<TenantTeamMemberDetail>(`/api/v1/tenant/users/${id}`);
}

export function getUserLoans(id: string, page = 1, limit = 20, status?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set('status', status);
  return tenantFetch<{ data: Loan[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/users/${id}/loans?${params}`,
  );
}

export function createTenantUser(dto: {
  email: string; password: string;
  firstName: string; lastName: string;
  phone: string; role: UserRole; branchId?: string;
}) {
  return tenantFetch<TenantTeamMember>('/api/v1/tenant/users', { method: 'POST', body: JSON.stringify(dto) });
}

export function updateTenantUser(id: string, dto: { firstName?: string; lastName?: string; phone?: string; role?: UserRole; branchId?: string | null }) {
  return tenantFetch<TenantTeamMember>(`/api/v1/tenant/users/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
}

export function deactivateTenantUser(id: string) {
  return tenantFetch(`/api/v1/tenant/users/${id}/deactivate`, { method: 'PATCH' });
}

export function activateTenantUser(id: string) {
  return tenantFetch(`/api/v1/tenant/users/${id}/activate`, { method: 'PATCH' });
}

export function resetTenantUserPassword(id: string, password: string) {
  return tenantFetch(`/api/v1/tenant/users/${id}/reset-password`, { method: 'PATCH', body: JSON.stringify({ password }) });
}

// ── Loan Actions ──────────────────────────────────────────────────────────────

export function closeLoan(id: string, dto: { comment: string }) {
  return tenantFetch<{
    id: string;
    status: string;
    closedAt: string;
    closeComment: string;
    closedWithPendingDues: boolean;
    outstanding: number;
  }>(`/api/v1/tenant/loans/${id}/close`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

export function reopenLoan(id: string, dto: { comment: string }) {
  return tenantFetch<{
    id: string;
    status: string;
    reopenComment: string;
    restoredInstallments: number;
  }>(`/api/v1/tenant/loans/${id}/reopen`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
  });
}

// ── Settings: SMS Config ──────────────────────────────────────────────────────

export interface SmsConfig {
  provider: 'fast2sms' | 'msg91' | 'console';
  apiKey: string;
  senderId?: string;
  configured?: boolean;
}

export function getSmsConfig() {
  return tenantFetch<SmsConfig & { configured: boolean }>('/api/v1/tenant/settings/sms');
}

export function updateSmsConfig(dto: SmsConfig) {
  return tenantFetch<{ message: string }>('/api/v1/tenant/settings/sms', {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}

// ── Loan Types ────────────────────────────────────────────────────────────────

export interface LoanType {
  id: string;
  name: string;
  description: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  minInterestRate: number | null;
  maxInterestRate: number | null;
  minTermMonths: number | null;
  maxTermMonths: number | null;
  isActive: boolean;
  createdAt: string;
  loanCount?: number;
  customerCount?: number;
  activePrincipal?: number;
}

export function getLoanTypes() {
  return tenantFetch<LoanType[]>('/api/v1/tenant/loan-types');
}

export function getLoanType(id: string) {
  return tenantFetch<LoanType>(`/api/v1/tenant/loan-types/${id}`);
}

export function getLoanTypeLoans(id: string, page = 1, limit = 20, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return tenantFetch<{
    data: Array<{
      id: string; loanNumber: string; principal: number; interestRate: number;
      termMonths: number; status: string; disbursedAt: string | null; createdAt: string;
      customerId: string; customerName: string; phone: string;
    }>;
    total: number; page: number; limit: number;
  }>(`/api/v1/tenant/loan-types/${id}/loans?${params}`);
}

export function getLoanTypeCustomers(id: string, page = 1, limit = 20, search?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return tenantFetch<{
    data: Array<{
      id: string; customerCode: string; name: string; phone: string;
      loanCount: number; activePrincipal: number;
    }>;
    total: number; page: number; limit: number;
  }>(`/api/v1/tenant/loan-types/${id}/customers?${params}`);
}

export function createLoanType(dto: {
  name: string; description?: string;
  minAmount?: number; maxAmount?: number;
  minInterestRate?: number; maxInterestRate?: number;
  minTermMonths?: number; maxTermMonths?: number;
}) {
  return tenantFetch<LoanType>('/api/v1/tenant/loan-types', { method: 'POST', body: JSON.stringify(dto) });
}

export function updateLoanType(id: string, dto: Partial<{
  name: string; description: string; isActive: boolean;
  minAmount: number; maxAmount: number;
  minInterestRate: number; maxInterestRate: number;
  minTermMonths: number; maxTermMonths: number;
}>) {
  return tenantFetch<LoanType>(`/api/v1/tenant/loan-types/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
}

export function deleteLoanType(id: string) {
  return tenantFetch<{ id: string }>(`/api/v1/tenant/loan-types/${id}`, { method: 'DELETE' });
}

// ── Accounts / GL ─────────────────────────────────────────────────────────────

export interface AccountsSummary {
  totalLoans: number;
  totalPrincipalDisbursed: number;
  activeLoans: number;
  activePrincipal: number;
  closedLoans: number;
  totalCollected: number;
  thisMonthCollected: number;
  lastMonthCollected: number;
  outstandingBalance: number;
  overdueCount: number;
  overdueAmount: number;
  loansByStatus: { status: string; count: number; principal: number }[];
}

export interface MonthlyTrend {
  month: string;
  disbursedCount: number;
  disbursedAmount: number;
  collectedCount: number;
  collectedAmount: number;
}

export interface TopBorrower {
  id: string;
  name: string;
  phone: string;
  loanCount: number;
  activePrincipal: number;
  outstanding: number;
}

export function getAccountsSummary() {
  return tenantFetch<AccountsSummary>('/api/v1/tenant/accounts/summary');
}

export function getMonthlyTrend(months = 6) {
  return tenantFetch<MonthlyTrend[]>(`/api/v1/tenant/accounts/monthly-trend?months=${months}`);
}

export function getTopBorrowers(limit = 10) {
  return tenantFetch<TopBorrower[]>(`/api/v1/tenant/accounts/top-borrowers?limit=${limit}`);
}

// ── Officers (for filter dropdown) ───────────────────────────────────────────

export interface Officer {
  id: string;
  name: string;
  role: UserRole;
}

export function getOfficers() {
  return tenantFetch<Officer[]>('/api/v1/tenant/users/officers');
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface TenantNotification {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'alert' | 'loan' | 'payment';
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export function getNotifications(page = 1, limit = 20, unreadOnly = false) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (unreadOnly) params.set('unreadOnly', 'true');
  return tenantFetch<{ data: TenantNotification[]; total: number; page: number; limit: number }>(
    `/api/v1/tenant/notifications?${params}`,
  );
}

export function getUnreadCount() {
  return tenantFetch<{ count: number }>('/api/v1/tenant/notifications/unread-count');
}

export function markNotificationRead(id: string) {
  return tenantFetch<{ id: string }>(`/api/v1/tenant/notifications/${id}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead() {
  return tenantFetch<{ updated: number }>('/api/v1/tenant/notifications/read-all', { method: 'PATCH' });
}

// ── Settings: WhatsApp Config ─────────────────────────────────────────────────

export interface WhatsAppConfig {
  provider: 'console' | 'twilio' | 'meta' | 'wati';
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  phoneNumberId?: string;
  accessToken?: string;
  apiUrl?: string;
  apiKey?: string;
  configured?: boolean;
}

export function getWhatsAppConfig() {
  return tenantFetch<WhatsAppConfig & { configured: boolean }>('/api/v1/tenant/settings/whatsapp');
}

export function updateWhatsAppConfig(dto: WhatsAppConfig) {
  return tenantFetch<{ message: string }>('/api/v1/tenant/settings/whatsapp', {
    method: 'PUT',
    body: JSON.stringify(dto),
  });
}

// ── Financial Ledger ──────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string; date: string; amount: number;
  accountName: string; displayAccount: string; isCash: boolean;
  entityName: string | null; entityType: string | null; entityId: string | null;
  description: string | null; referenceNumber: string | null;
  category: string; source: string;
}

export interface PrincipalTxn {
  id: string; date: string; amount: number; direction: 'CREDIT' | 'DEBIT';
  entityName: string; reference: string; description: string;
}

export interface ManualTransaction {
  id: string; date: string; type: 'CREDIT' | 'DEBIT'; amount: number;
  category: string; accountName: string | null; isCash: boolean;
  entityType: string | null; entityId: string | null; entityName: string | null;
  description: string | null; referenceNumber: string | null;
  createdByName: string | null; createdAt: string;
}

export function getLedgerCredits(page = 1, limit = 50, month?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (month) params.set('month', month);
  return tenantFetch<{ data: LedgerEntry[]; total: number; page: number; limit: number }>(`/api/v1/tenant/ledger/credits?${params}`);
}

export function getLedgerDebits(page = 1, limit = 50, month?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (month) params.set('month', month);
  return tenantFetch<{ data: LedgerEntry[]; total: number; page: number; limit: number }>(`/api/v1/tenant/ledger/debits?${params}`);
}

export function getLedgerPrincipal(page = 1, limit = 50, month?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (month) params.set('month', month);
  return tenantFetch<{ data: PrincipalTxn[]; total: number; page: number; limit: number }>(`/api/v1/tenant/ledger/principal?${params}`);
}

export function getLedgerTransactions(page = 1, limit = 50, month?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (month) params.set('month', month);
  return tenantFetch<{ data: ManualTransaction[]; total: number; page: number; limit: number }>(`/api/v1/tenant/ledger/transactions?${params}`);
}

export function addLedgerTransaction(dto: {
  transactionDate: string; type: 'CREDIT' | 'DEBIT'; amount: number;
  category: string; accountName?: string;
  entityType?: string; entityId?: string; entityName?: string;
  description?: string; referenceNumber?: string;
}) {
  return tenantFetch<ManualTransaction>('/api/v1/tenant/ledger/transactions', {
    method: 'POST', body: JSON.stringify(dto),
  });
}

// ── Activity Log (who did what inside this tenant) ─────────────────────────────

export interface TenantActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface TenantActivityPage {
  total: number;
  page: number;
  limit: number;
  data: TenantActivityEntry[];
  availableActions: string[];
}

export function getTenantActivity(params: {
  page?: number; limit?: number; action?: string; entityType?: string; search?: string;
} = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.action) qs.set('action', params.action);
  if (params.entityType) qs.set('entityType', params.entityType);
  if (params.search) qs.set('search', params.search);
  return tenantFetch<TenantActivityPage>(`/api/v1/tenant/activity-log?${qs.toString()}`);
}
