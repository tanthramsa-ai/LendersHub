'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTermLoan, closeLoan, reopenLoan, recordPayment, undoInstallmentPayment, getTenantSession, MANAGER_ROLES, COLLECTION_ROLES, TermLoanDetail, TermInstallment } from '@/services/tenant-api';
import { CloseLoanModal, CloseCommentBanner, ReopenLoanModal } from '@/components/CloseLoanModal';
import { refreshNotificationBell } from '@/lib/notifications-bus';

const STATUS_COLORS: Record<string, string> = {
  PAID: 'bg-green-100 text-green-700',
  PARTIALLY_PAID: 'bg-blue-100 text-blue-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  OVERDUE: 'bg-red-100 text-red-700',
  WAIVED: 'bg-slate-200 text-slate-600',
};

const LOAN_STATUS_COLORS: Record<string, string> = {
  DISBURSED: 'bg-green-100 text-green-700',
  PENDING:   'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  CLOSED:    'bg-slate-200 text-slate-800',
  DEFAULTED: 'bg-red-100 text-red-700',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function computeFinancials(installments: TermInstallment[]) {
  const totalPaid = installments.reduce((s, i) => s + i.paid, 0);
  const outstanding = installments
    .filter((i) => i.status !== 'PAID')
    .reduce((s, i) => s + (i.total - i.paid), 0);
  const overdueAmt = installments
    .filter((i) => i.status === 'OVERDUE')
    .reduce((s, i) => s + (i.total - i.paid), 0);
  return { totalPaid, outstanding, overdueAmt };
}

function tileColor(status: string, isNpa: boolean) {
  if (isNpa && status === 'OVERDUE') return 'bg-red-700 text-white border-red-700';
  if (status === 'PAID') return 'bg-green-500 text-white border-green-500';
  if (status === 'PARTIALLY_PAID') return 'bg-blue-400 text-white border-blue-400';
  if (status === 'OVERDUE') return 'bg-red-400 text-white border-red-400';
  if (status === 'WAIVED') return 'bg-slate-300 text-slate-600 border-slate-400';
  return 'bg-gray-100 text-gray-500 border-gray-200';
}

export default function TermLoanDetailPage() {
  const params = useParams<{ subdomain: string; id: string }>();
  const { subdomain, id } = params;
  const router = useRouter();
  const session = getTenantSession();
  const canClose = MANAGER_ROLES.includes(session?.user.role ?? 'VIEWER');
  const canPay = COLLECTION_ROLES.includes(session?.user.role ?? 'VIEWER');

  const [loan, setLoan] = useState<TermLoanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<TermInstallment | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'UPI' | 'BANK_TRANSFER' | 'CHEQUE' | 'NEFT' | 'RTGS'>('CASH');
  const [payRef, setPayRef] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [paying, setPaying] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [err, setErr] = useState('');
  const [tooltip, setTooltip] = useState<{ num: number; x: number; y: number } | null>(null);
  const [undoTarget, setUndoTarget] = useState<TermInstallment | null>(null);
  const [undoing, setUndoing] = useState(false);

  async function load() {
    try {
      const data = await getTermLoan(id);
      setLoan(data);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [id]);

  function openPayModal(inst?: TermInstallment) {
    setSelectedInstallment(inst ?? null);
    setPayAmount(inst ? String(inst.total - inst.paid) : '');
    setPayRef(''); setErr('');
    setShowPayModal(true);
  }

  async function submitPayment() {
    if (!payAmount || parseFloat(payAmount) <= 0) { setErr('Enter a valid amount'); return; }
    setPaying(true); setErr('');
    try {
      await recordPayment(id, {
        installmentId: selectedInstallment?.id,
        amount: parseFloat(payAmount),
        paymentMethod: payMethod,
        referenceNumber: payRef || undefined,
        paymentDate: payDate,
      });
      setShowPayModal(false);
      refreshNotificationBell();
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Payment failed');
    } finally { setPaying(false); }
  }

  async function handleUndo() {
    if (!undoTarget) return;
    setUndoing(true); setErr('');
    try {
      await undoInstallmentPayment(id, undoTarget.id);
      setUndoTarget(null);
      refreshNotificationBell();
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Undo failed');
    } finally { setUndoing(false); }
  }

  async function handleClose(comment: string) {
    setClosing(true); setErr('');
    try {
      await closeLoan(id, { comment });
      router.refresh();
      refreshNotificationBell();
      await load();
      setShowCloseConfirm(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Close failed');
      await load(); // resync in case the failure means our view of the loan was stale
    } finally { setClosing(false); }
  }

  async function handleReopen(comment: string) {
    setReopening(true); setErr('');
    try {
      await reopenLoan(id, { comment });
      router.refresh();
      refreshNotificationBell();
      await load();
      setShowReopenConfirm(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Reopen failed');
      await load(); // resync in case the failure means our view of the loan was stale
    } finally { setReopening(false); }
  }

  if (loading) return <div className="p-10 text-center text-gray-400 text-sm">Loading…</div>;
  if (!loan) return <div className="p-10 text-center text-red-400 text-sm">Loan not found</div>;

  const { totalPaid, outstanding, overdueAmt } = computeFinancials(loan.installments);
  const isNpa = loan.isNpa ?? (loan.overdueCount > 2);
  const isActive = ['DISBURSED', 'APPROVED'].includes(loan.status);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={`/${subdomain}/loans`} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 font-mono">{loan.loanNumber}</h1>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${LOAN_STATUS_COLORS[loan.status] ?? 'bg-gray-100 text-gray-500'}`}>{loan.status}</span>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Term Loan</span>
              {isNpa && <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-200 text-red-800">NPA</span>}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              <Link href={`/${subdomain}/customers/${loan.customerId}`} className="hover:text-blue-600 font-medium text-gray-700">{loan.customerName}</Link>
              {loan.branchName && <span> · {loan.branchName}</span>}
              {loan.calculationType && <span> · {loan.calculationType}</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {canPay && isActive && (
            <button onClick={() => openPayModal()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              + Record Payment
            </button>
          )}
          {canClose && isActive && (
            <button onClick={() => setShowCloseConfirm(true)}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors">
              Close Loan
            </button>
          )}
          {canClose && loan.status === 'CLOSED' && (
            <button onClick={() => { setErr(''); setShowReopenConfirm(true); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">
              Reopen Loan
            </button>
          )}
        </div>
      </div>

      {loan.status === 'CLOSED' && (
        <CloseCommentBanner
          comment={loan.closeComment}
          closedAt={loan.closedAt}
          hasWaivedInstallments={loan.installments.some((i) => i.status === 'WAIVED')}
        />
      )}

      {err && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{err}</div>}

      {/* Financial cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Principal', value: fmt(loan.principal), color: 'text-gray-900' },
          { label: 'EMI Amount', value: loan.emiAmount ? fmt(loan.emiAmount) : '—', color: 'text-blue-700' },
          { label: 'Outstanding', value: fmt(outstanding), color: outstanding > 0 ? 'text-red-600' : 'text-green-600' },
          { label: 'Total Paid', value: fmt(totalPaid), color: 'text-green-700' },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className={`text-lg font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {overdueAmt > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 font-medium">
          Overdue: {fmt(overdueAmt)} ({loan.overdueCount} installment{loan.overdueCount !== 1 ? 's' : ''})
        </div>
      )}

      {/* Installment grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <p className="text-sm font-semibold text-gray-900 mb-4">
          Installments · {loan.paidInstallments}/{loan.totalInstallments} paid
        </p>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))' }}>
          {loan.installments.map((inst) => (
            <div key={inst.id} className="relative group">
              <button
                onClick={() => {
                  if (canPay && isActive && inst.status !== 'PAID') openPayModal(inst);
                  else if (canClose && isActive && inst.status === 'PAID') setUndoTarget(inst);
                }}
                onMouseEnter={(e) => setTooltip({ num: inst.number, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
                className={`w-full aspect-square rounded-lg border text-xs font-bold flex flex-col items-center justify-center transition-all hover:scale-105 ${tileColor(inst.status, isNpa)} ${(canPay && isActive && inst.status !== 'PAID') || (canClose && isActive && inst.status === 'PAID') ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span>{inst.number}</span>
                {inst.status === 'PARTIALLY_PAID' && <span className="text-[8px] leading-none opacity-80">P</span>}
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 mt-4 text-xs text-gray-500">
          {[
            { color: 'bg-green-500', label: 'Paid' },
            { color: 'bg-blue-400', label: 'Partial' },
            { color: 'bg-yellow-100 border border-yellow-300', label: 'Pending' },
            { color: 'bg-red-400', label: 'Overdue' },
            { color: 'bg-slate-300 border border-slate-400', label: 'Waived' },
          ].map((l) => (
            <span key={l.label} className="flex items-center gap-1">
              <span className={`w-3 h-3 rounded ${l.color}`} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Installments table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">Installment Schedule</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {['#', 'Due Date', 'Principal', 'Interest', 'Total', 'Paid', 'Balance', 'Status', ''].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loan.installments.map((inst) => (
                <tr key={inst.id} className={`hover:bg-gray-50 ${inst.status === 'OVERDUE' ? 'bg-red-50/50' : inst.status === 'WAIVED' ? 'bg-slate-50' : ''}`}>
                  <td className="px-3 py-2.5 text-gray-400">{inst.number}</td>
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{fmtDate(inst.dueDate)}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-800">{fmt(inst.principal)}</td>
                  <td className="px-3 py-2.5 text-orange-600">{fmt(inst.interest)}</td>
                  <td className="px-3 py-2.5 font-bold text-blue-700">{fmt(inst.total)}</td>
                  <td className="px-3 py-2.5 text-green-700">{fmt(inst.paid)}</td>
                  <td className="px-3 py-2.5 text-red-600">{fmt(Math.max(0, inst.total - inst.paid))}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[inst.status] ?? 'bg-gray-100 text-gray-400'}`}>{inst.status}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    {canPay && isActive && inst.status !== 'PAID' && (
                      <button onClick={() => openPayModal(inst)} className="text-xs text-blue-600 hover:underline whitespace-nowrap">Pay</button>
                    )}
                    {canClose && isActive && inst.status === 'PAID' && (
                      <button onClick={() => setUndoTarget(inst)} className="text-xs text-red-600 hover:underline whitespace-nowrap">Undo</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Loan details */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <p className="text-sm font-semibold text-gray-900 mb-3">Loan Details</p>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
          <div><dt className="text-xs text-gray-500">Interest Rate</dt><dd className="font-medium">{loan.interestRate}% p.a.</dd></div>
          <div><dt className="text-xs text-gray-500">Tenure</dt><dd className="font-medium">{loan.termMonths} months</dd></div>
          <div><dt className="text-xs text-gray-500">First Due</dt><dd className="font-medium">{fmtDate(loan.firstDueDate)}</dd></div>
          <div><dt className="text-xs text-gray-500">Disbursed</dt><dd className="font-medium">{fmtDate(loan.disbursedAt)}</dd></div>
          {loan.purpose && <div><dt className="text-xs text-gray-500">Purpose</dt><dd className="font-medium">{loan.purpose}</dd></div>}
          <div><dt className="text-xs text-gray-500">Phone</dt><dd className="font-medium">{loan.customerPhone}</dd></div>
        </dl>
        {(loan.securityDocUrl || loan.promissoryNoteUrl) && (
          <div className="flex gap-4 mt-4 pt-4 border-t border-gray-100">
            {loan.securityDocUrl && (
              <a href={loan.securityDocUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline">📄 Security Document</a>
            )}
            {loan.promissoryNoteUrl && (
              <a href={loan.promissoryNoteUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline">📄 Promissory Note</a>
            )}
          </div>
        )}
      </div>

      {/* Payment history */}
      {loan.payments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Payment History</p>
          </div>
          <div className="divide-y divide-gray-50">
            {loan.payments.map((p) => (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{fmt(p.amount)}</p>
                  <p className="text-xs text-gray-400">{p.method}{p.referenceNumber ? ` · ${p.referenceNumber}` : ''}</p>
                </div>
                <p className="text-xs text-gray-400 whitespace-nowrap">{fmtDate(p.paymentDate)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div className="fixed z-50 pointer-events-none px-2 py-1 bg-gray-900 text-white text-xs rounded shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 28 }}>
          Installment #{tooltip.num}
        </div>
      )}

      {/* Payment modal */}
      {showPayModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Record Payment</h2>
            {selectedInstallment && (
              <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                Installment #{selectedInstallment.number} · Due: {fmtDate(selectedInstallment.dueDate)} · Balance: {fmt(selectedInstallment.total - selectedInstallment.paid)}
              </div>
            )}
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹)</label>
                <input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} min="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {selectedInstallment && parseFloat(payAmount || '0') > (selectedInstallment.total - selectedInstallment.paid) && (
                  <p className="text-xs text-gray-500 mt-1">Extra amount will apply to the next installment(s).</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {['CASH','UPI','BANK_TRANSFER','CHEQUE','NEFT','RTGS'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reference # (optional)</label>
                <input value={payRef} onChange={(e) => setPayRef(e.target.value)}
                  placeholder="Transaction ID, cheque #…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowPayModal(false)} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button disabled={paying} onClick={submitPayment}
                className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
                {paying ? 'Saving…' : 'Save Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo payment confirmation */}
      {undoTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Undo Payment</h2>
            <p className="text-sm text-gray-600">
              This reverts the most recent payment on installment #{undoTarget.number} ({fmt(undoTarget.paid)} paid) back to its previous status. This cannot be redone automatically.
            </p>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex gap-3 pt-2">
              <button onClick={() => { setUndoTarget(null); setErr(''); }} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button disabled={undoing} onClick={handleUndo}
                className="flex-1 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-40">
                {undoing ? 'Undoing…' : 'Undo Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close loan confirmation */}
      {showCloseConfirm && (
        <CloseLoanModal
          loanNumber={loan.loanNumber}
          outstanding={outstanding}
          closing={closing}
          error={err}
          onCancel={() => { setShowCloseConfirm(false); setErr(''); }}
          onConfirm={handleClose}
        />
      )}

      {showReopenConfirm && (
        <ReopenLoanModal
          loanNumber={loan.loanNumber}
          previousCloseComment={loan.closeComment}
          waivedCount={loan.installments.filter((i) => i.status === 'WAIVED').length}
          reopening={reopening}
          error={err}
          onCancel={() => { setShowReopenConfirm(false); setErr(''); }}
          onConfirm={handleReopen}
        />
      )}
    </div>
  );
}
