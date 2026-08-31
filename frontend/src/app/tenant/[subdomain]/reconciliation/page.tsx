'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getUnreconciledCollections, reconcileTransactions, getReversedTransactions, getPartiallyAllocated,
  getSnapshot, generateSnapshot, lockDay, unlockDay,
  listLedgerTransactions, postLedgerAdjustment, reverseLedgerTransaction, getLoans,
  LedgerLine, DailySnapshot, Loan,
} from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

type Tab = 'unreconciled' | 'reversed' | 'partial' | 'adjustments' | 'snapshot';

export default function ReconciliationPage() {
  const [tab, setTab] = useState<Tab>('unreconciled');

  const TABS: { key: Tab; label: string }[] = [
    { key: 'unreconciled', label: 'Unreconciled Collections' },
    { key: 'reversed', label: 'Reversed Transactions' },
    { key: 'partial', label: 'Partially Allocated' },
    { key: 'adjustments', label: 'Adjustments' },
    { key: 'snapshot', label: 'Daily Snapshot' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Reconciliation</h1>
        <p className="text-sm text-gray-500">Settle agent collections, review reversals, and generate day-end snapshots</p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'unreconciled' && <UnreconciledTab />}
      {tab === 'reversed' && <SimpleLedgerListTab loader={getReversedTransactions} emptyText="No reversed transactions" />}
      {tab === 'partial' && <SimpleLedgerListTab loader={getPartiallyAllocated} emptyText="No partially allocated collections" />}
      {tab === 'adjustments' && <AdjustmentsTab />}
      {tab === 'snapshot' && <SnapshotTab />}
    </div>
  );
}

