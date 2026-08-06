'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getBranches, createBranch, updateBranch, TenantBranch,
  getBranchMembers, BranchMember,
  getTenantUsers, updateTenantUser,
  getSmsConfig, updateSmsConfig, SmsConfig,
  getNpaConfig, updateNpaConfig, NpaConfig,
  getLoanTypes, createLoanType, updateLoanType, deleteLoanType, LoanType,
  getWhatsAppConfig, updateWhatsAppConfig, WhatsAppConfig,
  getPermissionMatrix, updatePermissionMatrix, addPermissionRole, renamePermissionRole, deletePermissionRole,
  PermissionMatrix, PermissionKey, PermissionUpdate,
  PERMISSION_KEYS, PERMISSION_LABELS, PERMISSION_VALUE_OPTIONS,
  ROLE_LABELS, UserRole, USER_ADMIN_ROLES, getTenantSession,
} from '@/services/tenant-api';
import { isOnlySpecialChars } from '@/lib/text-validation';

const BRAND = '#0F4C81';

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh','Puducherry',
];

const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ── Branch Modal ──────────────────────────────────────────────────────────────
type BranchForm = {
  name: string; code: string; address: string; city: string;
  state: string; phone: string; email: string; managerName: string;
};
const emptyForm: BranchForm = { name: '', code: '', address: '', city: '', state: '', phone: '', email: '', managerName: '' };

