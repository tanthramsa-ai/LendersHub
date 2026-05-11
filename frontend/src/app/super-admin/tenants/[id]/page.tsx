'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { tenantsApi, type TenantDetail } from '@/services/tenants';

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-900 text-emerald-300',
  PROVISIONING: 'bg-yellow-900 text-yellow-300 animate-pulse',
  SUSPENDED: 'bg-orange-900 text-orange-300',
  FAILED: 'bg-red-900 text-red-300',
};

const SUB_STATUS_STYLE: Record<string, string> = {
  TRIAL: 'bg-blue-900 text-blue-300',
  ACTIVE: 'bg-emerald-900 text-emerald-300',
  PAST_DUE: 'bg-orange-900 text-orange-300',
  CANCELLED: 'bg-gray-800 text-gray-400',
};

const PLAN_LABEL: Record<string, string> = {
  STARTER: 'Starter',
  PROFESSIONAL: 'Professional',
  ENTERPRISE: 'Enterprise',
};

const CYCLE_LABEL: Record<string, string> = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUALLY: 'Annually',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-400 w-44 shrink-0">{label}</span>
      <span className="text-sm text-white flex-1">{value}</span>
    </div>
  );
}

export default function TenantDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    tenantsApi.get(id)
      .then(setTenant)
      .catch(() => setError('Failed to load tenant'))
      .finally(() => setLoading(false));
  }, [id, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error || 'Tenant not found'}</p>
        <button onClick={() => router.back()} className="text-indigo-400 hover:underline text-sm">
          ← Go back
        </button>
      </div>
    );
  }

  const hasSubscription = !!tenant.plan;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push('/super-admin/tenants')} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-white">{tenant.companyName}</h1>
          <p className="text-xs text-gray-500 font-mono">{tenant.subdomain}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLE[tenant.status] ?? 'bg-gray-800 text-gray-300'}`}>
            {tenant.status}
          </span>
          <button
            onClick={() => router.push(`/super-admin/tenants/${id}/subscription`)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            {hasSubscription ? 'Edit Subscription' : 'Configure Subscription'}
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {/* Subscription banner */}
        {!hasSubscription && (
          <div className="bg-amber-950 border border-amber-700 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-amber-300 font-medium text-sm">No subscription configured</p>
              <p className="text-amber-500 text-xs mt-0.5">This tenant has not been assigned a plan yet.</p>
            </div>
            <button
              onClick={() => router.push(`/super-admin/tenants/${id}/subscription`)}
              className="shrink-0 text-sm px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
            >
              Configure now →
            </button>
          </div>
        )}

        {/* Subscription summary */}
        {hasSubscription && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold">Subscription</h2>
              {tenant.subscriptionStatus && (
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${SUB_STATUS_STYLE[tenant.subscriptionStatus] ?? 'bg-gray-800 text-gray-300'}`}>
                  {tenant.subscriptionStatus}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Plan</p>
                <p className="font-semibold text-white">{PLAN_LABEL[tenant.plan!] ?? tenant.plan}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Billing</p>
                <p className="font-semibold text-white">{CYCLE_LABEL[tenant.billingCycle!] ?? tenant.billingCycle}</p>
              </div>
              <div className="bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Monthly Amount</p>
                <p className="font-semibold text-white">${Number(tenant.monthlyAmount).toFixed(2)}</p>
              </div>
            </div>
            {tenant.trialEndsAt && (
              <p className="mt-3 text-xs text-blue-400">
                Trial ends: {new Date(tenant.trialEndsAt).toLocaleDateString()}
              </p>
            )}
            {tenant.subscriptionStartsAt && (
              <p className="mt-1 text-xs text-gray-500">
                Subscription starts: {new Date(tenant.subscriptionStartsAt).toLocaleDateString()}
              </p>
            )}
          </section>
        )}

        {/* Company details */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Company Details</h2>
          <InfoRow label="Company Name" value={tenant.companyName} />
          <InfoRow label="Subdomain" value={<span className="font-mono text-indigo-400">{tenant.subdomain}</span>} />
          <InfoRow label="Registration Number" value={tenant.registrationNumber} />
          {tenant.gstNumber && <InfoRow label="GST / Tax Number" value={tenant.gstNumber} />}
          <InfoRow label="Address" value={<span className="whitespace-pre-line">{tenant.address}</span>} />
          <InfoRow label="Admin Email" value={tenant.adminEmail} />
          <InfoRow label="Schema" value={<span className="font-mono text-xs text-gray-400">{tenant.schemaName ?? '—'}</span>} />
          <InfoRow label="Joined" value={new Date(tenant.createdAt).toLocaleDateString()} />
        </section>

        {/* Users */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="font-semibold">Users</h2>
            <p className="text-sm text-gray-400 mt-0.5">{tenant._count?.users ?? 0} total</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Email</th>
                  <th className="px-6 py-3 font-medium">Role</th>
                  <th className="px-6 py-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {tenant.users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500 text-sm">No users yet</td>
                  </tr>
                ) : (
                  tenant.users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-800 last:border-0">
                      <td className="px-6 py-3 text-white">
                        {u.firstName || u.lastName ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '—'}
                      </td>
                      <td className="px-6 py-3 text-gray-400">{u.email}</td>
                      <td className="px-6 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 font-medium">{u.role}</span>
                      </td>
                      <td className="px-6 py-3 text-gray-400 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
