'use client';

import { useState } from 'react';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

type CloseProps = {
  loanNumber: string;
  outstanding: number;
  closing?: boolean;
  error?: string;
  /** Extra context line (e.g. monthly principal reminder) */
  hint?: string;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
};

/**
 * Close-loan dialog with a required Comment for both:
 * - pending dues (waiver / early close reason)
 * - all dues paid (closure note)
 */
export function CloseLoanModal({
  loanNumber,
  outstanding,
  closing = false,
  error,
  hint,
  onCancel,
  onConfirm,
}: CloseProps) {
  const [comment, setComment] = useState('');
  const [localError, setLocalError] = useState('');
  const hasPendingDues = outstanding > 0.009;

  function submit() {
    const trimmed = comment.trim();
    if (!trimmed) {
      setLocalError('Comment is required when closing a loan');
      return;
    }
    if (trimmed.length > 1000) {
      setLocalError('Comment must be 1000 characters or fewer');
      return;
    }
    setLocalError('');
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Close Loan</h2>
        <p className="text-sm text-gray-600">
          This will mark <strong>{loanNumber}</strong> as CLOSED
          {hasPendingDues
            ? '. Remaining unpaid installments will be waived.'
            : '. All dues appear to be paid.'}
        </p>

        {hasPendingDues ? (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            Outstanding balance: <strong>{fmt(outstanding)}</strong>
            <p className="text-xs mt-1 text-amber-700">
              Please explain why this loan is being closed with pending dues.
            </p>
          </div>
        ) : (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
            All dues are paid. Add a short note to confirm proper closure.
          </div>
        )}

        {hint && (
          <p className="text-xs text-gray-500">{hint}</p>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Comment <span className="text-red-500">*</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => {
              setComment(e.target.value.slice(0, 1000));
              if (localError) setLocalError('');
            }}
            rows={3}
            placeholder={
              hasPendingDues
                ? 'e.g. Borrower settled partial amount; remaining waived by manager approval…'
                : 'e.g. All installments collected; loan closed as agreed…'
            }
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 resize-y min-h-[80px]"
          />
          <p className="text-[11px] text-gray-400 mt-1 text-right">{comment.length}/1000</p>
        </div>

        {(localError || error) && (
          <p className="text-sm text-red-600">{localError || error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={closing}
            className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={closing}
            onClick={submit}
            className="flex-1 py-2 text-sm font-medium text-white bg-gray-800 hover:bg-gray-900 rounded-lg disabled:opacity-40"
          >
            {closing ? 'Closing…' : 'Confirm Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

type ReopenProps = {
  loanNumber: string;
  previousCloseComment?: string | null;
  waivedCount?: number;
  reopening?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
};

/** Reopen a closed loan — restores waived installments and sets status back to DISBURSED. */
export function ReopenLoanModal({
  loanNumber,
  previousCloseComment,
  waivedCount = 0,
  reopening = false,
  error,
  onCancel,
  onConfirm,
}: ReopenProps) {
  const [comment, setComment] = useState('');
  const [localError, setLocalError] = useState('');

  function submit() {
    const trimmed = comment.trim();
    if (!trimmed) {
      setLocalError('Comment is required when reopening a loan');
      return;
    }
    if (trimmed.length > 1000) {
      setLocalError('Comment must be 1000 characters or fewer');
      return;
    }
    setLocalError('');
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Reopen Loan</h2>
        <p className="text-sm text-gray-600">
          This will set <strong>{loanNumber}</strong> back to <strong>DISBURSED</strong> and restore any waived installments so collections can continue.
        </p>

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          {waivedCount > 0
            ? `${waivedCount} waived installment${waivedCount === 1 ? '' : 's'} will be restored to pending/overdue.`
            : 'No waived installments to restore.'}
        </div>

        {previousCloseComment && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Previous closure comment</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{previousCloseComment}</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Comment <span className="text-red-500">*</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => {
              setComment(e.target.value.slice(0, 1000));
              if (localError) setLocalError('');
            }}
            rows={3}
            placeholder="e.g. Reopened to collect remaining dues after borrower resumed payments…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 resize-y min-h-[80px]"
          />
          <p className="text-[11px] text-gray-400 mt-1 text-right">{comment.length}/1000</p>
        </div>

        {(localError || error) && (
          <p className="text-sm text-red-600">{localError || error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={reopening}
            className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={reopening}
            onClick={submit}
            className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40"
          >
            {reopening ? 'Reopening…' : 'Confirm Reopen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Read-only close comment shown on closed loans. */
export function CloseCommentBanner({
  comment,
  closedAt,
  hasWaivedInstallments,
}: {
  comment: string | null | undefined;
  closedAt?: string | null;
  hasWaivedInstallments?: boolean;
}) {
  if (!comment && !closedAt) return null;

  const closedLabel = closedAt
    ? new Date(closedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;

  return (
    <div className={`rounded-xl border p-4 ${hasWaivedInstallments ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Closure Comment
        </p>
        {closedLabel && (
          <p className="text-[11px] text-gray-400">Closed {closedLabel}</p>
        )}
      </div>
      {hasWaivedInstallments && (
        <p className="text-xs text-amber-700 mb-2">Closed with pending dues waived.</p>
      )}
      <p className="text-sm text-gray-800 whitespace-pre-wrap">
        {comment?.trim() || '—'}
      </p>
    </div>
  );
}
