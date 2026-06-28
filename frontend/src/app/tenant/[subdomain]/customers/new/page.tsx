'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { createCustomer, getBranches, TenantBranch, getTenantSession, CUSTOMER_ROLES } from '@/services/tenant-api';

const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
];

const RELATIONS = ['Spouse','Parent','Child','Sibling','Friend','Colleague','Other'];

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function NewCustomerPage() {
  const router = useRouter();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const session = getTenantSession();
  const canAdd = CUSTOMER_ROLES.includes(session?.user.role ?? 'VIEWER');

  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '',
    dateOfBirth: '',
    panNumber: '', aadhaarLast4: '',
    address: '', locality: '', city: '', state: '', pincode: '',
    occupation: '', loanPurpose: '',
    altContact: '', altContactName: '', altContactRelation: '',
    creditScore: '',
    branchId: '',
  });
  const [aadhaarFile, setAadhaarFile] = useState<File | null>(null);
  const [aadhaarPreview, setAadhaarPreview] = useState<string>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getBranches().then((b) => setBranches(b.filter((br) => br.isActive)));
  }, []);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleAadhaarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Aadhaar file must be under 5 MB'); return; }
    setAadhaarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAadhaarPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.panNumber.trim() && !form.aadhaarLast4.trim()) {
      setError('At least one of PAN number or Aadhaar number is required');
      return;
    }

    setLoading(true);
    try {
      await createCustomer({
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        ...(form.email && { email: form.email }),
        ...(form.panNumber && { panNumber: form.panNumber }),
        ...(form.aadhaarLast4 && { aadhaarLast4: form.aadhaarLast4 }),
        ...(aadhaarPreview && { aadhaarDocUrl: aadhaarPreview }),
        ...(form.dateOfBirth && { dateOfBirth: form.dateOfBirth }),
        address: form.address,
        locality: form.locality,
        ...(form.city && { city: form.city }),
        ...(form.state && { state: form.state }),
        ...(form.pincode && { pincode: form.pincode }),
        ...(form.occupation && { occupation: form.occupation }),
        ...(form.loanPurpose && { loanPurpose: form.loanPurpose }),
        altContact: form.altContact,
        ...(form.altContactName && { altContactName: form.altContactName }),
        ...(form.altContactRelation && { altContactRelation: form.altContactRelation }),
        ...(form.creditScore && { creditScore: parseInt(form.creditScore) }),
        ...(form.branchId && { branchId: form.branchId }),
      });
      router.push(`/${subdomain}/customers`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!canAdd) {
    router.replace(`/${subdomain}/customers`);
    return null;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/${subdomain}/customers`} className="text-sm text-blue-600 hover:underline">
          ← Back to Customers
        </Link>
        <h1 className="text-xl font-bold text-gray-900 mt-2">Add New Customer</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Personal Information */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Personal Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="First Name" required>
              <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required className={inputCls} placeholder="Ravi" />
            </Field>
            <Field label="Last Name" required>
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required className={inputCls} placeholder="Kumar" />
            </Field>
            <Field label="Mobile Number" required>
              <div className="flex">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l-lg bg-gray-50 text-gray-500 text-sm">+91</span>
                <input
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  required
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-r-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                  placeholder="9876543210"
                  maxLength={10}
                />
              </div>
            </Field>
            <Field label="Email Address">
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} placeholder="ravi@example.com" />
            </Field>
            <Field label="Date of Birth">
              <input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Occupation">
              <input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} className={inputCls} placeholder="Farmer, Business, Salaried…" />
            </Field>
            <Field label="Reason for Loan">
              <input value={form.loanPurpose} onChange={(e) => set('loanPurpose', e.target.value)} className={inputCls} placeholder="Agriculture, Medical, Education…" />
            </Field>
            <Field label="Credit Score">
              <input type="number" value={form.creditScore} onChange={(e) => set('creditScore', e.target.value)} className={inputCls} placeholder="750" min={300} max={900} />
            </Field>
          </div>
        </div>

        {/* KYC Details */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">KYC Details</h2>
          <p className="text-xs text-gray-400 mb-4">At least one of PAN or Aadhaar is required</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="PAN Number">
              <input value={form.panNumber} onChange={(e) => set('panNumber', e.target.value.toUpperCase())} className={inputCls} placeholder="ABCDE1234F" maxLength={10} />
            </Field>
            <Field label="Aadhaar Last 4 Digits">
              <input value={form.aadhaarLast4} onChange={(e) => set('aadhaarLast4', e.target.value.replace(/\D/g, '').slice(0, 4))} className={inputCls} placeholder="1234" maxLength={4} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Aadhaar Copy (PDF or Image, max 5 MB)">
              <input type="file" accept="image/*,application/pdf" onChange={handleAadhaarFile} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
            </Field>
            {aadhaarFile && (
              <p className="text-xs text-green-600 mt-1">
                {aadhaarFile.name} ({(aadhaarFile.size / 1024).toFixed(0)} KB) attached
              </p>
            )}
          </div>
        </div>

        {/* Address */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Address</h2>
          <div className="space-y-4">
            <Field label="Street Address" required>
              <input value={form.address} onChange={(e) => set('address', e.target.value)} required className={inputCls} placeholder="Plot 12, Main Road" />
            </Field>
            <Field label="Locality / Area" required>
              <input value={form.locality} onChange={(e) => set('locality', e.target.value)} required className={inputCls} placeholder="Anna Nagar, Velachery…" />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="City">
                <input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls} placeholder="Chennai" />
              </Field>
              <Field label="State">
                <select value={form.state} onChange={(e) => set('state', e.target.value)} className={inputCls}>
                  <option value="">Select state</option>
                  {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Pincode">
                <input value={form.pincode} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} className={inputCls} placeholder="600001" maxLength={6} />
              </Field>
            </div>
          </div>
        </div>

        {/* Alternate Contact */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Alternate Contact</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Alternate Contact Number" required>
              <div className="flex">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l-lg bg-gray-50 text-gray-500 text-sm">+91</span>
                <input
                  value={form.altContact}
                  onChange={(e) => set('altContact', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  required
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-r-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                  placeholder="9876543210"
                  maxLength={10}
                />
              </div>
            </Field>
            <Field label="Contact Name">
              <input value={form.altContactName} onChange={(e) => set('altContactName', e.target.value)} className={inputCls} placeholder="Priya Kumar" />
            </Field>
            <Field label="Relation">
              <select value={form.altContactRelation} onChange={(e) => set('altContactRelation', e.target.value)} className={inputCls}>
                <option value="">Select relation</option>
                {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {/* Branch */}
        {branches.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Branch Assignment</h2>
            <Field label="Assign to Branch">
              <select value={form.branchId} onChange={(e) => set('branchId', e.target.value)} className={inputCls}>
                <option value="">No specific branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
            </Field>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        <div className="flex justify-end gap-3">
          <Link href={`/${subdomain}/customers`} className="px-5 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Saving…' : 'Add Customer'}
          </button>
        </div>
      </form>
    </div>
  );
}
