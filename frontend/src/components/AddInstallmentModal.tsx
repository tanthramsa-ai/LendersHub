'use client';

import { useState } from 'react';
import { addInstallment } from '@/services/tenant-api';

type Props = {
  loanId: string;
  onCancel: () => void;
  onAdded: () => void;
};

/**
 * Small modal for extending a loan's schedule by one installment. The due date is picked
 * automatically (one cycle period after the last installment) and the whole amount counts as
 * principal, no interest — matching how every other installment on the schedule already
 * behaves, so it's included the same way in Principal/Interest Outstanding. Restricted on the
 * backend to Owner/Admin/Manager.
 */
export function AddInstallmentModal({ loanId, onCancel, onAdded }: Props) {
  const [totalAmount, setTotalAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave = !!totalAmount && Number(totalAmount) > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await addInstallment(loanId, { totalAmount: Number(totalAmount) });
      onAdded();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to add installment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Add installment to schedule</h2>
          <p className="text-xs text-gray-500 mt-1">
            This adds a new due installment after the last one on the schedule, to make up for a
            missed EMI — it does not record a payment. To collect more than what&apos;s due on an
            existing installment, use <span className="font-medium text-gray-700">Record Payment</span> instead;
            any amount above the balance owed carries automatically onto the next installment.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Amount</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            placeholder="0.00"
            autoFocus
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Add Installment'}
          </button>
        </div>
      </div>
    </div>
  );
}
