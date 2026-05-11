import { sessionStore } from './super-admin-auth';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

async function authGet<T>(path: string): Promise<T> {
  const token = sessionStore.getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Request failed');
  return data as T;
}

export interface KpiMetric {
  value: number;
  growth: number;
}

export interface OverviewData {
  tenants: KpiMetric;
  mrr: KpiMetric;
  activeUsers: KpiMetric;
  systemAlerts: KpiMetric & { severity: 'none' | 'low' | 'medium' | 'high' };
  updatedAt: string;
}

export interface TenantDetail {
  monthlyCounts: { month: string; count: number }[];
  tenants: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    createdAt: string;
    _count: { loans: number };
  }[];
}

export interface MrrDetail {
  monthlyMrr: { month: string; mrr: number }[];
  topTenants: {
    id: string;
    companyName: string;
    subdomain: string;
    plan: string | null;
    billingCycle: string | null;
    monthlyAmount: number;
    subscriptionStatus: string | null;
    trialEndsAt: string | null;
    createdAt: string;
  }[];
}

export interface ActiveUsersDetail {
  dailyLogins: { day: string; count: number }[];
  recentUsers: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    lastLoginAt: string;
    ipAddress: string;
  }[];
}

export interface AlertsDetail {
  alerts: {
    id: string;
    email: string;
    ipAddress: string;
    reason: string | null;
    createdAt: string;
  }[];
  suspiciousIps: { ip: string; failedAttempts: number }[];
}

export const dashboardApi = {
  getOverview: () => authGet<OverviewData>('/api/v1/super-admin/dashboard/overview'),
  getTenants: () => authGet<TenantDetail>('/api/v1/super-admin/dashboard/tenants'),
  getMrr: () => authGet<MrrDetail>('/api/v1/super-admin/dashboard/mrr'),
  getActiveUsers: () => authGet<ActiveUsersDetail>('/api/v1/super-admin/dashboard/active-users'),
  getAlerts: () => authGet<AlertsDetail>('/api/v1/super-admin/dashboard/alerts'),
};
