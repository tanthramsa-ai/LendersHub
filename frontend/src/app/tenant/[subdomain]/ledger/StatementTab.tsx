'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  createLedgerEntry, deleteLedgerEntry, downloadStatement, getBranches, getOfficers, getStatementBreakdown,
  getStatementSummary, getStatementTransactions,
  LedgerEntryInput, Officer, StatementBreakdownRow, StatementBucket, StatementPage, StatementParams, StatementPeriod,
  StatementRow, StatementSummary, TenantBranch, UserRole,
} from '@/services/tenant-api';

type View = 'all' | 'principal' | 'interest' | 'cashbank' | 'loan-type' | 'agent' | 'branch';

const VIEWS: { key: View; label: string }[] = [
  { key: 'all', label: 'All transactions' },
  { key: 'principal', label: 'Principal' },
  { key: 'interest', label: 'Interest' },
  { key: 'cashbank', label: 'Cash & bank' },
  { key: 'loan-type', label: 'By loan type' },
  { key: 'agent', label: 'By agent' },
  { key: 'branch', label: 'By branch' },
];

const KINDS: [string, string][] = [
  ['DISBURSEMENT', 'Disbursement'], ['COLLECTION_PRINCIPAL', 'Collection – Principal'], ['COLLECTION_INTEREST', 'Collection – Interest'],
  ['COLLECTION_OTHER', 'Collection – Fees & other'], ['REFUND', 'Refund'], ['FEE_INCOME', 'Fee income'],
  ['CASH_IN', 'Cash deposit'], ['CASH_OUT', 'Cash withdrawal'], ['BANK_IN', 'Bank deposit'], ['BANK_OUT', 'Bank withdrawal'],
  ['TRANSFER', 'Transfer'], ['ADJUSTMENT', 'Adjustment'],
];

const ENTRY_TYPES: { key: LedgerEntryInput['type']; label: string }[] = [
  { key: 'CASH_IN', label: 'Cash deposit (money in)' },
  { key: 'CASH_OUT', label: 'Cash withdrawal (money out)' },
  { key: 'BANK_IN', label: 'Bank deposit (money in)' },
  { key: 'BANK_OUT', label: 'Bank withdrawal (money out)' },
  { key: 'TRANSFER', label: 'Transfer between accounts' },
  { key: 'ADJUSTMENT', label: 'Adjustment / correction' },
];

const LOAN_PATH: Record<string, string> = {
  WEEKLY: 'weekly-loans', DAILY_NO_SUNDAY: 'daily-loans', DAILY_WITH_SUNDAY: 'daily-loans',
  MONTHLY: 'monthly-loans', AGENT_RISK: 'agent-risk-loans',
};

const inr = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function allowedViews(role: UserRole): View[] {
  if (role === 'OWNER' || role === 'ADMIN') return VIEWS.map((v) => v.key);
  if (role === 'MANAGER') return ['all', 'principal', 'interest', 'loan-type', 'agent', 'branch'];
  return ['all'];
}

function Card({ label, value, sub, tone = 'default', negativeNote }: {
  label: string; value: string; sub?: string; tone?: 'default' | 'green' | 'red' | 'blue' | 'orange'; negativeNote?: boolean;
}) {
  const tones = {
    default: 'bg-white border-gray-100', green: 'bg-green-50 border-green-100', red: 'bg-red-50 border-red-100',
    blue: 'bg-blue-50 border-blue-100', orange: 'bg-orange-50 border-orange-100',
  } as const;
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`} title={negativeNote ? 'Negative: more has gone out than has been recorded coming in. Record opening balances and capital with a Cash/Bank deposit entry.' : undefined}>
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-1 ${negativeNote ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function KindBadge({ row }: { row: StatementRow }) {
  const out = row.debit !== null, inn = row.credit !== null;
  const cls = out ? 'bg-red-50 text-red-700' : inn ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${cls}`}>{row.kindLabel}</span>;
}

