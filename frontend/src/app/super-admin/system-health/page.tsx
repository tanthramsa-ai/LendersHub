'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore, saAuthFetch } from '@/services/super-admin-auth';

interface HealthData {
  checkedAt: string;
  database: { status: string; latencyMs: number };
  tenants: { active: number; provisioning: number; suspended: number; failed: number; total: number };
  security: { failedLogins24h: number; failedLoginsLastHour: number; loginSuccessRate: number; riskLevel: string };
  recentFailedLogins: { email: string; ipAddress: string; reason: string | null; createdAt: string }[];
  failedTenants: { id: string; companyName: string; subdomain: string; status: string; createdAt: string }[];
}

async function fetchHealth(): Promise<HealthData> {
  return saAuthFetch<HealthData>('/api/v1/super-admin/system-health');
}

function StatusDot({ ok, pulse }: { ok: boolean; pulse?: boolean }) {
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-red-500'} ${pulse ? 'animate-pulse' : ''}`} />
  );
}

function RiskBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    none: 'bg-emerald-900/50 text-emerald-300',
    low: 'bg-yellow-900/50 text-yellow-300',
    medium: 'bg-orange-900/50 text-orange-300',
    high: 'bg-red-900/50 text-red-300',
  };
  const label = level === 'none' ? 'Normal' : level.charAt(0).toUpperCase() + level.slice(1);
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[level] ?? map.none}`}>
      {label}
    </span>
  );
}

function LatencyBar({ ms }: { ms: number }) {
  const pct = Math.min(100, (ms / 500) * 100);
  const color = ms < 50 ? 'bg-emerald-500' : ms < 150 ? 'bg-yellow-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-300 w-14 text-right">{ms}ms</span>
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function SystemHealthPage() {
  const router = useRouter();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
  }, [router]);

  const load = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true); else setLoading(true);
    try {
      const d = await fetchHealth();
      setData(d);
      setError('');
    } catch {
      setError('Failed to load system health data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const SERVICES = [
    {
      label: 'API Server',
      ok: true,
      detail: 'NestJS · port 4001',
      value: 'Online',
    },
    {
      label: 'Database',
      ok: !loading && !error,
      detail: data ? `PostgreSQL · ${data.database.latencyMs}ms` : 'PostgreSQL',
      value: loading ? '…' : error ? 'Error' : 'Healthy',
    },
    {
      label: 'Frontend',
      ok: true,
      detail: 'Next.js · port 3010',
      value: 'Online',
    },
    {
      label: 'Auth Service',
      ok: true,
      detail: 'JWT + TOTP',
      value: 'Active',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">System Health</h1>
          {data && (
            <p className="text-xs text-gray-500 mt-0.5">Last checked {fmt(data.checkedAt)} · auto-refreshes every 30s</p>
          )}
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-50 transition-colors"
        >
          <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      <main className="px-8 py-8 max-w-[1200px] mx-auto space-y-8">
        {error && (
          <div className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-3">{error}</div>
        )}

        {/* Services grid */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">Services</h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {SERVICES.map((svc) => (
              <div key={svc.label} className={`border rounded-xl p-5 ${svc.ok ? 'bg-gray-900 border-gray-800' : 'bg-red-950/20 border-red-900/40'}`}>
                <div className="flex items-center gap-2 mb-3">
                  <StatusDot ok={svc.ok} pulse={!svc.ok} />
                  <span className="text-xs text-gray-400">{svc.detail}</span>
                </div>
                <p className="text-sm font-semibold text-white mb-0.5">{svc.label}</p>
                <p className={`text-xl font-bold ${svc.ok ? 'text-emerald-400' : 'text-red-400'}`}>{svc.value}</p>
              </div>
            ))}
          </div>
        </section>

        {/* DB latency + Tenant status */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Database detail */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="font-semibold text-white mb-5 flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582 4-8 4m16 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
              Database
            </h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>Query latency</span>
                  <span className={data ? (data.database.latencyMs < 50 ? 'text-emerald-400' : data.database.latencyMs < 150 ? 'text-yellow-400' : 'text-red-400') : ''}>
                    {loading ? '…' : data ? (data.database.latencyMs < 50 ? 'Excellent' : data.database.latencyMs < 150 ? 'Good' : 'Slow') : '—'}
                  </span>
                </div>
                {loading
                  ? <div className="h-1.5 bg-gray-800 rounded-full animate-pulse" />
                  : data && <LatencyBar ms={data.database.latencyMs} />
                }
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-gray-800 rounded-lg p-3 animate-pulse h-16" />
                  ))
                ) : data ? (
                  [
                    { label: 'Total Tenants', value: data.tenants.total, cls: 'text-white' },
                    { label: 'Active', value: data.tenants.active, cls: 'text-emerald-400' },
                    { label: 'Provisioning', value: data.tenants.provisioning, cls: 'text-yellow-400' },
                    { label: 'Failed', value: data.tenants.failed, cls: data.tenants.failed > 0 ? 'text-red-400' : 'text-gray-500' },
                  ].map((item) => (
                    <div key={item.label} className="bg-gray-800/60 rounded-lg p-3">
                      <p className="text-xs text-gray-500">{item.label}</p>
                      <p className={`text-2xl font-bold ${item.cls}`}>{item.value}</p>
                    </div>
                  ))
                ) : null}
              </div>
            </div>
          </section>

          {/* Security */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="font-semibold text-white mb-5 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Security
              {data && !loading && (
                <RiskBadge level={data.security.riskLevel} />
              )}
            </h2>
            <div className="space-y-3">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg p-4 animate-pulse h-16" />
                ))
              ) : data ? (
                <>
                  <div className="bg-gray-800/60 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">Failed logins (24h)</p>
                      <p className={`text-2xl font-bold ${data.security.failedLogins24h > 20 ? 'text-red-400' : data.security.failedLogins24h > 5 ? 'text-orange-400' : 'text-white'}`}>
                        {data.security.failedLogins24h}
                      </p>
                    </div>
                    <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div className="bg-gray-800/60 rounded-lg p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">Failed logins (last hour)</p>
                      <p className={`text-2xl font-bold ${data.security.failedLoginsLastHour >= 10 ? 'text-red-400' : data.security.failedLoginsLastHour >= 3 ? 'text-orange-400' : 'text-white'}`}>
                        {data.security.failedLoginsLastHour}
                      </p>
                    </div>
                    <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="bg-gray-800/60 rounded-lg p-4">
                    <div className="flex justify-between mb-1.5">
                      <p className="text-xs text-gray-500">Login success rate (24h)</p>
                      <span className={`text-xs font-semibold ${data.security.loginSuccessRate >= 95 ? 'text-emerald-400' : data.security.loginSuccessRate >= 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {data.security.loginSuccessRate}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full ${data.security.loginSuccessRate >= 95 ? 'bg-emerald-500' : data.security.loginSuccessRate >= 80 ? 'bg-yellow-400' : 'bg-red-500'}`}
                        style={{ width: `${data.security.loginSuccessRate}%` }}
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>

        {/* Failed tenants */}
        {!loading && data && data.failedTenants.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Tenant Issues ({data.failedTenants.length})
            </h2>
            <div className="bg-gray-900 border border-red-900/30 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Tenant</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Created</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {data.failedTenants.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-800/40 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-medium text-white">{t.companyName}</p>
                        <p className="text-xs text-gray-500 font-mono mt-0.5">{t.subdomain}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${t.status === 'FAILED' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300'}`}>
                          {t.status === 'PROVISIONING' ? 'Provisioning…' : 'Failed'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-400">{fmt(t.createdAt)}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => router.push(`/super-admin/tenants/${t.id}`)}
                          className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Recent failed logins */}
        {!loading && data && data.recentFailedLogins.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              Recent Failed Logins (last 24h)
            </h2>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Time</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Email</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">IP Address</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {data.recentFailedLogins.map((log, i) => (
                    <tr key={i} className="hover:bg-gray-800/40 transition-colors">
                      <td className="px-6 py-3 text-xs text-gray-400 whitespace-nowrap">{fmt(log.createdAt)}</td>
                      <td className="px-6 py-3 text-gray-300">{log.email}</td>
                      <td className="px-6 py-3 font-mono text-xs text-gray-400">{log.ipAddress}</td>
                      <td className="px-6 py-3 text-xs text-gray-500">{log.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* All clear */}
        {!loading && data && data.recentFailedLogins.length === 0 && data.failedTenants.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-900/30 border border-emerald-800/50 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <p className="text-emerald-400 font-semibold">All systems operational</p>
            <p className="text-gray-500 text-sm mt-1">No failed tenants or security incidents in the last 24 hours</p>
          </div>
        )}
      </main>
    </div>
  );
}
