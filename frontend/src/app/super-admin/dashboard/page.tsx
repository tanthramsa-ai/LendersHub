'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { dashboardApi, type OverviewData } from '@/services/dashboard';
import { tenantsApi, type Tenant } from '@/services/tenants';
import Link from 'next/link';

const REFRESH_INTERVAL = 60;

function GrowthBadge({ value }: { value: number }) {
  if (value === 0) return <span className="text-xs text-gray-500">—</span>;
  const positive = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d={positive
          ? 'M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z'
          : 'M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z'
        } clipRule="evenodd" />
      </svg>
      {Math.abs(value)}% vs last month
    </span>
  );
}

function AlertSeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    none: 'bg-emerald-500',
    low: 'bg-yellow-400',
    medium: 'bg-orange-400',
    high: 'bg-red-500 animate-pulse',
  };
  return <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${colors[severity] ?? 'bg-gray-500'}`} />;
}

interface KpiCardProps {
  label: string;
  value: string;
  growth: number;
  icon: React.ReactNode;
  accentClass: string;
  href: string;
  loading: boolean;
  extra?: React.ReactNode;
}

function KpiCard({ label, value, growth, icon, accentClass, href, loading, extra }: KpiCardProps) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className="group text-left bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-xl p-6 transition-all duration-150 cursor-pointer w-full relative overflow-hidden"
      aria-label={`View ${label} details`}
    >
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${accentClass}`} />
      <div className="flex items-start justify-between mb-4">
        <div className={`p-2.5 rounded-xl bg-gray-800 group-hover:bg-gray-750`}>
          {icon}
        </div>
        <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-9 w-24 bg-gray-800 rounded animate-pulse" />
      ) : (
        <p className="text-3xl font-bold text-white mt-1.5">{value}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {!loading && <GrowthBadge value={growth} />}
        {extra}
      </div>
    </button>
  );
}

function TenantLogo({ name }: { name: string }) {
  const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const colors = [
    'from-blue-500 to-blue-700',
    'from-emerald-500 to-emerald-700',
    'from-violet-500 to-violet-700',
    'from-amber-500 to-orange-600',
    'from-pink-500 to-rose-600',
    'from-sky-500 to-cyan-700',
  ];
  const color = colors[initials.charCodeAt(0) % colors.length];
  return (
    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
      {initials}
    </div>
  );
}