export default function StatementTab({ subdomain, role }: { subdomain: string; role: UserRole }) {
  const isFull = role === 'OWNER' || role === 'ADMIN';
  const canPost = isFull || role === 'MANAGER';
  const views = allowedViews(role);

  // Period
  const [fy, setFy] = useState<number | undefined>(undefined);
  const [period, setPeriod] = useState<StatementPeriod>('monthly');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const periodSig = `${fy}|${period}|${from}|${to}`;
  const [bucketState, setBucketState] = useState<{ sig: string; bucket: StatementBucket | null }>({ sig: '', bucket: null });
  // The month/quarter picked in the breakdown table; forgotten as soon as the period changes.
  const bucket = bucketState.sig === periodSig ? bucketState.bucket : null;
  const setBucket = (b: StatementBucket | null) => setBucketState({ sig: periodSig, bucket: b });

  // Filters
  const [view, setView] = useState<View>('all');
  const [kind, setKind] = useState('');
  const [mode, setMode] = useState('');
  const [agentId, setAgentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const filterSig = `${periodSig}|${bucket?.key ?? ''}|${view}|${kind}|${mode}|${agentId}|${branchId}|${q}|${order}`;
  const [pageState, setPageState] = useState({ sig: '', page: 1 });
  // Any change to a filter, the period or the sort goes back to page 1.
  const page = pageState.sig === filterSig ? pageState.page : 1;
  const setPage = (p: number) => setPageState({ sig: filterSig, page: p });
  const limit = 50;

  // Data
  const [summary, setSummary] = useState<StatementSummary | null>(null);
  const [grid, setGrid] = useState<StatementPage | null>(null);
  const [breakdown, setBreakdown] = useState<StatementBreakdownRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [branches, setBranches] = useState<TenantBranch[]>([]);

  // Actions
  const [busy, setBusy] = useState<'excel' | 'pdf' | 'print' | null>(null);
  const [printRows, setPrintRows] = useState<StatementRow[] | null>(null);
  const [showEntry, setShowEntry] = useState(false);

  const periodParams: StatementParams = useMemo(() => ({
    fy, period, ...(period === 'custom' ? { from: from || undefined, to: to || undefined } : {}),
  }), [fy, period, from, to]);

  const filterParams: StatementParams = useMemo(() => ({
    ...(view === 'principal' || view === 'interest' || view === 'cashbank' ? { group: view } : {}),
    kind: kind || undefined, mode: mode || undefined, agentId: agentId || undefined, branchId: branchId || undefined, q: q || undefined,
  }), [view, kind, mode, agentId, branchId, q]);

  /** What the grid / exports use: the chosen period, narrowed to one bucket if one is selected. */
  const gridPeriod: StatementParams = useMemo(
    () => (bucket ? { fy, period: 'custom' as const, from: bucket.from, to: bucket.to } : periodParams),
    [bucket, fy, periodParams],
  );

  useEffect(() => { const t = setTimeout(() => setQ(searchText.trim()), 300); return () => clearTimeout(t); }, [searchText]);

  useEffect(() => {
    if (role === 'AGENT') return;
    getOfficers().then(setOfficers).catch(() => setOfficers([]));
    getBranches().then((b) => setBranches(b.filter((x) => x.isActive))).catch(() => setBranches([]));
  }, [role]);

  // Summary: cards + buckets, for the selected period only
  useEffect(() => {
    if (period === 'custom' && (!from || !to || from > to)) return;
    let cancelled = false;
    getStatementSummary(periodParams)
      .then((s) => { if (!cancelled) { setSummary(s); setError(''); if (fy === undefined) setFy(s.fy); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load the summary'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodParams, refresh]);

  // Grid or breakdown
  const groupedView = view === 'loan-type' || view === 'agent' || view === 'branch';
  const load = useCallback(async () => {
    if (period === 'custom' && !bucket && (!from || !to || from > to)) return;
    setLoading(true);
    try {
      if (groupedView) {
        const r = await getStatementBreakdown(gridPeriod, view as 'loan-type' | 'agent' | 'branch');
        setBreakdown(r.rows); setGrid(null);
      } else {
        const r = await getStatementTransactions({ ...gridPeriod, ...filterParams, order, page, limit });
        setGrid(r); setBreakdown(null);
      }
      setError('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load the ledger');
    } finally { setLoading(false); }
  }, [period, bucket, from, to, groupedView, gridPeriod, view, filterParams, order, page]);
  // Fetching when the period/filters/page change is what this effect is for; load() owns the loading flag.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load, refresh]);

  const pages = grid ? Math.max(1, Math.ceil(grid.total / limit)) : 1;
  const cards = summary?.cards;
  const customIncomplete = period === 'custom' && (!from || !to || from > to);

  // ── actions ────────────────────────────────────────────────────────────────
  async function download(kindOf: 'excel' | 'pdf') {
    setBusy(kindOf); setError('');
    try { await downloadStatement(kindOf, { ...gridPeriod, ...filterParams }); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Download failed'); }
    finally { setBusy(null); }
  }

  /** Print everything that matches (not just the page on screen), in a print-only layout. */
  async function printAll() {
    setBusy('print'); setError('');
    try {
      const rows: StatementRow[] = [];
      for (let p = 1; p <= 15; p++) {
        const r = await getStatementTransactions({ ...gridPeriod, ...filterParams, order: 'asc', page: p, limit: 200 });
        rows.push(...r.rows);
        if (rows.length >= r.total) break;
      }
      setPrintRows(rows);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not prepare the print view'); }
    finally { setBusy(null); }
  }
  useEffect(() => {
    if (!printRows) return;
    const done = () => setPrintRows(null);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 80);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printRows]);

  async function removeEntry(row: StatementRow) {
    const reason = window.prompt(`Delete this ${row.kindLabel.toLowerCase()} of ${inr(row.credit ?? row.debit)}?\nOptional reason:`);
    if (reason === null) return;
    try { await deleteLedgerEntry(row.sourceId, reason || undefined); setRefresh((n) => n + 1); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Could not delete the entry'); }
  }

  const loanHref = (r: StatementRow) => r.loanId ? `/${subdomain}/${LOAN_PATH[r.loanType ?? ''] ?? 'loans'}/${r.loanId}` : null;

  return (
    <div className="space-y-4">
      <style>{`
        #statement-print-root { display: none; }
        @media print {
          body > *:not(#statement-print-root) { display: none !important; }
          #statement-print-root { display: block !important; padding: 0; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      `}</style>

      {/* Period + actions */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Financial year</label>
          <select value={fy ?? ''} onChange={(e) => setFy(Number(e.target.value))}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            {(summary?.availableFys ?? (fy ? [fy] : [])).map((y) => <option key={y} value={y}>FY {y}-{String((y + 1) % 100).padStart(2, '0')}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Period</label>
          <div className="flex bg-gray-100 p-0.5 rounded-lg">
            {(['monthly', 'quarterly', 'custom'] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm rounded-md capitalize transition-colors ${period === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
        {period === 'custom' && (
          <>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">To</label>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </>
        )}
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => download('excel')} disabled={busy !== null || customIncomplete}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-green-200 text-green-700 bg-green-50 hover:bg-green-100 disabled:opacity-50">
            {busy === 'excel' ? 'Preparing…' : 'Excel'}
          </button>
          <button onClick={() => download('pdf')} disabled={busy !== null || customIncomplete}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50">
            {busy === 'pdf' ? 'Preparing…' : 'PDF'}
          </button>
          <button onClick={printAll} disabled={busy !== null || customIncomplete}
            className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50">
            {busy === 'print' ? 'Preparing…' : 'Print'}
          </button>
          {canPost && (
            <button onClick={() => setShowEntry(true)} className="px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
              + Cash / bank entry
            </button>
          )}
        </div>
      </div>

      {customIncomplete && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">Pick a start and an end date (start on or before end) to see a custom range.</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3" role="alert">{error}</p>}

      {/* Summary cards */}
      {cards && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          <Card label="Financial year" value={cards.financialYear} sub={summary ? `${fmtDate(summary.range.from)} – ${fmtDate(summary.range.to)}` : undefined} tone="blue" />
          {cards.totalCapital !== null && <Card label="Total capital" value={inr(cards.totalCapital, 0)} sub="From funders" />}
          {cards.fundAvailable !== null && <Card label="Fund available" value={inr(cards.fundAvailable, 0)} sub="Capital + net loan cash flow" negativeNote={cards.fundAvailable < 0} />}
          {cards.totalLent !== null && <Card label="Total money lent" value={inr(cards.totalLent, 0)} sub={cards.lentInPeriod !== null ? `${inr(cards.lentInPeriod, 0)} in this period` : undefined} />}
          {cards.outstandingPrincipal !== null && <Card label="Outstanding principal" value={inr(cards.outstandingPrincipal, 0)} tone="orange" />}
          {cards.outstandingInterest !== null && <Card label="Outstanding interest" value={inr(cards.outstandingInterest, 0)} sub="Still to be earned" tone="orange" />}
          <Card label="Interest collected" value={inr(cards.interestCollected, 0)} sub="In this period" tone="green" />
          <Card label="Principal recovered" value={inr(cards.principalRecovered, 0)} sub="In this period" tone="green" />
          {cards.cashInHand !== null && <Card label="Cash in hand" value={inr(cards.cashInHand, 0)} negativeNote={cards.cashInHand < 0} />}
          {cards.bankBalance !== null && <Card label="Bank balance" value={inr(cards.bankBalance, 0)} negativeNote={cards.bankBalance < 0} />}
          {summary?.scope === 'agent' && <Card label="Collections" value={String(cards.collectionsCount)} sub="Rows in this period" />}
        </div>
      )}

      {/* Period breakdown */}
      {summary && summary.buckets.length > 0 && period !== 'custom' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">{period === 'monthly' ? 'Month-wise' : 'Quarter-wise'} breakdown</h3>
            <span className="text-xs text-gray-400">Click a row to show only that {period === 'monthly' ? 'month' : 'quarter'} below</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{period === 'monthly' ? 'Month' : 'Quarter'}</th>
                  {summary.scope !== 'agent' && <th className="px-3 py-2 text-right font-medium">Disbursed</th>}
                  <th className="px-3 py-2 text-right font-medium">Principal</th>
                  <th className="px-3 py-2 text-right font-medium">Interest</th>
                  <th className="px-3 py-2 text-right font-medium">Fees &amp; other</th>
                  {isFull && <><th className="px-3 py-2 text-right font-medium">Money in</th><th className="px-3 py-2 text-right font-medium">Money out</th><th className="px-3 py-2 text-right font-medium">Net</th></>}
                </tr>
              </thead>
              <tbody>
                {summary.buckets.map((b) => {
                  const empty = b.disbursed + b.principal + b.interest + b.other + b.moneyIn + b.moneyOut === 0;
                  const active = bucket?.key === b.key;
                  return (
                    <tr key={b.key} onClick={() => setBucket(active ? null : b)}
                      className={`border-t border-gray-50 cursor-pointer hover:bg-blue-50/40 ${active ? 'bg-blue-50' : ''} ${empty ? 'text-gray-300' : ''}`}>
                      <td className="px-3 py-2 font-medium">{b.label}</td>
                      {summary.scope !== 'agent' && <td className="px-3 py-2 text-right">{inr(b.disbursed, 0)}</td>}
                      <td className="px-3 py-2 text-right text-green-700">{inr(b.principal, 0)}</td>
                      <td className="px-3 py-2 text-right text-green-700">{inr(b.interest, 0)}</td>
                      <td className="px-3 py-2 text-right text-green-700">{inr(b.other, 0)}</td>
                      {isFull && <>
                        <td className="px-3 py-2 text-right text-green-700">{inr(b.moneyIn, 0)}</td>
                        <td className="px-3 py-2 text-right text-red-700">{inr(b.moneyOut, 0)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${b.net < 0 ? 'text-red-700' : ''}`}>{inr(b.net, 0)}</td>
                      </>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Views */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {VIEWS.filter((v) => views.includes(v.key)).map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${view === v.key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {bucket && (
        <div className="flex items-center gap-2 text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 w-fit">
          Showing {bucket.label} only
          <button onClick={() => setBucket(null)} className="text-blue-600 hover:underline">clear</button>
        </div>
      )}

      {/* Filters (transaction views) */}
      {!groupedView && (
        <div className="flex flex-wrap gap-2">
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search loan, customer, agent, remarks…"
            className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          {view === 'all' && (
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">All types</option>
              {KINDS.filter(([k]) => role !== 'AGENT' || k.startsWith('COLLECTION')).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          {isFull && (
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">All modes</option>
              {['Cash', 'Bank', 'UPI', 'Other'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {role !== 'AGENT' && officers.length > 0 && (
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">All agents</option>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {role !== 'AGENT' && branches.length > 0 && (
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white hover:bg-gray-50" title="Sort by date">
            Date {order === 'desc' ? '↓ newest first' : '↑ oldest first'}
          </button>
        </div>
      )}

      {/* Body */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading && !grid && !breakdown ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : groupedView ? (
          <BreakdownTable rows={breakdown ?? []} view={view} loading={loading} />
        ) : grid && (
          <>
            {isFull && grid.openingBalance !== null && (
              <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-x-6 gap-y-1">
                <span>Opening balance: <b className="text-gray-800">{inr(grid.openingBalance)}</b></span>
                <span>Closing balance: <b className="text-gray-800">{inr(grid.closingBalance)}</b></span>
                <span>Shown: <b className="text-green-700">{inr(grid.totalCredit)}</b> in · <b className="text-red-700">{inr(grid.totalDebit)}</b> out · {grid.total} rows</span>
              </div>
            )}
            {!isFull && (
              <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                <b className="text-green-700">{inr(grid.totalCredit)}</b> in · <b className="text-red-700">{inr(grid.totalDebit)}</b> out · {grid.total} rows
              </div>
            )}
            {grid.rows.length === 0 ? (
              <div className="py-16 text-center text-gray-400 text-sm">No transactions for these filters</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">Loan</th>
                      <th className="px-3 py-2 text-left font-medium">Customer</th>
                      <th className="px-3 py-2 text-left font-medium">Agent</th>
                      <th className="px-3 py-2 text-left font-medium">Branch</th>
                      <th className="px-3 py-2 text-right font-medium">Debit (out)</th>
                      <th className="px-3 py-2 text-right font-medium">Credit (in)</th>
                      {isFull && <th className="px-3 py-2 text-right font-medium">Balance</th>}
                      <th className="px-3 py-2 text-left font-medium">Mode</th>
                      <th className="px-3 py-2 text-left font-medium">Remarks</th>
                      <th className="px-3 py-2 text-left font-medium">By</th>
                      {isFull && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((r) => {
                      const href = loanHref(r);
                      return (
                        <tr key={r.id} className="border-t border-gray-50 hover:bg-gray-50/60">
                          <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.date)}</td>
                          <td className="px-3 py-2"><KindBadge row={r} /></td>
                          <td className="px-3 py-2 whitespace-nowrap">{href ? <Link href={href} className="text-blue-600 hover:underline font-mono">{r.loanNumber}</Link> : (r.loanNumber ?? '—')}</td>
                          <td className="px-3 py-2">{r.customerName ?? '—'}</td>
                          <td className="px-3 py-2">{r.agentName ?? '—'}</td>
                          <td className="px-3 py-2">{r.branchName ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-red-700 whitespace-nowrap">{r.debit !== null ? inr(r.debit) : ''}</td>
                          <td className="px-3 py-2 text-right font-medium text-green-700 whitespace-nowrap">{r.credit !== null ? inr(r.credit) : ''}</td>
                          {isFull && <td className={`px-3 py-2 text-right whitespace-nowrap ${(r.runningBalance ?? 0) < 0 ? 'text-red-700' : 'text-gray-800'}`}>{inr(r.runningBalance)}</td>}
                          <td className="px-3 py-2 whitespace-nowrap">{r.mode}{r.accountName ? <span className="text-gray-400"> · {r.accountName}</span> : null}</td>
                          <td className="px-3 py-2 max-w-[260px] truncate" title={[r.remarks, r.referenceNo && `Ref ${r.referenceNo}`].filter(Boolean).join(' · ')}>
                            {r.remarks}{r.referenceNo ? <span className="text-gray-400"> · Ref {r.referenceNo}</span> : null}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-gray-500">{r.createdByName ?? '—'}</td>
                          {isFull && (
                            <td className="px-3 py-2">
                              {r.source === 'MANUAL' && <button onClick={() => removeEntry(r)} className="text-red-600 hover:underline">Delete</button>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, grid.total)} of {grid.total}</span>
                <div className="flex items-center gap-1">
                  <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40">‹ Prev</button>
                  <span className="px-2">Page {page} of {pages}</span>
                  <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40">Next ›</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showEntry && <EntryModal onClose={() => setShowEntry(false)} onSaved={() => { setShowEntry(false); setRefresh((n) => n + 1); }} />}

      {printRows && summary && typeof document !== 'undefined' && createPortal(
        <div id="statement-print-root">
          <PrintSheet rows={printRows} summary={summary} grid={grid} showBalance={isFull} />
        </div>, document.body)}
    </div>
  );
}

function BreakdownTable({ rows, view, loading }: { rows: StatementBreakdownRow[]; view: View; loading: boolean }) {
  const label = view === 'loan-type' ? 'Loan type' : view === 'agent' ? 'Agent' : 'Branch';
  if (!loading && rows.length === 0) return <div className="py-16 text-center text-gray-400 text-sm">Nothing for this period</div>;
  const sum = (k: keyof StatementBreakdownRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{label}</th>
            <th className="px-3 py-2 text-right font-medium">Loans</th>
            <th className="px-3 py-2 text-right font-medium">Disbursed</th>
            <th className="px-3 py-2 text-right font-medium">Principal collected</th>
            <th className="px-3 py-2 text-right font-medium">Interest collected</th>
            <th className="px-3 py-2 text-right font-medium">Fees &amp; other</th>
            <th className="px-3 py-2 text-right font-medium">Total collected</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-50">
              <td className="px-3 py-2 font-medium">{r.label}</td>
              <td className="px-3 py-2 text-right">{r.loans}</td>
              <td className="px-3 py-2 text-right text-red-700">{inr(r.disbursed)}</td>
              <td className="px-3 py-2 text-right text-green-700">{inr(r.principalCollected)}</td>
              <td className="px-3 py-2 text-right text-green-700">{inr(r.interestCollected)}</td>
              <td className="px-3 py-2 text-right text-green-700">{inr(r.otherCollected)}</td>
              <td className="px-3 py-2 text-right font-semibold">{inr(r.principalCollected + r.interestCollected + r.otherCollected)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right" />
            <td className="px-3 py-2 text-right text-red-700">{inr(sum('disbursed'))}</td>
            <td className="px-3 py-2 text-right text-green-700">{inr(sum('principalCollected'))}</td>
            <td className="px-3 py-2 text-right text-green-700">{inr(sum('interestCollected'))}</td>
            <td className="px-3 py-2 text-right text-green-700">{inr(sum('otherCollected'))}</td>
            <td className="px-3 py-2 text-right">{inr(sum('principalCollected') + sum('interestCollected') + sum('otherCollected'))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Print-only layout: plain black-on-white table of every matching row, with the headline figures. */
function PrintSheet({ rows, summary, grid, showBalance }: { rows: StatementRow[]; summary: StatementSummary; grid: StatementPage | null; showBalance: boolean }) {
  const c = summary.cards;
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 10, color: '#000' }}>
      <h2 style={{ fontSize: 15, margin: '0 0 2px' }}>Financial ledger statement</h2>
      <p style={{ margin: '0 0 8px' }}>{summary.fyLabel} · {summary.range.from} to {summary.range.to}{grid ? ` · ${rows.length} rows` : ''}</p>
      <table style={{ borderCollapse: 'collapse', marginBottom: 10 }}>
        <tbody>
          <tr>
            {[['Total lent', c.totalLent], ['Outstanding principal', c.outstandingPrincipal], ['Outstanding interest', c.outstandingInterest],
              ['Interest collected', c.interestCollected], ['Principal recovered', c.principalRecovered], ['Cash in hand', c.cashInHand], ['Bank balance', c.bankBalance]]
              .filter(([, v]) => v !== null).map(([l, v]) => (
                <td key={String(l)} style={{ border: '1px solid #999', padding: '3px 8px' }}><div style={{ fontSize: 8, color: '#555' }}>{l}</div><b>{inr(v as number, 0)}</b></td>
              ))}
          </tr>
        </tbody>
      </table>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {['Date', 'Type', 'Loan', 'Customer', 'Agent', 'Debit', 'Credit', ...(showBalance ? ['Balance'] : []), 'Mode', 'Remarks'].map((h) => (
              <th key={h} style={{ border: '1px solid #999', padding: '3px 5px', background: '#eee', textAlign: 'left', fontSize: 9 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ pageBreakInside: 'avoid' }}>
              {[r.date, r.kindLabel, r.loanNumber ?? '', r.customerName ?? '', r.agentName ?? '', r.debit !== null ? inr(r.debit) : '', r.credit !== null ? inr(r.credit) : '',
                ...(showBalance ? [inr(r.runningBalance)] : []), r.mode, r.remarks ?? ''].map((v, i) => (
                <td key={i} style={{ border: '1px solid #ccc', padding: '2px 5px', textAlign: [5, 6, 7].includes(i) && (i !== 7 || showBalance) ? 'right' : 'left' }}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<LedgerEntryInput['type']>('CASH_IN');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [fromAcc, setFromAcc] = useState('CASH');
  const [toAcc, setToAcc] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [latestDate] = useState(() => new Date(Date.now() + 864e5).toISOString().slice(0, 10)); // a day of grace, as the server allows

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!amount || !Number.isFinite(n) || n <= 0) return setErr('Enter an amount greater than zero');
    if (type === 'ADJUSTMENT' && !remarks.trim()) return setErr('An adjustment needs a reason in Remarks');
    if (type === 'TRANSFER' && (!fromAcc.trim() || !toAcc.trim())) return setErr('Enter both accounts (use CASH for cash in hand)');
    setErr(''); setSaving(true);
    try {
      await createLedgerEntry({
        date, type, amount: n,
        ...(type === 'BANK_IN' || type === 'BANK_OUT' || type === 'ADJUSTMENT' ? { accountName: account.trim() || undefined } : {}),
        ...(type === 'TRANSFER' ? { fromAccount: fromAcc.trim(), toAccount: toAcc.trim() } : {}),
        ...(type === 'ADJUSTMENT' ? { direction } : {}),
        referenceNo: reference.trim() || undefined, remarks: remarks.trim() || undefined,
      });
      onSaved();
    } catch (ex: unknown) { setErr(ex instanceof Error ? ex.message : 'Could not save the entry'); }
    finally { setSaving(false); }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white';
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add cash or bank entry">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Cash / bank entry</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Close">×</button>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as LedgerEntryInput['type'])} className={inputCls}>
            {ENTRY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
            <input type="date" value={date} max={latestDate} onChange={(e) => setDate(e.target.value)} className={inputCls} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹)</label>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={inputCls} required />
          </div>
        </div>
        {(type === 'BANK_IN' || type === 'BANK_OUT') && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bank account</label>
            <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. HDFC Current (default: BANK)" className={inputCls} maxLength={60} />
          </div>
        )}
        {type === 'ADJUSTMENT' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Direction</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'IN' | 'OUT')} className={inputCls}>
                <option value="IN">Money in (credit)</option><option value="OUT">Money out (debit)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Account</label>
              <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="CASH or bank name" className={inputCls} maxLength={60} />
            </div>
          </div>
        )}
        {type === 'TRANSFER' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input value={fromAcc} onChange={(e) => setFromAcc(e.target.value)} placeholder="CASH or bank name" className={inputCls} maxLength={60} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input value={toAcc} onChange={(e) => setToAcc(e.target.value)} placeholder="CASH or bank name" className={inputCls} maxLength={60} />
            </div>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Reference no. <span className="text-gray-400">(optional)</span></label>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} maxLength={100} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Remarks {type === 'ADJUSTMENT' ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional)</span>}</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} className={inputCls} maxLength={500} />
        </div>
        {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-2" role="alert">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save entry'}
          </button>
        </div>
      </form>
    </div>
  );
}
