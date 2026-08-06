'use client';

import { useState } from 'react';
import { clampTenureInput } from '@/lib/numeric-input';
import { sanitizeLoanPurposeInput } from '@/lib/quick-add-customer';
import { TenantBranch, WeeklyCalculationType } from '@/services/tenant-api';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';

export type EditLoanCycleType = 'WEEKLY' | 'DAILY' | 'MONTHLY' | 'AGENT_RISK' | 'TERM_LOAN';

const TERM_LABEL: Record<EditLoanCycleType, string> = {
  WEEKLY: 'weeks', DAILY: 'days', MONTHLY: 'months', AGENT_RISK: 'months', TERM_LOAN: 'months',
};
const TERM_MAX: Record<EditLoanCycleType, number> = {
  WEEKLY: 99, DAILY: 3650, MONTHLY: 360, AGENT_RISK: 360, TERM_LOAN: 360,
};

export type EditLoanInitial = {
  principal: number;
  interestRate: number;
  term: number;
  firstDueDate: string;
  purpose?: string | null;
  branchId?: string | null;
  /** WEEKLY/DAILY: REDUCING | FLAT | PER_1000_PER_DAY. TERM_LOAN: REDUCING | FLAT. Unused for MONTHLY/AGENT_RISK. */
  calculationType?: string;
  interestPerDay?: number | null;
  /** DAILY only. */
  dailyCycleType?: 'DAILY_NO_SUNDAY' | 'DAILY_WITH_SUNDAY';
};

type EditLoanModalProps = {
  cycleType: EditLoanCycleType;
  loanNumber: string;
  branches: TenantBranch[];
  initial: EditLoanInitial;
  saving?: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (dto: Record<string, unknown>) => void;
};

/**
 * Shared edit form for all 5 loan cycle types. Only usable pre-payment (server re-checks
 * this), since saving deletes and regenerates the entire installment schedule.
 */
