'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { getTenantActivity, getTenantSession, MANAGER_ROLES, UserRole, TenantActivityEntry } from '@/services/tenant-api';

const BRAND = '#0F4C81';

const ACTION_LABELS: Record<string, string> = {
  'loan.created': 'Loan created',
  'loan.closed': 'Loan closed',
  'loan.reopened': 'Loan reopened',
  'loan.deleted': 'Loan deleted',
  'payment.recorded': 'Payment recorded',
  'customer.created': 'Customer added',
  'customer.updated': 'Customer updated',
  'customer.activated': 'Customer activated',
  'customer.deactivated': 'Customer deactivated',
  'customer.deleted': 'Customer deleted',
  'user.created': 'Team member added',
  'user.updated': 'Team member updated',
  'user.activated': 'Team member activated',
  'user.deactivated': 'Team member deactivated',
  'user.password_reset': 'Password reset',
  'branch.created': 'Branch created',
  'branch.updated': 'Branch updated',
  'loan_type.created': 'Loan type created',
  'loan_type.updated': 'Loan type updated',
  'loan_type.deleted': 'Loan type deleted',
  'settings.sms_updated': 'SMS settings updated',
  'settings.whatsapp_updated': 'WhatsApp settings updated',
  'installment.agent_assigned': 'Collector assigned',
  'installment.agent_unassigned': 'Collector unassigned',
  'ledger.credit_added': 'Ledger credit added',
  'ledger.debit_added': 'Ledger debit added',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

const ENTITY_BADGE: Record<string, string> = {
  loan: 'bg-blue-100 text-blue-700',
  customer: 'bg-teal-100 text-teal-700',
  user: 'bg-purple-100 text-purple-700',
  branch: 'bg-amber-100 text-amber-700',
  loan_type: 'bg-indigo-100 text-indigo-700',
  settings: 'bg-gray-200 text-gray-700',
  installment: 'bg-orange-100 text-orange-700',
  fund_transaction: 'bg-emerald-100 text-emerald-700',
};

function entityBadge(type: string) {
  const cls = ENTITY_BADGE[type] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${cls}`}>
      {type.replace('_', ' ')}
    </span>
  );
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function ActivityLogPage() {
  const session = getTenantSession();
  const myRole = session?.user.role as UserRole | undefined;
  const canView = myRole && MANAGER_ROLES.includes(myRole);

  const [entries, setEntries] = useState<TenantActivityEntry[]>([]);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const LIMIT = 25;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  useEffect(() => { setPage(1); }, [debouncedSearch, actionFilter, entityFilter]);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    getTenantActivity({
      page, limit: LIMIT,
      search: debouncedSearch || undefined,
      action: actionFilter || undefined,
      entityType: entityFilter || undefined,
    })
      .then((r) => { setEntries(r.data); setTotal(r.total); setAvailableActions(r.availableActions); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load activity log'))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, actionFilter, entityFilter, canView]);

  if (!canView) {
    return (
      <div className="p-4 lg:p-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-gray-400 text-sm">You do not have permission to view the activity log.</p>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / LIMIT);
  const entityTypes = Array.from(new Set(availableActions.map((a) => a.split('.')[0])));
  const hasFilters = search || actionFilter || entityFilter;

  function clearFilters() {
    setSearch(''); setActionFilter(''); setEntityFilter('');
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Activity Log</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {loading ? 'Loading…' : `${total} action${total !== 1 ? 's' : ''} recorded`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search actor, item, or action…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-56 max-w-sm border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Types</option>
          {entityTypes.map((t) => (
            <option key={t} value={t} className="capitalize">{t.replace('_', ' ')}</option>
          ))}
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Actions</option>
          {availableActions.map((a) => (
            <option key={a} value={a}>{actionLabel(a)}</option>
          ))}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-gray-800 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
            Clear filters
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-400 mt-3">Loading activity…</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm">
              {hasFilters ? (
                <>No activity matches your filters. <button onClick={clearFilters} className="text-blue-600 hover:underline">Clear filters</button></>
              ) : (
                'No activity recorded yet.'
              )}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Item</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">By</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map((e) => (
                  <Fragment key={e.id}>
                    <tr
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => e.metadata && setExpanded(expanded === e.id ? null : e.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{actionLabel(e.action)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {entityBadge(e.entityType)}
                          <span className="text-gray-600 truncate max-w-[200px]">{e.entityLabel ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-700">{e.actorName}</p>
                        <p className="text-xs text-gray-400">{e.actorRole.replace('_', ' ')}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatWhen(e.createdAt)}</td>
                    </tr>
                    {expanded === e.id && e.metadata && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={4} className="px-4 py-3">
                          <pre className="text-xs text-gray-500 font-mono overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(e.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 font-medium disabled:opacity-40 hover:bg-gray-50"
            >Previous</button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 font-medium disabled:opacity-40 hover:bg-gray-50"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
