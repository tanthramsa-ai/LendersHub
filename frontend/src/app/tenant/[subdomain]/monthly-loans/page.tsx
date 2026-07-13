'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getMonthlyLoans, getBranches, MonthlyLoan, TenantBranch, getTenantSession, LOAN_ROLES } from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

const STATUS_COLORS: Record<string, string> = {
  DISBURSED: 'bg-green-100 text-green-700',
  PENDING:   'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  CLOSED:    'bg-slate-200 text-slate-800',
  DEFAULTED: 'bg-red-100 text-red-700',
};

const STATUS_FILTERS = ['', 'DISBURSED', 'CLOSED', 'DEFAULTED', 'PENDING'];

export default function MonthlyLoansPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;
  const session = getTenantSession();
  const canCreate = LOAN_ROLES.includes(session?.user.role ?? 'VIEWER');

  const [loans, setLoans] = useState<MonthlyLoan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loading, setLoading] = useState(true);

  const limit = 20;

  useEffect(() => { getBranches().then((b) => setBranches(b.filter((br) => br.isActive))); }, []);

  const load = useCallback(async (p: number, s: string, st: string, br: string) => {
    setLoading(true);
    try {
      const res = await getMonthlyLoans(p, limit, { search: s || undefined, status: st || undefined, branchId: br || undefined });
      setLoans(res.data);
      setTotal(res.total);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page, search, status, branchId); }, [page, search, status, branchId, load]);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Monthly Loans</h1>
          <p className="text-sm text-gray-500">{total} loan{total !== 1 ? 's' : ''} · Interest-only</p>
        </div>
        {canCreate && (
          <Link href={`/${subdomain}/monthly-loans/new`}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + New Monthly Loan
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput); }} className="flex gap-2 flex-1 min-w-0">
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by loan #, customer name or phone…"
            className="flex-1 min-w-0 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          <button type="submit" className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-lg whitespace-nowrap">Search</button>
          {search && <button type="button" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
            className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Clear</button>}
        </form>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s || 'All Status'}</option>)}
        </select>
        {branches.length > 0 && (
          <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : loans.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm mb-3">No monthly loans found</p>
            {canCreate && <Link href={`/${subdomain}/monthly-loans/new`} className="text-sm text-blue-600 hover:underline">Create first monthly loan</Link>}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {['Loan ID','Customer','Branch','Principal','Monthly Interest','I.Received','I.Outstanding','P.Outstanding','Months','Overdue','NPA','Status',''].map((h) => (
                      <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loans.map((l) => (
                    <tr key={l.id} className={`hover:bg-gray-50 transition-colors ${l.isNpa ? 'bg-red-50' : l.status === 'CLOSED' ? 'bg-slate-50' : ''}`}>
                      <td className="px-3 py-3">
                        <Link href={`/${subdomain}/monthly-loans/${l.id}`} className="text-blue-600 hover:underline font-mono">{l.loanNumber}</Link>
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/${subdomain}/customers/${l.customerId}`} className="font-medium text-gray-900 hover:text-blue-600 whitespace-nowrap">
                          {l.customerName}
                        </Link>
                        <div className="text-gray-400">{l.phone}</div>
                      </td>
                      <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{l.branchName || '—'}</td>
                      <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">{fmt(l.principal)}</td>
                      <td className="px-3 py-3 text-blue-700 font-medium whitespace-nowrap">{l.monthlyInterest ? fmt(l.monthlyInterest) : '—'}</td>
                      <td className="px-3 py-3 text-green-700 whitespace-nowrap">{fmt(l.interestReceived)}</td>
                      <td className="px-3 py-3 font-medium text-red-600 whitespace-nowrap">{fmt(l.interestOutstanding)}</td>
                      <td className="px-3 py-3 font-medium text-orange-700 whitespace-nowrap">{fmt(l.principalOutstanding)}</td>
                      <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{l.paidInstallments}/{l.totalInstallments}</td>
                      <td className="px-3 py-3">
                        {l.overdueCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">{l.overdueCount} OD</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {l.isNpa
                          ? <span className="px-1.5 py-0.5 bg-red-200 text-red-800 rounded text-xs font-bold">NPA</span>
                          : <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[l.status] ?? 'bg-gray-100 text-gray-500'}`}>{l.status}</span>
                      </td>
                      <td className="px-3 py-3">
                        <Link href={`/${subdomain}/monthly-loans/${l.id}`} className="text-xs text-blue-600 hover:underline whitespace-nowrap">View →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">Showing {(page-1)*limit+1}–{Math.min(page*limit,total)} of {total}</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page-1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button disabled={page*limit >= total} onClick={() => setPage(page+1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
