'use client';

import { useState } from 'react';
import { markLoanNpa, clearLoanNpa } from '@/services/tenant-api';

type NpaLoan = {
  id: string;
  loanNumber: string;
  isNpa: boolean;
  overdueCount: number;
  npaThreshold?: number;
  npaMarkedAt?: string | null;
  npaMarkedByName?: string | null;
  npaReason?: string | null;
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * NPA badge plus the manual mark/clear control.
 *
 * `loan.isNpa` is decided by the server (tenant threshold OR manual flag) — this
 * component never recomputes it, it only explains which of the two applied.
 */
export function NpaBadge({
  loan,
  canManage = false,
  onChanged,
}: {
  loan: NpaLoan;
  canManage?: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState<'mark' | 'clear' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isManual = !!loan.npaMarkedAt;
  const threshold = loan.npaThreshold;

  const explanation = isManual
    ? `Marked NPA${loan.npaMarkedByName ? ` by ${loan.npaMarkedByName}` : ''}${loan.npaMarkedAt ? ` on ${fmtDate(loan.npaMarkedAt)}` : ''}${loan.npaReason ? ` — ${loan.npaReason}` : ''}`
    : threshold
      ? `${loan.overdueCount} overdue installments (NPA at ${threshold})`
      : `${loan.overdueCount} overdue installments`;

  async function submit() {
    const trimmed = reason.trim();
    if (open === 'mark' && !trimmed) {
      setError('A reason is required to mark a loan NPA');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (open === 'mark') await markLoanNpa(loan.id, trimmed);
      else await clearLoanNpa(loan.id, trimmed || undefined);
      setOpen(null);
      setReason('');
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {loan.isNpa && (
        <span
          title={explanation}
          className="px-2 py-0.5 bg-red-200 text-red-800 rounded text-xs font-bold cursor-help"
        >
          NPA{isManual ? ' •' : ''}
        </span>
      )}

      {canManage && !isManual && !loan.isNpa && (
        <button
          type="button"
          onClick={() => { setOpen('mark'); setError(''); }}
          className="px-2 py-0.5 border border-red-300 text-red-700 hover:bg-red-50 rounded text-xs font-medium transition-colors"
        >
          Mark NPA
        </button>
      )}
      {canManage && isManual && (
        <button
          type="button"
          onClick={() => { setOpen('clear'); setError(''); }}
          className="px-2 py-0.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded text-xs font-medium transition-colors"
        >
          Clear NPA
        </button>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">
              {open === 'mark' ? 'Mark Loan as NPA' : 'Clear NPA Flag'}
            </h2>

            {open === 'mark' ? (
              <p className="text-sm text-gray-600">
                This flags <strong>{loan.loanNumber}</strong> as a non-performing asset regardless of
                its overdue count. The loan stays active and collectable.
              </p>
            ) : (
              <p className="text-sm text-gray-600">
                This removes the manual NPA flag from <strong>{loan.loanNumber}</strong>.
                {threshold && loan.overdueCount >= threshold && (
                  <> It will still show as NPA because it has {loan.overdueCount} overdue installments
                    (threshold {threshold}).</>
                )}
              </p>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Reason {open === 'mark' && <span className="text-red-500">*</span>}
              </label>
              <textarea
                value={reason}
                onChange={(e) => { setReason(e.target.value.slice(0, 1000)); if (error) setError(''); }}
                rows={3}
                placeholder={open === 'mark'
                  ? 'e.g. Borrower absconded; recovery handed to legal…'
                  : 'e.g. Borrower resumed payments; flag raised in error…'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 resize-y min-h-[80px]"
              />
              <p className="text-[11px] text-gray-400 mt-1 text-right">{reason.length}/1000</p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setOpen(null); setReason(''); setError(''); }}
                disabled={busy}
                className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className={`flex-1 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40 ${
                  open === 'mark' ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-800 hover:bg-gray-900'
                }`}
              >
                {busy ? 'Saving…' : open === 'mark' ? 'Confirm NPA' : 'Clear Flag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
