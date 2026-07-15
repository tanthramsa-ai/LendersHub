'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCustomer, updateCustomer, getBranches, activateCustomer, deactivateCustomer, deleteCustomer,
  getLoans, loanDetailPath,
  CustomerDetail, TenantBranch, UpdateCustomerPayload, Loan,
  getTenantSession, CUSTOMER_ROLES, USER_ADMIN_ROLES,
} from '@/services/tenant-api';
import { sanitizeLocalityInput, sanitizePanInput, sanitizeLoanPurposeInput } from '@/lib/quick-add-customer';

const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
];
const RELATIONS = ['Spouse','Parent','Child','Sibling','Friend','Colleague','Other'];
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

const CYCLE_TYPE_LABEL: Record<string, string> = {
  WEEKLY: 'Weekly',
  DAILY_NO_SUNDAY: 'Daily',
  DAILY_WITH_SUNDAY: 'Daily',
  MONTHLY: 'Monthly',
  AGENT_RISK: 'Agent Risk',
  TERM_LOAN: 'Term Loan',
};

const LOAN_STATUS_COLORS: Record<string, string> = {
  DISBURSED: 'bg-green-100 text-green-700',
  PENDING:   'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  CLOSED:    'bg-slate-200 text-slate-800',
  DEFAULTED: 'bg-red-100 text-red-700',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function CustomerDetailPage() {
  const params = useParams<{ subdomain: string; id: string }>();
  const { subdomain, id } = params;
  const router = useRouter();

  const session = getTenantSession();
  const canEdit = CUSTOMER_ROLES.includes(session?.user.role ?? 'VIEWER');
  const canAdmin = USER_ADMIN_ROLES.includes(session?.user.role ?? 'VIEWER');

  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '',
    dateOfBirth: '', panNumber: '', aadhaarLast4: '',
    address: '', locality: '', city: '', state: '', pincode: '',
    occupation: '', loanPurpose: '',
    altContact: '', altContactName: '', altContactRelation: '',
    creditScore: '', branchId: '',
  });
  const [aadhaarFile, setAadhaarFile] = useState<File | null>(null);
  const [aadhaarPreview, setAadhaarPreview] = useState('');

  useEffect(() => {
    Promise.all([
      getCustomer(id),
      getBranches(),
      getLoans(1, 50, { customerId: id }).catch(() => ({ data: [] as Loan[] })),
    ]).then(([c, b, l]) => {
      setCustomer(c);
      setBranches(b.filter((br) => br.isActive));
      setLoans(l.data);
      setForm({
        firstName: c.firstName, lastName: c.lastName,
        phone: c.phone, email: c.email ?? '',
        dateOfBirth: c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : '',
        panNumber: c.panNumber ?? '', aadhaarLast4: c.aadhaarLast4 ?? '',
        address: c.address ?? '', locality: c.locality ?? '',
        city: c.city ?? '', state: c.state ?? '', pincode: c.pincode ?? '',
        occupation: c.occupation ?? '', loanPurpose: c.loanPurpose ?? '',
        altContact: c.altContact ?? '', altContactName: c.altContactName ?? '',
        altContactRelation: c.altContactRelation ?? '',
        creditScore: c.creditScore ? String(c.creditScore) : '',
        branchId: c.branchId ?? '',
      });
    }).catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleAadhaarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setSaveError('Aadhaar file must be under 5 MB'); return; }
    setAadhaarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAadhaarPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');
    setSaving(true);
    try {
      const payload: UpdateCustomerPayload = {
        firstName: form.firstName, lastName: form.lastName,
        phone: form.phone,
        email: form.email || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        panNumber: form.panNumber || undefined,
        aadhaarLast4: form.aadhaarLast4 || undefined,
        aadhaarDocUrl: aadhaarPreview || undefined,
        address: form.address, locality: form.locality,
        city: form.city || undefined, state: form.state || undefined,
        pincode: form.pincode || undefined,
        occupation: form.occupation || undefined,
        loanPurpose: form.loanPurpose || undefined,
        altContact: form.altContact.trim() || undefined,
        altContactName: form.altContactName || undefined,
        altContactRelation: form.altContactRelation || undefined,
        creditScore: form.creditScore ? parseInt(form.creditScore) : undefined,
        branchId: form.branchId || null,
      };
      await updateCustomer(id, payload);
      const updated = await getCustomer(id);
      setCustomer(updated);
      setEditing(false);
      setAadhaarFile(null);
      setAadhaarPreview('');
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!customer) return;
    setToggling(true);
    try {
      const fn = customer.isActive ? deactivateCustomer : activateCustomer;
      const res = await fn(id);
      setCustomer({ ...customer, isActive: res.isActive });
    } catch {}
    setToggling(false);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteCustomer(id);
      router.replace(`/${subdomain}/customers`);
    } catch (err) {
      alert((err as Error).message);
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    return <div className="p-6 flex justify-center items-center h-64"><div className="text-gray-400 text-sm">Loading…</div></div>;
  }

  if (error || !customer) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error || 'Customer not found'}</div>
        <button onClick={() => router.back()} className="mt-4 text-sm text-blue-600 hover:underline">← Go back</button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href={`/${subdomain}/customers`} className="text-sm text-blue-600 hover:underline">← Back to Customers</Link>
            <h1 className="text-xl font-bold text-gray-900 mt-1">Edit Customer — {customer.customerCode}</h1>
          </div>
          <button onClick={() => setEditing(false)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Personal Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="First Name *"><input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required className={inputCls} /></Field>
              <Field label="Last Name *"><input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required className={inputCls} /></Field>
              <Field label="Phone *"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} required className={inputCls} /></Field>
              <Field label="Email"><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} /></Field>
              <Field label="Date of Birth"><input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} className={inputCls} /></Field>
              <Field label="Occupation"><input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} className={inputCls} /></Field>
              <Field label="Reason for Loan"><input value={form.loanPurpose} onChange={(e) => set('loanPurpose', sanitizeLoanPurposeInput(e.target.value))} className={inputCls} /></Field>
              <Field label="Credit Score"><input type="number" value={form.creditScore} onChange={(e) => set('creditScore', e.target.value)} className={inputCls} min={300} max={900} /></Field>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">KYC Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="PAN Number"><input value={form.panNumber} onChange={(e) => set('panNumber', sanitizePanInput(e.target.value))} className={inputCls} maxLength={10} /></Field>
              <Field label="Aadhaar Last 4"><input value={form.aadhaarLast4} onChange={(e) => set('aadhaarLast4', e.target.value.replace(/\D/g, '').slice(0, 4))} className={inputCls} maxLength={4} /></Field>
            </div>
            <div className="mt-4">
              <Field label="Aadhaar Copy (replace existing)">
                <input type="file" accept="image/*,application/pdf" onChange={handleAadhaarFile}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
              </Field>
              {aadhaarFile && <p className="text-xs text-green-600 mt-1">{aadhaarFile.name} attached</p>}
              {customer.aadhaarDocUrl && !aadhaarFile && <p className="text-xs text-gray-400 mt-1">Existing file will be kept</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Address</h2>
            <div className="space-y-4">
              <Field label="Street Address *"><input value={form.address} onChange={(e) => set('address', e.target.value)} required className={inputCls} /></Field>
              <Field label="Locality *"><input value={form.locality} onChange={(e) => set('locality', sanitizeLocalityInput(e.target.value))} required className={inputCls} /></Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="City"><input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls} /></Field>
                <Field label="State">
                  <select value={form.state} onChange={(e) => set('state', e.target.value)} className={inputCls}>
                    <option value="">Select state</option>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Pincode"><input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} className={inputCls} maxLength={6} /></Field>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Alternate Contact</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Alt. Contact"><input value={form.altContact} onChange={(e) => set('altContact', e.target.value.replace(/\D/g, '').slice(0, 10))} className={inputCls} placeholder="Optional" /></Field>
              <Field label="Contact Name"><input value={form.altContactName} onChange={(e) => set('altContactName', e.target.value)} className={inputCls} /></Field>
              <Field label="Relation">
                <select value={form.altContactRelation} onChange={(e) => set('altContactRelation', e.target.value)} className={inputCls}>
                  <option value="">Select relation</option>
                  {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {branches.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Branch</h2>
              <Field label="Assign to Branch">
                <select value={form.branchId} onChange={(e) => set('branchId', e.target.value)} className={inputCls}>
                  <option value="">No specific branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                </select>
              </Field>
            </div>
          )}

          {saveError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{saveError}</div>}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditing(false)} className="px-5 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // View mode
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href={`/${subdomain}/customers`} className="text-sm text-blue-600 hover:underline">← Back to Customers</Link>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-xl font-bold text-gray-900">{customer.firstName} {customer.lastName}</h1>
            <span className="font-mono text-xs text-gray-400">{customer.customerCode}</span>
            <span className={`px-2.5 py-0.5 rounded text-xs font-semibold ${customer.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {customer.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Customer since {fmtDate(customer.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Edit
            </button>
          )}
          {canAdmin && (
            <button
              onClick={toggleActive}
              disabled={toggling}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${customer.isActive ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200' : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'}`}
            >
              {toggling ? '…' : customer.isActive ? 'Deactivate' : 'Activate'}
            </button>
          )}
          {canAdmin && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
        {confirmDelete && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full space-y-4">
              <h2 className="text-lg font-bold text-gray-900">Delete Customer?</h2>
              <p className="text-sm text-gray-600">This will deactivate the customer record. Customers with active loans cannot be deleted.</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Loans', value: customer.totalLoans, color: 'text-blue-700' },
          { label: 'Active Loans', value: customer.activeLoans, color: 'text-green-700' },
          { label: 'Total Repaid', value: `₹${customer.totalPaid.toLocaleString('en-IN')}`, color: 'text-purple-700' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Personal Info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Personal Information</h2>
          {[
            { label: 'Phone', value: customer.phone },
            { label: 'Email', value: customer.email || '—' },
            { label: 'Date of Birth', value: fmtDate(customer.dateOfBirth) },
            { label: 'Occupation', value: customer.occupation || '—' },
            { label: 'Loan Purpose', value: customer.loanPurpose || '—' },
            { label: 'Credit Score', value: customer.creditScore ? String(customer.creditScore) : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-gray-400">{label}</span>
              <span className="font-medium text-gray-900 text-right">{value}</span>
            </div>
          ))}
        </div>

        {/* KYC */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">KYC & Address</h2>
          {[
            { label: 'PAN', value: customer.panNumber || '—' },
            { label: 'Aadhaar (last 4)', value: customer.aadhaarLast4 ? `XXXX XXXX ${customer.aadhaarLast4}` : '—' },
            { label: 'Address', value: customer.address || '—' },
            { label: 'Locality', value: customer.locality || '—' },
            { label: 'City / State', value: [customer.city, customer.state].filter(Boolean).join(', ') || '—' },
            { label: 'Pincode', value: customer.pincode || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-gray-400">{label}</span>
              <span className="font-medium text-gray-900 text-right">{value}</span>
            </div>
          ))}
          {customer.aadhaarDocUrl && (
            <div className="pt-2">
              <a href={customer.aadhaarDocUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                View Aadhaar Copy
              </a>
            </div>
          )}
        </div>

        {/* Alternate Contact */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Alternate Contact</h2>
          {[
            { label: 'Number', value: customer.altContact || '—' },
            { label: 'Name', value: customer.altContactName || '—' },
            { label: 'Relation', value: customer.altContactRelation || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-gray-400">{label}</span>
              <span className="font-medium text-gray-900">{value}</span>
            </div>
          ))}
        </div>

        {/* Branch */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Branch</h2>
          {customer.branchName ? (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Branch</span>
              <span className="font-medium text-gray-900">{customer.branchName} ({customer.branchCode})</span>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No branch assigned</p>
          )}
        </div>
      </div>

      {/* Loans — every loan type this customer has, not just one product */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-700">Loans ({loans.length})</h2>
        {loans.length === 0 ? (
          <p className="text-sm text-gray-400">No loans yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {loans.map((l) => (
              <Link
                key={l.id}
                href={`/${subdomain}/${loanDetailPath(l.cycleType, l.id)}`}
                className="flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg"
              >
                <div>
                  <span className="text-sm font-medium text-blue-600">{l.loanNumber}</span>
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">
                    {CYCLE_TYPE_LABEL[l.cycleType ?? ''] ?? l.cycleType}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-gray-500">{fmt(l.principal)}</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${LOAN_STATUS_COLORS[l.status] ?? 'bg-gray-100 text-gray-500'}`}>{l.status}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Back */}
      <div className="flex items-center justify-between">
        <Link href={`/${subdomain}/customers`} className="text-sm text-blue-600 hover:underline">
          ← Back to Customers
        </Link>
      </div>
    </div>
  );
}
