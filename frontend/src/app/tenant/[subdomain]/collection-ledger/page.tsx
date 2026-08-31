'use client';

import { useEffect, useState, useCallback } from 'react';
import { listLedgerTransactions, LedgerLineDetailed } from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_STYLES: Record<string, string> = {
  POSTED: 'bg-gray-100 text-gray-600',
  RECONCILED: 'bg-green-100 text-green-700',
  REVERSED: 'bg-red-100 text-red-600',
  PENDING: 'bg-yellow-100 text-yellow-700',
};

const STATUS_OPTIONS = ['', 'POSTED', 'RECONCILED', 'REVERSED', 'PENDING'];

const PAGE_SIZE = 50;

/**
 * Collection Ledger (requirements doc §5.4) — every COLLECTION transaction with
 * its date/time, loan, borrower, agent, channel, external reference, the
 * principal/interest/fee split, status, and receipt number.
 */
export default function CollectionLedgerPage() {
  const [rows, setRows] = useState<LedgerLineDetailed[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const r = await listLedgerTransactions(
        { type: 'COLLECTION', status: status || undefined, from: from || undefined, to: to || undefined },
        page, PAGE_SIZE,
      );
      setRows(r.data);
      setTotal(r.total);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load collection ledger');
    } finally { setLoading(false); }
  }, [page, status, from, to]);

  useEffect(() => { setPage(1); }, [status, from, to]);
  useEffect(() => { load(); }, [load]);

  const pageTotal = rows.reduce((s, r) => s + r.totalAmount, 0);
  const pagePrincipal = rows.reduce((s, r) => s + r.principalAmount, 0);
  const pageInterest = rows.reduce((s, r) => s + r.interestAmount, 0);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Collection Ledger</h1>
        <p className="text-sm text-gray-500">Every collection posted to the ledger — principal, interest and fee split per transaction</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-green-50 border border-green-100 rounded-xl p-4">
          <p className="text-xs text-green-600">Total (this page)</p>
          <p className="text-xl font-bold text-green-700 mt-1">{fmt(pageTotal)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-500">Principal (this page)</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmt(pagePrincipal)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-500">Interest (this page)</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmt(pageInterest)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {(status || from || to) && (
          <button onClick={() => { setStatus(''); setFrom(''); setTo(''); }}
            className="px-3 py-2 text-sm text-blue-600 hover:underline">Clear filters</button>
        )}
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No collections found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    {['Date & Time', 'Loan', 'Borrower', 'Agent', 'Channel', 'Reference', 'Total', 'Principal', 'Interest', 'Fee', 'Receipt', 'Status'].map((h) => (
                      <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                      <td className="px-3 py-2.5 font-mono text-blue-600 whitespace-nowrap">{r.loanNumber || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{r.customerName || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.agentName || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-500">{r.paymentChannel || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-400">{r.externalReference || '—'}</td>
                      <td className="px-3 py-2.5 font-bold text-green-700 whitespace-nowrap">{fmt(r.totalAmount)}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmt(r.principalAmount)}</td>
                      <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmt(r.interestAmount)}</td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{fmt(r.feeAmount)}</td>
                      <td className="px-3 py-2.5 font-mono text-gray-400 whitespace-nowrap">{r.receiptNumber || '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_STYLES[r.status] ?? 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                  className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}
                  className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