function LedgerTable({ rows, showStatus = true, selectable, selected, onToggle, onReverse }: {
  rows: LedgerLine[]; showStatus?: boolean;
  selectable?: boolean; selected?: Set<string>; onToggle?: (id: string) => void;
  onReverse?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50">
          <tr>
            {selectable && <th className="px-3 py-3"></th>}
            {['Date', 'Type', 'Amount', 'Channel', 'Reference', 'Remarks', ...(showStatus ? ['Status'] : []), ...(onReverse ? [''] : [])].map((h) => (
              <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50">
              {selectable && (
                <td className="px-3 py-2.5">
                  <input type="checkbox" checked={selected?.has(r.id) ?? false} onChange={() => onToggle?.(r.id)} className="rounded" />
                </td>
              )}
              <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(r.transactionDate)}</td>
              <td className="px-3 py-2.5">{r.transactionType}</td>
              <td className={`px-3 py-2.5 font-bold whitespace-nowrap ${r.totalAmount >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(r.totalAmount)}</td>
              <td className="px-3 py-2.5 text-gray-500">{r.paymentChannel || '—'}</td>
              <td className="px-3 py-2.5 text-gray-400">{r.externalReference || '—'}</td>
              <td className="px-3 py-2.5 text-gray-500">{r.remarks || '—'}</td>
              {showStatus && (
                <td className="px-3 py-2.5">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    r.status === 'RECONCILED' ? 'bg-green-100 text-green-700'
                    : r.status === 'REVERSED' ? 'bg-red-100 text-red-600'
                    : 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
                </td>
              )}
              {onReverse && (
                <td className="px-3 py-2.5">
                  {r.status === 'POSTED' && !r.reversalOfId && (
                    <button onClick={() => onReverse(r.id)} className="text-red-500 hover:underline">Reverse</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UnreconciledTab() {
  const [rows, setRows] = useState<LedgerLine[]>([]);
  const [totalAmount, setTotalAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getUnreconciledCollections(1, 200);
      setRows(r.data);
      setTotalAmount(r.totalAmount);
      setSelected(new Set());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));
  }

  const selectedTotal = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.totalAmount, 0);

  async function submit() {
    if (selected.size === 0) return;
    setSubmitting(true); setErr('');
    try {
      await reconcileTransactions([...selected], reference || undefined);
      setReference('');
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to reconcile');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
          <p className="text-xs text-orange-600">Pending Reconciliation</p>
          <p className="text-xl font-bold text-orange-700 mt-1">{fmt(totalAmount)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-500">Collections Selected</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{selected.size}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-500">Selected Total</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmt(selectedTotal)}</p>
        </div>
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={toggleAll} className="text-xs text-blue-600 hover:underline">
          {selected.size === rows.length && rows.length > 0 ? 'Deselect all' : 'Select all'}
        </button>
        <input value={reference} onChange={(e) => setReference(e.target.value)}
          placeholder="Settlement reference (e.g. bank deposit slip #)…"
          className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button disabled={selected.size === 0 || submitting} onClick={submit}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">
          {submitting ? 'Reconciling…' : `Mark ${selected.size || ''} Reconciled`}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">Nothing pending reconciliation</div>
        ) : (
          <LedgerTable rows={rows} showStatus={false} selectable selected={selected} onToggle={toggle} />
        )}
      </div>
    </div>
  );
}

function SimpleLedgerListTab({ loader, emptyText }: {
  loader: (page?: number, limit?: number) => Promise<{ data: LedgerLine[]; total: number }>;
  emptyText: string;
}) {
  const [rows, setRows] = useState<LedgerLine[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    loader(1, 100).then((r) => setRows(r.data)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">{emptyText}</div>
      ) : (
        <LedgerTable rows={rows} />
      )}
    </div>
  );
}

/** Manual ledger adjustments (write-offs, corrections) — requirements doc §10/§11. */
function AdjustmentsTab() {
  const [rows, setRows] = useState<LedgerLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Loan[]>([]);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [fee, setFee] = useState('');
  const [other, setOther] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listLedgerTransactions({ type: 'ADJUSTMENT' }, 1, 100);
      setRows(r.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await getLoans(1, 8, { search: search.trim() });
        setResults(r.data);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function selectLoan(loan: Loan) {
    setSelectedLoan(loan);
    setResults([]);
    setSearch(loan.loanNumber);
  }

  async function submit() {
    const p = parseFloat(principal) || 0;
    const i = parseFloat(interest) || 0;
    const f = parseFloat(fee) || 0;
    const o = parseFloat(other) || 0;
    if (p + i + f + o === 0) { setErr('Enter at least one non-zero amount'); return; }
    if (!remarks.trim()) { setErr('Remarks are required to justify an adjustment'); return; }
    setSubmitting(true); setErr('');
    try {
      await postLedgerAdjustment({
        loanId: selectedLoan?.id, customerId: undefined,
        principalAmount: p || undefined, interestAmount: i || undefined,
        feeAmount: f || undefined, otherAmount: o || undefined,
        externalReference: reference || undefined, remarks: remarks.trim(),
      });
      setPrincipal(''); setInterest(''); setFee(''); setOther(''); setRemarks(''); setReference('');
      setSelectedLoan(null); setSearch('');
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to post adjustment');
    } finally { setSubmitting(false); }
  }

  async function reverse(id: string) {
    const reason = window.prompt('Reason for reversing this adjustment?');
    if (!reason?.trim()) return;
    try {
      await reverseLedgerTransaction(id, reason.trim());
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to reverse adjustment');
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Post an Adjustment</h2>
        <p className="text-xs text-gray-500">Manual corrections (write-offs, NPA adjustments). Never edits history — always a new, justified transaction.</p>

        {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

        <div className="relative max-w-sm">
          <label className="block text-xs font-medium text-gray-600 mb-1">Loan (optional)</label>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setSelectedLoan(null); }}
            placeholder="Search loan number, customer name or phone…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full border border-gray-200 rounded-lg overflow-hidden bg-white shadow-lg">
              {results.map((l) => (
                <button key={l.id} onClick={() => selectLoan(l)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b last:border-0">
                  <span className="font-medium">{l.loanNumber}</span> — {l.customerName}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Principal (₹)</label>
            <input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)}
              placeholder="signed, e.g. -500"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Interest (₹)</label>
            <input type="number" value={interest} onChange={(e) => setInterest(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fee (₹)</label>
            <input type="number" value={fee} onChange={(e) => setFee(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Other (₹)</label>
            <input type="number" value={other} onChange={(e) => setOther(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Remarks (required)</label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)}
            placeholder="Why this adjustment is being posted…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Reference # (optional)</label>
          <input value={reference} onChange={(e) => setReference(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        <button disabled={submitting} onClick={submit}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">
          {submitting ? 'Posting…' : 'Post Adjustment'}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No adjustments posted yet</div>
        ) : (
          <LedgerTable rows={rows} onReverse={reverse} />
        )}
      </div>
    </div>
  );
}

function SnapshotTab() {
  const [date, setDate] = useState(today());
  const [snapshot, setSnapshot] = useState<DailySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const s = await getSnapshot(date);
      setSnapshot(s);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load snapshot');
    } finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  async function doGenerate() {
    setBusy(true); setErr('');
    try { setSnapshot(await generateSnapshot(date)); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed to generate snapshot'); }
    finally { setBusy(false); }
  }

  async function doLock() {
    setBusy(true); setErr('');
    try { setSnapshot(await lockDay(date)); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed to lock day'); }
    finally { setBusy(false); }
  }

  async function doUnlock() {
    setBusy(true); setErr('');
    try { setSnapshot(await unlockDay(date)); }
    catch (e: unknown) { setErr(e instanceof Error ? e.message : 'Failed to unlock day'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button disabled={busy} onClick={doGenerate}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">
          {snapshot ? 'Regenerate Snapshot' : 'Generate Snapshot'}
        </button>
        {snapshot && (
          snapshot.lockedAt ? (
            <button disabled={busy} onClick={doUnlock} className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40">
              Unlock Day
            </button>
          ) : (
            <button disabled={busy} onClick={doLock} className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40">
              Lock Day
            </button>
          )
        )}
        {snapshot?.lockedAt && (
          <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">Locked {fmtDateTime(snapshot.lockedAt)}</span>
        )}
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
      ) : !snapshot ? (
        <div className="py-16 text-center text-gray-400 text-sm bg-white rounded-xl border border-gray-100">
          No snapshot generated for this day yet
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <p className="text-xs text-gray-500">Opening Outstanding Principal</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{fmt(snapshot.openingOutstandingPrincipal)}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <p className="text-xs text-gray-500">New Disbursements</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{fmt(snapshot.newDisbursementPrincipal)}</p>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-3">
              <p className="text-xs text-green-600">Principal Collected</p>
              <p className="text-lg font-bold text-green-700 mt-1">{fmt(snapshot.principalCollected)}</p>
            </div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-3">
              <p className="text-xs text-green-600">Interest Collected</p>
              <p className="text-lg font-bold text-green-700 mt-1">{fmt(snapshot.interestCollected)}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <p className="text-xs text-gray-500">Adjustments</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{fmt(snapshot.adjustments)}</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-xs text-blue-600">Closing Outstanding Principal</p>
              <p className="text-lg font-bold text-blue-700 mt-1">{fmt(snapshot.closingOutstandingPrincipal)}</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-xs text-blue-600">Available Fund</p>
              <p className="text-lg font-bold text-blue-700 mt-1">{fmt(snapshot.availableFund)}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-3">
              <p className="text-xs text-gray-500">Generated</p>
              <p className="text-sm font-medium text-gray-700 mt-1">{fmtDateTime(snapshot.generatedAt)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
