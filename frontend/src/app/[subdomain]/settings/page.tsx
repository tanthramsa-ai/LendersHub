'use client';

import { useEffect, useState, useCallback } from 'react';
import { getBranches, createBranch, updateBranch, TenantBranch } from '@/services/tenant-api';

const BRAND = '#0F4C81';

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh','Puducherry',
];

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

type BranchForm = {
  name: string; code: string; address: string; city: string;
  state: string; phone: string; email: string; managerName: string;
};

const emptyForm: BranchForm = { name: '', code: '', address: '', city: '', state: '', phone: '', email: '', managerName: '' };

// ── Branch Modal ──────────────────────────────────────────────────────────────
function BranchModal({
  branch, onClose, onSuccess,
}: { branch?: TenantBranch; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!branch;
  const [form, setForm] = useState<BranchForm>(
    branch
      ? { name: branch.name, code: branch.code, address: branch.address ?? '', city: branch.city ?? '', state: branch.state ?? '', phone: branch.phone ?? '', email: branch.email ?? '', managerName: branch.managerName ?? '' }
      : emptyForm,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k: keyof BranchForm, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.name.trim()) return setError('Branch name is required');
    if (!isEdit && !form.code.trim()) return setError('Branch code is required');
    setError(''); setLoading(true);
    try {
      if (isEdit) {
        await updateBranch(branch!.id, {
          name: form.name, address: form.address || undefined, city: form.city || undefined,
          state: form.state || undefined, phone: form.phone || undefined,
          email: form.email || undefined, managerName: form.managerName || undefined,
        });
      } else {
        await createBranch({
          name: form.name, code: form.code, address: form.address || undefined,
          city: form.city || undefined, state: form.state || undefined,
          phone: form.phone || undefined, email: form.email || undefined,
          managerName: form.managerName || undefined,
        });
      }
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save branch');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-900 text-lg">{isEdit ? 'Edit Branch' : 'Add Branch'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Branch Name *</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Chennai Main" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Branch Code *</label>
              <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="e.g. CHN-001" disabled={isEdit}
                className={`${inputCls} ${isEdit ? 'bg-gray-50 text-gray-400' : ''}`} />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Manager Name</label>
            <input value={form.managerName} onChange={(e) => set('managerName', e.target.value)}
              placeholder="Branch manager full name" className={inputCls} />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Address</label>
            <input value={form.address} onChange={(e) => set('address', e.target.value)}
              placeholder="Street / building address" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">City</label>
              <input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">State</label>
              <select value={form.state} onChange={(e) => set('state', e.target.value)} className={inputCls}>
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Email</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 font-medium">{error}</p>}

          <button onClick={submit} disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white text-sm"
            style={{ backgroundColor: BRAND, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Branch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Branch Card ───────────────────────────────────────────────────────────────
function BranchCard({ branch, onEdit, onToggle }: {
  branch: TenantBranch;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-900">{branch.name}</p>
          <p className="text-xs font-mono text-blue-600 mt-0.5">{branch.code}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${branch.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
          {branch.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="space-y-1 text-xs text-gray-500 mb-4">
        {branch.managerName && <p>👤 {branch.managerName}</p>}
        {(branch.city || branch.state) && <p>📍 {[branch.city, branch.state].filter(Boolean).join(', ')}</p>}
        {branch.phone && <p>📞 {branch.phone}</p>}
        {branch.email && <p>✉️ {branch.email}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center py-3 border-y border-gray-100 mb-4">
        <div><p className="text-base font-bold text-gray-900">{branch.userCount}</p><p className="text-xs text-gray-400">Users</p></div>
        <div><p className="text-base font-bold text-gray-900">{branch.customerCount}</p><p className="text-xs text-gray-400">Customers</p></div>
        <div><p className="text-base font-bold text-gray-900">{branch.loanCount}</p><p className="text-xs text-gray-400">Loans</p></div>
      </div>

      <div className="flex gap-2">
        <button onClick={onEdit}
          className="flex-1 py-2 rounded-xl text-xs font-semibold text-white"
          style={{ backgroundColor: BRAND }}>
          Edit
        </button>
        <button onClick={onToggle}
          className={`flex-1 py-2 rounded-xl text-xs font-semibold ${branch.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
          {branch.isActive ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
type SettingsTab = 'branches';

export default function SettingsPage() {
  const [tab] = useState<SettingsTab>('branches');
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editBranch, setEditBranch] = useState<TenantBranch | null>(null);

  const loadBranches = useCallback(async () => {
    setLoading(true);
    try { setBranches(await getBranches()); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  async function toggleActive(branch: TenantBranch) {
    try { await updateBranch(branch.id, { isActive: !branch.isActive }); loadBranches(); } catch {}
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your organisation configuration</p>
      </div>

      {/* Tab strip — expandable for future tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <button className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === 'branches' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500'}`}>
          Branches
        </button>
      </div>

      {/* Branches Tab */}
      {tab === 'branches' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{branches.length} {branches.length === 1 ? 'branch' : 'branches'} configured</p>
            <button onClick={() => setShowModal(true)}
              className="text-sm px-4 py-2 rounded-xl font-semibold text-white"
              style={{ backgroundColor: BRAND }}>
              + Add Branch
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : branches.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
              <p className="text-3xl mb-3">🏢</p>
              <p className="font-semibold text-gray-700">No branches yet</p>
              <p className="text-sm text-gray-400 mt-1 mb-4">Add your first branch to start assigning loans and customers</p>
              <button onClick={() => setShowModal(true)}
                className="text-sm px-4 py-2 rounded-xl font-semibold text-white"
                style={{ backgroundColor: BRAND }}>
                + Add Branch
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {branches.map((b) => (
                <BranchCard
                  key={b.id}
                  branch={b}
                  onEdit={() => setEditBranch(b)}
                  onToggle={() => toggleActive(b)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <BranchModal onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); loadBranches(); }} />
      )}
      {editBranch && (
        <BranchModal branch={editBranch} onClose={() => setEditBranch(null)} onSuccess={() => { setEditBranch(null); loadBranches(); }} />
      )}
    </div>
  );
}
