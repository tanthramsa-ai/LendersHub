'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { tenantsApi, type Tenant } from '@/services/tenants';

const PLAN_LABEL: Record<string, string> = {
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};
const PLAN_COLOR: Record<string, { badge: string; card: string; accent: string }> = {
  STARTER: {
    badge: 'bg-gray-800 text-gray-300',
    card: 'border-gray-700 bg-gray-800/40',
    accent: 'bg-gray-600',
  },
  PROFESSIONAL: {
    badge: 'bg-indigo-900/60 text-indigo-300',
    card: 'border-indigo-800/50 bg-indigo-950/30',
    accent: 'bg-indigo-500',
  },
  ENTERPRISE: {
    badge: 'bg-violet-900/60 text-violet-300',
    card: 'border-violet-800/50 bg-violet-950/30',
    accent: 'bg-violet-500',
  },
};
const SUB_BADGE: Record<string, string> = {
  TRIAL: 'bg-blue-900/50 text-blue-300',
  ACTIVE: 'bg-emerald-900/50 text-emerald-300',
  PAST_DUE: 'bg-orange-900/50 text-orange-300',
  CANCELLED: 'bg-gray-800 text-gray-400',
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function TrialCountdown({ endsAt }: { endsAt: string | null }) {
  const days = daysUntil(endsAt);
  if (days === null) return <span className="text-gray-600">—</span>;
  if (days < 0) return <span className="text-red-400 text-xs font-medium">Expired</span>;
  if (days === 0) return <span className="text-red-400 text-xs font-bold animate-pulse">Expires today</span>;
  const cls = days <= 3 ? 'text-red-400' : days <= 7 ? 'text-orange-400' : 'text-blue-400';
  return <span className={`text-xs font-medium ${cls}`}>{days}d left</span>;
}

type ViewFilter = 'all' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export default function SubscriptionsPage() {
  const router = useRouter();

  // Load ALL tenants for accurate summary stats
  const [allTenants, setAllTenants] = useState<Tenant[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  // Paginated filtered view
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LIMIT = 20;

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    // Load all for stats (high limit, no filter)
    tenantsApi.list({ page: 1, limit: 200 })
      .then((r) => setAllTenants(r.tenants))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, [router]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch, planFilter, viewFilter]);

  const fetchPage = useCallback(() => {
    setLoading(true);
    tenantsApi.list({
      page,
      limit: LIMIT,
      search: debouncedSearch || undefined,
      plan: planFilter || undefined,
      subscriptionStatus: viewFilter !== 'all' ? viewFilter : undefined,
      sortBy: 'createdAt',
      sortDir: 'desc',
    })
      .then((r) => { setTenants(r.tenants); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, planFilter, viewFilter]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  // Computed stats from allTenants
  const byStatus = {
    ACTIVE: allTenants.filter((t) => t.subscriptionStatus === 'ACTIVE').length,
    TRIAL: allTenants.filter((t) => t.subscriptionStatus === 'TRIAL').length,
    PAST_DUE: allTenants.filter((t) => t.subscriptionStatus === 'PAST_DUE').length,
    CANCELLED: allTenants.filter((t) => t.subscriptionStatus === 'CANCELLED').length,
  };
  const byPlan = {
    STARTER: allTenants.filter((t) => t.plan === 'STARTER').length,
    PROFESSIONAL: allTenants.filter((t) => t.plan === 'PROFESSIONAL').length,
    ENTERPRISE: allTenants.filter((t) => t.plan === 'ENTERPRISE').length,
    none: allTenants.filter((t) => !t.plan).length,
  };
  const trialsExpiringSoon = allTenants
    .filter((t) => t.subscriptionStatus === 'TRIAL' && t.trialEndsAt)
    .map((t) => ({ ...t, daysLeft: daysUntil(t.trialEndsAt) ?? 999 }))
    .filter((t) => t.daysLeft <= 7 && t.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const totalPages = Math.ceil(total / LIMIT);
  const hasFilters = search || planFilter || viewFilter !== 'all';

  const STATUS_TABS: { id: ViewFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: allTenants.length },
    { id: 'ACTIVE', label: 'Active', count: byStatus.ACTIVE },
    { id: 'TRIAL', label: 'Trial', count: byStatus.TRIAL },
    { id: 'PAST_DUE', label: 'Past Due', count: byStatus.PAST_DUE },
    { id: 'CANCELLED', label: 'Cancelled', count: byStatus.CANCELLED },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="sticky top-0 z-30 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-8 py-4">
        <h1 className="text-xl font-bold text-white">Subscriptions</h1>
        <p className="text-xs text-gray-500 mt-0.5">Plan distribution, trial status, and subscription lifecycle</p>
      </div>

      <main className="px-8 py-8 max-w-[1400px] mx-auto space-y-8">

        {/* Plan distribution */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">Plan Distribution</h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {(['STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const).map((plan) => {
              const count = byPlan[plan];
              const total_ = allTenants.filter((t) => t.plan).length || 1;
              const pct = Math.round((count / total_) * 100);
              const c = PLAN_COLOR[plan];
              return (
                <button
                  key={plan}
                  onClick={() => { setPlanFilter(planFilter === plan ? '' : plan); setViewFilter('all'); }}
                  className={`border rounded-xl p-5 text-left transition-all ${c.card} ${planFilter === plan ? 'ring-2 ring-indigo-500' : 'hover:border-gray-600'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.badge}`}>{PLAN_LABEL[plan]}</span>
                    {statsLoading
                      ? <div className="h-4 w-8 bg-gray-700 rounded animate-pulse" />
                      : <span className="text-xs text-gray-500">{pct}%</span>
                    }
                  </div>
                  {statsLoading
                    ? <div className="h-8 w-12 bg-gray-700 rounded animate-pulse" />
                    : <p className="text-3xl font-bold text-white">{count}</p>
                  }
                  <p className="text-xs text-gray-500 mt-1">tenant{count !== 1 ? 's' : ''}</p>
                  <div className="mt-3 h-1 rounded-full bg-gray-700">
                    <div className={`h-1 rounded-full ${c.accent} transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </button>
              );
            })}
            <div className="border border-gray-800 bg-gray-900/40 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-800 text-gray-400">No Plan</span>
              </div>
              {statsLoading
                ? <div className="h-8 w-12 bg-gray-700 rounded animate-pulse" />
                : <p className="text-3xl font-bold text-gray-500">{byPlan.none}</p>
              }
              <p className="text-xs text-gray-600 mt-1">not configured</p>
            </div>
          </div>
        </section>

        {/* Trials expiring soon */}
        {!statsLoading && trialsExpiringSoon.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-2">
              <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Trials Expiring Within 7 Days
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {trialsExpiringSoon.map((t) => (
                <button
                  key={t.id}
                  onClick={() => router.push(`/super-admin/tenants/${t.id}/subscription`)}
                  className="flex items-center gap-4 px-4 py-3 bg-gray-900 border border-orange-900/40 rounded-xl hover:border-orange-700/60 transition-colors text-left"
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${t.daysLeft === 0 ? 'bg-red-500 animate-pulse' : t.daysLeft <= 3 ? 'bg-red-400' : 'bg-orange-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-sm truncate">{t.companyName}</p>
                    <p className="text-xs text-gray-500 truncate">{t.subdomain}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <TrialCountdown endsAt={t.trialEndsAt} />
                    {t.plan && (
                      <p className="text-[10px] text-gray-600 mt-0.5">{PLAN_LABEL[t.plan]}</p>
                    )}
                  </div>
                  <svg className="w-4 h-4 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Table section */}
        <section>
          {/* Status tabs */}
          <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setViewFilter(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  viewFilter === tab.id
                    ? 'bg-violet-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {tab.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${viewFilter === tab.id ? 'bg-violet-500/50' : 'bg-gray-800'}`}>
                  {statsLoading ? '…' : tab.count}
                </span>
              </button>
            ))}

            {/* Search + plan filter inline */}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.65 16.65A7 7 0 1116.65 3a7 7 0 010 13.65z" />
                </svg>
                <input
                  type="search"
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-sm w-44"
                />
              </div>
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All Plans</option>
                <option value="STARTER">Starter</option>
                <option value="PROFESSIONAL">Professional</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>
              {hasFilters && (
                <button
                  onClick={() => { setSearch(''); setPlanFilter(''); setViewFilter('all'); }}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded border border-gray-700 hover:border-gray-600 transition-colors whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Tenant</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Plan</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Sub Status</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Trial / Started</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">MRR</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 5 }).map((_, j) => (
                          <td key={j} className="px-6 py-4">
                            <div className="h-4 bg-gray-800 rounded animate-pulse" style={{ width: `${45 + (i * 11 + j * 17) % 45}%` }} />
                          </td>
                        ))}
                        <td className="px-6 py-4"><div className="h-7 w-20 bg-gray-800 rounded-lg animate-pulse ml-auto" /></td>
                      </tr>
                    ))
                  ) : tenants.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-14 text-center text-gray-500">
                        {hasFilters ? (
                          <>No tenants match your filters. <button onClick={() => { setSearch(''); setPlanFilter(''); setViewFilter('all'); }} className="text-indigo-400 hover:underline">Clear filters</button></>
                        ) : 'No tenants found.'}
                      </td>
                    </tr>
                  ) : (
                    tenants.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-800/40 transition-colors">
                        <td className="px-6 py-4">
                          <p className="font-medium text-white">{t.companyName}</p>
                          <p className="text-xs text-gray-500 font-mono mt-0.5">{t.subdomain}</p>
                        </td>
                        <td className="px-6 py-4">
                          {t.plan ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_COLOR[t.plan]?.badge ?? 'bg-gray-800 text-gray-300'}`}>
                              {PLAN_LABEL[t.plan] ?? t.plan}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs italic">None</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {t.subscriptionStatus ? (
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SUB_BADGE[t.subscriptionStatus] ?? 'bg-gray-800 text-gray-400'}`}>
                              {t.subscriptionStatus === 'PAST_DUE' ? 'Past Due' : t.subscriptionStatus.charAt(0) + t.subscriptionStatus.slice(1).toLowerCase()}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {t.subscriptionStatus === 'TRIAL' ? (
                            <div>
                              <TrialCountdown endsAt={t.trialEndsAt} />
                              {t.trialEndsAt && (
                                <p className="text-[11px] text-gray-600 mt-0.5">
                                  {new Date(t.trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                </p>
                              )}
                            </div>
                          ) : t.subscriptionStartsAt ? (
                            <p className="text-xs text-gray-400">
                              {new Date(t.subscriptionStartsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right font-mono font-semibold text-white">
                          {t.monthlyAmount ? `₹${Number(t.monthlyAmount).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => router.push(`/super-admin/tenants/${t.id}/subscription`)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 transition-colors whitespace-nowrap"
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
                <p className="text-sm text-gray-400">Page {page} of {totalPages} · {total} total</p>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
                    Previous
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                    const p = start + i;
                    return (
                      <button key={p} onClick={() => setPage(p)}
                        className={`w-8 h-8 text-sm rounded border transition-colors ${p === page ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'}`}>
                        {p}
                      </button>
                    );
                  })}
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 transition-colors">
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
