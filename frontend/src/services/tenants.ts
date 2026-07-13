import { sessionStore } from './super-admin-auth';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStore.getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Request failed');
  return data as T;
}

export interface Branch {
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
}

export interface BranchDetail extends Branch {
  updatedAt: string;
  stats: { users: number; customers: number; loans: number };
  loanTypes: LoanType[];
}

export interface CreateBranchPayload {
  name: string;
  code: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  email?: string;
  managerName?: string;
}

export interface CreateLoanTypePayload {
  name: string;
  description?: string;
  minAmount?: number;
  maxAmount?: number;
  minInterestRate?: number;
  maxInterestRate?: number;
  minTermMonths?: number;
  maxTermMonths?: number;
}

export interface SubdomainCheck {
  valid: boolean;
  available: boolean;
}

export interface CreateTenantPayload {
  companyName: string;
  subdomain: string;
  registrationNumber: string;
  gstNumber?: string;
  address: string;
  city?: string;
  state?: string;
  adminEmail: string;
  adminFirstName: string;
  adminLastName: string;
  primaryColor?: string;
  customDomain?: string;
  features?: Record<string, boolean>;
  plan?: string;
  billingCycle?: string;
  trialDays?: number;
}

export interface Tenant {
  id: string;
  companyName: string;
  subdomain: string;
  registrationNumber: string;
  gstNumber: string | null;
  address: string;
  city: string | null;
  state: string | null;
  adminEmail: string;
  primaryColor: string | null;
  customDomain: string | null;
  features: Record<string, boolean> | null;
  status: 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'FAILED' | 'DELETED';
  schemaName: string | null;
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | null;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY' | null;
  trialDays: number | null;
  trialEndsAt: string | null;
  subscriptionStartsAt: string | null;
  monthlyAmount: string | null;
  subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | null;
  createdAt: string;
  updatedAt: string;
  _count?: { users: number; loans: number };
}

/**
 * Build the public URL for a tenant's app.
 * - customDomain wins if set.
 * - Otherwise, if NEXT_PUBLIC_TENANT_ROOT_DOMAIN is set (e.g. "lendershub.in"),
 *   use host-based subdomains: https://{subdomain}.{root}
 * - Otherwise (local dev), fall back to path-based routing on the current origin:
 *   http://localhost:3000/{subdomain}
 */
export function tenantAppUrl(tenant: Pick<Tenant, 'subdomain' | 'customDomain'>): string {
  if (tenant.customDomain) return `https://${tenant.customDomain}`;
  const root = process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAIN;
  if (root) return `https://${tenant.subdomain}.${root}`;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}/${tenant.subdomain}`;
  }
  return `/${tenant.subdomain}`;
}

export interface CreateTenantResult {
  tenant: Tenant;
  admin: { id: string; email: string; firstName: string; lastName: string };
  temporaryPassword: string;
  loginUrl: string;
  emailPreviewUrl?: string;
  provisionedInMs: number;
}

export interface TenantListResult {
  total: number;
  page: number;
  limit: number;
  tenants: Tenant[];
}

export interface PlanInfo {
  id: string;
  name: string;
  basePrice: number;
  features: string[];
}

export interface ConfigureSubscriptionPayload {
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
  trialDays?: number;
}

export interface SubscriptionResult {
  tenant: Tenant;
  monthlyAmount: number;
  effectivePrice: number;
  discountApplied: number;
  trialEndsAt: string | null;
  subscriptionStartsAt: string | null;
}

export interface TenantDetail extends Tenant {
  users: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    createdAt: string;
  }[];
  _count: { users: number; loans: number };
}

export const tenantsApi = {
  checkSubdomain: (subdomain: string) =>
    authFetch<SubdomainCheck>(`/api/v1/super-admin/tenants/check-subdomain?subdomain=${encodeURIComponent(subdomain)}`),

  create: (payload: CreateTenantPayload) =>
    authFetch<CreateTenantResult>('/api/v1/super-admin/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  list: (params: {
    page?: number;
    limit?: number;
    search?: string;
    plan?: string;
    status?: string;
    subscriptionStatus?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  } = {}) => {
    const { page = 1, limit = 20, ...filters } = params;
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
    return authFetch<TenantListResult>(`/api/v1/super-admin/tenants?${qs}`);
  },

  get: (id: string) =>
    authFetch<TenantDetail>(`/api/v1/super-admin/tenants/${id}`),

  getPlans: () =>
    authFetch<PlanInfo[]>('/api/v1/super-admin/tenants/plans'),

  configureSubscription: (id: string, payload: ConfigureSubscriptionPayload) =>
    authFetch<SubscriptionResult>(`/api/v1/super-admin/tenants/${id}/subscription`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Lifecycle
  suspend: (id: string) =>
    authFetch<Tenant>(`/api/v1/super-admin/tenants/${id}/suspend`, { method: 'PATCH' }),

  reactivate: (id: string) =>
    authFetch<Tenant>(`/api/v1/super-admin/tenants/${id}/reactivate`, { method: 'PATCH' }),

  softDelete: (id: string, confirmSubdomain: string) =>
    authFetch<Tenant>(`/api/v1/super-admin/tenants/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirmSubdomain }),
    }),

  // Branch API
  listBranches: (id: string) =>
    authFetch<Branch[]>(`/api/v1/super-admin/tenants/${id}/branches`),

  createBranch: (id: string, payload: CreateBranchPayload) =>
    authFetch<Branch>(`/api/v1/super-admin/tenants/${id}/branches`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getBranch: (tenantId: string, branchId: string) =>
    authFetch<BranchDetail>(`/api/v1/super-admin/tenants/${tenantId}/branches/${branchId}`),

  updateBranch: (tenantId: string, branchId: string, payload: Partial<CreateBranchPayload> & { isActive?: boolean }) =>
    authFetch<Branch>(`/api/v1/super-admin/tenants/${tenantId}/branches/${branchId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  createLoanType: (tenantId: string, payload: CreateLoanTypePayload) =>
    authFetch<LoanType>(`/api/v1/super-admin/tenants/${tenantId}/loan-types`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Tenant users (super-admin bootstrap)
  listTenantUsers: (id: string) =>
    authFetch<TenantUserRecord[]>(`/api/v1/super-admin/tenants/${id}/users`),

  createTenantUser: (id: string, payload: CreateTenantUserPayload) =>
    authFetch<TenantUserRecord>(`/api/v1/super-admin/tenants/${id}/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export interface TenantUserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateTenantUserPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: string;
}
