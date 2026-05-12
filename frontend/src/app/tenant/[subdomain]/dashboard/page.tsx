'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getDashboardStats, getRecentActivity, getActiveLoans,
  DashboardStats, ActivityItem, ActiveLoan,
} from '@/services/tenant-api';

function fmtCurrency(n: number) {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
  DISBURSED: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  CLOSED: 'bg-gray-100 text-gray-500',
  DEFAULTED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-600',
};

export default function TenantDashboardPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loans, setLoans] = useState<ActiveLoan[]>([]);
  const [loansTotal, setLoansTotal] = useState(0);
  const [loansPage, setLoansPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getDashboardStats(), getRecentActivity(), getActiveLoans(1, 10)])
      .then(([s, a, l]) => {
        setStats(s);
        setActivity(a.activity);
        setLoans(l.data);
        setLoansTotal(l.total);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function loadMoreLoans(page: number) {
    const l = await getActiveLoans(page, 10);
    setLoans(l.data);
    setLoansPage(page);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400 text-sm">Loading dashboard…</div>
      </div>
    );
  }

  const kpis = stats
    ? [
        { label: 'Total Customers', value: stats.totalCustomers.toLocaleString(), sub: 'Active borrowers', color: 'bg-blue-500', icon: '👥' },
        { label: 'Active Loans', value: stats.activeLoans.toLocaleString(), sub: `${stats.totalLoans} total`, color: 'bg-green-500', icon: '💰' },
        { label: "Today's Collection", value: fmtCurrency(stats.todaysCollection), sub: 'Cash + digital', color: 'bg-amber-500', icon: '📈' },
        { label: 'Pending Amount', value: fmtCurrency(stats.pendingAmount), sub: `${stats.overdueInstallments} overdue EMIs`, color: 'bg-red-500', icon: '⚠' },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <Link
          href={`/tenant/${subdomain}/loans/new`}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          + New Loan
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-start justify-between mb-3">
              <span className="text-gray-500 text-sm font-medium">{k.label}</span>
              <div className={`w-9 h-9 rounded-lg ${k.color} flex items-center justify-center text-white text-base`}>
                {k.icon}
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{k.value}</p>
            <p className="text-xs text-gray-400 mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Activity</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No activity yet</p>
          ) : (
            <div className="space-y-3">
              {activity.map((a) => (
                <div key={a.id} className="flex items-start gap-3">
                  <div className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${a.type === 'loan' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                    {a.type === 'loan' ? '💰' : '✓'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 font-medium truncate">{a.customerName}</p>
                    <p className="text-xs text-gray-500">
                      {a.type === 'loan'
                        ? `New loan ${a.loanNumber} — ${fmtCurrency(a.amount)}`
                        : `Payment received — ${fmtCurrency(a.amount)}`}
                    </p>
                    <p className="text-xs text-gray-400">{fmtDate(a.createdAt)}</p>
                  </div>
                  {a.status && (
                    <span className={`ml-auto flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {a.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {[
              { label: 'Add New Customer', href: `/tenant/${subdomain}/customers/new`, icon: '👤', color: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
              { label: 'Create Loan Application', href: `/tenant/${subdomain}/loans/new`, icon: '📄', color: 'bg-green-50 text-green-700 hover:bg-green-100' },
              { label: 'Record Payment', href: `/tenant/${subdomain}/payments`, icon: '💳', color: 'bg-amber-50 text-amber-700 hover:bg-amber-100' },
              { label: 'View Collections', href: `/tenant/${subdomain}/collections`, icon: '🗂', color: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
            ].map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${a.color}`}
              >
                <span>{a.icon}</span>
                {a.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Stats summary */}
        {stats && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Portfolio Health</h2>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Active Loans</span>
                  <span>{stats.totalLoans > 0 ? Math.round((stats.activeLoans / stats.totalLoans) * 100) : 0}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${stats.totalLoans > 0 ? (stats.activeLoans / stats.totalLoans) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Overdue Installments</span>
                  <span>{stats.overdueInstallments}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full"
                    style={{ width: `${Math.min(stats.overdueInstallments * 5, 100)}%` }}
                  />
                </div>
              </div>
              <div className="pt-2 border-t border-gray-100 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Customers</span>
                  <span className="font-semibold text-gray-900">{stats.totalCustomers}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Pending Dues</span>
                  <span className="font-semibold text-red-600">{fmtCurrency(stats.pendingAmount)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Collected Today</span>
                  <span className="font-semibold text-green-600">{fmtCurrency(stats.todaysCollection)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active Loans Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Active Loans</h2>
          <Link href={`/tenant/${subdomain}/loans`} className="text-sm text-blue-600 hover:underline">
            View all
          </Link>
        </div>

        {loans.length === 0 ? (
          <div className="px-5 py-12 text-center text-gray-400 text-sm">
            No active loans yet.{' '}
            <Link href={`/tenant/${subdomain}/loans/new`} className="text-blue-600 hover:underline">
              Create the first one
            </Link>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Loan #', 'Customer', 'Principal', 'Outstanding', 'Status', 'Due Date'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loans.map((loan) => (
                    <tr key={loan.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/tenant/${subdomain}/loans/${loan.id}`} className="text-blue-600 hover:underline font-medium">
                          {loan.loanNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{loan.customerName}</p>
                        <p className="text-xs text-gray-400">{loan.customerPhone}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-900">{fmtCurrency(loan.principal)}</td>
                      <td className="px-4 py-3">
                        <span className={loan.outstanding > 0 ? 'text-red-600 font-medium' : 'text-green-600'}>
                          {fmtCurrency(loan.outstanding)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[loan.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {loan.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(loan.firstDueDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {loansTotal > 10 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500">Showing {loans.length} of {loansTotal}</p>
                <div className="flex gap-2">
                  <button
                    disabled={loansPage <= 1}
                    onClick={() => loadMoreLoans(loansPage - 1)}
                    className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    disabled={loansPage * 10 >= loansTotal}
                    onClick={() => loadMoreLoans(loansPage + 1)}
                    className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
