'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { createCustomer, getBranches, TenantBranch, getTenantSession, CUSTOMER_ROLES } from '@/services/tenant-api';
import { sanitizeLocalityInput, sanitizeOccupationInput, sanitizePanInput, sanitizeNameInput, sanitizeLoanPurposeInput, hasDisallowedLoanPurposeChars } from '@/lib/quick-add-customer';
import { allowedCharsError, EMAIL_RE, PERSON_NAME_RE, PERSON_NAME_CHARS, ADDRESS_RE, ADDRESS_CHARS } from '@/lib/text-validation';

const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh',
];

const RELATIONS = ['Spouse','Parent','Child','Sibling','Friend','Colleague','Other'];

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';
const inputErrCls = 'w-full px-3 py-2 border border-red-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white text-gray-900';

type FormFields = {
  firstName: string; lastName: string; phone: string; email: string;
  dateOfBirth: string;
  panNumber: string; aadhaarLast4: string;
  address: string; locality: string; city: string; state: string; pincode: string;
  occupation: string; loanPurpose: string;
  altContact: string; altContactName: string; altContactRelation: string;
  creditScore: string;
  branchId: string;
};

type FieldKey = keyof FormFields;

function Field({
  label, children, required, error,
}: {
  label: string; children: React.ReactNode; required?: boolean; error?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function validateForm(form: FormFields): Partial<Record<FieldKey | 'kyc', string>> {
  const errors: Partial<Record<FieldKey | 'kyc', string>> = {};

  // Assign only when there IS an error: `errors.x = undefined` still creates the
  // key, which would make Object.keys(errors).length non-zero and block submit
  // forever.
  if (!form.firstName.trim()) errors.firstName = 'First name is required';
  else {
    const e = allowedCharsError(form.firstName, 'First name', PERSON_NAME_RE, PERSON_NAME_CHARS);
    if (e) errors.firstName = e;
  }
  if (!form.lastName.trim()) errors.lastName = 'Last name is required';
  else {
    const e = allowedCharsError(form.lastName, 'Last name', PERSON_NAME_RE, PERSON_NAME_CHARS);
    if (e) errors.lastName = e;
  }

  if (!form.phone.trim()) errors.phone = 'Phone number is required';
  else if (!/^\d{10}$/.test(form.phone)) errors.phone = 'Phone number must be exactly 10 digits';

  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) {
    errors.email = 'Email address is invalid';
  }

  if (!form.address.trim()) errors.address = 'Address is required';
  else {
    const e = allowedCharsError(form.address, 'Address', ADDRESS_RE, ADDRESS_CHARS, false);
    if (e) errors.address = e;
  }
  if (!form.locality.trim()) errors.locality = 'Locality is required';
  else if (!/^[a-zA-Z0-9\s\-.,']+$/.test(form.locality.trim())) {
    errors.locality = 'Locality cannot contain special characters';
  }

  if (form.altContactName.trim()) {
    const e = allowedCharsError(form.altContactName, 'Contact name', PERSON_NAME_RE, PERSON_NAME_CHARS);
    if (e) errors.altContactName = e;
  }

  if (form.altContact.trim() && !/^\d{10}$/.test(form.altContact)) {
    errors.altContact = 'Alternate contact must be exactly 10 digits';
  }

  if (!form.panNumber.trim() && !form.aadhaarLast4.trim()) {
    errors.kyc = 'At least one of PAN number or Aadhaar number is required';
  }
  if (form.panNumber.trim()) {
    if (/[^A-Z0-9]/.test(form.panNumber.trim())) {
      errors.panNumber = 'PAN cannot contain special characters';
    } else if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.panNumber.trim())) {
      errors.panNumber = 'PAN format is invalid (e.g. ABCDE1234F)';
    }
  }
  if (form.aadhaarLast4.trim() && !/^\d{4}$/.test(form.aadhaarLast4)) {
    errors.aadhaarLast4 = 'Aadhaar last 4 digits must be exactly 4 digits';
  }
  if (form.pincode.trim() && !/^\d{6}$/.test(form.pincode)) {
    errors.pincode = 'Pincode must be exactly 6 digits';
  }
  if (form.loanPurpose.trim() && hasDisallowedLoanPurposeChars(form.loanPurpose)) {
    errors.loanPurpose = 'Loan purpose can only contain letters (no numbers or special characters)';
  }
  if (form.creditScore.trim()) {
    const score = parseInt(form.creditScore, 10);
    if (Number.isNaN(score) || score < 300 || score > 900) {
      errors.creditScore = 'Credit score must be between 300 and 900';
    }
  }

  return errors;
}

