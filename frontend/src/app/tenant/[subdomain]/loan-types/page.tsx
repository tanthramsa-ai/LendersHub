'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getLoanTypes, createLoanType, updateLoanType, deleteLoanType,
  LoanType, getTenantSession, MANAGER_ROLES,
} from '@/services/tenant-api';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';

const DEFAULT_TYPES = [
  'Monthly', 'Weekly', 'Daily-No-Sunday', 'Daily-With-Sunday', 'Spot', 'Agent-Risk', 'Monthly-Emi',
];

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface FormState {
  name: string;
  description: string;
  minAmount: string;
  maxAmount: string;
  minInterestRate: string;
  maxInterestRate: string;
  minTermMonths: string;
  maxTermMonths: string;
}

const emptyForm: FormState = {
  name: '', description: '',
  minAmount: '', maxAmount: '',
  minInterestRate: '', maxInterestRate: '',
  minTermMonths: '', maxTermMonths: '',
};

export default function LoanTypesPage() {
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;
  const session = getTenantSession();
  const canManage = MANAGER_ROLES.includes(session?.user.role ?? 'VIEWER');

  const [types, setTypes] = useState<LoanType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<LoanType | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await getLoanTypes();
      setTypes(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
    setShowModal(true);
  }

  function openEdit(t: LoanType) {
    setEditing(t);
    setForm({
      name: t.name,
      description: t.description ?? '',
      minAmount: t.minAmount != null ? String(t.minAmount) : '',
      maxAmount: t.maxAmount != null ? String(t.maxAmount) : '',
      minInterestRate: t.minInterestRate != null ? String(t.minInterestRate) : '',
      maxInterestRate: t.maxInterestRate != null ? String(t.maxInterestRate) : '',
      minTermMonths: t.minTermMonths != null ? String(t.minTermMonths) : '',
      maxTermMonths: t.maxTermMonths != null ? String(t.maxTermMonths) : '',
    });
    setError('');
    setShowModal(true);
  }

  function set(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const dto = {
        name: form.name,
        description: form.description || undefined,
        minAmount: form.minAmount ? parseFloat(form.minAmount) : undefined,
        maxAmount: form.maxAmount ? parseFloat(form.maxAmount) : undefined,
        minInterestRate: form.minInterestRate ? parseFloat(form.minInterestRate) : undefined,
        maxInterestRate: form.maxInterestRate ? parseFloat(form.maxInterestRate) : undefined,
        minTermMonths: form.minTermMonths ? parseInt(form.minTermMonths) : undefined,
        maxTermMonths: form.maxTermMonths ? parseInt(form.maxTermMonths) : undefined,
      };
      if (editing) {
        await updateLoanType(editing.id, dto);
      } else {
        await createLoanType(dto);
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(t: LoanType) {
    try {
      await updateLoanType(t.id, { isActive: !t.isActive });
      setTypes((prev) => prev.map((x) => x.id === t.id ? { ...x, isActive: !x.isActive } : x));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleDelete(t: LoanType) {
    if ((t.loanCount ?? 0) > 0) {
      alert(`Cannot delete "${t.name}" — it has ${t.loanCount} loan(s) associated.`);
      return;
    }
    if (!confirm(`Delete loan type "${t.name}"?`)) return;
    try {
      await deleteLoanType(t.id);
      setTypes((prev) => prev.filter((x) => x.id !== t.id));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleSeedDefaults() {
    const existing = new Set(types.map((t) => t.name.toLowerCase()));
    const toSeed = DEFAULT_TYPES.filter((n) => !existing.has(n.toLowerCase()));
    if (toSeed.length === 0) { alert('All default loan types already exist.'); return; }
    if (!confirm(`Add ${toSeed.length} default loan type(s): ${toSeed.join(', ')}?`)) return;
    setSeeding(true);
    try {
      for (const name of toSeed) {
        await createLoanType({ name });
      }
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Loan Types</h1>
          <p className="text-sm text-gray-500">{types.length} type{types.length !== 1 ? 's' : ''} configured</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {types.length === 0 && (
              <button
                onClick={handleSeedDefaults}
                disabled={seeding}
                className="px-4 py-2 border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
              >
                {seeding ? 'Adding…' : '+ Add Defaults'}
              </button>
            )}
            <button
              onClick={openAdd}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + Add Loan Type
            </button>
          </div>
        )}
      </div>

      {/* Seed hint */}
      {canManage && types.length > 0 && types.length < DEFAULT_TYPES.length && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between gap-4">
          <p className="text-sm text-blue-700">Some default loan types are missing.</p>
          <button
            onClick={handleSeedDefaults}
            disabled={seeding}
            className="text-sm font-medium text-blue-700 underline hover:no-underline disabled:opacity-60 whitespace-nowrap"
          >
            {seeding ? 'Adding…' : 'Add missing defaults'}
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : types.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm mb-3">No loan types configured yet</p>
            {canManage && (
              <button onClick={handleSeedDefaults} disabled={seeding} className="text-sm text-blue-600 hover:underline">
                Add default loan types
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Name', 'Description', 'Amount Range', 'Interest Range', 'Term Range', 'Loans', 'Customers', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {types.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link href={`/${subdomain}/loan-types/${t.id}`} className="hover:text-blue-600 hover:underline">
                        {t.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{t.description || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {t.minAmount != null || t.maxAmount != null
                        ? `${t.minAmount != null ? fmt(t.minAmount) : '—'} – ${t.maxAmount != null ? fmt(t.maxAmount) : '—'}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {t.minInterestRate != null || t.maxInterestRate != null
                        ? `${t.minInterestRate ?? '—'}% – ${t.maxInterestRate ?? '—'}%`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {t.minTermMonths != null || t.maxTermMonths != null
                        ? `${t.minTermMonths ?? '—'} – ${t.maxTermMonths ?? '—'} mo`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/${subdomain}/loan-types/${t.id}?tab=loans`} className="text-blue-600 hover:underline font-medium">
                        {t.loanCount ?? 0}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/${subdomain}/loan-types/${t.id}?tab=customers`} className="text-blue-600 hover:underline font-medium">
                        {t.customerCount ?? 0}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {t.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {canManage && (
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(t)} className="text-xs text-blue-600 hover:underline">Edit</button>
                          <button onClick={() => handleToggle(t)} className="text-xs text-gray-500 hover:underline">
                            {t.isActive ? 'Disable' : 'Enable'}
                          </button>
                          <button onClick={() => handleDelete(t)} className="text-xs text-red-500 hover:underline">Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{editing ? 'Edit Loan Type' : 'Add Loan Type'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name <span className="text-red-500">*</span></label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} required className={inputCls} placeholder="e.g. Monthly" list="default-types" />
                <datalist id="default-types">
                  {DEFAULT_TYPES.map((n) => <option key={n} value={n} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input value={form.description} onChange={(e) => set('description', e.target.value)} className={inputCls} placeholder="Optional description" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Amount (₹)</label>
                  <input type="number" value={form.minAmount} onChange={(e) => set('minAmount', e.target.value)} className={inputCls} placeholder="1000" min={0} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max Amount (₹)</label>
                  <input type="number" value={form.maxAmount} onChange={(e) => set('maxAmount', e.target.value)} className={inputCls} placeholder="500000" min={0} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Interest Rate (%)</label>
                  <input type="number" step="0.01" value={form.minInterestRate} onChange={(e) => set('minInterestRate', e.target.value)} className={inputCls} placeholder="12" min={0} max={100} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max Interest Rate (%)</label>
                  <input type="number" step="0.01" value={form.maxInterestRate} onChange={(e) => set('maxInterestRate', e.target.value)} className={inputCls} placeholder="36" min={0} max={100} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Min Term (months)</label>
                  <input type="number" value={form.minTermMonths} onChange={(e) => set('minTermMonths', e.target.value)} className={inputCls} placeholder="1" min={1} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max Term (months)</label>
                  <input type="number" value={form.maxTermMonths} onChange={(e) => set('maxTermMonths', e.target.value)} className={inputCls} placeholder="60" min={1} />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Type'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
