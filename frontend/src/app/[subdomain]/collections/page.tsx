'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getCollectionStats, getTodayCollections, getOverdueCollections,
  getCollectionAgents, recordCollectionPayment, assignCollectionAgent,
  CollectionItem, CollectionStats, CollectionAgent,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';
const METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'NEFT', 'RTGS'];

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    PARTIALLY_PAID: 'bg-blue-100 text-blue-700',
    OVERDUE: 'bg-red-100 text-red-700',
    PAID: 'bg-green-100 text-green-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-black mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Payment Modal ─────────────────────────────────────────────────────────────
function PaymentModal({
  item, onClose, onSuccess,
}: { item: CollectionItem; onClose: () => void; onSuccess: () => void }) {
  const [amount, setAmount] = useState(String(item.balance));
  const [method, setMethod] = useState('CASH');
  const [ref, setRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return setError('Enter a valid amount');
    if (amt > item.balance) return setError(`Max allowed: ${fmtCurrency(item.balance)}`);
    setError('');
    setLoading(true);
    try {
      await recordCollectionPayment(item.id, { amount: amt, paymentMethod: method, referenceNumber: ref || undefined });
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900 text-lg">Record Payment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1">
          <p className="font-semibold text-gray-800">{item.customerName}</p>
          <p className="text-sm text-gray-500">{item.loanNumber} · EMI #{item.installmentNumber}</p>
          <p className="text-sm text-gray-500">Balance due: <span className="font-bold text-red-600">{fmtCurrency(item.balance)}</span></p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 mt-2">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setAmount(String(Math.round(item.balance * pct / 100)))}
                  className="flex-1 text-xs py-1.5 rounded-lg bg-gray-100 text-gray-600 font-semibold hover:bg-blue-50 hover:text-blue-700"
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`py-2 rounded-xl text-xs font-semibold border transition-colors ${
                    method === m
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {m.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {method !== 'CASH' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Reference Number</label>
              <input
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="UTR / Cheque / Transaction ID"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600 font-medium">{error}</p>}

          <button
            onClick={submit}
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white text-sm transition-opacity"
            style={{ backgroundColor: BRAND, opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Recording...' : `Confirm Payment  ${fmtCurrency(parseFloat(amount) || 0)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Assign Agent Modal ────────────────────────────────────────────────────────
function AssignModal({
  item, agents, onClose, onSuccess,
}: { item: CollectionItem; agents: CollectionAgent[]; onClose: () => void; onSuccess: () => void }) {
  const [selected, setSelected] = useState<string>(item.assignedTo ?? '');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await assignCollectionAgent(item.id, selected || null);
      onSuccess();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">Assign Agent</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{item.customerName} · {item.loanNumber} · EMI #{item.installmentNumber}</p>

        <div className="space-y-2 mb-5">
          <button
            onClick={() => setSelected('')}
            className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
              selected === '' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            Unassigned
          </button>
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a.id)}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                selected === a.id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-800 hover:border-gray-300'
              }`}
            >
              {a.name}
              <span className="ml-2 text-xs text-gray-400">{a.role}</span>
            </button>
          ))}
        </div>

        <button
          onClick={submit}
          disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-white text-sm"
          style={{ backgroundColor: BRAND, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Saving...' : 'Confirm Assignment'}
        </button>
      </div>
    </div>
  );
}

// ── Collections Table ─────────────────────────────────────────────────────────
function CollectionsTable({
  items, agents, onRefresh,
}: { items: CollectionItem[]; agents: CollectionAgent[]; onRefresh: () => void }) {
  const [payItem, setPayItem] = useState<CollectionItem | null>(null);
  const [assignItem, setAssignItem] = useState<CollectionItem | null>(null);

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
        <p className="text-4xl mb-3">✓</p>
        <p className="font-semibold text-gray-700">No collections found</p>
        <p className="text-sm text-gray-400 mt-1">All clear for this filter</p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Loan / EMI</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Due Date</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Balance</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Agent</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">{item.customerName}</p>
                    <p className="text-xs text-gray-400">{item.phone}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{item.loanNumber}</p>
                    <p className="text-xs text-gray-400">EMI #{item.installmentNumber}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-700">{new Date(item.dueDate).toLocaleDateString('en-IN')}</p>
                    {item.daysOverdue ? (
                      <p className="text-xs text-red-500 font-semibold">{item.daysOverdue}d overdue</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <p className="font-bold text-gray-900">{fmtCurrency(item.balance)}</p>
                    {item.paidAmount > 0 && (
                      <p className="text-xs text-green-600">Paid: {fmtCurrency(item.paidAmount)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-4 py-3">
                    {item.agentName ? (
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-lg font-medium">{item.agentName}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => setPayItem(item)}
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-opacity hover:opacity-80"
                        style={{ backgroundColor: BRAND }}
                      >
                        Collect
                      </button>
                      <button
                        onClick={() => setAssignItem(item)}
                        className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                      >
                        Assign
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {payItem && (
        <PaymentModal
          item={payItem}
          onClose={() => setPayItem(null)}
          onSuccess={() => { setPayItem(null); onRefresh(); }}
        />
      )}
      {assignItem && (
        <AssignModal
          item={assignItem}
          agents={agents}
          onClose={() => setAssignItem(null)}
          onSuccess={() => { setAssignItem(null); onRefresh(); }}
        />
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function CollectionsPage() {
  const [tab, setTab] = useState<'today' | 'overdue'>('today');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<CollectionAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const LIMIT = 20;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsData, listData] = await Promise.all([
        getCollectionStats(),
        tab === 'today'
          ? getTodayCollections(page, LIMIT, search || undefined)
          : getOverdueCollections(page, LIMIT, search || undefined),
      ]);
      setStats(statsData);
      setItems(listData.data);
      setTotal(listData.total);
    } catch {
      // silently fail — user sees empty state
    } finally {
      setLoading(false);
    }
  }, [tab, page, search]);

  useEffect(() => {
    getCollectionAgents().then(setAgents).catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
  }, [tab, search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-4 lg:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Collections</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track EMI collections and assign field agents</p>
        </div>
        <button
          onClick={loadData}
          className="text-sm px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium"
        >
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Due Today"
          value={stats ? String(stats.todayCount) : '—'}
          sub={stats ? fmtCurrency(stats.todayAmount) : undefined}
          color="text-blue-700"
        />
        <StatCard
          label="Overdue"
          value={stats ? String(stats.overdueCount) : '—'}
          sub={stats ? fmtCurrency(stats.overdueAmount) : undefined}
          color="text-red-600"
        />
        <StatCard
          label="Collected Today"
          value={stats ? fmtCurrency(stats.collectedToday) : '—'}
          color="text-green-600"
        />
        <StatCard
          label="Total Pending"
          value={stats ? fmtCurrency(stats.totalPending) : '—'}
          color="text-orange-600"
        />
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {(['today', 'overdue'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors capitalize ${
                tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'today' ? "Today's Due" : 'Overdue'}
              {t === 'today' && stats ? (
                <span className="ml-2 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">{stats.todayCount}</span>
              ) : null}
              {t === 'overdue' && stats ? (
                <span className="ml-2 bg-red-100 text-red-700 text-xs px-1.5 py-0.5 rounded-full">{stats.overdueCount}</span>
              ) : null}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search customer, loan number, phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400 mt-3">Loading collections...</p>
        </div>
      ) : (
        <CollectionsTable items={items} agents={agents} onRefresh={loadData} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 font-medium disabled:opacity-40 hover:bg-gray-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 text-sm rounded-xl border border-gray-200 font-medium disabled:opacity-40 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
