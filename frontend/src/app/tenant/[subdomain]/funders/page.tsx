'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getFunders, createFunder, updateFunder, getFunderDetail, postFunderTransaction, reverseFunderTransaction,
  getLoans, getLoanFunderAllocations, setLoanFunderAllocations,
  Funder, FunderTransaction, FunderTransactionType, Loan, LoanFunderAllocations,
} from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const TXN_TYPES: { value: FunderTransactionType; label: string }[] = [
  { value: 'CONTRIBUTION', label: 'Contribution (capital in)' },
  { value: 'WITHDRAWAL', label: 'Withdrawal (capital out)' },
  { value: 'ADJUSTMENT', label: 'Adjustment (correction)' },
];

export default function FundersPage() {
  const [funders, setFunders] = useState<Funder[]>([]);
  const [loading, setLoading] = useState(false);

  const loadFunders = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getFunders(1, 100);
      setFunders(r.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadFunders(); }, [loadFunders]);

  const [showAddFunder, setShowAddFunder] = useState(false);
  const [selectedFunderId, setSelectedFunderId] = useState<string | null>(null);

  const totalBalance = funders.reduce((s, f) => s + f.balance, 0);
  const totalAllocated = funders.reduce((s, f) => s + f.allocatedPrincipal, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Funders</h1>
          <p className="text-sm text-gray-500">Capital contributions, withdrawals, and loan funding allocation</p>
        </div>
        <button onClick={() => setShowAddFunder(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
          + Add Funder
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-xs text-blue-600">Total Capital</p>
          <p className="text-xl font-bold text-blue-700 mt-1">{fmt(totalBalance)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-500">Allocated to Active Loans</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmt(totalAllocated)}</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-xs text-gray-500">Unallocated</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{fmt(Math.max(0, totalBalance - totalAllocated))}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : funders.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No funders yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {['Name', 'Contact', 'Capital Balance', 'Allocated Principal', 'Status', ''].map((h) => (
                    <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {funders.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedFunderId(f.id)}>
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap">{f.name}</td>
                    <td className="px-3 py-2.5 text-gray-500">{[f.email, f.phone].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2.5 font-bold text-blue-700 whitespace-nowrap">{fmt(f.balance)}</td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{fmt(f.allocatedPrincipal)}</td>
                    <td className="px-3 py-2.5">
                      {f.isActive
                        ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Active</span>
                        : <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs font-medium">Inactive</span>}
                    </td>
                    <td className="px-3 py-2.5 text-blue-600">View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LoanAllocationTool />

      {showAddFunder && (
        <AddFunderModal
          onClose={() => setShowAddFunder(false)}
          onCreated={() => { setShowAddFunder(false); loadFunders(); }}
        />
      )}

      {selectedFunderId && (
        <FunderDetailModal
          funderId={selectedFunderId}
          onClose={() => setSelectedFunderId(null)}
          onChanged={loadFunders}
        />
      )}
    </div>
  );
}

function AddFunderModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    setSubmitting(true); setErr('');
    try {
      await createFunder({ name: name.trim(), email: email || undefined, phone: phone || undefined });
      onCreated();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to create funder');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Add Funder</h2>
        {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email (optional)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Phone (optional)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button disabled={submitting} onClick={submit}
            className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
            {submitting ? 'Saving…' : 'Add Funder'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FunderDetailModal({ funderId, onClose, onChanged }: { funderId: string; onClose: () => void; onChanged: () => void }) {
  const [funder, setFunder] = useState<Funder | null>(null);
  const [transactions, setTransactions] = useState<FunderTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showTxnForm, setShowTxnForm] = useState(false);
  const [editingActive, setEditingActive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getFunderDetail(funderId, 1, 50);
      setFunder(r.funder);
      setTransactions(r.transactions);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load funder');
    } finally { setLoading(false); }
  }, [funderId]);

  useEffect(() => { load(); }, [load]);

  async function toggleActive() {
    if (!funder) return;
    setEditingActive(true);
    try {
      await updateFunder(funder.id, { isActive: !funder.isActive });
      await load();
      onChanged();
    } finally { setEditingActive(false); }
  }

  async function reverse(txnId: string) {
    const reason = window.prompt('Reason for reversing this transaction?');
    if (!reason?.trim()) return;
    try {
      await reverseFunderTransaction(funderId, txnId, reason.trim());
      await load();
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to reverse transaction');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : !funder ? (
          <div className="py-16 text-center text-red-500 text-sm">{err || 'Funder not found'}</div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{funder.name}</h2>
                <p className="text-xs text-gray-500">{[funder.email, funder.phone].filter(Boolean).join(' · ') || 'No contact info'}</p>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
            </div>

            {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-600">Capital Balance</p>
                <p className="text-lg font-bold text-blue-700 mt-1">{fmt(funder.balance)}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-3">
                <p className="text-xs text-gray-500">Allocated Principal</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{fmt(funder.allocatedPrincipal)}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-3 flex flex-col justify-between">
                <p className="text-xs text-gray-500">Status</p>
                <button disabled={editingActive} onClick={toggleActive}
                  className={`mt-1 text-xs font-medium px-2 py-1 rounded w-fit ${funder.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {funder.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">Transaction History</h3>
              <button onClick={() => setShowTxnForm(true)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">
                + Post Transaction
              </button>
            </div>

            <div className="border border-gray-100 rounded-xl overflow-hidden">
              {transactions.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">No transactions yet</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Date', 'Type', 'Amount', 'Reference', 'Notes', 'Status', ''].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {transactions.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{fmtDate(t.transactionDate)}</td>
                        <td className="px-3 py-2">{t.transactionType}</td>
                        <td className={`px-3 py-2 font-bold whitespace-nowrap ${t.amount >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(t.amount)}</td>
                        <td className="px-3 py-2 text-gray-400">{t.referenceNumber || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{t.notes || '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${t.status === 'REVERSED' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>{t.status}</span>
                        </td>
                        <td className="px-3 py-2">
                          {t.status === 'POSTED' && !t.reversalOfId && (
                            <button onClick={() => reverse(t.id)} className="text-red-500 hover:underline">Reverse</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {showTxnForm && funder && (
        <PostTransactionModal
          funderId={funder.id}
          onClose={() => setShowTxnForm(false)}
          onPosted={() => { setShowTxnForm(false); load(); onChanged(); }}
        />
      )}
    </div>
  );
}

function PostTransactionModal({ funderId, onClose, onPosted }: { funderId: string; onClose: () => void; onPosted: () => void }) {
  const [type, setType] = useState<FunderTransactionType>('CONTRIBUTION');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const n = parseFloat(amount);
    if (!n) { setErr('Enter a valid amount'); return; }
    if (type !== 'ADJUSTMENT' && n <= 0) { setErr('Amount must be positive'); return; }
    setSubmitting(true); setErr('');
    try {
      await postFunderTransaction(funderId, {
        transactionType: type, amount: n, transactionDate: date,
        referenceNumber: reference || undefined, notes: notes || undefined,
      });
      onPosted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to post transaction');
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Post Funder Transaction</h2>
        {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <select value={type} onChange={(e) => setType(e.target.value as FunderTransactionType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TXN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹){type === 'ADJUSTMENT' && ' — signed'}</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reference # (optional)</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button disabled={submitting} onClick={submit}
            className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
            {submitting ? 'Posting…' : 'Post Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Explicit-allocation-model tool: search a loan, then declare which funder(s) financed it. */
function LoanAllocationTool() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Loan[]>([]);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [allocations, setAllocations] = useState<LoanFunderAllocations | null>(null);
  const [funders, setFunders] = useState<Funder[]>([]);
  const [rows, setRows] = useState<{ funderId: string; amount: string }[]>([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFunders(1, 200, true).then((r) => setFunders(r.data)).catch(() => {});
  }, []);

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

  async function selectLoan(loan: Loan) {
    setSelectedLoan(loan);
    setResults([]);
    setSearch(loan.loanNumber);
    setErr('');
    try {
      const alloc = await getLoanFunderAllocations(loan.id);
      setAllocations(alloc);
      setRows(alloc.allocations.length > 0
        ? alloc.allocations.map((a) => ({ funderId: a.funderId, amount: String(a.amount) }))
        : [{ funderId: '', amount: '' }]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load allocations');
    }
  }

  function addRow() { setRows([...rows, { funderId: '', amount: '' }]); }
  function removeRow(i: number) { setRows(rows.filter((_, idx) => idx !== i)); }
  function updateRow(i: number, patch: Partial<{ funderId: string; amount: string }>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const rowsTotal = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  async function save() {
    if (!selectedLoan) return;
    const parsed = rows.filter((r) => r.funderId && r.amount).map((r) => ({ funderId: r.funderId, amount: parseFloat(r.amount) }));
    setSaving(true); setErr('');
    try {
      const result = await setLoanFunderAllocations(selectedLoan.id, parsed);
      setAllocations(result);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save allocation');
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-700">Allocate a Loan to Funders</h2>
      <p className="text-xs text-gray-500">Explicit allocation: every rupee disbursed must be assigned to a specific funder.</p>

      <div className="relative max-w-sm">
        <input value={search} onChange={(e) => { setSearch(e.target.value); setSelectedLoan(null); setAllocations(null); }}
          placeholder="Search loan number, customer name or phone…"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full border border-gray-200 rounded-lg overflow-hidden bg-white shadow-lg">
            {results.map((l) => (
              <button key={l.id} onClick={() => selectLoan(l)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b last:border-0">
                <span className="font-medium">{l.loanNumber}</span> — {l.customerName} · {fmt(l.principal)}
              </button>
            ))}
          </div>
        )}
      </div>

      {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

      {selectedLoan && allocations && (
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap gap-4 text-xs text-gray-600">
            <span>Loan Principal: <strong className="text-gray-900">{fmt(allocations.principal)}</strong></span>
            <span>Allocated: <strong className="text-gray-900">{fmt(allocations.allocated)}</strong></span>
            <span className={allocations.unallocated !== 0 ? 'text-orange-600' : 'text-green-600'}>
              Unallocated: <strong>{fmt(allocations.unallocated)}</strong>
            </span>
          </div>

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={r.funderId} onChange={(e) => updateRow(i, { funderId: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select funder…</option>
                  {funders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <input type="number" value={r.amount} onChange={(e) => updateRow(i, { amount: e.target.value })}
                  placeholder="Amount"
                  className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500 px-2">✕</button>
              </div>
            ))}
            <button onClick={addRow} className="text-xs text-blue-600 hover:underline">+ Add another funder</button>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className={`text-xs ${Math.abs(rowsTotal - allocations.principal) > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
              Row total: {fmt(rowsTotal)} {Math.abs(rowsTotal - allocations.principal) > 0.01 && `(must equal ${fmt(allocations.principal)})`}
            </p>
            <button disabled={saving} onClick={save}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">
              {saving ? 'Saving…' : 'Save Allocation'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