function resolveStatus(t: Tenant) {
  if (t.subscriptionStatus === 'TRIAL') return { label: 'Trial', cls: 'bg-blue-900/50 text-blue-300' };
  if (t.subscriptionStatus === 'PAST_DUE') return { label: 'Past Due', cls: 'bg-orange-900/50 text-orange-300' };
  if (t.subscriptionStatus === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-gray-800 text-gray-400' };
  if (t.status === 'ACTIVE') return { label: 'Active', cls: 'bg-emerald-900/50 text-emerald-300' };
  if (t.status === 'SUSPENDED') return { label: 'Suspended', cls: 'bg-red-900/50 text-red-300' };
  return { label: t.status, cls: 'bg-gray-800 text-gray-400' };
}

const PLAN_LABEL: Record<string, string> = { STARTER: 'Starter', PROFESSIONAL: 'Professional', ENTERPRISE: 'Enterprise' };

const HEALTH_ITEMS = [
  { label: 'API Response', value: '98.7%', sub: 'Excellent', icon: '✓', color: 'emerald' },
  { label: 'Database', value: 'Normal', sub: 'PostgreSQL healthy', icon: '⚡', color: 'emerald' },
  { label: 'Storage', value: '68%', sub: '32% free space', icon: '💾', color: 'emerald' },
  { label: 'Redis Cache', value: 'Fair', sub: 'High memory usage', icon: '🔴', color: 'amber' },
];

export default function SuperAdminDashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recentTenants, setRecentTenants] = useState<Tenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(true);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const [exporting, setExporting] = useState(false);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionStore.getToken()) {
      router.replace('/super-admin/login');
    } else {
      setReady(true);
    }
  }, [router]);

  const fetchData = useCallback(async () => {
    try {
      const overview = await dashboardApi.getOverview();
      setData(overview);
      setError('');
    } catch {
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTenants = useCallback(async () => {
    try {
      const result = await tenantsApi.list({ limit: 5, sortBy: 'createdAt', sortDir: 'desc' });
      setRecentTenants(result.tenants);
    } catch {
      // non-critical
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    fetchData();
    fetchTenants();

    intervalRef.current = setInterval(() => {
      fetchData();
      setCountdown(REFRESH_INTERVAL);
    }, REFRESH_INTERVAL * 1000);

    countdownRef.current = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : REFRESH_INTERVAL));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [ready, fetchData, fetchTenants]);

  async function handleExportPDF() {
    if (!dashboardRef.current) return;
    setExporting(true);
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ]);
      const canvas = await html2canvas(dashboardRef.current, {
        backgroundColor: '#030712',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width / 2, canvas.height / 2] });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save(`lendershub-dashboard-${new Date().toISOString().split('T')[0]}.pdf`);
    } finally {
      setExporting(false);
    }
  }

  function fmtRupees(n: number) {
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${n.toLocaleString('en-IN')}`;
  }

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Super Admin Dashboard</h1>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">
              Last updated {new Date(data.updatedAt).toLocaleTimeString()} · refreshing in {countdown}s
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={handleExportPDF}
            disabled={exporting || loading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </div>
      </div>

      <main className="px-8 py-8 max-w-[1400px] mx-auto">
        {error && (
          <div className="mb-6 flex items-center gap-2 text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        {/* KPI Cards */}
        <div ref={dashboardRef} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
          <KpiCard
            label="Total Tenants"
            value={data ? data.tenants.value.toLocaleString() : '—'}
            growth={data?.tenants.growth ?? 0}
            loading={loading}
            href="/super-admin/dashboard/tenants"
            accentClass="bg-gradient-to-r from-violet-600 to-purple-600"
            icon={<svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}
          />
          <KpiCard
            label="Monthly Revenue (MRR)"
            value={data ? fmtRupees(data.mrr.value) : '—'}
            growth={data?.mrr.growth ?? 0}
            loading={loading}
            href="/super-admin/dashboard/mrr"
            accentClass="bg-gradient-to-r from-emerald-500 to-teal-600"
            icon={<svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          />
          <KpiCard
            label="Active Users"
            value={data ? data.activeUsers.value.toLocaleString() : '—'}
            growth={data?.activeUsers.growth ?? 0}
            loading={loading}
            href="/super-admin/dashboard/active-users"
            accentClass="bg-gradient-to-r from-amber-500 to-orange-600"
            icon={<svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
          />
          <KpiCard
            label="System Alerts"
            value={data ? data.systemAlerts.value.toLocaleString() : '—'}
            growth={data?.systemAlerts.growth ?? 0}
            loading={loading}
            href="/super-admin/dashboard/alerts"
            accentClass="bg-gradient-to-r from-red-500 to-rose-600"
            icon={<svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
            extra={data && <span className="flex items-center text-xs text-gray-500"><AlertSeverityDot severity={data.systemAlerts.severity} />{data.systemAlerts.severity === 'none' ? 'No alerts' : `${data.systemAlerts.severity} severity`}</span>}
          />
        </div>

        {/* Main grid: Active Tenants + System Health */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          {/* Active Tenants table */}
          <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                </svg>
                Active Tenants
              </h2>
              <div className="flex items-center gap-2">
                <Link
                  href="/super-admin/tenants"
                  className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600"
                >
                  View All
                </Link>
                <Link
                  href="/super-admin/tenants/new"
                  className="text-xs text-white px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 transition-colors flex items-center gap-1"
                >
                  <span>+</span> Add Tenant
                </Link>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Tenant</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Plan</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Users</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">MRR</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {tenantsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>
                        <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-xl bg-gray-800 animate-pulse" /><div className="space-y-1.5"><div className="h-3.5 w-28 bg-gray-800 rounded animate-pulse" /><div className="h-3 w-36 bg-gray-800 rounded animate-pulse" /></div></div></td>
                        <td className="px-4 py-4"><div className="h-3.5 w-20 bg-gray-800 rounded animate-pulse" /></td>
                        <td className="px-4 py-4 text-right"><div className="h-3.5 w-8 bg-gray-800 rounded animate-pulse ml-auto" /></td>
                        <td className="px-4 py-4 text-right"><div className="h-3.5 w-16 bg-gray-800 rounded animate-pulse ml-auto" /></td>
                        <td className="px-4 py-4"><div className="h-6 w-16 bg-gray-800 rounded-full animate-pulse" /></td>
                      </tr>
                    ))
                  ) : recentTenants.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-500 text-sm">No tenants yet. <Link href="/super-admin/tenants/new" className="text-violet-400 hover:underline">Create one →</Link></td></tr>
                  ) : (
                    recentTenants.map((t) => {
                      const { label, cls } = resolveStatus(t);
                      return (
                        <tr key={t.id} className="hover:bg-gray-800/50 transition-colors cursor-pointer" onClick={() => router.push(`/super-admin/tenants/${t.id}`)}>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <TenantLogo name={t.companyName} />
                              <div>
                                <p className="font-medium text-white">{t.companyName}</p>
                                <p className="text-xs text-gray-500">{t.subdomain}.lendershub.com</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-gray-300">{t.plan ? PLAN_LABEL[t.plan] ?? t.plan : '—'}</td>
                          <td className="px-4 py-4 text-right text-gray-300">{(t as any)._count?.users ?? '—'}</td>
                          <td className="px-4 py-4 text-right font-medium text-white">
                            {t.monthlyAmount ? `₹${Number(t.monthlyAmount).toLocaleString('en-IN')}` : '—'}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}>
                              {label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* System Health */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                System Health
              </h2>
            </div>
            <div className="p-4 space-y-3">
              {HEALTH_ITEMS.map((item) => (
                <div
                  key={item.label}
                  className={`p-4 rounded-xl border ${item.color === 'emerald' ? 'bg-emerald-950/30 border-emerald-900/40' : 'bg-amber-950/30 border-amber-900/40'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-400">{item.label}</span>
                    <span className="text-sm">{item.icon}</span>
                  </div>
                  <p className={`text-xl font-bold ${item.color === 'emerald' ? 'text-emerald-400' : 'text-amber-400'}`}>{item.value}</p>
                  <p className={`text-[11px] mt-0.5 ${item.color === 'emerald' ? 'text-emerald-600' : 'text-amber-600'}`}>{item.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
