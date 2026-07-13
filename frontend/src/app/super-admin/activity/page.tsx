'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { auditLogApi, type AuditLogEntry } from '@/services/audit-log';

const ACTION_LABELS: Record<string, string> = {
  'tenant.created': 'Tenant created',
  'tenant.subscription_updated': 'Subscription updated',
  'tenant.user.created': 'Tenant user created',
  'tenant.user.password_reset': 'Tenant user password reset',
  'branch.created': 'Branch created',
  'branch.updated': 'Branch updated',
  'loan_type.created': 'Loan type created',
  'super_admin.password_changed': 'Password changed',
  'super_admin.2fa_enabled': '2FA enabled',
  'super_admin.2fa_disabled': '2FA disabled',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

const TARGET_TYPE_BADGE: Record<string, string> = {
  tenant: 'bg-indigo-900 text-indigo-300',
  tenant_user: 'bg-violet-900 text-violet-300',
  branch: 'bg-blue-900 text-blue-300',
  loan_type: 'bg-teal-900 text-teal-300',
  super_admin: 'bg-amber-900 text-amber-300',
};

function targetTypeBadge(type: string) {
  const cls = TARGET_TYPE_BADGE[type] ?? 'bg-gray-800 text-gray-300';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${cls}`}>
      {type.replace('_', ' ')}
    </span>
  );
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function ActivityLogPage() {
  const router = useRouter();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const LIMIT = 25;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch, actionFilter, targetTypeFilter]);

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }

    setLoading(true);
    auditLogApi.list({
      page, limit: LIMIT,
      search: debouncedSearch || undefined,
      action: actionFilter || undefined,
      targetType: targetTypeFilter || undefined,
    })
      .then((r) => { setEntries(r.data); setTotal(r.total); setAvailableActions(r.availableActions); })
      .catch(() => setError('Failed to load activity log'))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, actionFilter, targetTypeFilter, router]);

  const totalPages = Math.ceil(total / LIMIT);
  const targetTypes = Array.from(new Set(availableActions.map((a) => a.split('.')[0])));
  const hasFilters = search || actionFilter || targetTypeFilter;

  function clearFilters() {
    setSearch(''); setActionFilter(''); setTargetTypeFilter('');
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push('/super-admin/dashboard')} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="font-bold text-white">Activity Log</h1>
          <p className="text-xs text-gray-500">
            {loading ? 'Loading…' : `${total} action${total !== 1 ? 's' : ''} recorded`}
          </p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && <p className="mb-5 text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm">{error}</p>}

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-56 max-w-sm">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.65 16.65A7 7 0 1116.65 3a7 7 0 010 13.65z" />
            </svg>
            <input
              type="search"
              placeholder="Search actor, target, or action…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
            />
          </div>

          <select
            value={targetTypeFilter}
            onChange={(e) => setTargetTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Types</option>
            {targetTypes.map((t) => (
              <option key={t} value={t} className="capitalize">{t.replace('_', ' ')}</option>
            ))}
          </select>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Actions</option>
            {availableActions.map((a) => (
              <option key={a} value={a}>{actionLabel(a)}</option>
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

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-6 py-3 font-medium">Action</th>
                  <th className="px-6 py-3 font-medium">Target</th>
                  <th className="px-6 py-3 font-medium">Actor</th>
                  <th className="px-6 py-3 font-medium">IP Address</th>
                  <th className="px-6 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-800">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-6 py-4">
                          <div className="h-4 bg-gray-800 rounded animate-pulse" style={{ width: `${60 + (j * 11) % 35}%` }} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-14 text-center text-gray-500">
                      {hasFilters ? (
                        <>No activity matches your filters.{' '}
                          <button onClick={clearFilters} className="text-indigo-400 hover:underline">Clear filters</button>
                        </>
                      ) : (
                        'No activity recorded yet.'
                      )}
                    </td>
                  </tr>
                ) : (
                  entries.map((e) => (
                    <Fragment key={e.id}>
                      <tr
                        className="border-b border-gray-800 last:border-0 hover:bg-gray-800/50 transition-colors cursor-pointer"
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      >
                        <td className="px-6 py-4">
                          <p className="text-white font-medium">{actionLabel(e.action)}</p>
                          <p className="text-gray-600 text-xs font-mono mt-0.5">{e.action}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            {targetTypeBadge(e.targetType)}
                            <span className="text-gray-300 text-sm truncate max-w-[220px]">{e.targetLabel ?? '—'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-300 text-sm">{e.actorEmail}</td>
                        <td className="px-6 py-4 font-mono text-xs text-gray-400">{e.ipAddress}</td>
                        <td className="px-6 py-4 text-gray-400 text-xs whitespace-nowrap">{formatWhen(e.createdAt)}</td>
                      </tr>
                      {expanded === e.id && e.metadata && (
                        <tr className="bg-gray-950/60 border-b border-gray-800">
                          <td colSpan={5} className="px-6 py-4">
                            <pre className="text-xs text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(e.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

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
