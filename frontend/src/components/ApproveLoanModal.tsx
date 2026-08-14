'use client';

import { useState } from 'react';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

type ApproveProps = {
  loanNumber: string;
  customerName: string;
  principal: number;
  securityDocUrl?: string | null;
  promissoryNoteUrl?: string | null;
  approving?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Approval is a manual judgment call, not an automated document check — the
 * approver reviews whatever's on file and explicitly confirms, mirroring the
 * customer-verification "Verify & Activate" gate rather than parsing documents.
 */
export function ApproveLoanModal({
  loanNumber,
  customerName,
  principal,
  securityDocUrl,
  promissoryNoteUrl,
  approving = false,
  error,
  onCancel,
  onConfirm,
}: ApproveProps) {
  const [confirmed, setConfirmed] = useState(false);
  const hasDocs = Boolean(securityDocUrl || promissoryNoteUrl);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Approve Loan</h2>
        <p className="text-sm text-gray-600">
          This will disburse <strong>{fmt(principal)}</strong> to <strong>{customerName}</strong> on loan <strong>{loanNumber}</strong>.
        </p>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Documents on file</p>
          {hasDocs ? (
            <div className="flex flex-wrap gap-2">
              {securityDocUrl && (
                <a href={securityDocUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-blue-600 hover:bg-white transition-colors">
                  📎 Security Document
                </a>
              )}
              {promissoryNoteUrl && (
                <a href={promissoryNoteUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-blue-600 hover:bg-white transition-colors">
                  📄 Promissory Note
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-amber-700">No documents were uploaded with this loan. Verify the customer's KYC on their profile before approving.</p>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          I have verified the customer's KYC and loan documents and approve disbursing this loan.
        </label>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={approving}
            className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={approving || !confirmed}
            onClick={onConfirm}
            className="flex-1 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-40"
          >
            {approving ? 'Approving…' : 'Confirm Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
