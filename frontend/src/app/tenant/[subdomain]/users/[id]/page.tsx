'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getTenantUser, getUserLoans, TenantTeamMemberDetail, Loan, ROLE_LABELS, UserRole,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';

const STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  DISBURSED: 'bg-indigo-100 text-indigo-700',
  CLOSED:    'bg-gray-100 text-gray-500',
  DEFAULTED: 'bg-red-100 text-red-700',
  REJECTED:  'bg-red-50 text-red-400',
};

type LoanStatusFilter = '' | 'APPROVED' | 'DISBURSED' | 'CLOSED' | 'DEFAULTED';

const LOAN_FILTERS: { label: string; value: LoanStatusFilter; color: string }[] = [
  { label: 'All', value: '', color: 'text-gray-700' },
  { label: 'Active', value: 'DISBURSED', color: 'text-green-700' },
  { label: 'Closed', value: 'CLOSED', color: 'text-gray-500' },
  { label: 'NPA / Defaulted', value: 'DEFAULTED', color: 'text-red-600' },
];

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function UserDetailPage() {
  const { subdomain, id } = useParams<{ subdomain: string; id: string }>();

  const [detail, setDetail]       = useState<TenantTeamMemberDetail | null>(null);
  const [loans, setLoans]         = useState<Loan[]>([]);
  const [loanTotal, setLoanTotal] = useState(0);
  const [loanPage, setLoanPage]   = useState(1);
  const [statusFilter, setStatusFilter] = useState<LoanStatusFilter>('');
  const [detailLoading, setDetailLoading] = useState(true);
  const [loansLoading, setLoansLoading]   = useState(true);

  const LOAN_LIMIT = 20;

  useEffect(() => {
    getTenantUser(id)
      .then(setDetail)
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  }, [id]);

  const loadLoans = useCallback(async (page: number, status: LoanStatusFilter) => {
    setLoansLoading(true);
    try {
      const res = await getUserLoans(id, page, LOAN_LIMIT, status || undefined);
      setLoans(res.data);
      setLoanTotal(res.total);
    } finally { setLoansLoading(false); }
  }, [id]);

  useEffect(() => { loadLoans(loanPage, statusFilter); }, [loadLoans, loanPage, statusFilter]);

  function changeFilter(f: LoanStatusFilter) { setStatusFilter(f); setLoanPage(1); }

  const loanPages = Math.ceil(loanTotal / LOAN_LIMIT);

  if (detailLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="p-6 text-center">
        <p className="text-gray-500">User not found.</p>
        <Link href={`/${subdomain}/users`} className="text-blue-600 text-sm hover:underline mt-2 block">Back to team</Link>
      </div>
    );
  }

  const { stats } = detail;

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/${subdomain}/users`} className="hover:text-blue-600 transition-colors">Team Members</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{detail.firstName} {detail.lastName}</span>
      </div>

      {/* User profile card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col sm:flex-row items-start gap-5">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0"
          style={{ backgroundColor: BRAND }}
        >
          {detail.firstName[0]}{detail.lastName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-gray-900">{detail.firstName} {detail.lastName}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${detail.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {detail.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500">
            <span>{ROLE_LABELS[detail.role as UserRole] ?? detail.role}</span>
            <span>{detail.email}</span>
            {detail.phone && <span>{detail.phone}</span>}
            {detail.branchName && (
              <span className="text-blue-600 font-medium">
                {detail.branchName} {detail.branchCode ? `(${detail.branchCode})` : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Active Loans"
          value={stats.activeLoans}
          sub={`₹${stats.activePrincipal.toLocaleString('en-IN')}`}
          color="text-green-700"
        />
        <StatCard label="Closed Loans" value={stats.closedLoans} color="text-gray-600" />
        <StatCard
          label="NPA"
          value={stats.npaLoans}
          sub={stats.npaPrincipal > 0 ? `₹${stats.npaPrincipal.toLocaleString('en-IN')}` : undefined}
          color={stats.npaLoans > 0 ? 'text-red-600' : 'text-gray-400'}
        />
        <StatCard label="Total Customers" value={stats.totalCustomers} />
        <StatCard label="Total Loans" value={stats.activeLoans + stats.closedLoans + stats.npaLoans} />
      </div>

      {/* Loans section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Associated Loans</h2>
          <p className="text-sm text-gray-400">{loanTotal} loans</p>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {LOAN_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => changeFilter(f.value)}
              className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                statusFilter === f.value
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {loansLoading ? (
            <div className="p-10 text-center">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : loans.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-gray-400">No loans found for this filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Loan #', 'Customer', 'Principal', 'Outstanding', 'Status', 'First Due', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loans.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/${subdomain}/loans/${l.id}`} className="font-mono text-blue-600 hover:underline text-xs">
                          {l.loanNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{l.customerName}</p>
                        <p className="text-xs text-gray-400">{l.customerPhone}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-700">₹{l.principal.toLocaleString('en-IN')}</td>
                      <td className="px-4 py-3">
                        <span className={l.outstanding > 0 ? 'text-orange-600 font-semibold' : 'text-gray-400'}>
                          ₹{l.outstanding.toLocaleString('en-IN')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_BADGE[l.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {l.status === 'DEFAULTED' ? 'NPA' : l.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {l.firstDueDate ? new Date(l.firstDueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/${subdomain}/loans/${l.id}`} className="text-xs text-blue-600 hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {loanPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {(loanPage - 1) * LOAN_LIMIT + 1}–{Math.min(loanPage * LOAN_LIMIT, loanTotal)} of {loanTotal}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setLoanPage((p) => Math.max(1, p - 1))} disabled={loanPage === 1}
                className="px-4 py-2 text-sm rounded-xl border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >Previous</button>
              <button
                onClick={() => setLoanPage((p) => Math.min(loanPages, p + 1))} disabled={loanPage === loanPages}
                className="px-4 py-2 text-sm rounded-xl border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
              >Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
