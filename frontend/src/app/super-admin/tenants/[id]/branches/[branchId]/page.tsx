'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { tenantsApi, type BranchDetail, type LoanType, type CreateLoanTypePayload } from '@/services/tenants';

function StatCard({ label, value, icon, href }: { label: string; value: number; icon: string; href?: string }) {
  const inner = (
    <div className={`bg-gray-800 border border-gray-700 rounded-xl p-5 text-center ${href ? 'hover:border-indigo-500 cursor-pointer transition-colors' : ''}`}>
      <p className="text-3xl mb-1">{icon}</p>
      <p className="text-3xl font-black text-white">{value}</p>
      <p className="text-sm text-gray-400 mt-0.5">{label}</p>
      {href && <p className="text-xs text-indigo-400 mt-2">View all →</p>}
    </div>
  );
  return href ? <a href={href}>{inner}</a> : inner;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-400 w-40 shrink-0">{label}</span>
      <span className="text-sm text-white flex-1">{value ?? '—'}</span>
    </div>
  );
}

// ── Add Loan Type Modal ───────────────────────────────────────────────────────
function AddLoanTypeModal({ tenantId, onClose, onSuccess }: { tenantId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<CreateLoanTypePayload>({ name: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k: keyof CreateLoanTypePayload, v: string) {
    const num = ['minAmount', 'maxAmount', 'minInterestRate', 'maxInterestRate', 'minTermMonths', 'maxTermMonths'] as const;
    if ((num as readonly string[]).includes(k)) {
      setForm((f) => ({ ...f, [k]: v === '' ? undefined : Number(v) }));
    } else {
      setForm((f) => ({ ...f, [k]: v }));
    }
  }

  async function submit() {
    if (!form.name.trim()) return setError('Loan type name is required');
    setError(''); setLoading(true);
    try {
      await tenantsApi.createLoanType(tenantId, form);
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create loan type');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-white text-lg">Add Loan Type</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Name *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Gold Loan, Personal Loan"
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Description</label>
            <input value={form.description ?? ''} onChange={(e) => set('description', e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Min Amount (₹)</label>
              <input type="number" value={form.minAmount ?? ''} onChange={(e) => set('minAmount', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Max Amount (₹)</label>
              <input type="number" value={form.maxAmount ?? ''} onChange={(e) => set('maxAmount', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Interest Rate Min (%)</label>
              <input type="number" step="0.01" value={form.minInterestRate ?? ''} onChange={(e) => set('minInterestRate', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Interest Rate Max (%)</label>
              <input type="number" step="0.01" value={form.maxInterestRate ?? ''} onChange={(e) => set('maxInterestRate', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Min Term (months)</label>
              <input type="number" value={form.minTermMonths ?? ''} onChange={(e) => set('minTermMonths', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Max Term (months)</label>
              <input type="number" value={form.maxTermMonths ?? ''} onChange={(e) => set('maxTermMonths', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button onClick={submit} disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60">
            {loading ? 'Creating...' : 'Add Loan Type'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BranchDetailPage() {
  const router = useRouter();
  const params = useParams();
  const tenantId = params.id as string;
  const branchId = params.branchId as string;

  const [branch, setBranch] = useState<BranchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddLoanType, setShowAddLoanType] = useState(false);

  function load() {
    setLoading(true);
    tenantsApi.getBranch(tenantId, branchId)
      .then(setBranch)
      .catch(() => setError('Failed to load branch'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, branchId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !branch) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{error || 'Branch not found'}</p>
        <button onClick={() => router.back()} className="text-indigo-400 hover:underline text-sm">← Go back</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push(`/super-admin/tenants/${tenantId}?tab=branches`)} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-white">{branch.name}</h1>
          <p className="text-xs text-gray-500 font-mono">{branch.code}</p>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${branch.isActive ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
          {branch.isActive ? 'Active' : 'Inactive'}
        </span>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Users" value={branch.stats.users} icon="👤" />
          <StatCard label="Customers" value={branch.stats.customers} icon="👥" />
          <StatCard label="Loans" value={branch.stats.loans} icon="💰" />
        </div>

        {/* Branch Details */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-4">Branch Details</h2>
          <InfoRow label="Branch Name" value={branch.name} />
          <InfoRow label="Branch Code" value={<span className="font-mono text-indigo-400">{branch.code}</span>} />
          <InfoRow label="Manager" value={branch.managerName} />
          <InfoRow label="Address" value={branch.address} />
          <InfoRow label="City" value={branch.city} />
          <InfoRow label="State" value={branch.state} />
          <InfoRow label="Phone" value={branch.phone} />
          <InfoRow label="Email" value={branch.email} />
          <InfoRow label="Created" value={new Date(branch.createdAt).toLocaleDateString('en-IN')} />
        </section>

        {/* Loan Types */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Loan Types</h2>
              <p className="text-sm text-gray-400 mt-0.5">{branch.loanTypes.length} configured</p>
            </div>
            <button onClick={() => setShowAddLoanType(true)}
              className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors">
              + Add Loan Type
            </button>
          </div>

          {branch.loanTypes.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-gray-500 text-sm mb-3">No loan types configured yet</p>
              <button onClick={() => setShowAddLoanType(true)} className="text-indigo-400 hover:underline text-sm">
                Add the first loan type
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {branch.loanTypes.map((lt: LoanType) => (
                <div key={lt.id} className="px-6 py-4 flex items-start justify-between">
                  <div>
                    <p className="font-medium text-white">{lt.name}</p>
                    {lt.description && <p className="text-xs text-gray-400 mt-0.5">{lt.description}</p>}
                    <div className="flex flex-wrap gap-3 mt-2">
                      {lt.minAmount != null && lt.maxAmount != null && (
                        <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-lg">
                          ₹{Number(lt.minAmount).toLocaleString('en-IN')} – ₹{Number(lt.maxAmount).toLocaleString('en-IN')}
                        </span>
                      )}
                      {lt.minInterestRate != null && lt.maxInterestRate != null && (
                        <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-lg">
                          {lt.minInterestRate}% – {lt.maxInterestRate}% p.a.
                        </span>
                      )}
                      {lt.minTermMonths != null && lt.maxTermMonths != null && (
                        <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-lg">
                          {lt.minTermMonths} – {lt.maxTermMonths} months
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${lt.isActive ? 'bg-emerald-900 text-emerald-300' : 'bg-gray-800 text-gray-400'}`}>
                    {lt.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {showAddLoanType && (
        <AddLoanTypeModal
          tenantId={tenantId}
          onClose={() => setShowAddLoanType(false)}
          onSuccess={() => { setShowAddLoanType(false); load(); }}
        />
      )}
    </div>
  );
}
