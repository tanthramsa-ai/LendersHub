'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getBranches, createBranch, updateBranch, TenantBranch,
  getSmsConfig, updateSmsConfig, SmsConfig,
  getLoanTypes, createLoanType, updateLoanType, deleteLoanType, LoanType,
  getWhatsAppConfig, updateWhatsAppConfig, WhatsAppConfig,
} from '@/services/tenant-api';

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

  function set(k: keyof BranchForm, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit() {
    if (!form.name.trim()) return setError('Branch name is required');
    if (!isEdit && !form.code.trim()) return setError('Branch code is required');
    setError(''); setLoading(true);
    try {
      if (isEdit) {
        await updateBranch(branch!.id, { name: form.name, address: form.address || undefined, city: form.city || undefined, state: form.state || undefined, phone: form.phone || undefined, email: form.email || undefined, managerName: form.managerName || undefined });
      } else {
        await createBranch({ name: form.name, code: form.code, address: form.address || undefined, city: form.city || undefined, state: form.state || undefined, phone: form.phone || undefined, email: form.email || undefined, managerName: form.managerName || undefined });
      }
      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save branch');
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
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Chennai Main" className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Branch Code *</label>
              <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. CHN-001" disabled={isEdit} className={`${inputCls} ${isEdit ? 'bg-gray-50 text-gray-400' : ''}`} />
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
function BranchCard({ branch, onEdit, onToggle }: { branch: TenantBranch; onEdit: () => void; onToggle: () => void }) {
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
        <div><p className="text-base font-bold text-gray-900">{branch.userCount}</p><p className="text-xs text-gray-400">Users</p></div>
        <div><p className="text-base font-bold text-gray-900">{branch.customerCount}</p><p className="text-xs text-gray-400">Customers</p></div>
        <div><p className="text-base font-bold text-gray-900">{branch.loanCount}</p><p className="text-xs text-gray-400">Loans</p></div>
      </div>
      <div className="flex gap-2">
        <button onClick={onEdit} className="flex-1 py-2 rounded-xl text-xs font-semibold text-white" style={{ backgroundColor: BRAND }}>Edit</button>
        <button onClick={onToggle} className={`flex-1 py-2 rounded-xl text-xs font-semibold ${branch.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
          {branch.isActive ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </div>
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

// ── Main Settings Page ────────────────────────────────────────────────────────
type SettingsTab = 'branches' | 'loanTypes' | 'sms' | 'whatsapp';

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>('branches');
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

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'branches', label: 'Branches' },
    { key: 'loanTypes', label: 'Loan Types' },
    { key: 'sms', label: 'SMS / OTP' },
    { key: 'whatsapp', label: 'WhatsApp' },
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
                <BranchCard key={b.id} branch={b} onEdit={() => setEditBranch(b)} onToggle={() => toggleActive(b)} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'loanTypes' && <LoanTypesTab />}
      {tab === 'sms' && <SmsConfigTab />}
      {tab === 'whatsapp' && <WhatsAppConfigTab />}

      {showModal && <BranchModal onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); loadBranches(); }} />}
      {editBranch && <BranchModal branch={editBranch} onClose={() => setEditBranch(null)} onSuccess={() => { setEditBranch(null); loadBranches(); }} />}
    </div>
  );
}
