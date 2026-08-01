'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getCollectionsCalendar, getCollectionsByDate, recordCollectionPayment,
  CollectionCalendarDay, CollectionItem,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function CollectionsCalendarPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const [month, setMonth] = useState(() => todayStr().slice(0, 7));
  const [days, setDays] = useState<CollectionCalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayItems, setDayItems] = useState<CollectionItem[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [payTarget, setPayTarget] = useState<CollectionItem | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS'>('CASH');
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState('');

  const loadMonth = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const res = await getCollectionsCalendar(m);
      setDays(res.days);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadMonth(month); }, [month, loadMonth]);

  async function openDay(date: string) {
    setSelectedDate(date);
    setDayLoading(true); setErr('');
    try {
      const res = await getCollectionsByDate(date, 1, 50);
      setDayItems(res.data);
    } finally { setDayLoading(false); }
  }

  async function submitPayment() {
    if (!payTarget || !payAmount || parseFloat(payAmount) <= 0) { setErr('Enter a valid amount'); return; }
    setPaying(true); setErr('');
    try {
      await recordCollectionPayment(payTarget.id, { amount: parseFloat(payAmount), paymentMethod: payMethod });
      setPayTarget(null);
      if (selectedDate) await openDay(selectedDate);
      await loadMonth(month);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Payment failed');
    } finally { setPaying(false); }
  }

  const byDate = new Map(days.map((d) => [d.date, d]));
  const [y, m] = month.split('-').map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startWeekday = firstOfMonth.getDay();
  const cells: (string | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/tenant/${subdomain}/collections`} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Collection Calendar</h1>
          <p className="text-sm text-gray-500 mt-0.5">Dues, overdue and collected amounts by day</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">← Prev</button>
          <p className="font-semibold text-gray-900">{monthLabel(month)}</p>
          <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Next →</button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="text-xs font-semibold text-gray-400 text-center py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((date, i) => {
                if (!date) return <div key={`empty-${i}`} />;
                const d = byDate.get(date);
                const isToday = date === todayStr();
                const hasOverdue = (d?.overdueCount ?? 0) > 0;
                const hasDue = (d?.dueCount ?? 0) > 0;
                return (
                  <button
                    key={date}
                    onClick={() => openDay(date)}
                    className={`aspect-square rounded-lg border p-1.5 text-left flex flex-col justify-between transition-colors hover:bg-blue-50 ${
                      isToday ? 'border-blue-500 ring-1 ring-blue-200' : 'border-gray-200'
                    } ${hasOverdue ? 'bg-red-50' : hasDue ? 'bg-yellow-50' : 'bg-white'}`}
                  >
                    <span className={`text-xs font-semibold ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>{Number(date.slice(-2))}</span>
                    {d && (
                      <span className="text-[9px] leading-tight space-y-0.5">
                        {d.dueCount > 0 && <span className="block text-yellow-700">{d.dueCount} due</span>}
                        {d.overdueCount > 0 && <span className="block text-red-600 font-medium">{d.overdueCount} overdue</span>}
                        {d.paidCount > 0 && <span className="block text-green-600">{d.paidCount} paid</span>}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-50 border border-yellow-300" />Due</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-50 border border-red-300" />Has overdue</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border border-blue-500" />Today</span>
            </div>
          </>
        )}
      </div>

      {/* Day detail modal */}
      {selectedDate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                {new Date(selectedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </h2>
              <button onClick={() => { setSelectedDate(null); setDayItems([]); }} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            {dayLoading ? (
              <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
            ) : dayItems.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No installments due this day.</p>
            ) : (
              <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                {dayItems.map((item) => (
                  <div key={item.id} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{item.customerName}</p>
                      <p className="text-xs text-gray-400 font-mono">{item.loanNumber} · #{item.installmentNumber}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-semibold text-sm text-gray-900">{fmt(item.balance)}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        item.status === 'PAID' ? 'bg-green-100 text-green-700' :
                        item.status === 'OVERDUE' ? 'bg-red-100 text-red-700' :
                        item.status === 'PARTIALLY_PAID' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>{item.status}</span>
                    </div>
                    {item.status !== 'PAID' && (
                      <button
                        onClick={() => { setPayTarget(item); setPayAmount(String(item.balance)); setErr(''); }}
                        className="text-xs px-2.5 py-1.5 text-white rounded-lg hover:opacity-90 flex-shrink-0"
                        style={{ backgroundColor: BRAND }}>
                        Pay
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment modal */}
      {payTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Record Payment</h2>
            <p className="text-sm text-gray-500">{payTarget.customerName} · {payTarget.loanNumber} · #{payTarget.installmentNumber}</p>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹)</label>
                <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'NEFT', 'RTGS'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setPayTarget(null)} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button disabled={paying} onClick={submitPayment}
                className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
                {paying ? 'Saving…' : 'Save Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
