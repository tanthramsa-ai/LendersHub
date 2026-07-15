'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getMonthlyLoan, recordPayment, closeLoan, reopenLoan, MonthlyLoanDetail, MonthlyInstallment,
  getTenantSession, COLLECTION_ROLES, MANAGER_ROLES,
} from '@/services/tenant-api';
import { CloseLoanModal, CloseCommentBanner, ReopenLoanModal } from '@/components/CloseLoanModal';
import { refreshNotificationBell } from '@/lib/notifications-bus';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const LOAN_STATUS_COLORS: Record<string, string> = {
  DISBURSED: 'bg-green-100 text-green-700',
  PENDING:   'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  CLOSED:    'bg-slate-200 text-slate-800',
  DEFAULTED: 'bg-red-100 text-red-700',
};

function tileClasses(inst: MonthlyInstallment): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(inst.dueDate); due.setHours(0, 0, 0, 0);
  switch (inst.status) {
    case 'PAID':         return 'bg-green-100 border-green-300 text-green-800';
    case 'PARTIALLY_PAID': return 'bg-amber-100 border-amber-300 text-amber-800';
    case 'OVERDUE':      return 'bg-red-100 border-red-400 text-red-800';
    case 'WAIVED':       return 'bg-slate-200 border-slate-400 text-slate-600';
    case 'PENDING':
      return due < today ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200 text-gray-600';
    default: return 'bg-white border-gray-200 text-gray-600';
  }
}

function buildTooltip(inst: MonthlyInstallment): string {
  const lines: string[] = [
    `Month #${inst.number}`,
    `Due: ${fmtDate(inst.dueDate)}`,
    `Interest: ${fmt(inst.interest)}`,
    `Total:    ${fmt(inst.total)}`,
  ];
  if (inst.paid > 0) lines.push(`Paid:     ${fmt(inst.paid)}`);
  if (inst.paidAt) {
    lines.push(`Paid on: ${fmtDate(inst.paidAt)}`);
    const due = new Date(inst.dueDate); due.setHours(0, 0, 0, 0);
    const paid = new Date(inst.paidAt); paid.setHours(0, 0, 0, 0);
    const late = Math.round((paid.getTime() - due.getTime()) / 86400000);
    if (late > 0) lines.push(`⚠ Paid ${late} day${late !== 1 ? 's' : ''} late`);
  }
  return lines.join('\n');
}

function computeFinancials(installments: MonthlyInstallment[], principal: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let interestOutstanding = 0, interestReceived = 0;
  let paidCount = 0, overdueCount = 0;

  for (const i of installments) {
    if (i.status === 'PAID') {
      interestReceived += i.interest;
      paidCount++;
    } else if (i.status === 'PARTIALLY_PAID') {
      const iPaid = Math.min(i.paid, i.interest);
      interestReceived += iPaid;
      interestOutstanding += i.interest - iPaid;
    } else if (i.status === 'PENDING' || i.status === 'OVERDUE') {
      interestOutstanding += i.interest;
      const due = new Date(i.dueDate); due.setHours(0, 0, 0, 0);
      if (i.status === 'OVERDUE' || due < today) overdueCount++;
    }
  }
  return { principalOutstanding: principal, interestOutstanding, interestReceived, paidCount, overdueCount };
}

const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'NEFT', 'RTGS'] as const;

