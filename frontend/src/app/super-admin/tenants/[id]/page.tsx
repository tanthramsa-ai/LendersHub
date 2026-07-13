'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { tenantsApi, type TenantDetail, type Branch, type CreateBranchPayload, type TenantUserRecord, type CreateTenantUserPayload } from '@/services/tenants';

const TENANT_ROLES: { value: string; label: string }[] = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'LOAN_OFFICER', label: 'Loan Officer' },
  { value: 'COLLECTOR', label: 'Collector' },
  { value: 'VIEWER', label: 'Viewer' },
];

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-900 text-emerald-300',
  PROVISIONING: 'bg-yellow-900 text-yellow-300 animate-pulse',
  SUSPENDED: 'bg-orange-900 text-orange-300',
  FAILED: 'bg-red-900 text-red-300',
  DELETED: 'bg-gray-800 text-gray-500',
};

const SUB_STATUS_STYLE: Record<string, string> = {
  TRIAL: 'bg-blue-900 text-blue-300',
  ACTIVE: 'bg-emerald-900 text-emerald-300',
  PAST_DUE: 'bg-orange-900 text-orange-300',
  CANCELLED: 'bg-gray-800 text-gray-400',
};

const PLAN_LABEL: Record<string, string> = { STARTER: 'Starter', PROFESSIONAL: 'Professional', ENTERPRISE: 'Enterprise' };
const CYCLE_LABEL: Record<string, string> = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUALLY: 'Annually' };

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-800 last:border-0">
      <span className="text-sm text-gray-400 w-44 shrink-0">{label}</span>
      <span className="text-sm text-white flex-1">{value}</span>
    </div>
  );
}

// ── Add Branch Modal ──────────────────────────────────────────────────────────
const INDIAN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh','Puducherry'];

