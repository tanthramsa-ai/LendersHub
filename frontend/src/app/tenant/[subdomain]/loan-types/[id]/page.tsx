'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getLoanType, getLoanTypeLoans, getLoanTypeCustomers, LoanType,
} from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
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

type Tab = 'loans' | 'customers';

export default function LoanTypeDetailPage() {
  const params = useParams<{ subdomain: string; id: string }>();
  const { subdomain, id } = params;
  const searchParams = useSearchParams();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>((searchParams.get('tab') as Tab) ?? 'loans');
  const [loanType, setLoanType] = useState<LoanType | null>(null);
  const [ltLoading, setLtLoading] = useState(true);
  const [error, setError] = useState('');

  // Loans tab state
  const [loans, setLoans] = useState<Array<{
    id: string; loanNumber: string; principal: number; interestRate: number;
    termMonths: number; status: string; disbursedAt: string | null; createdAt: string;
    customerId: string; customerName: string; phone: string;
  }>>([]);
  const [loansTotal, setLoansTotal] = useState(0);
  const [loansPage, setLoansPage] = useState(1);
  const [loansSearch, setLoansSearch] = useState('');
  const [loansSearchInput, setLoansSearchInput] = useState('');
  const [loansLoading, setLoansLoading] = useState(false);

  // Customers tab state
  const [customers, setCustomers] = useState<Array<{
    id: string; customerCode: string; name: string; phone: string;
    loanCount: number; activePrincipal: number;
  }>>([]);
  const [custTotal, setCustTotal] = useState(0);
  const [custPage, setCustPage] = useState(1);
  const [custSearch, setCustSearch] = useState('');
  const [custSearchInput, setCustSearchInput] = useState('');
  const [custLoading, setCustLoading] = useState(false);

  const limit = 20;

  useEffect(() => {
    getLoanType(id)
      .then(setLoanType)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLtLoading(false));
  }, [id]);

  const loadLoans = useCallback(async (p: number, s: string) => {
    setLoansLoading(true);
    try {
      const res = await getLoanTypeLoans(id, p, limit, s || undefined);
      setLoans(res.data);
      setLoansTotal(res.total);
    } finally {
      setLoansLoading(false);
    }
  }, [id]);

  const loadCustomers = useCallback(async (p: number, s: string) => {
    setCustLoading(true);
    try {
      const res = await getLoanTypeCustomers(id, p, limit, s || undefined);
      setCustomers(res.data);
      setCustTotal(res.total);
    } finally {
      setCustLoading(false);
    }
  }, [id]);

  useEffect(() => { loadLoans(loansPage, loansSearch); }, [loansPage, loansSearch, loadLoans]);
  useEffect(() => { loadCustomers(custPage, custSearch); }, [custPage, custSearch, loadCustomers]);

  function switchTab(t: Tab) {
    setTab(t);
    router.replace(`/${subdomain}/loan-types/${id}?tab=${t}`, { scroll: false });
  }

  if (ltLoading) {
    return <div className="p-6 flex justify-center items-center h-64"><div className="text-gray-400 text-sm">Loading…</div></div>;
  }

  if (error || !loanType) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error || 'Loan type not found'}</div>
        <Link href={`/${subdomain}/loan-types`} className="mt-4 inline-block text-sm text-blue-600 hover:underline">← Back</Link>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link href={`/${subdomain}/loan-types`} className="text-sm text-blue-600 hover:underline">← Back to Loan Types</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-xl font-bold text-gray-900">{loanType.name}</h1>
          <span className={`px-2.5 py-0.5 rounded text-xs font-semibold ${loanType.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {loanType.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        {loanType.description && <p className="text-sm text-gray-500 mt-0.5">{loanType.description}</p>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Loans', value: loanType.loanCount ?? 0, color: 'text-blue-700' },
          { label: 'Total Customers', value: loanType.customerCount ?? 0, color: 'text-purple-700' },
          { label: 'Active Principal', value: fmt(loanType.activePrincipal ?? 0), color: 'text-green-700' },
          {
            label: 'Amount Range',
            value: loanType.minAmount != null || loanType.maxAmount != null
              ? `${loanType.minAmount != null ? fmt(loanType.minAmount) : '—'} – ${loanType.maxAmount != null ? fmt(loanType.maxAmount) : '—'}`
              : 'No limit',
            color: 'text-gray-800',
          },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-0">
          {([
            { key: 'loans', label: `Loans (${loansTotal})` },
            { key: 'customers', label: `Customers (${custTotal})` },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loans Tab */}
      {tab === 'loans' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => { e.preventDefault(); setLoansPage(1); setLoansSearch(loansSearchInput); }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={loansSearchInput}
              onChange={(e) => setLoansSearchInput(e.target.value)}
              placeholder="Search by loan number, customer name or phone…"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button type="submit" className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-lg">Search</button>
            {loansSearch && (
              <button type="button" onClick={() => { setLoansSearchInput(''); setLoansSearch(''); setLoansPage(1); }}
                className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Clear</button>
            )}
          </form>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {loansLoading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : loans.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">No loans found</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Loan #', 'Customer', 'Phone', 'Principal', 'Rate', 'Term', 'Status', 'Disbursed'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loans.map((l) => (
                        <tr key={l.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <Link href={`/${subdomain}/loans/${l.id}`} className="text-blue-600 hover:underline font-mono text-xs">{l.loanNumber}</Link>
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                            <Link href={`/${subdomain}/customers/${l.customerId}`} className="hover:text-blue-600 hover:underline">{l.customerName}</Link>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{l.phone}</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{fmt(l.principal)}</td>
                          <td className="px-4 py-3 text-gray-500">{l.interestRate}%</td>
                          <td className="px-4 py-3 text-gray-500">{l.termMonths}m</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[l.status] ?? 'bg-gray-100 text-gray-500'}`}>{l.status}</span>
                          </td>
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtDate(l.disbursedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    Showing {(loansPage - 1) * limit + 1}–{Math.min(loansPage * limit, loansTotal)} of {loansTotal}
                  </p>
                  <div className="flex gap-2">
                    <button disabled={loansPage <= 1} onClick={() => setLoansPage(loansPage - 1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
                    <button disabled={loansPage * limit >= loansTotal} onClick={() => setLoansPage(loansPage + 1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Customers Tab */}
      {tab === 'customers' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => { e.preventDefault(); setCustPage(1); setCustSearch(custSearchInput); }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={custSearchInput}
              onChange={(e) => setCustSearchInput(e.target.value)}
              placeholder="Search by name, phone or customer code…"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
            <button type="submit" className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-lg">Search</button>
            {custSearch && (
              <button type="button" onClick={() => { setCustSearchInput(''); setCustSearch(''); setCustPage(1); }}
                className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Clear</button>
            )}
          </form>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {custLoading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : customers.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">No customers found</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Code', 'Name', 'Phone', 'Loans', 'Active Principal'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {customers.map((c) => (
                        <tr key={c.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <Link href={`/${subdomain}/customers/${c.id}`} className="text-blue-600 hover:underline font-mono text-xs">{c.customerCode}</Link>
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900">
                            <Link href={`/${subdomain}/customers/${c.id}`} className="hover:text-blue-600 hover:underline">{c.name}</Link>
                          </td>
                          <td className="px-4 py-3 text-gray-500">{c.phone}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">{c.loanCount}</span>
                          </td>
                          <td className="px-4 py-3 font-medium text-green-700">{c.activePrincipal > 0 ? fmt(c.activePrincipal) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    Showing {(custPage - 1) * limit + 1}–{Math.min(custPage * limit, custTotal)} of {custTotal}
                  </p>
                  <div className="flex gap-2">
                    <button disabled={custPage <= 1} onClick={() => setCustPage(custPage - 1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
                    <button disabled={custPage * limit >= custTotal} onClick={() => setCustPage(custPage + 1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