export default function NewCustomerPage() {
  const router = useRouter();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const session = getTenantSession();
  const canAdd = CUSTOMER_ROLES.includes(session?.user.role ?? 'CUSTOMER');

  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [form, setForm] = useState<FormFields>({
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
  const [touched, setTouched] = useState<Partial<Record<FieldKey | 'kyc', boolean>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Validate on every render, but only SHOW a field's error once the user has
  // left it (blur) or tried to submit — otherwise an untouched empty form lights
  // up red immediately. Same pattern as the branch modal, so the two forms
  // behave identically.
  const liveErrors = validateForm(form);
  const fieldErrors: Partial<Record<FieldKey | 'kyc', string>> = {};
  for (const k of Object.keys(liveErrors) as (FieldKey | 'kyc')[]) {
    if (touched[k] || submitAttempted) fieldErrors[k] = liveErrors[k];
  }

  function blur(field: FieldKey | 'kyc') {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }

  useEffect(() => {
    getBranches().then((b) => setBranches(b.filter((br) => br.isActive)));
  }, []);

  function set(field: FieldKey, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function cls(field: FieldKey) {
    return fieldErrors[field] ? inputErrCls : inputCls;
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

    setSubmitAttempted(true);
    if (Object.keys(liveErrors).length > 0) {
      // Every validation error renders inline under its own field (kyc included),
      // so the summary stays generic rather than repeating the first field's
      // message — which read as a second, unrelated problem.
      setError('Please fix the highlighted fields');
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
        ...(form.altContact && { altContact: form.altContact }),
        ...(form.altContactName && { altContactName: form.altContactName }),
        ...(form.altContactRelation && { altContactRelation: form.altContactRelation }),
        ...(form.creditScore && { creditScore: parseInt(form.creditScore) }),
        ...(form.branchId && { branchId: form.branchId }),
      });
      router.push(`/tenant/${subdomain}/customers`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!canAdd) {
    router.replace(`/tenant/${subdomain}/customers`);
    return null;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/tenant/${subdomain}/customers`} className="text-sm text-blue-600 hover:underline">
          ← Back to Customers
        </Link>
        <h1 className="text-xl font-bold text-gray-900 mt-2">Add New Customer</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>

        {/* Personal Information */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Personal Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="First Name" required error={fieldErrors.firstName}>
              <input value={form.firstName} onBlur={() => blur('firstName')} onChange={(e) => set('firstName', sanitizeNameInput(e.target.value))} className={cls('firstName')} placeholder="Ravi" />
            </Field>
            <Field label="Last Name" required error={fieldErrors.lastName}>
              <input value={form.lastName} onBlur={() => blur('lastName')} onChange={(e) => set('lastName', sanitizeNameInput(e.target.value))} className={cls('lastName')} placeholder="Kumar" />
            </Field>
            <Field label="Mobile Number" required error={fieldErrors.phone}>
              <div className="flex">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l-lg bg-gray-50 text-gray-500 text-sm">+91</span>
                <input
                  value={form.phone} onBlur={() => blur('phone')}
                  onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className={`flex-1 px-3 py-2 border rounded-r-lg text-sm focus:outline-none focus:ring-2 bg-white text-gray-900 ${fieldErrors.phone ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 focus:ring-blue-500'}`}
                  placeholder="9876543210"
                  maxLength={10}
                  inputMode="numeric"
                />
              </div>
            </Field>
            <Field label="Email Address" error={fieldErrors.email}>
              <input type="email" value={form.email} onBlur={() => blur('email')} onChange={(e) => set('email', e.target.value)} className={cls('email')} placeholder="ravi@example.com" />
            </Field>
            <Field label="Date of Birth">
              <input type="date" value={form.dateOfBirth} onBlur={() => blur('dateOfBirth')} onChange={(e) => set('dateOfBirth', e.target.value)} className={inputCls} />
            </Field>
            <Field label="Occupation">
              <input value={form.occupation} onBlur={() => blur('occupation')} onChange={(e) => set('occupation', sanitizeOccupationInput(e.target.value))} className={inputCls} placeholder="Farmer, Business, Salaried…" />
            </Field>
            <Field label="Reason for Loan" error={fieldErrors.loanPurpose}>
              <input value={form.loanPurpose} onBlur={() => blur('loanPurpose')} onChange={(e) => set('loanPurpose', sanitizeLoanPurposeInput(e.target.value))} className={cls('loanPurpose')} placeholder="Agriculture, Medical, Education…" />
            </Field>
            <Field label="Credit Score" error={fieldErrors.creditScore}>
              <input type="number" value={form.creditScore} onBlur={() => blur('creditScore')} onChange={(e) => set('creditScore', e.target.value)} className={cls('creditScore')} placeholder="750" min={300} max={900} />
            </Field>
          </div>
        </div>

        {/* KYC Details */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">KYC Details</h2>
          <p className="text-xs text-gray-400 mb-4">At least one of PAN or Aadhaar is required</p>
          {(fieldErrors.kyc) && <p className="text-xs text-red-600 mb-3">{fieldErrors.kyc}</p>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="PAN Number" error={fieldErrors.panNumber}>
              <input value={form.panNumber} onBlur={() => blur('panNumber')} onChange={(e) => set('panNumber', sanitizePanInput(e.target.value))} className={cls('panNumber')} placeholder="ABCDE1234F" maxLength={10} />
            </Field>
            <Field label="Aadhaar Last 4 Digits" error={fieldErrors.aadhaarLast4}>
              <input value={form.aadhaarLast4} onBlur={() => blur('aadhaarLast4')} onChange={(e) => set('aadhaarLast4', e.target.value.replace(/\D/g, '').slice(0, 4))} className={cls('aadhaarLast4')} placeholder="1234" maxLength={4} inputMode="numeric" />
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
            <Field label="Street Address" required error={fieldErrors.address}>
              <input value={form.address} onBlur={() => blur('address')} onChange={(e) => set('address', e.target.value)} className={cls('address')} placeholder="Plot 12, Main Road" />
            </Field>
            <Field label="Locality / Area" required error={fieldErrors.locality}>
              <input value={form.locality} onBlur={() => blur('locality')} onChange={(e) => set('locality', sanitizeLocalityInput(e.target.value))} className={cls('locality')} placeholder="Anna Nagar, Velachery…" />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="City">
                <input value={form.city} onBlur={() => blur('city')} onChange={(e) => set('city', e.target.value)} className={inputCls} placeholder="Chennai" />
              </Field>
              <Field label="State">
                <select value={form.state} onBlur={() => blur('state')} onChange={(e) => set('state', e.target.value)} className={inputCls}>
                  <option value="">Select state</option>
                  {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Pincode" error={fieldErrors.pincode}>
                <input value={form.pincode} onBlur={() => blur('pincode')} onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} className={cls('pincode')} placeholder="600001" maxLength={6} inputMode="numeric" />
              </Field>
            </div>
          </div>
        </div>

        {/* Alternate Contact */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Alternate Contact</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Alternate Contact Number" error={fieldErrors.altContact}>
              <div className="flex">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l-lg bg-gray-50 text-gray-500 text-sm">+91</span>
                <input
                  value={form.altContact} onBlur={() => blur('altContact')}
                  onChange={(e) => set('altContact', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className={`flex-1 px-3 py-2 border rounded-r-lg text-sm focus:outline-none focus:ring-2 bg-white text-gray-900 ${fieldErrors.altContact ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 focus:ring-blue-500'}`}
                  placeholder="9876543210"
                  maxLength={10}
                  inputMode="numeric"
                />
              </div>
            </Field>
            <Field label="Contact Name" error={fieldErrors.altContactName}>
              <input value={form.altContactName} onBlur={() => blur('altContactName')} onChange={(e) => set('altContactName', sanitizeNameInput(e.target.value))} className={cls('altContactName')} placeholder="Priya Kumar" />
            </Field>
            <Field label="Relation">
              <select value={form.altContactRelation} onBlur={() => blur('altContactRelation')} onChange={(e) => set('altContactRelation', e.target.value)} className={inputCls}>
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
              <select value={form.branchId} onBlur={() => blur('branchId')} onChange={(e) => set('branchId', e.target.value)} className={inputCls}>
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
