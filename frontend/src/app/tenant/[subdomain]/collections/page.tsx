'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getCollectionReminder, getPendingCollections, getTenantSession,
  CollectionItem, CollectionPeriod, COLLECTION_PERIODS,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';
const ACCENT = '#FF6B35';

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** Collection Reminder / Pending Collections list — same shape, different source. */
function CollectionList({
  title, subtitle, items, total, totalAmount, loading, error, accent, subdomain, emptyText,
}: {
  title: string; subtitle: string; items: CollectionItem[]; total: number; totalAmount: number;
  loading: boolean; error: string | null; accent: string; subdomain: string; emptyText: string;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-lg font-bold" style={{ color: accent }}>{fmtCurrency(totalAmount)}</p>
          <p className="text-xs text-gray-400">{total} installment{total !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {loading ? (
        <p className="px-5 py-10 text-center text-sm text-gray-400">Loading…</p>
      ) : error ? (
        <p className="px-5 py-10 text-center text-sm text-red-600">{error}</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-gray-400">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {items.map((i) => (
            <li key={i.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors">
              <div className="min-w-0">
                <Link
                  href={`/tenant/${subdomain}/loans/${i.loanId}`}
                  className="font-medium text-sm text-gray-900 hover:underline truncate block"
                >
                  {i.customerName}
                </Link>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {i.loanNumber} · #{i.installmentNumber} · due {fmtDate(i.dueDate)}
                  {i.agentName ? ` · ${i.agentName}` : ''}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-gray-900">{fmtCurrency(i.balance)}</p>
                {i.status === 'OVERDUE' ? (
                  <span className="text-xs font-semibold text-red-600">
                    {i.daysOverdue ? `${i.daysOverdue}d overdue` : 'Overdue'}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">{i.status === 'PARTIALLY_PAID' ? 'Partial' : 'Pending'}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && total > items.length && (
        <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-50">
          Showing {items.length} of {total}
        </p>
      )}
    </div>
  );
}

export default function CollectionsPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const session = getTenantSession();
  const isAgent = (session?.user.role ?? '') === 'AGENT';

  const [period, setPeriod] = useState<CollectionPeriod>('D');
  const [reminder, setReminder] = useState<{ data: CollectionItem[]; total: number; totalAmount: number }>({ data: [], total: 0, totalAmount: 0 });
  const [pending, setPending] = useState<{ data: CollectionItem[]; total: number; totalAmount: number }>({ data: [], total: 0, totalAmount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `cancelled` guards against a slower earlier period landing after a newer one.
    let cancelled = false;
    // Sequential rather than Promise.all: both hit the same tenant pool and the
    // lists are small, so serialising keeps connection pressure predictable.
    getCollectionReminder(period, 1, 10)
      .then(async (r) => ({ r, q: await getPendingCollections(period, 1, 10) }))
      .then(({ r, q }) => {
        if (cancelled) return;
        setReminder({ data: r.data, total: r.total, totalAmount: r.totalAmount });
        setPending({ data: q.data, total: q.total, totalAmount: q.totalAmount });
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load collections');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [period]);

  function selectPeriod(p: CollectionPeriod) {
    if (p === period) return;
    setLoading(true);
    setPeriod(p);
  }

  const scopeNote = isAgent ? 'your assigned collections' : 'all users';
  const windowNote = period === 'D' ? 'today' : period === 'W' ? 'the next 7 days' : 'the next 30 days';

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Collections</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage field agent collections and track dues</p>
        </div>

        {/* Day / Week / Month selector — drives both lists below */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl" role="group" aria-label="Collection period">
          {COLLECTION_PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => selectPeriod(p.key)}
              aria-pressed={period === p.key}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                period === p.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <CollectionList
          title="Collection Reminder"
          subtitle={`Falling due ${windowNote} · ${scopeNote}`}
          items={reminder.data} total={reminder.total} totalAmount={reminder.totalAmount}
          loading={loading} error={error} accent={BRAND} subdomain={subdomain}
          emptyText="Nothing due in this period."
        />
        <CollectionList
          title="Pending Collections"
          subtitle={`Outstanding through ${windowNote} · ${scopeNote}`}
          items={pending.data} total={pending.total} totalAmount={pending.totalAmount}
          loading={loading} error={error} accent={ACCENT} subdomain={subdomain}
          emptyText="No pending collections in this period."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Agent Dashboard Card */}
        <Link
          href={`/tenant/${subdomain}/collections/agent`}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow group"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `linear-gradient(135deg, ${BRAND}, #1a6fc4)` }}>
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900 group-hover:text-blue-700 transition-colors">Agent Mobile Dashboard</h2>
              <p className="text-sm text-gray-500 mt-1">Field collection tool with route planning, target tracking, and on-the-go payment recording</p>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs font-semibold px-2.5 py-1 bg-green-100 text-green-700 rounded-full">6 Today</span>
                <span className="text-xs font-semibold px-2.5 py-1 bg-red-100 text-red-700 rounded-full">2 Overdue</span>
                <span className="text-xs font-semibold px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full">North Zone</span>
              </div>
            </div>
            <svg className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>

        {/* Overdue Report Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#FEF3F2' }}>
              <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900">Overdue Report</h2>
              <p className="text-sm text-gray-500 mt-1">View all overdue EMIs and prioritize collection efforts across your loan portfolio</p>
              <div className="mt-3">
                <span className="text-xs text-gray-400">Coming soon</span>
              </div>
            </div>
          </div>
        </div>

        {/* Collection Calendar */}
        <Link
          href={`/tenant/${subdomain}/collections/calendar`}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow group"
        >
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${ACCENT}15` }}>
              <svg className="w-7 h-7" style={{ color: ACCENT }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900 group-hover:text-blue-700 transition-colors">Collection Calendar</h2>
              <p className="text-sm text-gray-500 mt-1">See daily due amounts, overdues and collections in a month view</p>
            </div>
            <svg className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </Link>

        {/* Performance Analytics */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#F0FDF4' }}>
              <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="font-bold text-gray-900">Agent Performance</h2>
              <p className="text-sm text-gray-500 mt-1">Track collection efficiency, success rates, and agent-wise performance metrics</p>
              <div className="mt-3">
                <span className="text-xs text-gray-400">Coming soon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
