'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getDashboardStats, getRecentActivity, getActiveLoans, getMonthlyTrend,
  getTenantSession,
  DashboardStats, ActivityItem, ActiveLoan, MonthlyTrend,
  MANAGER_ROLES, LOAN_ROLES,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';
const ACCENT = '#FF6B35';

function fmtCurrency(n: number) {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMonth(m: string) {
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-IN', { month: 'short' });
}

const STATUS_COLORS: Record<string, string> = {
  DISBURSED: 'bg-green-100 text-green-700',
  PENDING:   'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  CLOSED:    'bg-gray-100 text-gray-500',
  DEFAULTED: 'bg-red-100 text-red-700',
  REJECTED:  'bg-red-100 text-red-600',
};

export default function TenantDashboardPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const session = getTenantSession();
  const userRole = session?.user.role ?? 'VIEWER';
  const userName = session ? `${session.user.firstName} ${session.user.lastName}`.trim() : '';

  const isManager = MANAGER_ROLES.includes(userRole);
  const canCreateLoan = LOAN_ROLES.includes(userRole);
  const isCollector = userRole === 'COLLECTOR';

  const [stats, setStats] = useState<DashboardStats & { roleView?: string } | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loans, setLoans] = useState<ActiveLoan[]>([]);
  const [loansTotal, setLoansTotal] = useState(0);
  const [loansPage, setLoansPage] = useState(1);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getDashboardStats(), getRecentActivity(), getActiveLoans(1, 10), getMonthlyTrend(12)])
      .then(([s, a, l, t]) => {
        setStats(s as DashboardStats & { roleView?: string });
        setActivity(a.activity);
        setLoans(l.data);
        setLoansTotal(l.total);
        setTrend(t);
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
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  // ── KPI configuration per role ───────────────────────────────────────────────
  const kpis = stats
    ? isCollector
      ? [
          {
            label: 'Assigned Loans',
            value: stats.activeLoans.toLocaleString(),
            sub: 'Pending collection',
            icon: <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
            bg: BRAND,
          },
          {
            label: "Today's Collection",
            value: fmtCurrency(stats.todaysCollection),
            sub: 'Collected by you today',
            icon: <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
            bg: '#10B981',
          },
          {
            label: 'Pending Amount',
            value: fmtCurrency(stats.pendingAmount),
            sub: `${stats.overdueInstallments} overdue`,
            icon: <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
            bg: '#EF4444',
          },
        ]
      : [
          {
            label: isManager ? 'Total Customers' : 'My Customers',
            value: stats.totalCustomers.toLocaleString(),
            sub: isManager ? 'Active borrowers' : 'Under your loans',
            icon: <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
            bg: BRAND,
          },
          {
            label: isManager ? 'Active Loans' : 'My Active Loans',
            value: stats.activeLoans.toLocaleString(),
            sub: `${stats.totalLoans} total`,
            icon: <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
            bg: '#10B981',
          },
          {
            label: "Today's Collection",
            value: fmtCurrency(stats.todaysCollection),
            sub: 'Cash + digital',
            icon: <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
            bg: ACCENT,
          },
          {
            label: 'Pending Amount',
            value: fmtCurrency(stats.pendingAmount),
            sub: `${stats.overdueInstallments} overdue EMIs`,
            icon: <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
            bg: '#EF4444',
          },
        ]
    : [];

  // ── Quick actions per role ────────────────────────────────────────────────────
  const quickActions = [
    canCreateLoan && { label: 'Add Customer', sub: 'Register new borrower', href: `/tenant/${subdomain}/customers/new`, icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>, color: BRAND },
    canCreateLoan && { label: 'New Loan', sub: 'Create loan application', href: `/tenant/${subdomain}/loans/new`, icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>, color: '#10B981' },
    { label: 'Collections', sub: isCollector ? 'My assigned dues' : 'Manage field agents', href: `/tenant/${subdomain}/collections`, icon: <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>, color: '#8B5CF6' },
  ].filter(Boolean) as { label: string; sub: string; href: string; icon: React.ReactNode; color: string }[];

  const loanTableTitle = isCollector
    ? 'My Assigned Loans'
    : isManager
      ? 'Recent Disbursed Loans'
      : 'My Disbursed Loans';

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {userName ? `Hello, ${userName.split(' ')[0]}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
          userRole === 'OWNER'        ? 'bg-yellow-100 text-yellow-700' :
          userRole === 'MANAGER'      ? 'bg-indigo-100 text-indigo-700' :
          userRole === 'ADMIN'        ? 'bg-purple-100 text-purple-700' :
          userRole === 'LOAN_OFFICER' ? 'bg-blue-100 text-blue-700' :
          userRole === 'COLLECTOR'    ? 'bg-orange-100 text-orange-700' :
          'bg-gray-100 text-gray-600'
        }`}>
          {userRole.replace('_', ' ')}
        </span>
      </div>

      {/* KPI Cards */}
      <div className={`grid gap-4 ${isCollector ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: k.bg }}>
                {k.icon}
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{k.value}</p>
            <p className="text-xs text-gray-500 font-medium mt-1">{k.label}</p>
            <p className="text-xs text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Chart + Activity row — hidden for collectors */}
      {!isCollector && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Collections Trend */}
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Collections Trend</h2>
                <p className="text-xs text-gray-400 mt-0.5">Monthly collection performance</p>
              </div>
            </div>
            {trend.length === 0 ? (
              <div className="flex items-center justify-center h-36">
                <p className="text-sm text-gray-400">No collection data yet</p>
              </div>
            ) : (
              <>
                <div className="flex items-end gap-1.5 h-36">
                  {trend.map((t, i) => {
                    const maxVal = Math.max(...trend.map((d) => d.collectedAmount), 1);
                    return (
                      <div key={t.month} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t-sm transition-all min-h-[2px]"
                          style={{ height: `${(t.collectedAmount / maxVal) * 100}%`, backgroundColor: i === trend.length - 1 ? ACCENT : `${BRAND}66` }}
                          title={fmtCurrency(t.collectedAmount)}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-1.5 mt-1">
                  {trend.map((t) => (
                    <div key={t.month} className="flex-1 text-center text-xs text-gray-400 truncate">{fmtMonth(t.month)}</div>
                  ))}
                </div>
              </>
            )}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-400">Today</p>
                <p className="text-lg font-bold" style={{ color: ACCENT }}>{fmtCurrency(stats?.todaysCollection ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Pending</p>
                <p className="text-lg font-bold text-gray-900">{fmtCurrency(stats?.pendingAmount ?? 0)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Overdue EMIs</p>
                <p className="text-lg font-bold text-red-600">{stats?.overdueInstallments ?? 0}</p>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Recent Activity</h2>
              <span className="text-xs text-gray-400">{activity.length} events</span>
            </div>
            {activity.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-gray-400">No activity yet</p>
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto">
                {activity.map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className="mt-0.5 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: a.type === 'loan' ? `${BRAND}20` : '#10B98120' }}>
                      {a.type === 'loan' ? (
                        <svg className="w-4 h-4" style={{ color: BRAND }} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{a.customerName}</p>
                      <p className="text-xs text-gray-500">
                        {a.type === 'loan' ? `New loan ${a.loanNumber} · ${fmtCurrency(a.amount)}` : `Payment received · ${fmtCurrency(a.amount)}`}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{fmtDate(a.createdAt)}</p>
                    </div>
                    {a.status && (
                      <span className={`ml-auto flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {a.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <Link href={`/tenant/${subdomain}/activity`} className="text-xs font-medium flex items-center justify-center gap-1" style={{ color: BRAND }}>
                View all activity
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Loans Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{loanTableTitle}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {loansTotal} loan{loansTotal !== 1 ? 's' : ''} · sorted by disbursement date
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={`/tenant/${subdomain}/loans`} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              View all
            </Link>
            {canCreateLoan && (
              <Link href={`/tenant/${subdomain}/loans/new`} className="text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-colors" style={{ backgroundColor: BRAND }}>
                + New Loan
              </Link>
            )}
          </div>
        </div>

        {loans.length === 0 ? (
          <div className="px-5 py-12 text-center text-gray-400 text-sm">
            {isCollector
              ? 'No loans assigned to you yet.'
              : canCreateLoan
                ? <>No disbursed loans yet. <Link href={`/tenant/${subdomain}/loans/new`} className="hover:underline" style={{ color: BRAND }}>Create the first one</Link></>
                : 'No disbursed loans found.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Customer', 'Loan #', 'Principal', 'Outstanding', 'Disbursed', 'Status', 'Action'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loans.map((loan) => (
                    <tr key={loan.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: BRAND }}>
                            {loan.customerName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 whitespace-nowrap">{loan.customerName}</p>
                            <p className="text-xs text-gray-400">{loan.customerPhone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/tenant/${subdomain}/loans/${loan.id}`} className="font-medium hover:underline whitespace-nowrap" style={{ color: BRAND }}>
                          {loan.loanNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{fmtCurrency(loan.principal)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`font-semibold ${loan.outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {fmtCurrency(loan.outstanding)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(loan.disbursedAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${STATUS_COLORS[loan.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {loan.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link href={`/tenant/${subdomain}/loans/${loan.id}`} className="text-xs font-medium px-2.5 py-1 rounded-lg border hover:bg-gray-50 text-gray-600 whitespace-nowrap transition-colors">
                            View
                          </Link>
                          <Link href={`/tenant/${subdomain}/loans/${loan.id}`} className="text-xs font-medium px-2.5 py-1 rounded-lg text-white whitespace-nowrap transition-colors" style={{ backgroundColor: ACCENT }}>
                            Collect
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {loansTotal > 10 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500">Showing {loans.length} of {loansTotal}</p>
                <div className="flex gap-2">
                  <button disabled={loansPage <= 1} onClick={() => loadMoreLoans(loansPage - 1)} className="px-3 py-1 text-xs border rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">Previous</button>
                  <button disabled={loansPage * 10 >= loansTotal} onClick={() => loadMoreLoans(loansPage + 1)} className="px-3 py-1 text-xs border rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Actions */}
      <div className={`grid gap-4 grid-cols-2 ${
        quickActions.length === 1 ? 'lg:grid-cols-1' :
        quickActions.length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'
      }`}>
        {quickActions.map((a) => (
          <Link key={a.href} href={a.href} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-shadow flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${a.color}15` }}>
              <span style={{ color: a.color }}>{a.icon}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{a.label}</p>
              <p className="text-xs text-gray-400 truncate">{a.sub}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
