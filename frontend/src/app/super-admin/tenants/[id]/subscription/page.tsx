'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { tenantsApi, type PlanInfo, type TenantDetail } from '@/services/tenants';

type Plan = 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';
type TrialDays = 0 | 7 | 14 | 30;

const BILLING_OPTIONS: { value: BillingCycle; label: string; discount: number }[] = [
  { value: 'MONTHLY', label: 'Monthly', discount: 0 },
  { value: 'QUARTERLY', label: 'Quarterly', discount: 5 },
  { value: 'ANNUALLY', label: 'Annually', discount: 15 },
];

const TRIAL_OPTIONS: { value: TrialDays; label: string }[] = [
  { value: 0, label: 'No trial' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
];

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export default function SubscriptionPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan>('PROFESSIONAL');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('MONTHLY');
  const [trialDays, setTrialDays] = useState<TrialDays>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    Promise.all([tenantsApi.get(id), tenantsApi.getPlans()])
      .then(([t, p]) => {
        setTenant(t);
        setPlans(p);
        if (t.plan) setSelectedPlan(t.plan as Plan);
        if (t.billingCycle) setBillingCycle(t.billingCycle as BillingCycle);
        if (t.trialDays) setTrialDays(t.trialDays as TrialDays);
      })
      .catch(() => setLoadError('Failed to load data'))
      .finally(() => setLoading(false));
  }, [id, router]);

  const currentPlanInfo = plans.find((p) => p.id === selectedPlan);
  const billingOption = BILLING_OPTIONS.find((b) => b.value === billingCycle)!;
  const discount = billingOption?.discount ?? 0;
  const basePrice = currentPlanInfo?.basePrice ?? 0;
  const effectiveMonthly = +(basePrice * (1 - discount / 100)).toFixed(2);

  const trialEnd = trialDays > 0
    ? new Date(Date.now() + trialDays * 86_400_000).toLocaleDateString()
    : null;

  async function handleSubmit() {
    setError('');
    setSubmitting(true);
    try {
      await tenantsApi.configureSubscription(id, {
        plan: selectedPlan,
        billingCycle,
        trialDays: trialDays || undefined,
      });
      router.push(`/super-admin/tenants/${id}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to configure subscription');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{loadError}</p>
        <button onClick={() => router.back()} className="text-indigo-400 hover:underline text-sm">← Go back</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="font-bold text-white">Configure Subscription</h1>
          <p className="text-xs text-gray-500">{tenant?.companyName}</p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        {/* Plan selection */}
        <section>
          <h2 className="font-semibold mb-4">Select Plan</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => {
              const isSelected = selectedPlan === plan.id;
              return (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id as Plan)}
                  className={`text-left rounded-xl border p-5 transition-all ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500'
                      : 'border-gray-800 bg-gray-900 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-white">{plan.name}</p>
                      <p className="text-2xl font-bold text-white mt-1">
                        ${plan.basePrice}
                        <span className="text-sm font-normal text-gray-400">/mo</span>
                      </p>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <ul className="space-y-1.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-gray-300">
                        <CheckIcon />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </section>

        {/* Billing cycle */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Billing Cycle</h2>
          <div className="grid grid-cols-3 gap-3">
            {BILLING_OPTIONS.map((opt) => {
              const isSelected = billingCycle === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setBillingCycle(opt.value)}
                  className={`rounded-lg border p-4 text-left transition-all ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500'
                      : 'border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <p className="font-medium text-white text-sm">{opt.label}</p>
                  {opt.discount > 0 ? (
                    <p className="text-xs text-emerald-400 mt-0.5">{opt.discount}% off</p>
                  ) : (
                    <p className="text-xs text-gray-500 mt-0.5">No discount</p>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* Trial period */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-1">Trial Period</h2>
          <p className="text-sm text-gray-500 mb-4">Optional free trial before billing begins</p>
          <div className="grid grid-cols-4 gap-3">
            {TRIAL_OPTIONS.map((opt) => {
              const isSelected = trialDays === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTrialDays(opt.value)}
                  className={`rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-950/40 text-white ring-1 ring-indigo-500'
                      : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Cost summary */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Cost Summary</h2>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Base price ({currentPlanInfo?.name})</span>
              <span className="text-white">${basePrice}/mo</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{billingOption.label} discount</span>
                <span className="text-emerald-400">−{discount}%</span>
              </div>
            )}
            <div className="border-t border-gray-800 pt-3 flex justify-between">
              <span className="font-semibold text-white">Effective monthly rate</span>
              <span className="text-xl font-bold text-white">${effectiveMonthly}</span>
            </div>
            {trialEnd && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Trial ends</span>
                <span className="text-blue-400">{trialEnd}</span>
              </div>
            )}
            {trialDays === 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Billing starts</span>
                <span className="text-white">Immediately on save</span>
              </div>
            )}
          </div>
        </section>

        <div className="flex items-center gap-4 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-2.5 text-sm rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              'Save Subscription'
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
