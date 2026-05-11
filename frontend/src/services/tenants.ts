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
  status: 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'FAILED';
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
};
