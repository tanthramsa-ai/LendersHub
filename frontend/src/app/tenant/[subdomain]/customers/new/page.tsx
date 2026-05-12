'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { createCustomer } from '@/services/tenant-api';

const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
];

export default function NewCustomerPage() {
  const router = useRouter();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', email: '',
    panNumber: '', aadhaarLast4: '', dateOfBirth: '',
    address: '', city: '', state: '', pincode: '',
    creditScore: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createCustomer({
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        email: form.email || undefined,
        panNumber: form.panNumber || undefined,
        aadhaarLast4: form.aadhaarLast4 || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        pincode: form.pincode || undefined,
        creditScore: form.creditScore ? parseInt(form.creditScore) : undefined,
      });
      router.push(`/tenant/${subdomain}/customers`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/tenant/${subdomain}/customers`} className="text-sm text-blue-600 hover:underline">
          ← Back to Customers
        </Link>
        <h1 className="text-xl font-bold text-gray-900 mt-2">Add New Customer</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Personal Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="First Name *" required>
              <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required className={inputCls} placeholder="Ravi" />
            </Field>
            <Field label="Last Name *" required>
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required className={inputCls} placeholder="Kumar" />
            </Field>
            <Field label="Mobile Number *">
              <input value={form.phone} onChange={(e) => set('phone', e.target.value)} required className={inputCls} placeholder="9876543210" maxLength={10} />
            </Field>
            <Field label="Email Address">
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} placeholder="ravi@example.com" />
            </Field>
            <Field label="Date of Birth">
              <input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Credit Score">
              <input type="number" value={form.creditScore} onChange={(e) => set('creditScore', e.target.value)} className={inputCls} placeholder="750" min={300} max={900} />
            </Field>
          </div>
        </div>

        {/* KYC */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">KYC Details</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="PAN Number">
              <input value={form.panNumber} onChange={(e) => set('panNumber', e.target.value.toUpperCase())} className={inputCls} placeholder="ABCDE1234F" maxLength={10} />
            </Field>
            <Field label="Aadhaar Last 4 Digits">
              <input value={form.aadhaarLast4} onChange={(e) => set('aadhaarLast4', e.target.value)} className={inputCls} placeholder="1234" maxLength={4} />
            </Field>
          </div>
        </div>

        {/* Address */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Address</h2>
          <div className="space-y-4">
            <Field label="Street Address">
              <input value={form.address} onChange={(e) => set('address', e.target.value)} className={inputCls} placeholder="Plot 12, Main Road" />
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
                <input value={form.pincode} onChange={(e) => set('pincode', e.target.value)} className={inputCls} placeholder="600001" maxLength={6} />
              </Field>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        <div className="flex justify-end gap-3">
          <Link href={`/tenant/${subdomain}/customers`} className="px-5 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">
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

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}{required && ' *'}</label>
      {children}
    </div>
  );
}