function AddBranchModal({ tenantId, onClose, onSuccess }: { tenantId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<CreateBranchPayload>({ name: '', code: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k: keyof CreateBranchPayload, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.name.trim() || !form.code.trim()) return setError('Branch name and code are required');
    setError(''); setLoading(true);
    try {
      await tenantsApi.createBranch(tenantId, form);
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create branch');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-white text-lg">Add Branch</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold">✕</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Branch Name *</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Chennai Main Branch"
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Branch Code *</label>
              <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())}
                placeholder="e.g. CHN-001"
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Manager Name</label>
            <input value={form.managerName ?? ''} onChange={(e) => set('managerName', e.target.value)}
              placeholder="Branch manager"
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Address</label>
            <input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)}
              placeholder="Street address"
              className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">City</label>
              <input value={form.city ?? ''} onChange={(e) => set('city', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">State</label>
              <select value={form.state ?? ''} onChange={(e) => set('state', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Phone</label>
              <input type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Email</label>
              <input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button onClick={submit} disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60">
            {loading ? 'Creating...' : 'Create Branch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Tenant User Modal ─────────────────────────────────────────────────────
function AddTenantUserModal({ tenantId, onClose, onSuccess }: { tenantId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState<CreateTenantUserPayload>({
    email: '', password: '', firstName: '', lastName: '', phone: '', role: 'ADMIN',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k: keyof CreateTenantUserPayload, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.firstName.trim() || !form.lastName.trim()) return setError('First and last name are required');
    if (!form.email.trim()) return setError('Email is required');
    if (form.password.length < 6) return setError('Password must be at least 6 characters');
    setError(''); setLoading(true);
    try {
      await tenantsApi.createTenantUser(tenantId, {
        ...form,
        email: form.email.trim(),
        phone: form.phone?.trim() || undefined,
      });
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create user');
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-white text-lg">Add User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold">✕</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>First Name *</label>
              <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Last Name *</label>
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Email *</label>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
              placeholder="user@example.com" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Mobile Number</label>
            <div className="flex gap-2">
              <span className="flex items-center px-3 border border-gray-600 rounded-xl text-sm text-gray-400 bg-gray-800">+91</span>
              <input type="tel" value={form.phone ?? ''}
                onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number" className={`${inputCls} flex-1`} />
            </div>
            <p className="text-xs text-gray-500 mt-1">If set, the user verifies an OTP on login (currently the default OTP).</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Role *</label>
              <select value={form.role} onChange={(e) => set('role', e.target.value)} className={inputCls}>
                {TENANT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Password *</label>
              <input type="text" value={form.password} onChange={(e) => set('password', e.target.value)}
                placeholder="Min 6 characters" className={inputCls} />
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button onClick={submit} disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60">
            {loading ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Tenant Modal ──────────────────────────────────────────────────────
function DeleteTenantModal({
  subdomain, onClose, onConfirm, loading, error,
}: { subdomain: string; onClose: () => void; onConfirm: (confirmSubdomain: string) => void; loading: boolean; error: string }) {
  const [typed, setTyped] = useState('');
  const canDelete = typed === subdomain;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-red-900 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-white text-lg">Delete Tenant</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold">✕</button>
        </div>

        <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 mb-4">
          <p className="text-red-300 text-sm font-medium">This locks the tenant out immediately.</p>
          <p className="text-red-400/80 text-xs mt-1">
            The tenant&apos;s data and schema are kept (nothing is dropped), but there is
            no undo action in this UI — login will be blocked the same as a suspended tenant.
          </p>
        </div>

        <p className="text-sm text-gray-400 mb-2">
          Type <span className="font-mono text-white">{subdomain}</span> to confirm.
        </p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={subdomain}
          autoFocus
          className="w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
        />

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-gray-300 bg-gray-800 hover:bg-gray-700">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(typed)}
            disabled={!canDelete || loading}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Deleting…' : 'Delete Tenant'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Branch Card ───────────────────────────────────────────────────────────────
function BranchCard({ branch, tenantId, router }: { branch: Branch; tenantId: string; router: ReturnType<typeof useRouter> }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-indigo-500 transition-colors cursor-pointer"
      onClick={() => router.push(`/super-admin/tenants/${tenantId}/branches/${branch.id}`)}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-white">{branch.name}</p>
          <p className="text-xs font-mono text-indigo-400 mt-0.5">{branch.code}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${branch.isActive ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
          {branch.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      {(branch.city || branch.state) && (
        <p className="text-xs text-gray-400 mb-3">📍 {[branch.city, branch.state].filter(Boolean).join(', ')}</p>
      )}
      {branch.managerName && (
        <p className="text-xs text-gray-400 mb-3">👤 {branch.managerName}</p>
      )}

      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-700">
        <div className="text-center">
          <p className="text-lg font-bold text-white">{branch.userCount}</p>
          <p className="text-xs text-gray-500">Users</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-white">{branch.customerCount}</p>
          <p className="text-xs text-gray-500">Customers</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-white">{branch.loanCount}</p>
          <p className="text-xs text-gray-500">Loans</p>
        </div>
      </div>
    </div>
  );
}

// ── Reset Tenant User Password Modal ──────────────────────────────────────────
function ResetTenantUserPasswordModal({
  tenantId,
  user,
  onClose,
  onSuccess,
}: {
  tenantId: string;
  user: TenantUserRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const inputCls = 'w-full bg-gray-800 border border-gray-600 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5';
  const displayName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;

  async function submit() {
    if (password.length < 6) return setError('Password must be at least 6 characters');
    setError('');
    setLoading(true);
    try {
      await tenantsApi.resetTenantUserPassword(tenantId, user.id, password);
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-white text-lg">Reset Password</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl font-bold">✕</button>
        </div>
        <p className="text-sm text-gray-400 mb-4">{displayName} · {user.email}</p>
        <div className="mb-4">
          <label className={labelCls}>New Password *</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 6 characters"
            className={inputCls}
            autoFocus
          />
        </div>
        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        <button
          onClick={submit}
          disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-white text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60"
        >
          {loading ? 'Resetting…' : 'Reset Password'}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type Tab = 'details' | 'branches' | 'users';

export default function TenantDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<TenantUserRecord[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [resetUser, setResetUser] = useState<TenantUserRecord | null>(null);
  const [tab, setTab] = useState<Tab>('details');
  const [loading, setLoading] = useState(true);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAddBranch, setShowAddBranch] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [lifecycleError, setLifecycleError] = useState('');

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    tenantsApi.get(id)
      .then(setTenant)
      .catch(() => setError('Failed to load tenant'))
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => {
    if (tab !== 'branches') return;
    setBranchesLoading(true);
    tenantsApi.listBranches(id)
      .then(setBranches)
      .finally(() => setBranchesLoading(false));
  }, [tab, id]);

  function refreshBranches() {
    tenantsApi.listBranches(id).then(setBranches);
  }

  useEffect(() => {
    if (tab !== 'users' || usersLoaded) return;
    setUsersLoading(true);
    tenantsApi.listTenantUsers(id)
      .then((u) => { setUsers(u); setUsersLoaded(true); })
      .finally(() => setUsersLoading(false));
  }, [tab, id, usersLoaded]);

  function refreshUsers() {
    tenantsApi.listTenantUsers(id).then(setUsers);
  }

  async function handleSuspend() {
    setLifecycleLoading(true); setLifecycleError('');
    try {
      const updated = await tenantsApi.suspend(id);
      setTenant((t) => t && { ...t, status: updated.status });
    } catch (e: unknown) {
      setLifecycleError(e instanceof Error ? e.message : 'Failed to suspend tenant');
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function handleReactivate() {
    setLifecycleLoading(true); setLifecycleError('');
    try {
      const updated = await tenantsApi.reactivate(id);
      setTenant((t) => t && { ...t, status: updated.status });
    } catch (e: unknown) {
      setLifecycleError(e instanceof Error ? e.message : 'Failed to reactivate tenant');
    } finally {
      setLifecycleLoading(false);
    }
  }

  async function handleDeleteConfirm(confirmSubdomain: string) {
    setLifecycleLoading(true); setLifecycleError('');
    try {
      const updated = await tenantsApi.softDelete(id, confirmSubdomain);
      setTenant((t) => t && { ...t, status: updated.status });
      setShowDeleteModal(false);
    } catch (e: unknown) {
      setLifecycleError(e instanceof Error ? e.message : 'Failed to delete tenant');
    } finally {
      setLifecycleLoading(false);
    }
  }

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
        <button onClick={() => router.back()} className="text-indigo-400 hover:underline text-sm">← Go back</button>
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
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_STYLE[tenant.status] ?? 'bg-gray-800 text-gray-300'}`}>
            {tenant.status}
          </span>

          {tenant.status === 'ACTIVE' && (
            <button
              onClick={handleSuspend}
              disabled={lifecycleLoading}
              className="px-3 py-2 text-sm rounded-lg bg-orange-950 border border-orange-800 text-orange-300 hover:bg-orange-900 font-medium transition-colors disabled:opacity-50"
            >
              Suspend
            </button>
          )}
          {tenant.status === 'SUSPENDED' && (
            <button
              onClick={handleReactivate}
              disabled={lifecycleLoading}
              className="px-3 py-2 text-sm rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-300 hover:bg-emerald-900 font-medium transition-colors disabled:opacity-50"
            >
              Reactivate
            </button>
          )}
          {tenant.status !== 'DELETED' && (
            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={lifecycleLoading}
              className="px-3 py-2 text-sm rounded-lg bg-red-950 border border-red-800 text-red-300 hover:bg-red-900 font-medium transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          )}

          <button
            onClick={() => router.push(`/super-admin/tenants/${id}/subscription`)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            {hasSubscription ? 'Edit Subscription' : 'Configure Subscription'}
          </button>
        </div>
      </header>

      {lifecycleError && (
        <div className="max-w-5xl mx-auto px-6 pt-4">
          <p className="text-sm text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3">{lifecycleError}</p>
        </div>
      )}
      {tenant.status === 'DELETED' && (
        <div className="max-w-5xl mx-auto px-6 pt-4">
          <p className="text-sm text-gray-400 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
            This tenant has been deleted. Their data is retained but login is blocked.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-gray-900 border-b border-gray-800 px-6">
        <div className="flex gap-1">
          {(['details', 'branches', 'users'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}>
              {t === 'branches' ? `Branches (${branches.length || '…'})` : t === 'users' ? `Users (${usersLoaded ? users.length : (tenant._count?.users ?? 0)})` : 'Details'}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Details Tab ── */}
        {tab === 'details' && (
          <>
            {!hasSubscription && (
              <div className="bg-amber-950 border border-amber-700 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-amber-300 font-medium text-sm">No subscription configured</p>
                  <p className="text-amber-500 text-xs mt-0.5">This tenant has not been assigned a plan yet.</p>
                </div>
                <button onClick={() => router.push(`/super-admin/tenants/${id}/subscription`)}
                  className="shrink-0 text-sm px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors">
                  Configure now →
                </button>
              </div>
            )}

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
                    <p className="font-semibold text-white">₹{Number(tenant.monthlyAmount).toLocaleString('en-IN')}</p>
                  </div>
                </div>
                {tenant.trialEndsAt && (
                  <p className="mt-3 text-xs text-blue-400">Trial ends: {new Date(tenant.trialEndsAt).toLocaleDateString('en-IN')}</p>
                )}
              </section>
            )}

            <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="font-semibold mb-4">Company Details</h2>
              <InfoRow label="Company Name" value={tenant.companyName} />
              <InfoRow label="Subdomain" value={<span className="font-mono text-indigo-400">{tenant.subdomain}</span>} />
              <InfoRow label="Registration Number" value={tenant.registrationNumber} />
              {tenant.gstNumber && <InfoRow label="GST / Tax Number" value={tenant.gstNumber} />}
              <InfoRow label="Address" value={<span className="whitespace-pre-line">{tenant.address}</span>} />
              {tenant.city && <InfoRow label="City" value={tenant.city} />}
              {tenant.state && <InfoRow label="State" value={tenant.state} />}
              <InfoRow label="Admin Email" value={tenant.adminEmail} />
              <InfoRow label="Schema" value={<span className="font-mono text-xs text-gray-400">{tenant.schemaName ?? '—'}</span>} />
              <InfoRow label="Joined" value={new Date(tenant.createdAt).toLocaleDateString('en-IN')} />
            </section>
          </>
        )}

        {/* ── Branches Tab ── */}
        {tab === 'branches' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">{branches.length} {branches.length === 1 ? 'branch' : 'branches'} configured</p>
              <button onClick={() => setShowAddBranch(true)}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors">
                + Add Branch
              </button>
            </div>

            {branchesLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : branches.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
                <p className="text-3xl mb-3">🏢</p>
                <p className="text-gray-300 font-medium">No branches yet</p>
                <p className="text-gray-500 text-sm mt-1 mb-4">Add the first branch to start managing users, customers and loans</p>
                <button onClick={() => setShowAddBranch(true)}
                  className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
                  + Add Branch
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {branches.map((b) => (
                  <BranchCard key={b.id} branch={b} tenantId={id} router={router} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Users Tab ── */}
        {tab === 'users' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-400">
                {usersLoaded ? `${users.length} ${users.length === 1 ? 'user' : 'users'}` : 'Loading users…'}
              </p>
              <button onClick={() => setShowAddUser(true)}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors">
                + Add User
              </button>
            </div>

            <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {usersLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : users.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-3xl mb-3">👥</p>
                  <p className="text-gray-300 font-medium">No users yet</p>
                  <p className="text-gray-500 text-sm mt-1 mb-4">Add the first user so this tenant can log in</p>
                  <button onClick={() => setShowAddUser(true)}
                    className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium">
                    + Add User
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400 text-left">
                        <th className="px-6 py-3 font-medium">Name</th>
                        <th className="px-6 py-3 font-medium">Email</th>
                        <th className="px-6 py-3 font-medium">Mobile</th>
                        <th className="px-6 py-3 font-medium">Role</th>
                        <th className="px-6 py-3 font-medium">Status</th>
                        <th className="px-6 py-3 font-medium">Joined</th>
                        <th className="px-6 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-b border-gray-800 last:border-0">
                          <td className="px-6 py-3 text-white">
                            {u.firstName || u.lastName ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '—'}
                          </td>
                          <td className="px-6 py-3 text-gray-400">{u.email}</td>
                          <td className="px-6 py-3 text-gray-400">{u.phone ?? '—'}</td>
                          <td className="px-6 py-3">
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 font-medium">{u.role}</span>
                          </td>
                          <td className="px-6 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.isActive ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                              {u.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-gray-400 text-xs">{new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
                          <td className="px-6 py-3">
                            <button
                              type="button"
                              onClick={() => setResetUser(u)}
                              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 whitespace-nowrap"
                            >
                              Reset Password
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {showAddBranch && (
        <AddBranchModal
          tenantId={id}
          onClose={() => setShowAddBranch(false)}
          onSuccess={() => { setShowAddBranch(false); refreshBranches(); setTab('branches'); }}
        />
      )}

      {showAddUser && (
        <AddTenantUserModal
          tenantId={id}
          onClose={() => setShowAddUser(false)}
          onSuccess={() => { setShowAddUser(false); refreshUsers(); }}
        />
      )}

      {resetUser && (
        <ResetTenantUserPasswordModal
          tenantId={id}
          user={resetUser}
          onClose={() => setResetUser(null)}
          onSuccess={() => setResetUser(null)}
        />
      )}

      {showDeleteModal && (
        <DeleteTenantModal
          subdomain={tenant.subdomain}
          onClose={() => { setShowDeleteModal(false); setLifecycleError(''); }}
          onConfirm={handleDeleteConfirm}
          loading={lifecycleLoading}
          error={lifecycleError}
        />
      )}
    </div>
  );
}
