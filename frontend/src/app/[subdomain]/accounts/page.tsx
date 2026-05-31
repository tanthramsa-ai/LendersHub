'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getAccountsSummary, getMonthlyTrend, getTopBorrowers, AccountsSummary, MonthlyTrend, TopBorrower } from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtShort(n: number) {
  if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
}

function fmtMonth(m: string) {
  const [y, mo] = m.split('-');
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  DISBURSED: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  CLOSED: 'bg-gray-100 text-gray-500',
  DEFAULTED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-600',
};

function BarChart({ data }: { data: MonthlyTrend[] }) {
  if (!data.length) return null;
  const maxVal = Math.max(...data.map((d) => Math.max(d.disbursedAmount, d.collectedAmount)), 1);

  return (
    <div className="flex items-end gap-3 h-40 pt-4">
      {data.map((d) => (
        <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex gap-0.5 items-end h-32">
            <div
              className="flex-1 rounded-t bg-blue-400 min-h-[2px]"
              style={{ height: `${(d.disbursedAmount / maxVal) * 100}%` }}
              title={`Disbursed: ${fmt(d.disbursedAmount)}`}
            />
            <div
              className="flex-1 rounded-t bg-green-400 min-h-[2px]"
              style={{ height: `${(d.collectedAmount / maxVal) * 100}%` }}
              title={`Collected: ${fmt(d.collectedAmount)}`}
            />
          </div>
          <span className="text-xs text-gray-400">{fmtMonth(d.month)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AccountsPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const [summary, setSummary] = useState<AccountsSummary | null>(null);
  const [trend, setTrend] = useState<MonthlyTrend[]>([]);
  const [borrowers, setBorrowers] = useState<TopBorrower[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      getAccountsSummary(),
      getMonthlyTrend(6),
      getTopBorrowers(10),
    ])
      .then(([s, t, b]) => { setSummary(s); setTrend(t); setBorrowers(b); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex justify-center items-center h-64">
        <div className="text-gray-400 text-sm">Loading accounts summary…</div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error || 'Failed to load accounts data'}
        </div>
      </div>
    );
  }

  const collectionRate = summary.totalPrincipalDisbursed > 0
    ? ((summary.totalCollected / summary.totalPrincipalDisbursed) * 100).toFixed(1)
    : '0';

  const monthlyGrowth = trend.length >= 2
    ? trend[trend.length - 1].collectedAmount - trend[trend.length - 2].collectedAmount
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Accounts</h1>
        <p className="text-sm text-gray-500">Financial overview and portfolio health</p>
      </div>

      {/* KPI row 1 — Portfolio */}
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Portfolio</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Loans" value={summary.totalLoans.toString()} sub={`${summary.activeLoans} active`} />
          <StatCard label="Principal Disbursed" value={fmtShort(summary.totalPrincipalDisbursed)} sub={`${fmtShort(summary.activePrincipal)} active`} color="text-blue-700" />
          <StatCard label="Total Collected" value={fmtShort(summary.totalCollected)} sub={`${collectionRate}% recovery`} color="text-green-700" />
          <StatCard label="Outstanding Balance" value={fmtShort(summary.outstandingBalance)} sub={`${summary.overdueCount} overdue installments`} color={summary.outstandingBalance > 0 ? 'text-red-600' : 'text-green-600'} />
        </div>
      </div>

      {/* KPI row 2 — Collections */}
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Collections</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="This Month" value={fmtShort(summary.thisMonthCollected)} color="text-green-700" />
          <StatCard label="Last Month" value={fmtShort(summary.lastMonthCollected)} />
          <StatCard
            label="Month-on-Month"
            value={`${monthlyGrowth >= 0 ? '+' : ''}${fmtShort(monthlyGrowth)}`}
            color={monthlyGrowth >= 0 ? 'text-green-600' : 'text-red-600'}
          />
          <StatCard label="Overdue Amount" value={fmtShort(summary.overdueAmount)} color="text-red-600" sub={`${summary.overdueCount} installments`} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly trend chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-700">Monthly Trend (6 months)</h2>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-400 inline-block" /> Disbursed</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-400 inline-block" /> Collected</span>
            </div>
          </div>
          {trend.length > 0 ? (
            <>
              <BarChart data={trend} />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400">
                      <th className="text-left py-1 pr-3">Month</th>
                      <th className="text-right py-1 px-2">Loans</th>
                      <th className="text-right py-1 px-2">Disbursed</th>
                      <th className="text-right py-1 px-2">Collected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...trend].reverse().map((d) => (
                      <tr key={d.month}>
                        <td className="py-1.5 pr-3 text-gray-600">{fmtMonth(d.month)}</td>
                        <td className="py-1.5 px-2 text-right text-gray-500">{d.disbursedCount}</td>
                        <td className="py-1.5 px-2 text-right text-blue-600">{fmtShort(d.disbursedAmount)}</td>
                        <td className="py-1.5 px-2 text-right text-green-600">{fmtShort(d.collectedAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-gray-400 text-sm">No trend data yet</div>
          )}
        </div>

        {/* Loans by status */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Loans by Status</h2>
          {summary.loansByStatus.length === 0 ? (
            <div className="py-6 text-center text-gray-400 text-sm">No data</div>
          ) : (
            <div className="space-y-3">
              {summary.loansByStatus.map((s) => {
                const pct = summary.totalLoans > 0 ? (s.count / summary.totalLoans) * 100 : 0;
                return (
                  <div key={s.status}>
                    <div className="flex justify-between items-center mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {s.status}
                      </span>
                      <span className="text-xs text-gray-500">{s.count} · {fmtShort(s.principal)}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-blue-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top borrowers by outstanding */}
      {borrowers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Top Borrowers by Outstanding</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Customer', 'Phone', 'Loans', 'Active Principal', 'Outstanding'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {borrowers.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/tenant/${subdomain}/customers/${b.id}`} className="text-blue-600 hover:underline font-medium">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{b.phone}</td>
                    <td className="px-4 py-3 text-gray-700">{b.loanCount}</td>
                    <td className="px-4 py-3 text-blue-700 font-medium">{fmt(b.activePrincipal)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-bold ${b.outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {fmt(b.outstanding)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