function BranchModal({ branch, onClose, onSuccess }: { branch?: TenantBranch; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!branch;
  const [form, setForm] = useState<BranchForm>(
    branch
      ? { name: branch.name, code: branch.code, address: branch.address ?? '', city: branch.city ?? '', state: branch.state ?? '', phone: branch.phone ?? '', email: branch.email ?? '', managerName: branch.managerName ?? '' }
      : emptyForm,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [codeError, setCodeError] = useState('');

  function set(k: keyof BranchForm, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === 'name' && nameError) setNameError('');
    if (k === 'code' && codeError) setCodeError('');
  }

  async function submit() {
    setError(''); setNameError(''); setCodeError('');
    if (!form.name.trim()) { setNameError('Branch name is required'); return; }
    if (isOnlySpecialChars(form.name)) { setNameError('Branch name cannot consist of only special characters'); return; }
    if (!isEdit && !form.code.trim()) { setCodeError('Branch code is required'); return; }
    if (!isEdit && isOnlySpecialChars(form.code)) { setCodeError('Branch code cannot consist of only special characters'); return; }
    setLoading(true);
    try {
      if (isEdit) {
        await updateBranch(branch!.id, { name: form.name, address: form.address || undefined, city: form.city || undefined, state: form.state || undefined, phone: form.phone || undefined, email: form.email || undefined, managerName: form.managerName || undefined });
      } else {
        await createBranch({ name: form.name, code: form.code, address: form.address || undefined, city: form.city || undefined, state: form.state || undefined, phone: form.phone || undefined, email: form.email || undefined, managerName: form.managerName || undefined });
      }
      onSuccess();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to save branch';
      // Server-side validation mirrors the client-side checks above and uses the
      // same wording, so routing by which field the message names keeps a
      // duplicate-key API error or other backend rejection inline too, not just
      // the checks this form already does before ever calling the API.
      if (/\bname\b/i.test(message)) setNameError(message);
      else if (/\bcode\b/i.test(message)) setCodeError(message);
      else setError(message);
    } finally { setLoading(false); }
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
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Chennai Main" className={`${inputCls} ${nameError ? 'border-red-400 focus:ring-red-400' : ''}`} />
              {nameError && <p className="text-xs text-red-600 mt-1">{nameError}</p>}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Branch Code *</label>
              <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. CHN-001" disabled={isEdit} className={`${inputCls} ${isEdit ? 'bg-gray-50 text-gray-400' : ''} ${codeError ? 'border-red-400 focus:ring-red-400' : ''}`} />
              {codeError && <p className="text-xs text-red-600 mt-1">{codeError}</p>}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Manager Name</label>
            <input value={form.managerName} onChange={(e) => set('managerName', e.target.value)} placeholder="Branch manager full name" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Address</label>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street / building address" className={inputCls} />
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
          <button onClick={submit} disabled={loading} className="w-full py-3 rounded-xl font-bold text-white text-sm" style={{ backgroundColor: BRAND, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Branch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Branch Card ───────────────────────────────────────────────────────────────
function BranchCard({ branch, onEdit, onToggle, onManageTeam }: {
  branch: TenantBranch;
  onEdit: () => void;
  onToggle: () => void;
  onManageTeam: () => void;
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
      </div>
      <div className="grid grid-cols-3 gap-2 text-center py-3 border-y border-gray-100 mb-4">
        <button
          onClick={onManageTeam}
          className="hover:bg-blue-50 rounded-lg transition-colors py-1"
        >
          <p className="text-base font-bold text-gray-900">{branch.userCount}</p>
          <p className="text-xs text-blue-600 font-medium">Team</p>
        </button>
        <div><p className="text-base font-bold text-gray-900">{branch.customerCount}</p><p className="text-xs text-gray-400">Customers</p></div>
        <div><p className="text-base font-bold text-gray-900">{branch.loanCount}</p><p className="text-xs text-gray-400">Loans</p></div>
      </div>
      <div className="flex gap-2">
        <button onClick={onManageTeam} className="flex-1 py-2 rounded-xl text-xs font-semibold bg-gray-50 text-gray-700 hover:bg-gray-100">
          👥 Team
        </button>
        <button onClick={onEdit} className="flex-1 py-2 rounded-xl text-xs font-semibold text-white" style={{ backgroundColor: BRAND }}>Edit</button>
        <button onClick={onToggle} className={`flex-1 py-2 rounded-xl text-xs font-semibold ${branch.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
          {branch.isActive ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </div>
  );
}

// ── Branch Members Modal ──────────────────────────────────────────────────────
function BranchMembersModal({ branch, onClose, onChanged }: {
  branch: TenantBranch;
  onClose: () => void;
  onChanged: () => void;
}) {
  const session = getTenantSession();
  const canManage = session?.user && USER_ADMIN_ROLES.includes(session.user.role as UserRole);

  const [members, setMembers] = useState<BranchMember[]>([]);
  const [allUsers, setAllUsers] = useState<BranchMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addId, setAddId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mem, usersRes] = await Promise.all([
        getBranchMembers(branch.id),
        getTenantUsers(1, 100),
      ]);
      setMembers(mem);
      setAllUsers(usersRes.data as unknown as BranchMember[]);
    } catch {
      setError('Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [branch.id]);

  useEffect(() => { load(); }, [load]);

  const memberIds = new Set(members.map((m) => m.id));
  const available = allUsers.filter((u) => !memberIds.has(u.id) && u.isActive);

  async function remove(userId: string) {
    setSaving(true); setError('');
    try {
      await updateTenantUser(userId, { branchId: null });
      await load();
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    } finally { setSaving(false); }
  }

  async function add() {
    if (!addId) return;
    setSaving(true); setError('');
    try {
      await updateTenantUser(addId, { branchId: branch.id });
      setAddId('');
      await load();
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add member');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">Team — {branch.name}</h2>
            <p className="text-xs text-blue-600 font-mono mt-0.5">{branch.code}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-4">
            {/* Current members */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {members.length} {members.length === 1 ? 'Member' : 'Members'}
              </p>
              {members.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No members assigned yet</p>
              ) : (
                <div className="space-y-2">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">
                          {m.firstName} {m.lastName}
                        </p>
                        <p className="text-xs text-gray-400 truncate">{m.email}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700">
                          {ROLE_LABELS[m.role as UserRole] ?? m.role}
                        </span>
                        {canManage && (
                          <button
                            onClick={() => remove(m.id)}
                            disabled={saving}
                            className="text-xs text-red-500 hover:text-red-700 font-medium"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add member */}
            {canManage && (
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add Member</p>
                {available.length === 0 ? (
                  <p className="text-sm text-gray-400">All active users are already assigned to this branch.</p>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={addId}
                      onChange={(e) => setAddId(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select a team member…</option>
                      {available.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName} · {ROLE_LABELS[u.role as UserRole] ?? u.role}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={add}
                      disabled={!addId || saving}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                      style={{ backgroundColor: '#0F4C81' }}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── NPA Rule Tab ──────────────────────────────────────────────────────────────
function NpaConfigTab() {
  const [threshold, setThreshold] = useState('');
  const [config, setConfig] = useState<NpaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getNpaConfig()
      .then((c) => { setConfig(c); setThreshold(String(c.overdueThreshold)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSaving(true); setSaved(false);
    try {
      const res = await updateNpaConfig(Number(threshold));
      setConfig((c) => (c ? { ...c, overdueThreshold: res.overdueThreshold, isCustom: true } : c));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <form onSubmit={save} className="max-w-xl space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-1">
        <p className="font-semibold">When is a loan a non-performing asset?</p>
        <p>
          A loan is flagged <strong>NPA</strong> once it has this many overdue installments.
          Installments become overdue automatically the day after their due date.
        </p>
        <p className="text-xs text-blue-700">
          Admins can also mark any individual loan NPA by hand from the loan page — that override
          applies regardless of this number.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Overdue installments before NPA
        </label>
        <input
          type="number"
          min={1}
          max={60}
          value={threshold}
          onChange={(e) => { setThreshold(e.target.value); if (error) setError(''); }}
          className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
        />
        <p className="text-xs text-gray-500 mt-1">
          Default is {config?.defaultThreshold ?? 4}. Applies to every loan cycle — remember that
          4 missed daily installments is a much shorter window than 4 missed monthly ones.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-green-600 font-medium">NPA rule saved.</p>}

      <button
        type="submit"
        disabled={saving}
        className="text-sm px-5 py-2.5 rounded-xl font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: BRAND }}
      >
        {saving ? 'Saving…' : 'Save NPA Rule'}
      </button>
    </form>
  );
}

// ── SMS Config Tab ────────────────────────────────────────────────────────────
function SmsConfigTab() {
  const [config, setConfig] = useState<SmsConfig & { configured?: boolean }>({ provider: 'console', apiKey: '', senderId: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSmsConfig()
      .then((c) => setConfig(c))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSaving(true); setSaved(false);
    try {
      await updateSmsConfig({ provider: config.provider, apiKey: config.apiKey, senderId: config.senderId });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <form onSubmit={save} className="max-w-xl space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">SMS is used for login OTP and password reset.</p>
        <p>
          <strong>Fast2SMS</strong> (recommended for India) — sign up at{' '}
          <span className="font-mono">fast2sms.com</span> and paste your API key below.
          Leave provider as <em>Console (Dev)</em> to log OTPs to the server console during development.
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
          SMS Provider
        </label>
        <select
          value={config.provider}
          onChange={(e) => setConfig((c) => ({ ...c, provider: e.target.value as SmsConfig['provider'] }))}
          className={inputCls}
        >
          <option value="console">Console (Dev — prints OTP to server log)</option>
          <option value="fast2sms">Fast2SMS (recommended for India)</option>
          <option value="msg91">MSG91</option>
        </select>
      </div>

      {config.provider !== 'console' && (
        <>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
              API Key
            </label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
              placeholder={config.configured ? 'Leave blank to keep existing key' : 'Paste your SMS API key'}
              className={inputCls}
              autoComplete="off"
            />
          </div>

          {config.provider === 'msg91' && (
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">
                Template / Sender ID
              </label>
              <input
                type="text"
                value={config.senderId ?? ''}
                onChange={(e) => setConfig((c) => ({ ...c, senderId: e.target.value }))}
                placeholder="MSG91 template ID"
                className={inputCls}
              />
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      {saved && <p className="text-sm text-green-600 font-medium">SMS configuration saved.</p>}

      <button
        type="submit"
        disabled={saving}
        className="px-6 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60"
        style={{ backgroundColor: BRAND }}
      >
        {saving ? 'Saving…' : 'Save Configuration'}
      </button>
    </form>
  );
}

// ── Loan Type Modal ───────────────────────────────────────────────────────────
type LoanTypeForm = {
  name: string; description: string;
  minAmount: string; maxAmount: string;
  minInterestRate: string; maxInterestRate: string;
  minTermMonths: string; maxTermMonths: string;
};
const emptyLtForm: LoanTypeForm = { name: '', description: '', minAmount: '', maxAmount: '', minInterestRate: '', maxInterestRate: '', minTermMonths: '', maxTermMonths: '' };

function LoanTypeModal({ lt, onClose, onSuccess }: { lt?: LoanType; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!lt;
  const [form, setForm] = useState<LoanTypeForm>(
    lt ? {
      name: lt.name, description: lt.description ?? '',
      minAmount: lt.minAmount?.toString() ?? '', maxAmount: lt.maxAmount?.toString() ?? '',
      minInterestRate: lt.minInterestRate?.toString() ?? '', maxInterestRate: lt.maxInterestRate?.toString() ?? '',
      minTermMonths: lt.minTermMonths?.toString() ?? '', maxTermMonths: lt.maxTermMonths?.toString() ?? '',
    } : emptyLtForm,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k: keyof LoanTypeForm, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.name.trim()) return setError('Loan type name is required');
    setError(''); setLoading(true);
    try {
      const dto = {
        name: form.name.trim(), description: form.description || undefined,
        minAmount: form.minAmount ? parseFloat(form.minAmount) : undefined,
        maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : undefined,
        minInterestRate: form.minInterestRate ? parseFloat(form.minInterestRate) : undefined,
        maxInterestRate: form.maxInterestRate ? parseFloat(form.maxInterestRate) : undefined,
        minTermMonths: form.minTermMonths ? parseInt(form.minTermMonths) : undefined,
        maxTermMonths: form.maxTermMonths ? parseInt(form.maxTermMonths) : undefined,
      };
      if (isEdit) {
        await updateLoanType(lt!.id, dto);
      } else {
        await createLoanType(dto);
      }
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save loan type');
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-900 text-lg">{isEdit ? 'Edit Loan Type' : 'Add Loan Type'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Name *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Personal Loan, Gold Loan" className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Description</label>
            <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Short description" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Min Amount (₹)</label>
              <input type="number" value={form.minAmount} onChange={(e) => set('minAmount', e.target.value)} placeholder="e.g. 10000" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Max Amount (₹)</label>
              <input type="number" value={form.maxAmount} onChange={(e) => set('maxAmount', e.target.value)} placeholder="e.g. 500000" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Min Rate (%)</label>
              <input type="number" step="0.01" value={form.minInterestRate} onChange={(e) => set('minInterestRate', e.target.value)} placeholder="e.g. 10" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Max Rate (%)</label>
              <input type="number" step="0.01" value={form.maxInterestRate} onChange={(e) => set('maxInterestRate', e.target.value)} placeholder="e.g. 24" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Min Term (months)</label>
              <input type="number" value={form.minTermMonths} onChange={(e) => set('minTermMonths', e.target.value)} placeholder="e.g. 6" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Max Term (months)</label>
              <input type="number" value={form.maxTermMonths} onChange={(e) => set('maxTermMonths', e.target.value)} placeholder="e.g. 60" className={inputCls} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
          <button onClick={submit} disabled={loading} className="w-full py-3 rounded-xl font-bold text-white text-sm" style={{ backgroundColor: BRAND, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Loan Type'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Loan Types Tab ────────────────────────────────────────────────────────────
function LoanTypesTab() {
  const [loanTypes, setLoanTypes] = useState<LoanType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editLt, setEditLt] = useState<LoanType | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setLoanTypes(await getLoanTypes()); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(lt: LoanType) {
    try { await updateLoanType(lt.id, { isActive: !lt.isActive }); load(); } catch {}
  }

  async function remove(lt: LoanType) {
    if (!confirm(`Delete loan type "${lt.name}"? This cannot be undone.`)) return;
    try { await deleteLoanType(lt.id); load(); } catch {}
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{loanTypes.length} loan {loanTypes.length === 1 ? 'type' : 'types'} configured</p>
        <button onClick={() => setShowModal(true)} className="text-sm px-4 py-2 rounded-xl font-semibold text-white" style={{ backgroundColor: BRAND }}>
          + Add Loan Type
        </button>
      </div>

      {loanTypes.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <p className="text-3xl mb-3">📋</p>
          <p className="font-semibold text-gray-700">No loan types yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Define loan products like Personal Loan, Gold Loan, etc.</p>
          <button onClick={() => setShowModal(true)} className="text-sm px-4 py-2 rounded-xl font-semibold text-white" style={{ backgroundColor: BRAND }}>
            + Add Loan Type
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Name', 'Amount Range', 'Interest Range', 'Term Range', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loanTypes.map((lt) => (
                <tr key={lt.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{lt.name}</p>
                    {lt.description && <p className="text-xs text-gray-400">{lt.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {lt.minAmount || lt.maxAmount
                      ? `₹${lt.minAmount?.toLocaleString('en-IN') ?? '–'} – ₹${lt.maxAmount?.toLocaleString('en-IN') ?? '–'}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {lt.minInterestRate || lt.maxInterestRate
                      ? `${lt.minInterestRate ?? '–'}% – ${lt.maxInterestRate ?? '–'}%`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {lt.minTermMonths || lt.maxTermMonths
                      ? `${lt.minTermMonths ?? '–'} – ${lt.maxTermMonths ?? '–'} mo`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${lt.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {lt.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setEditLt(lt)} className="text-xs text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => toggle(lt)} className="text-xs text-gray-500 hover:text-gray-700">
                        {lt.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => remove(lt)} className="text-xs text-red-500 hover:text-red-700">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <LoanTypeModal onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); load(); }} />}
      {editLt && <LoanTypeModal lt={editLt} onClose={() => setEditLt(null)} onSuccess={() => { setEditLt(null); load(); }} />}
    </div>
  );
}

// ── WhatsApp Config Tab ───────────────────────────────────────────────────────
function WhatsAppConfigTab() {
  const [config, setConfig] = useState<WhatsAppConfig & { configured?: boolean }>({ provider: 'console' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getWhatsAppConfig()
      .then((c) => setConfig(c))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof WhatsAppConfig>(k: K, v: WhatsAppConfig[K]) {
    setConfig((c) => ({ ...c, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSaving(true); setSaved(false);
    try {
      await updateWhatsAppConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  const isMasked = (v?: string) => v ? v.includes('*') : false;

  return (
    <form onSubmit={save} className="max-w-xl space-y-5">
      <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
        <p className="font-semibold mb-1">WhatsApp is used to notify agents and customers about due/overdue installments.</p>
        <p>Select your provider and enter the required credentials. Leave as <em>Console (Dev)</em> to log messages to the server during development.</p>
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Provider</label>
        <select
          value={config.provider}
          onChange={(e) => set('provider', e.target.value as WhatsAppConfig['provider'])}
          className={inputCls}
        >
          <option value="console">Console (Dev — prints to server log)</option>
          <option value="twilio">Twilio WhatsApp</option>
          <option value="meta">Meta / WhatsApp Cloud API</option>
          <option value="wati">WATI</option>
        </select>
      </div>

      {config.provider === 'twilio' && (
        <>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Account SID</label>
            <input
              value={config.accountSid ?? ''}
              onChange={(e) => set('accountSid', e.target.value)}
              placeholder={isMasked(config.accountSid) ? 'Leave blank to keep existing' : 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
              className={inputCls} autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Auth Token</label>
            <input
              type="password"
              value={config.authToken ?? ''}
              onChange={(e) => set('authToken', e.target.value)}
              placeholder={isMasked(config.authToken) ? 'Leave blank to keep existing' : 'Your Twilio auth token'}
              className={inputCls} autoComplete="off"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">From Number (WhatsApp)</label>
            <input
              value={config.fromNumber ?? ''}
              onChange={(e) => set('fromNumber', e.target.value)}
              placeholder="e.g. +14155238886"
              className={inputCls}
            />
          </div>
        </>
      )}

      {config.provider === 'meta' && (
        <>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Phone Number ID</label>
            <input
              value={config.phoneNumberId ?? ''}
              onChange={(e) => set('phoneNumberId', e.target.value)}
              placeholder="From Meta Business Manager"
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Permanent Access Token</label>
            <input
              type="password"
              value={config.accessToken ?? ''}
              onChange={(e) => set('accessToken', e.target.value)}
              placeholder={isMasked(config.accessToken) ? 'Leave blank to keep existing' : 'Your Meta access token'}
              className={inputCls} autoComplete="off"
            />
          </div>
        </>
      )}

      {config.provider === 'wati' && (
        <>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">WATI API URL</label>
            <input
              value={config.apiUrl ?? ''}
              onChange={(e) => set('apiUrl', e.target.value)}
              placeholder="e.g. https://live-server-xxxxx.wati.io"
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">API Key / Bearer Token</label>
            <input
              type="password"
              value={config.apiKey ?? ''}
              onChange={(e) => set('apiKey', e.target.value)}
              placeholder={isMasked(config.apiKey) ? 'Leave blank to keep existing' : 'Your WATI API key'}
              className={inputCls} autoComplete="off"
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      {saved && <p className="text-sm text-green-600 font-medium">WhatsApp configuration saved.</p>}

      <button
        type="submit"
        disabled={saving}
        className="px-6 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60"
        style={{ backgroundColor: BRAND }}
      >
        {saving ? 'Saving…' : 'Save Configuration'}
      </button>
    </form>
  );
}

// ── Permissions Tab (role matrix) ─────────────────────────────────────────────

/** Built-in roles get their friendly label; a tenant-defined custom role falls back
 *  to a title-cased rendering of its key (e.g. FIELD_SUPERVISOR -> Field Supervisor). */
function roleLabel(role: string): string {
  if (role in ROLE_LABELS) return ROLE_LABELS[role as UserRole];
  return role.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function PermissionsTab() {
  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [dirty, setDirty] = useState<Map<string, PermissionUpdate>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [addingRole, setAddingRole] = useState(false);
  const [addRoleError, setAddRoleError] = useState('');
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editingRoleName, setEditingRoleName] = useState('');
  const [roleActionError, setRoleActionError] = useState('');
  const [roleActionBusy, setRoleActionBusy] = useState<string | null>(null);

  const builtIns = Object.keys(ROLE_LABELS);
  const roles = matrix
    ? [...builtIns.filter((r) => r in matrix), ...Object.keys(matrix).filter((r) => !builtIns.includes(r)).sort()]
    : [];

  useEffect(() => {
    getPermissionMatrix()
      .then(setMatrix)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load permissions'))
      .finally(() => setLoading(false));
  }, []);

  function cellValue(role: string, key: PermissionKey): string {
    const dirtyKey = `${role}:${key}`;
    return dirty.get(dirtyKey)?.value ?? matrix?.[role]?.[key] ?? '';
  }

  function setCell(role: string, key: PermissionKey, value: string) {
    setDirty((prev) => {
      const next = new Map(prev);
      next.set(`${role}:${key}`, { role, permissionKey: key, value });
      return next;
    });
    setSaved(false);
  }

  async function addRole() {
    const name = newRoleName.trim();
    if (!name) return;
    setAddingRole(true); setAddRoleError('');
    try {
      const updated = await addPermissionRole(name);
      setMatrix(updated);
      setNewRoleName('');
    } catch (e: unknown) {
      setAddRoleError(e instanceof Error ? e.message : 'Failed to add role');
    } finally {
      setAddingRole(false);
    }
  }

  function startEditRole(role: string) {
    setEditingRole(role);
    setEditingRoleName(roleLabel(role));
    setRoleActionError('');
  }

  // Renaming/deleting a role invalidates any unsaved matrix edits queued for its old
  // key — drop them rather than silently losing track of which role they applied to.
  function dropDirtyFor(role: string) {
    setDirty((prev) => {
      const next = new Map(prev);
      for (const k of next.keys()) if (k.startsWith(`${role}:`)) next.delete(k);
      return next;
    });
  }

  async function saveRoleRename(role: string) {
    const name = editingRoleName.trim();
    if (!name || name === roleLabel(role)) { setEditingRole(null); return; }
    setRoleActionBusy(role); setRoleActionError('');
    try {
      const updated = await renamePermissionRole(role, name);
      setMatrix(updated);
      dropDirtyFor(role);
      setEditingRole(null);
    } catch (e: unknown) {
      setRoleActionError(e instanceof Error ? e.message : 'Failed to rename role');
    } finally {
      setRoleActionBusy(null);
    }
  }

  async function removeRole(role: string) {
    if (!confirm(`Delete the "${roleLabel(role)}" role? Users must be reassigned first if any still have it.`)) return;
    setRoleActionBusy(role); setRoleActionError('');
    try {
      const updated = await deletePermissionRole(role);
      dropDirtyFor(role);
      setMatrix(updated);
    } catch (e: unknown) {
      setRoleActionError(e instanceof Error ? e.message : 'Failed to delete role');
    } finally {
      setRoleActionBusy(null);
    }
  }

  async function save() {
    if (dirty.size === 0) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      await updatePermissionMatrix([...dirty.values()]);
      setMatrix((prev) => {
        if (!prev) return prev;
        const next: PermissionMatrix = { ...prev };
        for (const u of dirty.values()) {
          next[u.role] = { ...next[u.role], [u.permissionKey]: u.value };
        }
        return next;
      });
      setDirty(new Map());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save permissions');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (!matrix) return <p className="text-sm text-red-600 font-medium">{error || 'Could not load the permission matrix.'}</p>;

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">What each role can do, per action.</p>
        <p>
          <strong>All</strong> = every record in the tenant. <strong>Self</strong> = only records where
          this user is the assigned agent. <strong>Partial</strong> (Add Loan) = can create/request
          close, but Owner/Admin/Manager must approve. Owner&rsquo;s row is fixed at full access.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Add a custom role
          </label>
          <input
            type="text"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="e.g. Field Supervisor"
            maxLength={30}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={addRole}
          disabled={addingRole || !newRoleName.trim()}
          className="px-4 py-2 rounded-lg font-semibold text-white text-sm disabled:opacity-40"
          style={{ backgroundColor: BRAND }}
        >
          {addingRole ? 'Adding…' : 'Add Role'}
        </button>
        {addRoleError && <p className="text-sm text-red-600 font-medium w-full">{addRoleError}</p>}
        <p className="text-xs text-gray-400 w-full">
          A new role starts with the most restrictive value for every permission below, and can be
          assigned to users. It only controls what shows in this matrix &mdash; other areas of the app
          (loans, collections, etc.) treat it like Staff until it&rsquo;s wired into those checks.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Role</th>
              {PERMISSION_KEYS.map((key) => (
                <th key={key} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                  {PERMISSION_LABELS[key]}
                </th>
              ))}
              <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {roles.map((role) => {
              const isOwner = role === 'OWNER';
              const isCustom = !(role in ROLE_LABELS);
              const isEditing = editingRole === role;
              const busy = roleActionBusy === role;
              return (
                <tr key={role} className={isOwner ? 'bg-gray-50/60' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingRoleName}
                        onChange={(e) => setEditingRoleName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveRoleRename(role); if (e.key === 'Escape') setEditingRole(null); }}
                        maxLength={30}
                        className="text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <>
                        <span className="font-semibold text-gray-900">{roleLabel(role)}</span>
                        {isOwner && <span className="ml-2 text-xs text-gray-400">(fixed)</span>}
                        {isCustom && <span className="ml-2 text-xs text-blue-500">(custom)</span>}
                      </>
                    )}
                  </td>
                  {PERMISSION_KEYS.map((key) => (
                    <td key={key} className="px-3 py-2.5">
                      <select
                        value={cellValue(role, key)}
                        onChange={(e) => setCell(role, key, e.target.value)}
                        disabled={isOwner}
                        className={`text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${isOwner ? 'bg-gray-100 text-gray-400' : ''}`}
                      >
                        {PERMISSION_VALUE_OPTIONS[key].map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </td>
                  ))}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {isCustom && (
                      isEditing ? (
                        <div className="flex gap-1.5">
                          <button onClick={() => saveRoleRename(role)} disabled={busy} className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-40">
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingRole(null)} disabled={busy} className="text-xs font-semibold text-gray-500 hover:text-gray-700">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <button onClick={() => startEditRole(role)} className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                            Rename
                          </button>
                          <button onClick={() => removeRole(role)} disabled={busy} className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-40">
                            {busy ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {roleActionError && <p className="text-sm text-red-600 font-medium">{roleActionError}</p>}
      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      {saved && <p className="text-sm text-green-600 font-medium">Permission matrix saved.</p>}

      <button
        onClick={save}
        disabled={saving || dirty.size === 0}
        className="px-6 py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-40"
        style={{ backgroundColor: BRAND }}
      >
        {saving ? 'Saving…' : dirty.size > 0 ? `Save ${dirty.size} Change${dirty.size === 1 ? '' : 's'}` : 'Save Changes'}
      </button>
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
type SettingsTab = 'branches' | 'loanTypes' | 'npa' | 'sms' | 'whatsapp' | 'permissions';

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('branches');
  const session = getTenantSession();
  const isAdmin = !!session?.user && USER_ADMIN_ROLES.includes(session.user.role as UserRole);
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editBranch, setEditBranch] = useState<TenantBranch | null>(null);
  const [teamBranch, setTeamBranch] = useState<TenantBranch | null>(null);

  const loadBranches = useCallback(async () => {
    setLoading(true);
    try { setBranches(await getBranches()); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadBranches(); }, [loadBranches]);

  async function toggleActive(branch: TenantBranch) {
    try { await updateBranch(branch.id, { isActive: !branch.isActive }); loadBranches(); } catch {}
  }

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'branches', label: 'Branches' },
    { key: 'loanTypes', label: 'Loan Types' },
    ...(isAdmin ? [{ key: 'npa' as const, label: 'NPA Rule' }] : []),
    { key: 'sms', label: 'SMS / OTP' },
    { key: 'whatsapp', label: 'WhatsApp' },
    ...(isAdmin ? [{ key: 'permissions' as const, label: 'Permissions' }] : []),
  ];

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your organisation configuration</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'branches' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{branches.length} {branches.length === 1 ? 'branch' : 'branches'} configured</p>
            <button onClick={() => setShowModal(true)} className="text-sm px-4 py-2 rounded-xl font-semibold text-white" style={{ backgroundColor: BRAND }}>
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
              <button onClick={() => setShowModal(true)} className="text-sm px-4 py-2 rounded-xl font-semibold text-white" style={{ backgroundColor: BRAND }}>
                + Add Branch
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {branches.map((b) => (
                <BranchCard key={b.id} branch={b} onEdit={() => setEditBranch(b)} onToggle={() => toggleActive(b)} onManageTeam={() => setTeamBranch(b)} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'loanTypes' && <LoanTypesTab />}
      {tab === 'npa' && isAdmin && <NpaConfigTab />}
      {tab === 'sms' && <SmsConfigTab />}
      {tab === 'whatsapp' && <WhatsAppConfigTab />}
      {tab === 'permissions' && isAdmin && <PermissionsTab />}

      {showModal && <BranchModal onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); loadBranches(); }} />}
      {editBranch && <BranchModal branch={editBranch} onClose={() => setEditBranch(null)} onSuccess={() => { setEditBranch(null); loadBranches(); }} />}
      {teamBranch && <BranchMembersModal branch={teamBranch} onClose={() => setTeamBranch(null)} onChanged={loadBranches} />}
    </div>
  );
}
