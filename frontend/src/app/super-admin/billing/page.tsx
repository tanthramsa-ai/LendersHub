'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { tenantsApi, type Tenant } from '@/services/tenants';

const PLAN_LABEL: Record<string, string> = {
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};
const PLAN_BADGE: Record<string, string> = {
  STARTER: 'bg-gray-800 text-gray-300',
  PROFESSIONAL: 'bg-indigo-900/60 text-indigo-300',
  ENTERPRISE: 'bg-violet-900/60 text-violet-300',
};
const CYCLE_LABEL: Record<string, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUALLY: 'Annually',
};
const SUB_STATUS_BADGE: Record<string, string> = {
  TRIAL: 'bg-blue-900/50 text-blue-300',
  ACTIVE: 'bg-emerald-900/50 text-emerald-300',
  PAST_DUE: 'bg-orange-900/50 text-orange-300',
  CANCELLED: 'bg-gray-800 text-gray-400',
};

function fmtRupees(n: number | string | null) {
  if (!n) return '—';
  const v = Number(n);
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
  return `₹${v.toLocaleString('en-IN')}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

type SubFilter = '' | 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export default function BillingPage() {
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [subFilter, setSubFilter] = useState<SubFilter>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LIMIT = 20;

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
  }, [router]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch, planFilter, subFilter]);

  useEffect(() => {
    setLoading(true);
    tenantsApi.list({
      page,
      limit: LIMIT,
      search: debouncedSearch || undefined,
      plan: planFilter || undefined,
      subscriptionStatus: subFilter || undefined,
      sortBy: 'createdAt',
      sortDir: 'desc',
    })
      .then((r) => { setTenants(r.tenants); setTotal(r.total); })
      .catch(() => setError('Failed to load billing data'))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, planFilter, subFilter]);

  // Compute summary from loaded tenants (first page only — indicative, not aggregate)
  const activeTenants = tenants.filter((t) => t.subscriptionStatus === 'ACTIVE');
  const trialTenants = tenants.filter((t) => t.subscriptionStatus === 'TRIAL');
  const pastDueTenants = tenants.filter((t) => t.subscriptionStatus === 'PAST_DUE');
  const mrr = tenants.reduce((sum, t) => sum + (t.monthlyAmount ? Number(t.monthlyAmount) : 0), 0);

  const totalPages = Math.ceil(total / LIMIT);
  const hasFilters = search || planFilter || subFilter;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Billing</h1>
          <p className="text-xs text-gray-500 mt-0.5">Subscription plans and revenue across all tenants</p>
        </div>
      </div>

      <main className="px-8 py-8 max-w-[1400px] mx-auto">
        {error && (
          <div className="mb-6 text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-3">{error}</div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {[
            {
              label: 'Page MRR',
              value: loading ? null : fmtRupees(mrr),
              sub: 'From current view',
              accent: 'from-emerald-500 to-teal-600',
              icon: (
                <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
            },
            {
              label: 'Active',
              value: loading ? null : String(activeTenants.length),
              sub: 'Paying subscriptions',
              accent: 'from-violet-600 to-purple-600',
              icon: (
                <svg className="w-5 h-5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
            },
            {
              label: 'On Trial',
              value: loading ? null : String(trialTenants.length),
              sub: 'Free trial period',
              accent: 'from-blue-500 to-cyan-600',
              icon: (
                <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
            },
            {
              label: 'Past Due',
              value: loading ? null : String(pastDueTenants.length),
              sub: 'Payment overdue',
              accent: 'from-orange-500 to-red-600',
              icon: (
                <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ),
            },
          ].map((card) => (
            <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-5 relative overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${card.accent}`} />
              <div className="flex items-center justify-between mb-3">
                <div className="p-2 rounded-lg bg-gray-800">{card.icon}</div>
              </div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{card.label}</p>
              {card.value === null ? (
                <div className="mt-1.5 h-8 w-20 bg-gray-800 rounded animate-pulse" />
              ) : (
                <p className="text-3xl font-bold text-white mt-1.5">{card.value}</p>
              )}
              <p className="text-xs text-gray-600 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="relative flex-1 min-w-56 max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.65 16.65A7 7 0 1116.65 3a7 7 0 010 13.65z" />
            </svg>
            <input
              type="search"
              placeholder="Search company or subdomain…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Plans</option>
            <option value="STARTER">Starter</option>
            <option value="PROFESSIONAL">Professional</option>
            <option value="ENTERPRISE">Enterprise</option>
          </select>
          <select
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value as SubFilter)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Statuses</option>
            <option value="TRIAL">Trial</option>
            <option value="ACTIVE">Active</option>
            <option value="PAST_DUE">Past Due</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          {hasFilters && (
            <button
              onClick={() => { setSearch(''); setPlanFilter(''); setSubFilter(''); }}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-700 hover:border-gray-600 transition-colors"
            >
              Clear filters
            </button>
          )}
          <div className="ml-auto text-xs text-gray-500">
            {!loading && `${total} tenant${total !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Tenant</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Plan</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Cycle</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Monthly Amount</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Trial Ends / Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-6 py-4">
                          <div className="h-4 bg-gray-800 rounded animate-pulse" style={{ width: `${50 + (j * 13 + i * 7) % 40}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-14 text-center text-gray-500">
                      {hasFilters ? (
                        <>No tenants match your filters. <button onClick={() => { setSearch(''); setPlanFilter(''); setSubFilter(''); }} className="text-indigo-400 hover:underline">Clear filters</button></>
                      ) : (
                        <>No tenants with billing data yet. <button onClick={() => router.push('/super-admin/tenants/new')} className="text-indigo-400 hover:underline">Create a tenant →</button></>
                      )}
                    </td>
                  </tr>
                ) : (
                  tenants.map((t) => (
                    <tr
                      key={t.id}
                      className="hover:bg-gray-800/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/super-admin/tenants/${t.id}/subscription`)}
                    >
                      <td className="px-6 py-4">
                        <p className="font-medium text-white">{t.companyName}</p>
                        <p className="text-xs text-gray-500 mt-0.5 font-mono">{t.subdomain}</p>
                      </td>
                      <td className="px-6 py-4">
                        {t.plan ? (
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${PLAN_BADGE[t.plan] ?? 'bg-gray-800 text-gray-300'}`}>
                            {PLAN_LABEL[t.plan] ?? t.plan}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">No plan</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-xs">
                        {t.billingCycle ? CYCLE_LABEL[t.billingCycle] ?? t.billingCycle : '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="font-mono font-semibold text-white">{fmtRupees(t.monthlyAmount)}</span>
                      </td>
                      <td className="px-6 py-4">
                        {t.subscriptionStatus ? (
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${SUB_STATUS_BADGE[t.subscriptionStatus] ?? 'bg-gray-800 text-gray-400'}`}>
                            {t.subscriptionStatus === 'PAST_DUE' ? 'Past Due' : t.subscriptionStatus.charAt(0) + t.subscriptionStatus.slice(1).toLowerCase()}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-400">
                        {t.subscriptionStatus === 'TRIAL'
                          ? (t.trialEndsAt ? `Trial ends ${fmtDate(t.trialEndsAt)}` : '—')
                          : (t.subscriptionStartsAt ? fmtDate(t.subscriptionStartsAt) : '—')}
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
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  Previous
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 text-sm rounded border transition-colors ${p === page ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'}`}
                    >
                      {p}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
