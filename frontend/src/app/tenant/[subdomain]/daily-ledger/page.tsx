'use client';

import { useEffect, useState, useCallback } from 'react';
import { getDailyLedger, DailyLedgerView, LedgerLineDetailed } from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TYPE_STYLES: Record<string, string> = {
  COLLECTION: 'bg-green-100 text-green-700',
  DISBURSEMENT: 'bg-blue-100 text-blue-700',
  ADJUSTMENT: 'bg-orange-100 text-orange-700',
  REFUND: 'bg-red-100 text-red-600',
  FEE: 'bg-purple-100 text-purple-700',
  OTHER: 'bg-gray-100 text-gray-600',
};

const PAGE_SIZE = 50;

/**
 * Daily Ledger View (requirements doc §5.5) — opening outstanding principal,
 * the day's movements, closing outstanding principal, and a drill-down to the
 * underlying transactions that produced them.
 */
export default function DailyLedgerPage() {
  const [date, setDate] = useState(today());
  const [view, setView] = useState<DailyLedgerView | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      setView(await getDailyLedger(date, page, PAGE_SIZE));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load daily ledger');
    } finally { setLoading(false); }
  }, [date, page]);

  useEffect(() => { setPage(1); }, [date]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Daily Ledger</h1>
        <p className="text-sm text-gray-500">Opening balance, the day&apos;s movements, closing balance — and the transactions behind them</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setDate(shiftDate(date, -1))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">← Prev</button>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button disabled={date >= today()} onClick={() => setDate(shiftDate(date, 1))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-40">Next →</button>
        {date !== today() && (
          <button onClick={() => setDate(today())} className="px-3 py-2 text-sm text-blue-600 hover:underline">Today</button>
        )}
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

      {loading && !view ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
      ) : view ? (
        <>
          {/* §5.5 movement columns: opening → +disbursements −collections ±adjustments → closing */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <p className="text-xs text-gray-500">Opening Principal</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{fmt(view.openingOutstandingPrincipal)}</p>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-600">+ New Disbursements</p>
                <p className="text-lg font-bold text-blue-700 mt-1">{fmt(view.newDisbursements)}</p>
              </div>
              <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                <p className="text-xs text-green-600">− Principal Collected</p>
                <p className="text-lg font-bold text-green-700 mt-1">{fmt(view.principalCollections)}</p>
              </div>
              <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
                <p className="text-xs text-orange-600">± Adjustments</p>
                <p className="text-lg font-bold text-orange-700 mt-1">{fmt(view.adjustments)}</p>
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                <p className="text-xs text-gray-600 font-medium">= Closing Principal</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{fmt(view.closingOutstandingPrincipal)}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-3">
                <p className="text-xs text-gray-500">Interest Collected</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{fmt(view.interestCollected)}</p>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">
                Net cash / bank movement:{' '}
                <span className={`font-bold ${view.cashBankMovement >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {fmt(view.cashBankMovement)}
                </span>
              </p>
            </div>
          </div>

          {/* Drill-down (§5.5: "possible to drill from a daily total to the underlying transactions") */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Transactions on this day ({view.total})</h2>
            </div>
            {view.transactions.length === 0 ? (
              <div className="py-16 text-center text-gray-400 text-sm">No transactions on this day</div>
            ) : (
              <>
                <DailyTransactionsTable rows={view.transactions} />
                <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    Showing {Math.min((page - 1) * PAGE_SIZE + 1, view.total)}–{Math.min(page * PAGE_SIZE, view.total)} of {view.total}
                  </p>
                  <div className="flex gap-2">
                    <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                      className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
                    <button disabled={page * PAGE_SIZE >= view.total} onClick={() => setPage(page + 1)}
                      className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DailyTransactionsTable({ rows }: { rows: LedgerLineDetailed[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            {['Time', 'Type', 'Loan', 'Borrower', 'Total', 'Principal', 'Interest', 'Channel', 'Receipt', 'Status'].map((h) => (
              <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
              <td className="px-3 py-2.5">
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${TYPE_STYLES[r.transactionType] ?? 'bg-gray-100 text-gray-600'}`}>
                  {r.transactionType}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono text-blue-600 whitespace-nowrap">{r.loanNumber || '—'}</td>
              <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{r.customerName || '—'}</td>
              <td className={`px-3 py-2.5 font-bold whitespace-nowrap ${r.totalAmount >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(r.totalAmount)}</td>
              <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmt(r.principalAmount)}</td>
              <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmt(r.interestAmount)}</td>
              <td className="px-3 py-2.5 text-gray-500">{r.paymentChannel || '—'}</td>
              <td className="px-3 py-2.5 font-mono text-gray-400 whitespace-nowrap">{r.receiptNumber || '—'}</td>
              <td className="px-3 py-2.5">
                <span className={`px-1.5 py-0.5 rounded text-xs ${
                  r.status === 'RECONCILED' ? 'bg-green-100 text-green-700'
                  : r.status === 'REVERSED' ? 'bg-red-100 text-red-600'
                  : 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
