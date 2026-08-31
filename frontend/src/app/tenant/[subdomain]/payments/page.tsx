'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getWebhookConfig, setWebhookSecret, getUnmatchedPayments, getProcessedPayments,
  matchPaymentEvent, rejectPaymentEvent, getLoans, getLoan,
  WebhookProviderConfig, IncomingPaymentEvent, Loan,
} from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDateTime(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type Tab = 'unmatched' | 'processed' | 'config';

export default function DirectPaymentsPage() {
  const [tab, setTab] = useState<Tab>('unmatched');
  const TABS: { key: Tab; label: string }[] = [
    { key: 'unmatched', label: 'Unmatched Payments' },
    { key: 'processed', label: 'Processed / Rejected' },
    { key: 'config', label: 'Webhook Configuration' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Direct Payments</h1>
        <p className="text-sm text-gray-500">
          Payments received via a bank/UPI/payment gateway webhook, matched to loans manually.
          No provider is wired up yet — see Webhook Configuration.
        </p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'unmatched' && <UnmatchedTab />}
      {tab === 'processed' && <ProcessedTab />}
      {tab === 'config' && <ConfigTab />}
    </div>
  );
}

function UnmatchedTab() {
  const [events, setEvents] = useState<IncomingPaymentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [matchingId, setMatchingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getUnmatchedPayments(1, 100);
      setEvents(r.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : events.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No unmatched payments</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {['Received', 'Provider', 'Amount', 'Method', 'Reference', 'Payer', ''].map((h) => (
                    <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {events.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDateTime(e.receivedAt)}</td>
                    <td className="px-3 py-2.5">{e.provider}</td>
                    <td className="px-3 py-2.5 font-bold text-green-700 whitespace-nowrap">{fmt(e.amount)}</td>
                    <td className="px-3 py-2.5 text-gray-500">{e.paymentMethod || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-400 font-mono">{e.externalReference}</td>
                    <td className="px-3 py-2.5 text-gray-500">{[e.payerName, e.payerContact].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2.5">
                      <button onClick={() => setMatchingId(e.id)} className="text-blue-600 hover:underline">Match / Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {matchingId && (
        <MatchModal
          event={events.find((e) => e.id === matchingId)!}
          onClose={() => setMatchingId(null)}
          onDone={() => { setMatchingId(null); load(); }}
        />
      )}
    </div>
  );
}

function MatchModal({ event, onClose, onDone }: { event: IncomingPaymentEvent; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Loan[]>([]);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [installments, setInstallments] = useState<{ id: string; number: number; dueDate: string; total: number; paid: number; status: string }[]>([]);
  const [installmentId, setInstallmentId] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await getLoans(1, 8, { search: search.trim(), status: 'DISBURSED' });
        setResults(r.data);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function selectLoan(loan: Loan) {
    setSelectedLoan(loan);
    setResults([]);
    setSearch(loan.loanNumber);
    setInstallmentId('');
    try {
      const detail = await getLoan(loan.id) as unknown as { installments: { id: string; number: number; dueDate: string; total: number; paid: number; status: string }[] };
      setInstallments((detail.installments ?? []).filter((i) => i.status !== 'PAID'));
    } catch { setInstallments([]); }
  }

  async function submitMatch() {
    if (!selectedLoan) { setErr('Select a loan first'); return; }
    setBusy(true); setErr('');
    try {
      await matchPaymentEvent(event.id, selectedLoan.id, installmentId || undefined);
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to match payment');
    } finally { setBusy(false); }
  }

  async function submitReject() {
    if (!rejectReason.trim()) { setErr('A reason is required'); return; }
    setBusy(true); setErr('');
    try {
      await rejectPaymentEvent(event.id, rejectReason.trim());
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to reject payment');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Match Payment</h2>
            <p className="text-xs text-gray-500">{fmt(event.amount)} via {event.provider} · Ref {event.externalReference}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
        </div>

        {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

        {!showReject ? (
          <>
            <div className="relative">
              <label className="block text-xs font-medium text-gray-600 mb-1">Loan</label>
              <input value={search} onChange={(e) => { setSearch(e.target.value); setSelectedLoan(null); }}
                placeholder="Search loan number, customer name or phone…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full border border-gray-200 rounded-lg overflow-hidden bg-white shadow-lg">
                  {results.map((l) => (
                    <button key={l.id} onClick={() => selectLoan(l)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b last:border-0">
                      <span className="font-medium">{l.loanNumber}</span> — {l.customerName} · {fmt(l.outstanding)} outstanding
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedLoan && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Installment (optional — leave blank to record as unallocated)</label>
                <select value={installmentId} onChange={(e) => setInstallmentId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">None — unallocated</option>
                  {installments.map((i) => (
                    <option key={i.id} value={i.id}>
                      #{i.number} due {new Date(i.dueDate).toLocaleDateString('en-IN')} — balance {fmt(i.total - i.paid)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowReject(true)} className="flex-1 py-2 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
                Reject Instead
              </button>
              <button disabled={busy || !selectedLoan} onClick={submitMatch}
                className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
                {busy ? 'Matching…' : 'Match & Post'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason for rejecting</label>
              <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. duplicate webhook, test transaction, unresolvable"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowReject(false)} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
              <button disabled={busy} onClick={submitReject}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-40">
                {busy ? 'Rejecting…' : 'Reject Payment'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProcessedTab() {
  const [events, setEvents] = useState<IncomingPaymentEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getProcessedPayments(1, 100).then((r) => setEvents(r.data)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
      ) : events.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">No processed payments yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {['Processed', 'Provider', 'Amount', 'Reference', 'Status', 'Detail'].map((h) => (
                  <th key={h} className="px-3 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDateTime(e.processedAt)}</td>
                  <td className="px-3 py-2.5">{e.provider}</td>
                  <td className="px-3 py-2.5 font-bold whitespace-nowrap">{fmt(e.amount)}</td>
                  <td className="px-3 py-2.5 text-gray-400 font-mono">{e.externalReference}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${e.status === 'POSTED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{e.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">{e.rejectionReason || (e.matchedLoanId ? 'Matched to loan' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfigTab() {
  const [providers, setProviders] = useState<WebhookProviderConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getWebhookConfig();
      setProviders(r);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveSecret(provider: string) {
    const secret = secretInputs[provider];
    if (!secret?.trim()) { setErr('Enter a secret first'); return; }
    setSavingProvider(provider); setErr('');
    try {
      await setWebhookSecret(provider, secret.trim());
      setSecretInputs((s) => ({ ...s, [provider]: '' }));
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to save secret');
    } finally { setSavingProvider(null); }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg p-3">
        Only a placeholder &quot;generic&quot; adapter exists so far — no real gateway (Razorpay, Cashfree, etc.)
        is wired up. Give the URL below to that adapter for testing; a real provider needs its own adapter added
        server-side before it can be selected here.
      </p>
      {err && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{err}</p>}

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div key={p.provider} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-800 capitalize">{p.provider}</h3>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.configured ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {p.configured ? 'Configured' : 'Not configured'}
                </span>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Webhook URL</p>
                <code className="block text-xs bg-gray-50 border border-gray-100 rounded px-2 py-1.5 break-all">{p.webhookUrl}</code>
              </div>
              <div className="flex gap-2">
                <input type="password" value={secretInputs[p.provider] ?? ''} onChange={(e) => setSecretInputs((s) => ({ ...s, [p.provider]: e.target.value }))}
                  placeholder={p.configured ? 'Replace secret…' : 'Set shared secret…'}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button disabled={savingProvider === p.provider} onClick={() => saveSecret(p.provider)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-40">
                  {savingProvider === p.provider ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