export function EditLoanModal({ cycleType, loanNumber, branches, initial, saving = false, error, onCancel, onSave }: EditLoanModalProps) {
  const hasCalcType = cycleType === 'WEEKLY' || cycleType === 'DAILY' || cycleType === 'TERM_LOAN';
  const hasPerDayOption = cycleType === 'WEEKLY' || cycleType === 'DAILY';

  const [form, setForm] = useState({
    principal: String(initial.principal),
    interestRate: String(initial.interestRate ?? ''),
    term: String(initial.term),
    firstDueDate: initial.firstDueDate,
    purpose: initial.purpose ?? '',
    branchId: initial.branchId ?? '',
    calculationType: (initial.calculationType ?? 'REDUCING') as WeeklyCalculationType,
    interestPerDay: initial.interestPerDay != null ? String(initial.interestPerDay) : '3.19',
    emiRounding: '10',
    dailyCycleType: initial.dailyCycleType ?? 'DAILY_NO_SUNDAY',
  });
  const [localError, setLocalError] = useState('');

  const isPerDay = hasPerDayOption && form.calculationType === 'PER_1000_PER_DAY';

  function setF<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function submit() {
    const principal = parseFloat(form.principal);
    const term = parseInt(form.term, 10);
    const interestRate = isPerDay ? 0 : parseFloat(form.interestRate);
    const interestPerDay = parseFloat(form.interestPerDay);

    if (!principal || principal <= 0) { setLocalError('Principal must be positive'); return; }
    if (!term || term < 1 || term > TERM_MAX[cycleType]) { setLocalError(`Tenure must be 1–${TERM_MAX[cycleType]} ${TERM_LABEL[cycleType]}`); return; }
    if (!form.firstDueDate) { setLocalError('First installment date is required'); return; }
    if (isPerDay) {
      if (!interestPerDay || interestPerDay <= 0) { setLocalError('Interest per ₹1,000/day is required'); return; }
    } else if (interestRate < 0) {
      setLocalError('Invalid interest rate');
      return;
    }
    setLocalError('');

    const base: Record<string, unknown> = {
      principal,
      interestRate,
      firstDueDate: form.firstDueDate,
      ...(form.purpose.trim() && { purpose: form.purpose.trim() }),
      ...(form.branchId && { branchId: form.branchId }),
    };

    if (cycleType === 'WEEKLY') {
      onSave({
        ...base, termWeeks: term, calculationType: form.calculationType,
        emiRounding: parseInt(form.emiRounding, 10),
        ...(isPerDay && { interestPerDay }),
      });
    } else if (cycleType === 'DAILY') {
      onSave({
        ...base, termDays: term, calculationType: form.calculationType,
        emiRounding: parseInt(form.emiRounding, 10), cycleType: form.dailyCycleType,
        ...(isPerDay && { interestPerDay }),
      });
    } else if (cycleType === 'TERM_LOAN') {
      onSave({
        ...base, termMonths: term,
        calculationType: form.calculationType === 'PER_1000_PER_DAY' ? 'REDUCING' : form.calculationType,
        emiRounding: parseInt(form.emiRounding, 10),
      });
    } else {
      onSave({ ...base, termMonths: term });
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Edit Loan</h2>
          <p className="text-sm text-gray-500">{loanNumber}</p>
        </div>

        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          Saving will regenerate the full installment schedule from these values. Only available because no payments have been recorded yet.
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Principal Amount (₹) <span className="text-red-500">*</span></label>
            <input type="number" value={form.principal} onChange={(e) => setF('principal', e.target.value)} className={inputCls} min={1} />
          </div>
          <div>
            {isPerDay ? (
              <>
                <label className="block text-xs font-medium text-gray-600 mb-1">Interest per ₹1,000 per day (₹) <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" value={form.interestPerDay} onChange={(e) => setF('interestPerDay', e.target.value)} className={inputCls} min={0.01} max={10} />
              </>
            ) : (
              <>
                <label className="block text-xs font-medium text-gray-600 mb-1">Interest Rate (% per annum) <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" value={form.interestRate} onChange={(e) => setF('interestRate', e.target.value)} className={inputCls} min={0} max={200} />
              </>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Tenure ({TERM_LABEL[cycleType]}) <span className="text-red-500">*</span>
            </label>
            <input type="number" value={form.term} onChange={(e) => setF('term', clampTenureInput(e.target.value, TERM_MAX[cycleType]))} className={inputCls} min={1} max={TERM_MAX[cycleType]} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">First Installment Date <span className="text-red-500">*</span></label>
            <input type="date" value={form.firstDueDate} onChange={(e) => setF('firstDueDate', e.target.value)} className={inputCls} />
          </div>
          {hasCalcType && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Calculation Type</label>
              <select value={form.calculationType} onChange={(e) => setF('calculationType', e.target.value as WeeklyCalculationType)} className={inputCls}>
                <option value="REDUCING">Reducing Balance</option>
                <option value="FLAT">Flat Rate</option>
                {hasPerDayOption && <option value="PER_1000_PER_DAY">₹ per ₹1,000 per day</option>}
              </select>
            </div>
          )}
          {hasCalcType && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">EMI Rounding</label>
              <select value={form.emiRounding} onChange={(e) => setF('emiRounding', e.target.value)} className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-400`} disabled={isPerDay}>
                <option value="0">No rounding</option>
                <option value="10">Round to nearest ₹10</option>
                <option value="50">Round to nearest ₹50</option>
                <option value="100">Round to nearest ₹100</option>
              </select>
            </div>
          )}
          {cycleType === 'DAILY' && (
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Cycle</label>
              <div className="flex gap-3">
                {[
                  { value: 'DAILY_NO_SUNDAY', label: 'Daily (Sundays skipped)' },
                  { value: 'DAILY_WITH_SUNDAY', label: 'Daily (all days)' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setF('dailyCycleType', opt.value as 'DAILY_NO_SUNDAY' | 'DAILY_WITH_SUNDAY')}
                    className={`flex-1 text-left px-3 py-2 rounded-lg border-2 text-sm transition-colors ${form.dailyCycleType === opt.value ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {branches.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Branch</label>
              <select value={form.branchId} onChange={(e) => setF('branchId', e.target.value)} className={inputCls}>
                <option value="">No specific branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
            </div>
          )}
          <div className={branches.length > 0 ? '' : 'col-span-2'}>
            <label className="block text-xs font-medium text-gray-600 mb-1">Loan Purpose</label>
            <input value={form.purpose} onChange={(e) => setF('purpose', sanitizeLoanPurposeInput(e.target.value))} className={inputCls} placeholder="Agriculture, Business…" />
          </div>
        </div>

        {(localError || error) && (
          <p className="text-sm text-red-600">{localError || error}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
