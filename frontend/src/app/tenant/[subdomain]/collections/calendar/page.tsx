'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getCalendarItems, getCalendarSummary, getCollectionDetail, collectPayment, confirmCollection,
  getTenantSession,
  CalendarView, CalendarCollectionItem, CalendarSummary, CollectionDetail,
  MANAGER_ROLES,
} from '@/services/tenant-api';

const ACCENT = '#FF6B35';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(date: string, view: CalendarView, delta: number) {
  const d = new Date(`${date}T00:00:00Z`);
  if (view === 'day') d.setUTCDate(d.getUTCDate() + delta);
  else if (view === 'week') d.setUTCDate(d.getUTCDate() + delta * 7);
  else d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

function rangeLabel(start: string, end: string) {
  const f = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  return start === end ? f(start) : `${f(start)} – ${f(end)}`;
}

// Not color alone (spec §2): every status also carries a short text glyph/label.
const DUE_BUCKET_BADGE: Record<string, { label: string; cls: string }> = {
  UPCOMING: { label: '○ Upcoming', cls: 'bg-gray-100 text-gray-600' },
  DUE_TODAY: { label: '● Due today', cls: 'bg-blue-100 text-blue-700' },
  OVERDUE: { label: '▲ Overdue', cls: 'bg-red-100 text-red-700' },
};

const COLLECTION_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: '○ Scheduled', cls: 'bg-gray-100 text-gray-600' },
  COLLECTED: { label: '✓ Collected', cls: 'bg-amber-100 text-amber-700' },
  CONFIRMED: { label: '✓✓ Confirmed', cls: 'bg-green-100 text-green-700' },
  CANCELLED: { label: '✕ Cancelled', cls: 'bg-gray-200 text-gray-500' },
};

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-bold mt-0.5" style={accent ? { color: accent } : undefined}>{value}</p>
    </div>
  );
}