export default function MonthlyLoanDetailPage() {
  const params = useParams<{ subdomain: string; id: string }>();
  const { subdomain, id } = params;
  const session = getTenantSession();
  const canRecord = COLLECTION_ROLES.includes(session?.user.role ?? 'VIEWER');
  const canClose = MANAGER_ROLES.includes(session?.user.role ?? 'VIEWER');

  const [loan, setLoan] = useState<MonthlyLoanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [payInst, setPayInst] = useState<MonthlyInstallment | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', method: 'CASH', ref: '', date: '' });
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setLoan(await getMonthlyLoan(id)); }
    catch (e: unknown) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function openPay(inst: MonthlyInstallment) {
    const remaining = Math.max(0, inst.total - inst.paid);
    setPayInst(inst);
    setPayForm({ amount: String(Math.round(remaining)), method: 'CASH', ref: '', date: new Date().toISOString().slice(0, 10) });
    setPayError(''); setPaySuccess('');
  }

  async function submitPay() {
    if (!payInst) return;
    const amount = parseFloat(payForm.amount);
    if (isNaN(amount) || amount <= 0) { setPayError('Enter a valid amount'); return; }
    setPaying(true); setPayError('');
    try {
      await recordPayment(id, {
        installmentId: payInst.id, amount,
        paymentMethod: payForm.method as 'CASH',
        referenceNumber: payForm.ref || undefined,
        paymentDate: payForm.date || undefined,
      });
      setPayInst(null);
      setPaySuccess(`Payment of ${fmt(amount)} recorded for Month #${payInst.number}`);
      refreshNotificationBell();
      await load();
    } catch (e: unknown) {
      setPayError((e as Error).message);
    } finally { setPaying(false); }
  }

  async function handleClose(comment: string) {
    setClosing(true); setCloseError('');
    try {
      await closeLoan(id, { comment });
      setShowCloseConfirm(false);
      refreshNotificationBell();
      await load();
    } catch (e: unknown) {
      setCloseError((e as Error).message);
      await load(); // resync in case the failure means our view of the loan was stale
    } finally { setClosing(false); }
  }

  async function handleReopen(comment: string) {
    setReopening(true); setReopenError('');
    try {
      await reopenLoan(id, { comment });
      setShowReopenConfirm(false);
      refreshNotificationBell();
      await load();
    } catch (e: unknown) {
      setReopenError((e as Error).message);
      await load(); // resync in case the failure means our view of the loan was stale
    } finally { setReopening(false); }
  }

  if (loading) return <div className="p-6 text-gray-400 text-sm">Loading…</div>;
  if (error) return <div className="p-6 text-red-600 text-sm">{error}</div>;
  if (!loan) return null;

  const fin = computeFinancials(loan.installments, loan.principal);
  const isNpa = loan.status === 'DEFAULTED' || fin.overdueCount > 2;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/${subdomain}/monthly-loans`} className="text-sm text-gray-500 hover:text-gray-700">← Monthly Loans</Link>
        <span className="text-gray-300">|</span>
        <h1 className="text-lg font-bold text-gray-900 font-mono">{loan.loanNumber}</h1>
        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${LOAN_STATUS_COLORS[loan.status] ?? 'bg-gray-100 text-gray-500'}`}>{loan.status}</span>
        {isNpa && <span className="px-2 py-0.5 bg-red-200 text-red-800 rounded text-xs font-bold">NPA</span>}
        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Interest-Only</span>
      </div>

      {loan.status === 'CLOSED' && (
        <CloseCommentBanner
          comment={loan.closeComment}
          closedAt={loan.closedAt}
          hasWaivedInstallments={loan.installments.some((i) => i.status === 'WAIVED')}
        />
      )}

      {paySuccess && (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-2 rounded-lg">
          <span>{paySuccess}</span>
          <button onClick={() => setPaySuccess('')} className="ml-3 text-green-500 hover:text-green-700">✕</button>
        </div>
      )}

      {/* Loan details */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Customer</p>
            <Link href={`/${subdomain}/customers/${loan.customerId}`} className="text-sm font-semibold text-blue-600 hover:underline block">{loan.customerName}</Link>
            <p className="text-xs text-gray-500">{loan.customerPhone ?? loan.phone}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Principal</p>
            <p className="text-sm font-semibold text-gray-900">{fmt(loan.principal)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Monthly Interest</p>
            <p className="text-sm font-semibold text-blue-700">{loan.emiAmount ? fmt(loan.emiAmount) : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Interest Rate</p>
            <p className="text-sm font-semibold text-gray-900">{loan.interestRate}% p.a.</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Tenure</p>
            <p className="text-sm font-semibold text-gray-900">{loan.termMonths} months</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">First Due</p>
            <p className="text-sm font-semibold text-gray-900">{fmtDate(loan.firstDueDate)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Branch</p>
            <p className="text-sm font-semibold text-gray-900">{loan.branchName ?? '—'}</p>
          </div>
          {loan.purpose && (
            <div className="col-span-2 sm:col-span-3 lg:col-span-4">
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Purpose</p>
              <p className="text-sm text-gray-700">{loan.purpose}</p>
            </div>
          )}
        </div>
      </div>

      {/* Financial summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
          <p className="text-xs text-orange-400 uppercase tracking-wide mb-1">Principal Outstanding</p>
          <p className="text-xl font-bold text-orange-700">{fmt(fin.principalOutstanding)}</p>
          <p className="text-[10px] text-orange-300 mt-1">Collected on loan closure</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4 border border-red-100">
          <p className="text-xs text-red-400 uppercase tracking-wide mb-1">Interest Outstanding</p>
          <p className="text-xl font-bold text-red-600">{fmt(fin.interestOutstanding)}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4 border border-green-100">
          <p className="text-xs text-green-400 uppercase tracking-wide mb-1">Interest Received</p>
          <p className="text-xl font-bold text-green-700">{fmt(fin.interestReceived)}</p>
        </div>
      </div>

      {/* Installment grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-sm font-bold text-gray-700">
            Monthly Installments — {fin.paidCount}/{loan.installments.length} paid
            {fin.overdueCount > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-xs font-normal">{fin.overdueCount} overdue</span>
            )}
          </h2>
          <div className="flex gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 border border-green-300 inline-block"/>Paid</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-200 border border-amber-300 inline-block"/>Partial</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 border border-red-300 inline-block"/>Overdue</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-white border border-gray-300 inline-block"/>Upcoming</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200 border border-slate-400 inline-block"/>Waived</span>
          </div>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-12 gap-2">
          {loan.installments.map((inst) => {
            const due = new Date(inst.dueDate); due.setHours(0, 0, 0, 0);
            const isPastDue = inst.status === 'OVERDUE' || (inst.status === 'PENDING' && due < today);
            const canPay = canRecord && ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(inst.status) && loan.status !== 'CLOSED';
            const tooltip = buildTooltip(inst);

            return (
              <div
                key={inst.id}
                role={canPay ? 'button' : undefined}
                tabIndex={canPay ? 0 : undefined}
                onClick={() => canPay && openPay(inst)}
                onKeyDown={(e) => e.key === 'Enter' && canPay && openPay(inst)}
                title={tooltip}
                className={[
                  'relative group rounded-lg border-2 p-2 text-center select-none transition-all',
                  tileClasses(inst),
                  canPay ? 'cursor-pointer hover:scale-110 hover:shadow-md hover:z-10' : 'cursor-default',
                ].join(' ')}
              >
                <p className="text-[10px] font-bold leading-tight">#{inst.number}</p>
                <p className="text-[9px] mt-0.5 opacity-70 leading-tight">
                  {new Date(inst.dueDate).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}
                </p>
                {inst.status === 'PAID' && <p className="text-[10px] mt-0.5 text-green-600 font-bold">✓</p>}
                {inst.status === 'PARTIALLY_PAID' && <p className="text-[8px] mt-0.5 opacity-80">{fmt(inst.paid)}</p>}
                {isPastDue && inst.status !== 'PARTIALLY_PAID' && inst.status !== 'PAID' && (
                  <p className="text-[10px] mt-0.5 font-bold">!</p>
                )}

                {/* Tooltip panel */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 pointer-events-none">
                  <div className="bg-gray-900 text-white rounded-lg px-3 py-2 text-left shadow-xl whitespace-pre text-[10px] leading-relaxed min-w-[170px]">
                    {tooltip}
                  </div>
                  <div className="w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1"/>
                </div>
              </div>
            );
          })}
        </div>

        {canRecord && loan.status !== 'CLOSED' && (
          <p className="mt-3 text-xs text-gray-400">Click an overdue or pending month to record a payment.</p>
        )}
      </div>

      {/* Documents */}
      {(loan.securityDocUrl || loan.promissoryNoteUrl) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3">Documents</h2>
          <div className="flex flex-wrap gap-3">
            {loan.securityDocUrl && (
              <a href={loan.securityDocUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-blue-600 hover:bg-gray-50 transition-colors">
                📎 Security Document
              </a>
            )}
            {loan.promissoryNoteUrl && (
              <a href={loan.promissoryNoteUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm text-blue-600 hover:bg-gray-50 transition-colors">
                📄 Promissory Note
              </a>
            )}
          </div>
        </div>
      )}

      {/* Payment history */}
      {loan.payments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3">Payment History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 uppercase border-b border-gray-100">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Method</th>
                  <th className="pb-2">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loan.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-4 text-gray-600">{fmtDate(p.paymentDate)}</td>
                    <td className="py-2 pr-4 font-semibold text-gray-900">{fmt(p.amount)}</td>
                    <td className="py-2 pr-4 text-gray-600">{p.method}</td>
                    <td className="py-2 text-gray-400">{p.referenceNumber ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Close / Reopen loan */}
      {canClose && loan.status === 'DISBURSED' && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-orange-800">Close Loan</p>
            <p className="text-xs text-orange-600 mt-0.5">
              Ensure principal of <strong>{fmt(loan.principal)}</strong> has been collected from the borrower before closing.
            </p>
          </div>
          <button
            onClick={() => { setCloseError(''); setShowCloseConfirm(true); }}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            Close Loan
          </button>
        </div>
      )}
      {canClose && loan.status === 'CLOSED' && (
        <div className="flex justify-end">
          <button
            onClick={() => { setReopenError(''); setShowReopenConfirm(true); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Reopen Loan
          </button>
        </div>
      )}

      {showCloseConfirm && (
        <CloseLoanModal
          loanNumber={loan.loanNumber}
          outstanding={fin.interestOutstanding}
          hint={`Confirm that principal of ${fmt(loan.principal)} has been collected. Remaining interest installments will be waived.`}
          closing={closing}
          error={closeError}
          onCancel={() => { setShowCloseConfirm(false); setCloseError(''); }}
          onConfirm={handleClose}
        />
      )}

      {showReopenConfirm && (
        <ReopenLoanModal
          loanNumber={loan.loanNumber}
          previousCloseComment={loan.closeComment}
          waivedCount={loan.installments.filter((i) => i.status === 'WAIVED').length}
          reopening={reopening}
          error={reopenError}
          onCancel={() => { setShowReopenConfirm(false); setReopenError(''); }}
          onConfirm={handleReopen}
        />
      )}

      {/* Payment modal */}
      {payInst && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-base font-bold text-gray-900 mb-1">Record Interest Payment</h3>
            <p className="text-xs text-gray-500 mb-4">Month #{payInst.number} — Due {fmtDate(payInst.dueDate)}</p>

            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-600 space-y-1">
              <div className="flex justify-between"><span>Interest</span><span className="font-semibold">{fmt(payInst.total)}</span></div>
              {payInst.paid > 0 && <div className="flex justify-between"><span>Already paid</span><span className="font-semibold text-green-600">{fmt(payInst.paid)}</span></div>}
              <div className="flex justify-between border-t border-gray-200 pt-1"><span>Remaining</span><span className="font-bold text-orange-600">{fmt(Math.max(0, payInst.total - payInst.paid))}</span></div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹)</label>
                <input type="number" value={payForm.amount} min="1"
                  onChange={(e) => setPayForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
                <select value={payForm.method} onChange={(e) => setPayForm(f => ({ ...f, method: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reference No. <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={payForm.ref} placeholder="UTR / cheque number"
                  onChange={(e) => setPayForm(f => ({ ...f, ref: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
                <input type="date" value={payForm.date}
                  onChange={(e) => setPayForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {payError && <p className="mt-3 text-xs text-red-600">{payError}</p>}

            <div className="mt-5 flex gap-3">
              <button onClick={() => setPayInst(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={submitPay} disabled={paying}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60 transition-colors">
                {paying ? 'Recording…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
