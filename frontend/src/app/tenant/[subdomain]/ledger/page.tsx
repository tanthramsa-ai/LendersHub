'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getLedgerCredits, getLedgerDebits, getLedgerPrincipal, getLedgerTransactions,
  addLedgerTransaction, getCustomers, getTenantSession, MANAGER_ROLES,
  LedgerEntry, PrincipalTxn, ManualTransaction,
} from '@/services/tenant-api';

type Tab = 'credits' | 'debits' | 'principal' | 'transactions';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const CATEGORIES = [
  'CASH_IN', 'CASH_OUT', 'BANK_DEPOSIT', 'BANK_WITHDRAWAL',
  'AGENT_TRANSFER', 'CUSTOMER_TRANSFER', 'EXPENSE', 'OTHER',
];

export default function LedgerPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;
  const session = getTenantSession();
  const canAdd = MANAGER_ROLES.includes(session?.user.role ?? 'VIEWER');

  const [tab, setTab] = useState<Tab>('credits');
  const [month, setMonth] = useState(thisMonth());
  const [applyMonth, setApplyMonth] = useState(true);
  const [page, setPage] = useState(1);

  // Data
  const [credits, setCredits] = useState<LedgerEntry[]>([]);
  const [debits, setDebits] = useState<LedgerEntry[]>([]);
  const [principal, setPrincipal] = useState<PrincipalTxn[]>([]);
  const [transactions, setTransactions] = useState<ManualTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Add transaction modal
  const [showModal, setShowModal] = useState(false);
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [txnType, setTxnType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [txnAmount, setTxnAmount] = useState('');
  const [txnCategory, setTxnCategory] = useState('CASH_IN');
  const [txnAccount, setTxnAccount] = useState('');
  const [txnEntityType, setTxnEntityType] = useState('');
  const [txnEntitySearch, setTxnEntitySearch] = useState('');
  const [txnEntityId, setTxnEntityId] = useState('');
  const [txnEntityName, setTxnEntityName] = useState('');
  const [txnDesc, setTxnDesc] = useState('');
  const [txnRef, setTxnRef] = useState('');
  const [txnErr, setTxnErr] = useState('');
  const [txnSubmitting, setTxnSubmitting] = useState(false);
  const [entityResults, setEntityResults] = useState<Array<{ id: string; name: string; phone: string }>>([]);

  const limit = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const m = applyMonth ? month : undefined;
      if (tab === 'credits') {
        const r = await getLedgerCredits(page, limit, m);
        setCredits(r.data); setTotal(r.total);
      } else if (tab === 'debits') {
        const r = await getLedgerDebits(page, limit, m);
        setDebits(r.data); setTotal(r.total);
      } else if (tab === 'principal') {
        const r = await getLedgerPrincipal(page, limit, m);
        setPrincipal(r.data); setTotal(r.total);
      } else {
        const r = await getLedgerTransactions(page, limit, m);
        setTransactions(r.data); setTotal(r.total);
      }
    } finally { setLoading(false); }
  }, [tab, page, month, applyMonth]);

  useEffect(() => { setPage(1); }, [tab, month, applyMonth]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!txnEntitySearch || txnEntitySearch.length < 2 || txnEntityType !== 'customer') {
      setEntityResults([]); return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await getCustomers(1, 8, txnEntitySearch);
        setEntityResults(r.data.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, phone: c.phone })));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [txnEntitySearch, txnEntityType]);

  async function submitTransaction() {
    if (!txnAmount || parseFloat(txnAmount) <= 0) { setTxnErr('Enter a valid amount'); return; }
    setTxnSubmitting(true); setTxnErr('');
    try {
      await addLedgerTransaction({
        transactionDate: txnDate, type: txnType, amount: parseFloat(txnAmount),
        category: txnCategory, accountName: txnAccount || undefined,
        entityType: txnEntityType || undefined, entityId: txnEntityId || undefined,
        entityName: txnEntityName || undefined,
        description: txnDesc || undefined, referenceNumber: txnRef || undefined,
      });
      setShowModal(false);
      setTxnAmount(''); setTxnDesc(''); setTxnRef(''); setTxnEntitySearch(''); setTxnEntityId(''); setTxnEntityName('');
      if (tab === 'transactions') load();
    } catch (e: unknown) {
      setTxnErr(e instanceof Error ? e.message : 'Failed to add transaction');
    } finally { setTxnSubmitting(false); }
  }

  const TABS: { key: Tab; label: string; color: string }[] = [
    { key: 'credits', label: 'Credits', color: 'text-green-700' },
    { key: 'debits', label: 'Debits', color: 'text-red-700' },
    { key: 'principal', label: 'Principal Fund', color: 'text-blue-700' },
    { key: 'transactions', label: 'Transactions', color: 'text-gray-700' },
  ];

  const creditTotal = credits.reduce((s, c) => s + c.amount, 0);
  const debitTotal = debits.reduce((s, d) => s + d.amount, 0);
  const principalIn = principal.filter((p) => p.direction === 'CREDIT').reduce((s, p) => s + p.amount, 0);
  const principalOut = principal.filter((p) => p.direction === 'DEBIT').reduce((s, p) => s + p.amount, 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Financial Ledger</h1>
          <p className="text-sm text-gray-500">Credits · Debits · Principal Fund</p>
        </div>
        {canAdd && (
          <button onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Add Transaction
          </button>
        )}
      </div>

      {/* Month filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <input type="checkbox" id="applyMonth" checked={applyMonth} onChange={(e) => setApplyMonth(e.target.checked)}
            className="rounded" />
          <label htmlFor="applyMonth" className="text-sm text-gray-600">Filter by month</label>
        </div>
        {applyMonth && (
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        )}
      </div>

      {/* Summary cards (credits/debits tab) */}
      {tab === 'credits' && credits.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-green-50 border border-green-100 rounded-xl p-4">
            <p className="text-xs text-green-600">Total Credits</p>
            <p className="text-xl font-bold text-green-700 mt-1">{fmt(creditTotal)}</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs text-gray-500">Cash Credits</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{fmt(credits.filter((c) => c.isCash).reduce((s, c) => s + c.amount, 0))}</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs text-gray-500">Bank/UPI Credits</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{fmt(credits.filter((c) => !c.isCash).reduce((s, c) => s + c.amount, 0))}</p>
          </div>
        </div>
      )}
      {tab === 'debits' && debits.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <p className="text-xs text-red-600">Total Debits</p>
            <p className="text-xl font-bold text-red-700 mt-1">{fmt(debitTotal)}</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs text-gray-500">Loan Disbursements</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{fmt(debits.filter((d) => d.category === 'LOAN_DISBURSEMENT').reduce((s, d) => s + d.amount, 0))}</p>
          </div>
        </div>
      )}
      {tab === 'principal' && principal.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-xs text-blue-600">Principal In</p>
            <p className="text-xl font-bold text-blue-700 mt-1">{fmt(principalIn)}</p>
          </div>
          <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
            <p className="text-xs text-orange-600">Principal Out</p>
            <p className="text-xl font-bold text-orange-700 mt-1">{fmt(principalOut)}</p>
          </div>
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-xs text-gray-500">Net Position</p>
            <p className={`text-xl font-bold mt-1 ${principalIn - principalOut >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(principalIn - principalOut)}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <>
            {/* Credits */}
            {tab === 'credits' && (
              <>
                {credits.length === 0 ? (
                  <div className="py-16 text-center text-gray-400 text-sm">No credits found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Date', 'Amount', 'Account / Method', 'Customer', 'Loan / Description', 'Reference', 'Category'].map((h) => (
                            <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {credits.map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(c.date)}</td>
                            <td className="px-3 py-2.5 font-bold text-green-700 whitespace-nowrap">{fmt(c.amount)}</td>
                            <td className="px-3 py-2.5">
                              {c.isCash
                                ? <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">Cash</span>
                                : <span className="text-gray-700">{c.displayAccount}</span>}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{c.entityName || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-500 font-mono">{c.description || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-400">{c.referenceNumber || '—'}</td>
                            <td className="px-3 py-2.5">
                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{c.category.replace(/_/g, ' ')}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Debits */}
            {tab === 'debits' && (
              <>
                {debits.length === 0 ? (
                  <div className="py-16 text-center text-gray-400 text-sm">No debits found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Date', 'Amount', 'Method', 'To (Entity)', 'Description', 'Category'].map((h) => (
                            <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {debits.map((d) => (
                          <tr key={d.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(d.date)}</td>
                            <td className="px-3 py-2.5 font-bold text-red-700 whitespace-nowrap">{fmt(d.amount)}</td>
                            <td className="px-3 py-2.5">
                              {d.isCash
                                ? <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">Cash</span>
                                : <span className="text-gray-700">{d.displayAccount}</span>}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{d.entityName || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-500 font-mono">{d.description || '—'}</td>
                            <td className="px-3 py-2.5">
                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{d.category.replace(/_/g, ' ')}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Principal */}
            {tab === 'principal' && (
              <>
                {principal.length === 0 ? (
                  <div className="py-16 text-center text-gray-400 text-sm">No principal transactions found</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Date', 'Direction', 'Amount', 'Customer', 'Loan #', 'Description'].map((h) => (
                            <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {principal.map((p) => (
                          <tr key={p.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(p.date)}</td>
                            <td className="px-3 py-2.5">
                              {p.direction === 'CREDIT'
                                ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">↑ In</span>
                                : <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">↓ Out</span>}
                            </td>
                            <td className={`px-3 py-2.5 font-bold whitespace-nowrap ${p.direction === 'CREDIT' ? 'text-green-700' : 'text-red-700'}`}>
                              {p.direction === 'CREDIT' ? '+' : '-'}{fmt(p.amount)}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700">{p.entityName}</td>
                            <td className="px-3 py-2.5 font-mono text-blue-600">{p.reference}</td>
                            <td className="px-3 py-2.5 text-gray-500">{p.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Manual transactions */}
            {tab === 'transactions' && (
              <>
                {transactions.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-gray-400 text-sm mb-3">No manual transactions found</p>
                    {canAdd && <button onClick={() => setShowModal(true)} className="text-sm text-blue-600 hover:underline">Add first transaction</button>}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          {['Date', 'Type', 'Amount', 'Category', 'Account', 'Entity', 'Description', 'Ref #', 'By'].map((h) => (
                            <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {transactions.map((t) => (
                          <tr key={t.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(t.date)}</td>
                            <td className="px-3 py-2.5">
                              {t.type === 'CREDIT'
                                ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Credit</span>
                                : <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">Debit</span>}
                            </td>
                            <td className={`px-3 py-2.5 font-bold whitespace-nowrap ${t.type === 'CREDIT' ? 'text-green-700' : 'text-red-700'}`}>
                              {fmt(t.amount)}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">{t.category.replace(/_/g, ' ')}</span>
                            </td>
                            <td className="px-3 py-2.5">
                              {t.isCash
                                ? <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">Cash</span>
                                : <span className="text-gray-600">{t.accountName}</span>}
                            </td>
                            <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{t.entityName || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-500">{t.description || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-400">{t.referenceNumber || '—'}</td>
                            <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">{t.createdByName || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* Pagination */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-500">Showing {Math.min((page-1)*limit+1, total)}–{Math.min(page*limit, total)} of {total}</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page-1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button disabled={page*limit >= total} onClick={() => setPage(page+1)} className="px-3 py-1 text-xs border rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add Transaction Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900">Add Transaction</h2>
            {txnErr && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{txnErr}</p>}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select value={txnType} onChange={(e) => { setTxnType(e.target.value as 'CREDIT' | 'DEBIT'); setTxnCategory(e.target.value === 'CREDIT' ? 'CASH_IN' : 'CASH_OUT'); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="CREDIT">Credit (In)</option>
                  <option value="DEBIT">Debit (Out)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹)</label>
                <input type="number" value={txnAmount} onChange={(e) => setTxnAmount(e.target.value)} min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select value={txnCategory} onChange={(e) => setTxnCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Account / Bank Name (leave blank for Cash)</label>
                <input value={txnAccount} onChange={(e) => setTxnAccount(e.target.value)}
                  placeholder="e.g. HDFC Bank, SBI… (blank = Cash)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Entity Type</label>
                <select value={txnEntityType} onChange={(e) => { setTxnEntityType(e.target.value); setTxnEntitySearch(''); setTxnEntityId(''); setTxnEntityName(''); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">None</option>
                  <option value="customer">Customer</option>
                  <option value="agent">Agent</option>
                </select>
              </div>
              {txnEntityType === 'customer' && (
                <div className="col-span-2 space-y-1">
                  <label className="block text-xs font-medium text-gray-600">Search Customer</label>
                  <input value={txnEntitySearch} onChange={(e) => setTxnEntitySearch(e.target.value)}
                    placeholder="Type name or phone…"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {entityResults.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      {entityResults.map((e) => (
                        <button key={e.id} onClick={() => { setTxnEntityId(e.id); setTxnEntityName(e.name); setTxnEntitySearch(e.name); setEntityResults([]); }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b last:border-0">
                          <span className="font-medium">{e.name}</span> <span className="text-gray-400">{e.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {txnEntityId && <p className="text-xs text-green-600">✓ {txnEntityName}</p>}
                </div>
              )}
              {txnEntityType === 'agent' && (
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Agent Name</label>
                  <input value={txnEntityName} onChange={(e) => setTxnEntityName(e.target.value)}
                    placeholder="Enter agent name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input value={txnDesc} onChange={(e) => setTxnDesc(e.target.value)}
                  placeholder="Optional description…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Reference #</label>
                <input value={txnRef} onChange={(e) => setTxnRef(e.target.value)}
                  placeholder="Transaction ID, cheque #…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button disabled={txnSubmitting} onClick={submitTransaction}
                className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
                {txnSubmitting ? 'Saving…' : 'Save Transaction'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