export default function CollectionsCalendarPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;
  const session = getTenantSession();
  const role = session?.user.role ?? 'CUSTOMER';
  const isManager = MANAGER_ROLES.includes(role);

  // Spec: default view is Week.
  const [view, setView] = useState<CalendarView>('week');
  const [date, setDate] = useState(todayStr());
  const [items, setItems] = useState<CalendarCollectionItem[]>([]);
  const [summary, setSummary] = useState<CalendarSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS'>('CASH');
  const [reference, setReference] = useState('');
  const [acting, setActing] = useState(false);
  const [actionErr, setActionErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const load = useCallback((v: CalendarView, d: string) => {
    return Promise.all([getCalendarItems(v, d), getCalendarSummary(v, d)])
      .then(([i, s]) => { setItems(i.items); setSummary(s); })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load calendar'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCalendarItems(view, date)
      .then(async (i) => {
        const s = await getCalendarSummary(view, date);
        if (cancelled) return;
        setItems(i.items);
        setSummary(s);
        setError(null);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load calendar'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, date]);

  function changeView(v: CalendarView) {
    if (v === view) return;
    setLoading(true);
    setView(v);
  }

  function changeDate(d: string) {
    if (d === date) return;
    setLoading(true);
    setDate(d);
  }

  async function openCollection(installmentId: string) {
    setOpenId(installmentId);
    setDetail(null);
    setDetailLoading(true);
    setActionErr(''); setActionMsg('');
    try {
      const d = await getCollectionDetail(installmentId);
      setDetail(d);
      setAmount(String(d.totalAmountDue));
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to load collection');
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDrawer() {
    setOpenId(null); setDetail(null); setAmount(''); setReference(''); setActionErr(''); setActionMsg('');
  }

  async function handleCollect() {
    if (!openId || !detail) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setActionErr('Enter a valid amount'); return; }
    setActing(true); setActionErr(''); setActionMsg('');
    try {
      // One key per drawer session — a double-tap or network retry on the same
      // open collection replays the same submission instead of double-crediting.
      const idempotencyKey = `${openId}-${Date.now()}`;
      await collectPayment(openId, { amount: amt, paymentMethod: method, referenceNumber: reference || undefined, idempotencyKey });
      setActionMsg('Collected. Awaiting office confirmation.');
      await openCollection(openId);
      await load(view, date);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Collection failed');
    } finally {
      setActing(false);
    }
  }

  async function handleConfirm(paymentId: string) {
    setActing(true); setActionErr(''); setActionMsg('');
    try {
      await confirmCollection(paymentId);
      setActionMsg('Confirmed.');
      if (openId) await openCollection(openId);
      await load(view, date);
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Confirmation failed');
    } finally {
      setActing(false);
    }
  }

  // Most recent COLLECTED (not yet CONFIRMED) payment on this installment —
  // the one a manager/owner would act on.
  const confirmable = detail?.history.find((h) => h.collectionStatus === 'COLLECTED');

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Collection Calendar</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {isManager ? 'All agents’ scheduled, collected and confirmed collections' : 'Your scheduled collections — tap one to collect'}
          </p>
        </div>
        <Link href={`/tenant/${subdomain}/collections`} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
          Back to Collections
        </Link>
      </div>

      {/* View controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl" role="group" aria-label="Calendar view">
          {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
            <button
              key={v}
              onClick={() => changeView(v)}
              aria-pressed={view === v}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                view === v ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeDate(shiftDate(date, view, -1))} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">‹</button>
          <button onClick={() => changeDate(todayStr())} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Today</button>
          <button onClick={() => changeDate(shiftDate(date, view, 1))} className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500">›</button>
          <span className="text-sm font-medium text-gray-700 ml-1">{summary ? rangeLabel(summary.start, summary.end) : ''}</span>
        </div>
      </div>

      {/* Summary (spec §10) — authoritative backend totals, not UI-state math */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          <StatCard label="Scheduled" value={summary.scheduled} />
          <StatCard label="Collected" value={summary.collected} accent="#D97706" />
          <StatCard label="Confirmed" value={summary.confirmed} accent="#10B981" />
          <StatCard label="Pending" value={summary.pending} accent={ACCENT} />
          <StatCard label="Expected" value={fmt(summary.amountExpected)} />
          <StatCard label="Collected ₹" value={fmt(summary.amountCollected)} accent="#D97706" />
          <StatCard label="Confirmed ₹" value={fmt(summary.amountConfirmed)} accent="#10B981" />
        </div>
      )}

      {/* Items */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">Loading…</p>
        ) : error ? (
          <p className="px-5 py-10 text-center text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">No collections scheduled in this range.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {items.map((it) => {
              const due = DUE_BUCKET_BADGE[it.dueBucket];
              const coll = COLLECTION_STATUS_BADGE[it.collectionStatus];
              return (
                <li key={it.installmentId}>
                  <button
                    onClick={() => openCollection(it.installmentId)}
                    className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm text-gray-900">{it.customerName}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${due.cls}`}>{due.label}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${coll.cls}`}>{coll.label}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        Loan: {it.loanNumber} · Installment: {it.installmentNumber} · Due: {fmt(it.scheduledAmount)}
                        {new Date(it.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) ? ` · ${new Date(it.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : ''}
                      </p>
                      {it.pendingInstallments > 0 && (
                        <p className="text-xs text-red-600 font-medium mt-0.5">
                          Pending: {it.pendingInstallments} · Total Due: {fmt(it.totalAmountDue)} ({it.totalInstallmentsDue} installments)
                        </p>
                      )}
                    </div>
                    <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Collection detail drawer — open directly from the calendar (spec §3), no
          Customer -> Loan -> Installments navigation required. */}
      {openId && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} />
          <div className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Collection</h2>
              <button onClick={closeDrawer} className="text-gray-400 hover:text-gray-600 text-sm">✕ Close</button>
            </div>

            {detailLoading ? (
              <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
            ) : !detail ? (
              <p className="text-sm text-red-600">{actionErr || 'Not found'}</p>
            ) : (
              <>
                <div>
                  <p className="font-semibold text-gray-900">{detail.customer.name}</p>
                  <p className="text-xs text-gray-400">{detail.customer.phone}{detail.customer.locality ? ` · ${detail.customer.locality}` : ''}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-gray-400">Loan</p><p className="font-medium">{detail.loan.loanNumber}</p></div>
                  <div><p className="text-xs text-gray-400">Loan status</p><p className="font-medium">{detail.loan.status}</p></div>
                  <div><p className="text-xs text-gray-400">Installment</p><p className="font-medium">#{detail.installment.installmentNumber}</p></div>
                  <div><p className="text-xs text-gray-400">Previous installment</p><p className="font-medium">{detail.installment.previousInstallmentStatus ?? '—'}</p></div>
                  <div><p className="text-xs text-gray-400">Pending installments</p><p className="font-medium text-red-600">{detail.pendingInstallments}</p></div>
                  <div><p className="text-xs text-gray-400">Total amount due</p><p className="font-bold">{fmt(detail.totalAmountDue)}</p></div>
                  <div>
                    <p className="text-xs text-gray-400">Collection status</p>
                    <p className="font-medium">{COLLECTION_STATUS_BADGE[detail.installment.collectionStatus].label}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Installment status</p>
                    <p className="font-medium">{detail.installment.installmentStatus}</p>
                  </div>
                </div>

                {actionErr && <p className="text-sm text-red-600">{actionErr}</p>}
                {actionMsg && <p className="text-sm text-green-600">{actionMsg}</p>}

                {/* Collect Payment — agent/staff/manager can create a collection.
                    Only shown while balance remains. */}
                {detail.installment.balance > 0 || detail.pendingInstallments > 0 ? (
                  <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50">
                    <p className="text-sm font-semibold text-gray-900">Collect Payment</p>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Amount to collect (₹)</label>
                      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="1"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Payment method</label>
                      <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        {['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'NEFT', 'RTGS'].map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Reference / receipt no. (optional)</label>
                      <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <button
                      disabled={acting}
                      onClick={handleCollect}
                      className="w-full py-2.5 text-sm font-semibold text-white rounded-lg disabled:opacity-40"
                      style={{ backgroundColor: ACCENT }}
                    >
                      {acting ? 'Saving…' : 'Collect Payment'}
                    </button>
                    <p className="text-[11px] text-gray-400">
                      This records that <b>you</b> received the money. Office reconciliation confirms it separately.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-green-600 font-medium">Fully paid — nothing outstanding.</p>
                )}

                {/* Office Confirmation — Manager/Owner only, enforced server-side too. */}
                {isManager && confirmable && (
                  <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-2">
                    <p className="text-sm font-semibold text-amber-900">Awaiting office confirmation</p>
                    <p className="text-xs text-amber-700">
                      {fmt(confirmable.amount)} collected by {confirmable.collectedByName ?? 'agent'} on{' '}
                      {new Date(confirmable.createdAt).toLocaleString('en-IN')}
                    </p>
                    <button
                      disabled={acting}
                      onClick={() => handleConfirm(confirmable.id)}
                      className="w-full py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-40"
                    >
                      {acting ? 'Confirming…' : 'Confirm Receipt'}
                    </button>
                  </div>
                )}

                {/* Collection history / audit trail */}
                {detail.history.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Collection History</p>
                    <ul className="space-y-2">
                      {detail.history.map((h) => (
                        <li key={h.id} className="text-xs border border-gray-100 rounded-lg p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-gray-900">{fmt(h.amount)}</span>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${COLLECTION_STATUS_BADGE[h.collectionStatus].cls}`}>
                              {COLLECTION_STATUS_BADGE[h.collectionStatus].label}
                            </span>
                          </div>
                          <p className="text-gray-400 mt-0.5">
                            {h.method} · {new Date(h.createdAt).toLocaleString('en-IN')} · by {h.collectedByName ?? '—'}
                          </p>
                          {h.confirmedAt && (
                            <p className="text-gray-400">
                              Confirmed: {fmt(h.confirmedAmount ?? h.amount)} by {h.confirmedByName ?? '—'} on {new Date(h.confirmedAt).toLocaleString('en-IN')}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
