'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { tenantsApi, type Tenant } from '@/services/tenants';

type SortField = 'createdAt' | 'mrr' | 'users';
type SortDir = 'asc' | 'desc';

// Combined display status derived from both status + subscriptionStatus
function resolveDisplayStatus(t: Tenant): { label: string; cls: string } {
  if (t.subscriptionStatus === 'TRIAL') return { label: 'Trial', cls: 'bg-blue-900 text-blue-300' };
  if (t.subscriptionStatus === 'PAST_DUE') return { label: 'Past Due', cls: 'bg-orange-900 text-orange-300' };
  if (t.subscriptionStatus === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-gray-800 text-gray-400' };
  switch (t.status) {
    case 'ACTIVE': return { label: 'Active', cls: 'bg-emerald-900 text-emerald-300' };
    case 'PROVISIONING': return { label: 'Provisioning', cls: 'bg-yellow-900 text-yellow-300 animate-pulse' };
    case 'SUSPENDED': return { label: 'Suspended', cls: 'bg-red-900 text-red-300' };
    case 'FAILED': return { label: 'Failed', cls: 'bg-red-900 text-red-300' };
    default: return { label: t.status, cls: 'bg-gray-800 text-gray-300' };
  }
}

const PLAN_LABEL: Record<string, string> = {
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};

const PLAN_BADGE: Record<string, string> = {
  STARTER: 'bg-gray-800 text-gray-300',
  PROFESSIONAL: 'bg-indigo-900 text-indigo-300',
  ENTERPRISE: 'bg-purple-900 text-purple-300',
};

// Status filter options map to the correct API param
const STATUS_FILTER_OPTIONS = [
  { label: 'All Statuses', value: '' },
  { label: 'Active', value: 'status:ACTIVE' },
  { label: 'Trial', value: 'subscriptionStatus:TRIAL' },
  { label: 'Provisioning', value: 'status:PROVISIONING' },
  { label: 'Suspended', value: 'status:SUSPENDED' },
  { label: 'Failed', value: 'status:FAILED' },
];

function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) {
    return (
      <svg className="w-3.5 h-3.5 text-gray-600 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return dir === 'desc' ? (
    <svg className="w-3.5 h-3.5 text-indigo-400 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-indigo-400 ml-1 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  );
}

export default function TenantListPage() {
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const LIMIT = 20;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Reset to page 1 when filters/sort change
  useEffect(() => { setPage(1); }, [debouncedSearch, planFilter, statusFilter, sortBy, sortDir]);

  // Fetch tenants
  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }

    // Parse statusFilter into the right API params
    let status: string | undefined;
    let subscriptionStatus: string | undefined;
    if (statusFilter.startsWith('status:')) status = statusFilter.slice(7);
    else if (statusFilter.startsWith('subscriptionStatus:')) subscriptionStatus = statusFilter.slice(19);

    setLoading(true);
    tenantsApi.list({
      page,
      limit: LIMIT,
      search: debouncedSearch || undefined,
      plan: planFilter || undefined,
      status,
      subscriptionStatus,
      sortBy,
      sortDir,
    })
      .then((r) => { setTenants(r.tenants); setTotal(r.total); })
      .catch(() => setError('Failed to load tenants'))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, planFilter, statusFilter, sortBy, sortDir, router]);

  const totalPages = Math.ceil(total / LIMIT);

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  }

  function clearFilters() {
    setSearch('');
    setPlanFilter('');
    setStatusFilter('');
    setSortBy('createdAt');
    setSortDir('desc');
  }

  const hasFilters = search || planFilter || statusFilter;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push('/super-admin/dashboard')} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-white">Tenant Management</h1>
          <p className="text-xs text-gray-500">
            {loading ? 'Loading…' : `${total} tenant${total !== 1 ? 's' : ''} on platform`}
          </p>
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

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && <p className="mb-5 text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm">{error}</p>}

        {/* Filter bar */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {/* Search */}
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

          {/* Plan filter */}
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

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-700 hover:border-gray-600 transition-colors"
            >
              Clear filters
            </button>
          )}

          <div className="ml-auto text-xs text-gray-500">
            {!loading && total > 0 && `${total} result${total !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-6 py-3 font-medium">Company</th>
                  <th className="px-6 py-3 font-medium">Subdomain</th>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">
                    <button
                      onClick={() => toggleSort('users')}
                      className="flex items-center hover:text-white transition-colors"
                    >
                      Users
                      <SortIcon field="users" current={sortBy} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-6 py-3 font-medium">
                    <button
                      onClick={() => toggleSort('mrr')}
                      className="flex items-center hover:text-white transition-colors"
                    >
                      MRR
                      <SortIcon field="mrr" current={sortBy} dir={sortDir} />
                    </button>
                  </th>
                  <th className="px-6 py-3 font-medium">
                    <button
                      onClick={() => toggleSort('createdAt')}
                      className="flex items-center hover:text-white transition-colors"
                    >
                      Created
                      <SortIcon field="createdAt" current={sortBy} dir={sortDir} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-800">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-6 py-4">
                          <div className="h-4 bg-gray-800 rounded animate-pulse" style={{ width: `${60 + (j * 11) % 35}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : tenants.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-14 text-center text-gray-500">
                      {hasFilters ? (
                        <>
                          No tenants match your filters.{' '}
                          <button onClick={clearFilters} className="text-indigo-400 hover:underline">Clear filters</button>
                        </>
                      ) : (
                        <>
                          No tenants yet.{' '}
                          <button onClick={() => router.push('/super-admin/tenants/new')} className="text-indigo-400 hover:underline">
                            Create the first tenant →
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  tenants.map((t) => {
                    const { label: statusLabel, cls: statusCls } = resolveDisplayStatus(t);
                    return (
                      <tr
                        key={t.id}
                        className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50 transition-colors cursor-pointer"
                        onClick={() => router.push(`/super-admin/tenants/${t.id}`)}
                      >
                        <td className="px-6 py-4">
                          <p className="text-white font-medium">{t.companyName}</p>
                          <p className="text-gray-500 text-xs mt-0.5">{t.registrationNumber}</p>
                        </td>
                        <td className="px-6 py-4 font-mono text-sm text-indigo-400">{t.subdomain}</td>
                        <td className="px-6 py-4">
                          {t.plan ? (
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_BADGE[t.plan] ?? 'bg-gray-800 text-gray-300'}`}>
                              {PLAN_LABEL[t.plan] ?? t.plan}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCls}`}>
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-300 font-mono text-sm">
                          {t._count?.users ?? 0}
                        </td>
                        <td className="px-6 py-4">
                          {t.monthlyAmount ? (
                            <span className="font-mono text-sm text-white">
                              ${Number(t.monthlyAmount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                          ) : (
                            <span className="text-gray-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-gray-400 text-xs">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
              <p className="text-sm text-gray-400">
                Page {page} of {totalPages} · {total} total
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 transition-colors"
                  title="First page"
                >
                  «
                </button>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 transition-colors"
                >
                  Previous
                </button>

                {/* Page number pills */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                  const p = start + i;
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-8 h-8 text-sm rounded border transition-colors ${
                        p === page
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 transition-colors"
                >
                  Next
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1.5 text-xs rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 transition-colors"
                  title="Last page"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
