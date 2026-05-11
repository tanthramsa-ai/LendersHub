'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { dashboardApi } from '@/services/dashboard';

interface MonthCount { month: string; count: number; }
interface TenantRow {
  id: string;
  companyName: string;
  subdomain: string;
  adminEmail: string;
  status: string;
  createdAt: string;
  _count: { users: number; loans: number };
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-900 text-emerald-300',
  PROVISIONING: 'bg-yellow-900 text-yellow-300',
  SUSPENDED: 'bg-orange-900 text-orange-300',
  FAILED: 'bg-red-900 text-red-300',
};

export default function TenantsDetailPage() {
  const router = useRouter();
  const [monthlyCounts, setMonthlyCounts] = useState<MonthCount[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    dashboardApi.getTenants()
      .then((data: any) => {
        setMonthlyCounts(data.monthlyCounts ?? []);
        setTenants(data.tenants ?? []);
      })
      .catch(() => setError('Failed to load tenant data'))
      .finally(() => setLoading(false));
  }, [router]);

  const maxCount = Math.max(...monthlyCounts.map((m) => m.count), 1);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-white">Total Tenants</h1>
          <p className="text-xs text-gray-500">Active tenant accounts on the platform</p>
        </div>
        <button
          onClick={() => router.push('/super-admin/tenants/new')}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Tenant
        </button>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {error && <p className="text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm">{error}</p>}

        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-5">New Tenants — Last 6 Months</h2>
          {loading ? (
            <div className="h-32 bg-gray-800 rounded animate-pulse" />
          ) : (
            <div className="flex items-end gap-3 h-32">
              {monthlyCounts.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400">{m.count}</span>
                  <div
                    className="w-full bg-indigo-600 rounded-t"
                    style={{ height: `${(m.count / maxCount) * 100}%`, minHeight: m.count > 0 ? 4 : 0 }}
                  />
                  <span className="text-xs text-gray-500">{m.month}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">All Tenants</h2>
              {!loading && <p className="text-sm text-gray-400 mt-0.5">{tenants.length} records</p>}
            </div>
            <button
              onClick={() => router.push('/super-admin/tenants')}
              className="text-sm text-indigo-400 hover:underline"
            >
              Manage all →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-6 py-3 font-medium">Company</th>
                  <th className="px-6 py-3 font-medium">Subdomain</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Joined</th>
                  <th className="px-6 py-3 font-medium text-right">Users</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-800">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-6 py-4"><div className="h-4 bg-gray-800 rounded animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                      No tenants yet.{' '}
                      <button onClick={() => router.push('/super-admin/tenants/new')} className="text-indigo-400 hover:underline">
                        Create the first tenant →
                      </button>
                    </td>
                  </tr>
                ) : (
                  tenants.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/super-admin/tenants/${t.id}`)}
                    >
                      <td className="px-6 py-4">
                        <p className="text-white font-medium">{t.companyName}</p>
                        <p className="text-gray-400 text-xs">{t.adminEmail}</p>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-indigo-400">{t.subdomain}</td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[t.status] ?? 'bg-gray-800 text-gray-300'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-right font-mono text-gray-300">{t._count.users}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
