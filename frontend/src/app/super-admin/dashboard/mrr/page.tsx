'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { dashboardApi, type MrrDetail } from '@/services/dashboard';

function fmtInr(n: number) {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

const PLAN_COLOR: Record<string, string> = {
  STARTER: 'bg-sky-900/40 text-sky-300 border-sky-800',
  PROFESSIONAL: 'bg-violet-900/40 text-violet-300 border-violet-800',
  ENTERPRISE: 'bg-amber-900/40 text-amber-300 border-amber-800',
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-emerald-900/40 text-emerald-300',
  TRIAL: 'bg-blue-900/40 text-blue-300',
  PAST_DUE: 'bg-red-900/40 text-red-300',
  CANCELLED: 'bg-gray-800 text-gray-400',
};

export default function MrrDetailPage() {
  const router = useRouter();
  const [data, setData] = useState<MrrDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    dashboardApi.getMrr()
      .then(setData)
      .catch(() => setError('Failed to load revenue data'))
      .finally(() => setLoading(false));
  }, [router]);

  const maxMrr = data ? Math.max(...data.monthlyMrr.map((m) => m.mrr), 1) : 1;
  const totalMrr = data?.topTenants.reduce((s, t) => s + t.monthlyAmount, 0) ?? 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="font-bold text-white">Monthly Recurring Revenue</h1>
          <p className="text-xs text-gray-500">Subscription revenue from active tenants</p>
        </div>
        {!loading && (
          <div className="ml-auto text-right">
            <p className="text-2xl font-bold text-emerald-400">{fmtInr(totalMrr)}</p>
            <p className="text-xs text-gray-500">Current MRR</p>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {error && <p className="text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm">{error}</p>}

        {/* MRR bar chart */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-5">MRR Trend — Last 6 Months</h2>
          {loading ? (
            <div className="h-36 bg-gray-800 rounded animate-pulse" />
          ) : (
            <div className="flex items-end gap-3 h-36">
              {data?.monthlyMrr.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400">{fmtInr(m.mrr)}</span>
                  <div
                    className="w-full bg-emerald-600 rounded-t transition-all"
                    style={{ height: `${(m.mrr / maxMrr) * 100}%`, minHeight: m.mrr > 0 ? 4 : 0 }}
                  />
                  <span className="text-xs text-gray-500">{m.month}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Top tenants by subscription */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="font-semibold">Top Tenants by Subscription Value</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-6 py-3 font-medium">Tenant</th>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 font-medium">Billing</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Monthly</th>
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
                ) : data?.topTenants.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                      No tenants with active subscriptions yet
                    </td>
                  </tr>
                ) : (
                  data?.topTenants.map((t) => (
                    <tr key={t.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-white font-medium">{t.companyName}</p>
                        <p className="text-gray-400 text-xs">{t.subdomain}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${PLAN_COLOR[t.plan ?? ''] ?? 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                          {t.plan ?? '—'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-400 capitalize">
                        {t.billingCycle ? t.billingCycle.charAt(0) + t.billingCycle.slice(1).toLowerCase() : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${STATUS_COLOR[t.subscriptionStatus ?? ''] ?? 'bg-gray-800 text-gray-400'}`}>
                          {t.subscriptionStatus ?? '—'}
                        </span>
                        {t.subscriptionStatus === 'TRIAL' && t.trialEndsAt && (
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            ends {new Date(t.trialEndsAt).toLocaleDateString()}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-emerald-400 font-semibold">
                        {fmtInr(t.monthlyAmount)}
                      </td>
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
