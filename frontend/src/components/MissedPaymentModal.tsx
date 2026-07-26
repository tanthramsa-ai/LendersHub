'use client';

import { useEffect, useState } from 'react';
import {
  previewMissResolutions, MissResolution, MissResolutionPreview, MissResolutionOption,
} from '@/services/tenant-api';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

/**
 * Field-facing wording. A collector reads these standing in front of the borrower, so each one
 * says what happens next in the borrower's terms — not the internal strategy name.
 */
const COPY: Record<MissResolution, { label: string; detail: (o: MissResolutionOption, shortfall: number) => string }> = {
  PAY_EXTRA_NEXT: {
    label: 'Collect it on the next visit',
    detail: (_o, shortfall) =>
      `Nothing changes on the schedule. You collect the ${fmt(shortfall)} shortfall on top of the next instalment.`,
  },
  EXTEND_EMI: {
    label: 'Spread it across the remaining instalments',
    detail: (o) =>
      `Every remaining collection goes up to ${fmt(o.nextDue)}. The loan still finishes on its original date.`,
  },
  DEFER_TO_END: {
    label: 'Add it to the end of the loan',
    detail: (o) =>
      `Instalments stay the same. The loan runs ${o.periods} collections instead, finishing later.`,
  },
};

type Props = {
  loanId: string;
  installmentId: string;
  /** 'Week' or 'Day' — matches the loan's cadence so the dialog reads correctly. */
  periodNoun: string;
  currentResolution: MissResolution | null;
  saving?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (strategy: MissResolution) => void;
  onClear: () => void;
};

/**
 * Confirmation dialog for handling a missed instalment. Shows what each option would actually
 * do in rupees before anything is committed — this changes what a borrower is asked to pay, so
 * it should never happen from a stray dropdown click.
 */
export function MissedPaymentModal({
  loanId, installmentId, periodNoun, currentResolution,
  saving = false, error, onCancel, onConfirm, onClear,
}: Props) {
  const [preview, setPreview] = useState<MissResolutionPreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [choice, setChoice] = useState<MissResolution | null>(currentResolution);

  useEffect(() => {
    let cancelled = false;
    previewMissResolutions(loanId, installmentId)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((e: unknown) => { if (!cancelled) setLoadError((e as Error).message); });
    return () => { cancelled = true; };
  }, [loanId, installmentId]);

  const selected = preview?.options.find((o) => o.strategy === choice) ?? null;
  const canConfirm = !!choice && !!selected?.applicable && choice !== currentResolution && !saving;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Missed payment</h2>
          {preview ? (
            <p className="text-sm text-gray-600 mt-1">
              {periodNoun} #{preview.installmentNumber} was short by{' '}
              <strong className="text-red-700">{fmt(preview.shortfall)}</strong>. Choose how to handle it.
            </p>
          ) : (
            <p className="text-sm text-gray-400 mt-1">Working out the options…</p>
          )}
        </div>

        {loadError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</p>
        )}

        {preview && (
          <>
            <div className="space-y-2">
              {preview.options.map((o) => {
                const copy = COPY[o.strategy];
                const isChosen = choice === o.strategy;
                const disabled = !o.applicable;
                return (
                  <label
                    key={o.strategy}
                    className={[
                      'block border-2 rounded-xl p-3 transition-colors',
                      disabled
                        ? 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-70'
                        : isChosen
                          ? 'border-blue-500 bg-blue-50/60 cursor-pointer'
                          : 'border-gray-200 hover:border-gray-300 cursor-pointer',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="miss-resolution"
                        className="mt-1 flex-shrink-0"
                        checked={isChosen}
                        disabled={disabled}
                        onChange={() => setChoice(o.strategy)}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900">{copy.label}</span>
                          {o.changesAmounts && (
                            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                              Changes what they pay
                            </span>
                          )}
                          {o.strategy === currentResolution && (
                            <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {disabled ? o.unavailableReason : copy.detail(o, preview.shortfall)}
                        </p>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Before / after, so the consequence is explicit rather than implied. */}
            {selected?.applicable && choice !== currentResolution && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2">
                  If you choose this
                </p>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  {[
                    { k: 'Each collection', now: preview.current.nextDue, next: selected.nextDue, money: true },
                    { k: 'Collections left', now: preview.current.periods, next: selected.periods, money: false },
                    { k: 'Total to repay', now: preview.current.totalPayable, next: selected.totalPayable, money: true },
                  ].map((r) => {
                    const changed = Math.abs(Number(r.now) - Number(r.next)) > 0.005;
                    return (
                      <div key={r.k}>
                        <dt className="text-gray-500">{r.k}</dt>
                        <dd className={`mt-0.5 font-semibold ${changed ? 'text-amber-800' : 'text-gray-700'}`}>
                          {r.money ? fmt(Number(r.next)) : r.next}
                          {changed && (
                            <span className="block text-[10px] font-normal text-gray-400 line-through">
                              {r.money ? fmt(Number(r.now)) : r.now}
                            </span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
                {selected.changesAmounts && (
                  <p className="text-[11px] text-amber-800 mt-2">
                    Tell the borrower the new amount before the next visit.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-600 text-sm rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          {currentResolution && (
            <button
              type="button"
              onClick={onClear}
              disabled={saving}
              className="px-4 py-2 border border-red-200 text-red-700 text-sm rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors"
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={() => choice && onConfirm(choice)}
            disabled={!canConfirm}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
