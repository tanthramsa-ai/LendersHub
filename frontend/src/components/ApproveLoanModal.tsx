'use client';

import { useState } from 'react';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

type ApproveProps = {
  loanNumber: string;
  customerName: string;
  principal: number;
  /** The loan's proposed first-due-date, set by the agent at creation — editable here since the real EMI clock starts at release, not at the original proposal. */
  firstDueDate: string;
  securityDocUrl?: string | null;
  promissoryNoteUrl?: string | null;
  /** Only set while the customer is still IN_PROGRESS — approving this loan verifies them too, so their documents need review here. */
  customerStatus?: 'IN_PROGRESS' | 'ACTIVE';
  customerAadhaarDocUrl?: string | null;
  customerPhotoUrl?: string | null;
  approving?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (firstDueDate: string) => void;
};

/**
 * Approval is a manual judgment call, not an automated document check — the
 * approver reviews whatever's on file and explicitly confirms. For a new
 * customer's first loan, approving also verifies the customer (mirroring the
 * standalone "Verify & Activate" gate), so their Aadhaar copy and photo are
 * reviewed in the same screen — both are mandatory, and the backend refuses
 * the approval if either is missing.
 * Releasing the loan also re-anchors the EMI schedule to whatever date the
 * approver picks here, since the agent's original date was just a proposal.
 */
export function ApproveLoanModal({
  loanNumber,
  customerName,
  principal,
  firstDueDate,
  securityDocUrl,
  promissoryNoteUrl,
  customerStatus,
  customerAadhaarDocUrl,
  customerPhotoUrl,
  approving = false,
  error,
  onCancel,
  onConfirm,
}: ApproveProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [dueDate, setDueDate] = useState(firstDueDate);
  const verifiesCustomer = customerStatus === 'IN_PROGRESS';
  const missingCustomerDocs = verifiesCustomer && (!customerAadhaarDocUrl || !customerPhotoUrl);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Approve Loan</h2>
        <p className="text-sm text-gray-600">
          This will disburse <strong>{fmt(principal)}</strong> to <strong>{customerName}</strong> on loan <strong>{loanNumber}</strong>.
        </p>

        {verifiesCustomer && (
          <div className={`p-3 rounded-lg border ${missingCustomerDocs ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">
              New customer — verifying with this loan
            </p>
            <div className="flex flex-wrap gap-2">
              {customerPhotoUrl ? (
                <a href={customerPhotoUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-blue-600 hover:bg-white transition-colors bg-white">
                  🖼️ Photo
                </a>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-700">🖼️ Photo missing</span>
              )}
              {customerAadhaarDocUrl ? (
                <a href={customerAadhaarDocUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-blue-600 hover:bg-white transition-colors bg-white">
                  🪪 Aadhaar Copy
                </a>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-700">🪪 Aadhaar missing</span>
              )}
            </div>
            {missingCustomerDocs && (
              <p className="text-xs text-red-700 mt-2">
                Both are required to verify this customer. Ask the agent to upload what&apos;s missing before approving.
              </p>
            )}
          </div>
        )}

        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Loan documents</p>
          <div className="flex flex-wrap gap-2">
            {securityDocUrl && (
              <a href={securityDocUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-blue-600 hover:bg-white transition-colors">
                📎 Security Document
              </a>
            )}
            {promissoryNoteUrl ? (
              <a href={promissoryNoteUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-blue-600 hover:bg-white transition-colors">
                📄 Promissory Note
              </a>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-700">📄 Promissory note missing</span>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            EMI Start Date (First Due Date) <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            The full schedule shifts to start here — the agent's proposed date is just a placeholder until release.
          </p>
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
            disabled={approving || !confirmed || !dueDate || missingCustomerDocs}
            onClick={() => onConfirm(dueDate)}
            className="flex-1 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg disabled:opacity-40"
          >
            {approving ? 'Approving…' : 'Confirm Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
