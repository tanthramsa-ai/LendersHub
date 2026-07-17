'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCustomers, getBranches, Customer, TenantBranch, getTenantSession, CUSTOMER_ROLES } from '@/services/tenant-api';

export default function CustomersPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;
  const router = useRouter();
  const session = getTenantSession();
  const canAddCustomer = CUSTOMER_ROLES.includes(session?.user.role ?? 'VIEWER');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loading, setLoading] = useState(true);

  const limit = 20;

  useEffect(() => {
    getBranches().then((b) => setBranches(b.filter((br) => br.isActive)));
  }, []);

  const load = useCallback(async (p: number, s: string, b: string) => {
    setLoading(true);
    try {
      const res = await getCustomers(p, limit, s || undefined, b || undefined);
      setCustomers(res.data);
      setTotal(res.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search, branchId);
  }, [page, search, branchId, load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500">{total} total records</p>
        </div>
        {canAddCustomer && (
          <Link
            href={`/${subdomain}/customers/new`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Add Customer
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-0">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, phone, or code…"
            className="flex-1 min-w-0 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
              className="px-3 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </form>

        {branches.length > 0 && (
          <select
            value={branchId}
            onChange={(e) => { setBranchId(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All Branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm mb-3">No customers found</p>
            {canAddCustomer && (
              <Link href={`/${subdomain}/customers/new`} className="text-sm text-blue-600 hover:underline">
                Add your first customer
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Name', 'Phone', 'Locality', 'PAN', 'Active Loans', 'Closed Loans', 'Branch', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {customers.map((c) => (
                    <tr
                      key={c.id}
                      onDoubleClick={() => router.push(`/${subdomain}/customers/${c.id}`)}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      title="Double-click to open"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {c.firstName} {c.lastName}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{c.phone}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{c.locality || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.panNumber ?? '—'}</td>
                      <td className="px-4 py-3">
                        {c.activeLoans > 0 ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                            {c.activeLoans}
                          </span>
                        ) : <span className="text-gray-400 text-xs">0</span>}
                      </td>
                      <td className="px-4 py-3">
                        {c.closedLoans > 0 ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                            {c.closedLoans}
                          </span>
                        ) : <span className="text-gray-400 text-xs">0</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {c.branchName || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {c.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button disabled={page * limit >= total} onClick={() => setPage(page + 1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
