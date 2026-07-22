'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getCustomers, createCustomer, updateCustomer, getCustomer, getBranches, getLoanTypes,
  previewWeeklySchedule, createWeeklyLoan,
  Customer, TenantBranch, LoanType, WeeklySchedulePreview, WeeklyCalculationType,
  getTenantSession, LOAN_CREATE_ROLES,
} from '@/services/tenant-api';
import {
  getQuickAddCustomerErrors, sanitizeNameInput, sanitizeLocalityInput, sanitizePanInput, sanitizeLoanPurposeInput,
  EMPTY_QUICK_ADD_CUSTOMER, customerToQuickAddForm,
} from '@/lib/quick-add-customer';


const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Step = 1 | 2 | 3;

export default function NewWeeklyLoanPage() {
  const router = useRouter();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const session = getTenantSession();
  if (!LOAN_CREATE_ROLES.includes(session?.user.role ?? 'VIEWER')) {
    router.replace(`/${subdomain}/dashboard`);
    return null;
  }

  const [step, setStep] = useState<Step>(1);

  // Step 1: Customer
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [newCust, setNewCust] = useState({ ...EMPTY_QUICK_ADD_CUSTOMER });
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [addCustError, setAddCustError] = useState('');

  // Step 2: Loan Terms
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loanTypes, setLoanTypes] = useState<LoanType[]>([]);
  const [weeklyTypeId, setWeeklyTypeId] = useState('');
  const [form, setForm] = useState({
    branchId: '', purpose: '',
    principal: '', interestRate: '', termWeeks: '',
    firstDueDate: '', calculationType: 'REDUCING' as WeeklyCalculationType,
    interestPerDay: '3.19',
    emiRounding: '10',
  });
  const isPerDay = form.calculationType === 'PER_1000_PER_DAY';
  const [preview, setPreview] = useState<WeeklySchedulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Step 3: Documents
  const [securityFile, setSecurityFile] = useState<File | null>(null);
  const [securityB64, setSecurityB64] = useState('');
  const [promissoryFile, setPromissoryFile] = useState<File | null>(null);
  const [promissoryB64, setPromissoryB64] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    // Both lists are optional context — if the API is unreachable the form still works,
    // so swallow the failure rather than leaving an unhandled rejection.
    getBranches()
      .then((b) => setBranches(b.filter((br) => br.isActive)))
      .catch(() => setBranches([]));
    getLoanTypes()
      .then((lt) => {
        setLoanTypes(lt.filter((t) => t.isActive));
        const weekly = lt.find((t) => t.name.toLowerCase() === 'weekly');
        if (weekly) setWeeklyTypeId(weekly.id);
      })
      .catch(() => setLoanTypes([]));
    // Default first due date to next Monday
    const nextMon = new Date();
    nextMon.setDate(nextMon.getDate() + ((8 - nextMon.getDay()) % 7 || 7));
    setForm((f) => ({ ...f, firstDueDate: nextMon.toISOString().slice(0, 10) }));
  }, []);

  // Customer search
  const searchCustomers = useCallback(async (q: string) => {
    if (!q.trim()) { setCustomerResults([]); return; }
    setSearching(true);
    try {
      const res = await getCustomers(1, 8, q);
      setCustomerResults(res.data);
    } finally { setSearching(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(customerSearch), 300);
    return () => clearTimeout(t);
  }, [customerSearch, searchCustomers]);

  async function handleChangeCustomer() {
    if (!selectedCustomer) return;
    setAddCustError('');
    try {
      const detail = await getCustomer(selectedCustomer.id);
      setNewCust(customerToQuickAddForm(detail));
      setEditingCustomerId(detail.id);
    } catch {
      // Fall back to whatever we already know about the selected customer
      setNewCust(customerToQuickAddForm(selectedCustomer));
      setEditingCustomerId(selectedCustomer.id);
    }
    setSelectedCustomer(null);
    setShowAddCustomer(true);
    setCustomerSearch('');
    setCustomerResults([]);
  }

  async function handleAddCustomer() {
    const validationErrors = getQuickAddCustomerErrors(newCust);
    if (validationErrors.length) {
      setAddCustError(validationErrors.join('\n'));
      return;
    }
    setAddCustError('');
    setAddingCustomer(true);
    try {
      const payload = {
        firstName: newCust.firstName,
        lastName: newCust.lastName || '-',
        phone: newCust.phone,
        address: newCust.address,
        locality: newCust.locality,
        ...(newCust.altContact && { altContact: newCust.altContact }),
        ...(newCust.panNumber && { panNumber: newCust.panNumber }),
        ...(newCust.aadhaarLast4 && { aadhaarLast4: newCust.aadhaarLast4 }),
        ...(newCust.branchId && { branchId: newCust.branchId }),
      };
      if (editingCustomerId) {
        await updateCustomer(editingCustomerId, payload);
        const updated = await getCustomer(editingCustomerId);
        setSelectedCustomer(updated);
        setEditingCustomerId(null);
      } else {
        const result = await createCustomer(payload) as Customer;
        setSelectedCustomer(result);
      }
      setShowAddCustomer(false);
      setNewCust({ ...EMPTY_QUICK_ADD_CUSTOMER });
    } catch (e) {
      setAddCustError((e as Error).message);
    } finally {
      setAddingCustomer(false);
    }
  }

  function setF(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setPreview(null);
  }

  async function handlePreview() {
    const rateFilled = isPerDay ? form.interestPerDay : form.interestRate;
    if (!form.principal || !rateFilled || !form.termWeeks || !form.firstDueDate) {
      setPreviewError(isPerDay
        ? 'Fill principal, interest per ₹1,000/day, weeks and first due date'
        : 'Fill principal, interest rate, weeks and first due date');
      return;
    }
    setPreviewError('');
    setPreviewing(true);
    try {
      const p = await previewWeeklySchedule({
        principal: parseFloat(form.principal),
        interestRate: isPerDay ? 0 : parseFloat(form.interestRate),
        termWeeks: parseInt(form.termWeeks),
        firstDueDate: form.firstDueDate,
        calculationType: form.calculationType,
        emiRounding: parseInt(form.emiRounding),
        ...(isPerDay && { interestPerDay: parseFloat(form.interestPerDay) }),
      });
      setPreview(p);
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  function handleFile(file: File, setB64: (s: string) => void, setFile: (f: File) => void) {
    if (file.size > 10 * 1024 * 1024) return;
    setFile(file);
    const reader = new FileReader();
    reader.onload = () => setB64(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!selectedCustomer || !preview) return;
    setSubmitError('');
    setSubmitting(true);
    try {
      const result = await createWeeklyLoan({
        customerId: selectedCustomer.id,
        principal: parseFloat(form.principal),
        interestRate: isPerDay ? 0 : parseFloat(form.interestRate),
        termWeeks: parseInt(form.termWeeks),
        firstDueDate: form.firstDueDate,
        calculationType: form.calculationType,
        emiRounding: parseInt(form.emiRounding),
        ...(isPerDay && { interestPerDay: parseFloat(form.interestPerDay) }),
        ...(form.purpose && { purpose: form.purpose }),
        ...(form.branchId && { branchId: form.branchId }),
        ...(weeklyTypeId && { loanTypeId: weeklyTypeId }),
        ...(securityB64 && { securityDocUrl: securityB64 }),
        ...(promissoryB64 && { promissoryNoteUrl: promissoryB64 }),
      });
      router.push(`/${subdomain}/weekly-loans/${result.id}`);
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href={`/${subdomain}/weekly-loans`} className="text-sm text-blue-600 hover:underline">← Back to Weekly Loans</Link>
        <h1 className="text-xl font-bold text-gray-900 mt-1">New Weekly Loan</h1>
      </div>

      {/* Step indicator */}
      <div className="flex gap-0">
        {[{ n: 1, label: 'Customer' }, { n: 2, label: 'Loan Terms' }, { n: 3, label: 'Documents' }].map(({ n, label }) => (
          <div key={n} className="flex-1 text-center">
            <div className={`h-1 mb-2 rounded-full ${step >= n ? 'bg-blue-600' : 'bg-gray-200'}`} />
            <span className={`text-xs font-medium ${step === n ? 'text-blue-700' : 'text-gray-400'}`}>
              {n}. {label}
            </span>
          </div>
        ))}
      </div>

      {/* ── STEP 1: Customer ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Select Customer</h2>

            {selectedCustomer ? (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div>
                  <p className="font-semibold text-gray-900">{selectedCustomer.firstName} {selectedCustomer.lastName}</p>
                  <p className="text-sm text-gray-500">{selectedCustomer.phone} · {selectedCustomer.customerCode}</p>
                </div>
                <button onClick={handleChangeCustomer} className="text-xs text-red-500 hover:underline">Change</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <input
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search by name, phone or customer code…"
                    className={inputCls}
                    autoFocus
                  />
                  {searching && <span className="absolute right-3 top-2.5 text-xs text-gray-400">Searching…</span>}
                </div>

                {customerResults.length > 0 && (
                  <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setCustomerResults([]); }}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors"
                      >
                        <p className="font-medium text-gray-900 text-sm">{c.firstName} {c.lastName}</p>
                        <p className="text-xs text-gray-400">{c.phone} · {c.customerCode}</p>
                      </button>
                    ))}
                  </div>
                )}

                {customerSearch.length > 2 && customerResults.length === 0 && !searching && (
                  <p className="text-sm text-gray-500 mt-2">No customers found. <button onClick={() => { setEditingCustomerId(null); setNewCust({ ...EMPTY_QUICK_ADD_CUSTOMER }); setAddCustError(''); setShowAddCustomer(true); }} className="text-blue-600 hover:underline">Add new customer</button></p>
                )}
              </>
            )}

            {!selectedCustomer && (
              <button
                onClick={() => {
                  if (showAddCustomer) {
                    setShowAddCustomer(false);
                    setEditingCustomerId(null);
                    setNewCust({ ...EMPTY_QUICK_ADD_CUSTOMER });
                    setAddCustError('');
                  } else {
                    setEditingCustomerId(null);
                    setNewCust({ ...EMPTY_QUICK_ADD_CUSTOMER });
                    setAddCustError('');
                    setShowAddCustomer(true);
                  }
                }}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                {showAddCustomer ? '▲ Hide' : '+ Add new customer'}
              </button>
            )}

            {showAddCustomer && !selectedCustomer && (
              <div className="mt-4 border-t pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  {editingCustomerId ? 'Edit Customer' : 'Quick Add Customer'}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">First Name <span className="text-red-500">*</span></label>
                    <input value={newCust.firstName} onChange={(e) => setNewCust({ ...newCust, firstName: sanitizeNameInput(e.target.value) })} className={inputCls} placeholder="Ravi" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                    <input value={newCust.lastName} onChange={(e) => setNewCust({ ...newCust, lastName: sanitizeNameInput(e.target.value) })} className={inputCls} placeholder="Kumar" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Phone <span className="text-red-500">*</span></label>
                    <input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value.replace(/\D/g,'').slice(0,10) })} className={inputCls} placeholder="9876543210" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Alt. Contact <span className="text-xs text-gray-400 font-normal">(optional)</span></label>
                    <input value={newCust.altContact} onChange={(e) => setNewCust({ ...newCust, altContact: e.target.value.replace(/\D/g,'').slice(0,10) })} className={inputCls} placeholder="9876543210" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Address <span className="text-red-500">*</span></label>
                    <input value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} className={inputCls} placeholder="Plot 12, Main Road" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Locality <span className="text-red-500">*</span></label>
                    <input value={newCust.locality} onChange={(e) => setNewCust({ ...newCust, locality: sanitizeLocalityInput(e.target.value) })} className={inputCls} placeholder="Anna Nagar" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">PAN <span className="text-xs text-gray-400">(or Aadhaar)</span></label>
                    <input value={newCust.panNumber} onChange={(e) => setNewCust({ ...newCust, panNumber: sanitizePanInput(e.target.value) })} className={inputCls} placeholder="ABCDE1234F" maxLength={10} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Aadhaar Last 4</label>
                    <input value={newCust.aadhaarLast4} onChange={(e) => setNewCust({ ...newCust, aadhaarLast4: e.target.value.replace(/\D/g,'').slice(0,4) })} className={inputCls} placeholder="1234" maxLength={4} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Branch</label>
                    <select value={newCust.branchId} onChange={(e) => setNewCust({ ...newCust, branchId: e.target.value })} className={inputCls}>
                      <option value="">No specific branch</option>
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    {branches.length === 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        No branches yet — <Link href={`/${subdomain}/settings`} target="_blank" className="text-blue-600 hover:underline">add one in Settings →</Link>
                      </p>
                    )}
                  </div>
                </div>
                {addCustError && (
                  <ul className="text-xs text-red-600 list-disc list-inside space-y-0.5">
                    {addCustError.split('\n').map((line) => <li key={line}>{line}</li>)}
                  </ul>
                )}
                <button onClick={handleAddCustomer} disabled={addingCustomer}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
                  {addingCustomer ? 'Saving…' : editingCustomerId ? 'Save Customer' : 'Add & Select Customer'}
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!selectedCustomer}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              Next: Loan Terms →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Loan Terms ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-xs text-blue-500 font-medium">Customer</span>
              <p className="font-semibold text-gray-900">{selectedCustomer?.firstName} {selectedCustomer?.lastName} · {selectedCustomer?.phone}</p>
            </div>
            <button onClick={() => setStep(1)} className="text-xs text-blue-600 hover:underline">Change</button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Loan Terms</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Principal Amount (₹) <span className="text-red-500">*</span></label>
                <input type="number" value={form.principal} onChange={(e) => setF('principal', e.target.value)} className={inputCls} placeholder="10000" min={1} />
              </div>
              <div>
                {isPerDay ? (
                  <>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Interest per ₹1,000 per day (₹) <span className="text-red-500">*</span></label>
                    <input type="number" step="0.01" value={form.interestPerDay} onChange={(e) => setF('interestPerDay', e.target.value)} className={inputCls} placeholder="3.19" min={0.01} max={10} />
                    <p className="text-xs text-gray-400 mt-1">
                      ≈ {(parseFloat(form.interestPerDay || '0') * 36.4).toFixed(2)}% p.a. flat
                    </p>
                  </>
                ) : (
                  <>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Interest Rate (% per annum) <span className="text-red-500">*</span></label>
                    <input type="number" step="0.01" value={form.interestRate} onChange={(e) => setF('interestRate', e.target.value)} className={inputCls} placeholder="24" min={0} max={200} />
                  </>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tenure (weeks) <span className="text-red-500">*</span></label>
                <input type="number" value={form.termWeeks} onChange={(e) => setF('termWeeks', e.target.value)} className={inputCls} placeholder="52" min={1} max={99} maxLength={2} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">First Installment Date <span className="text-red-500">*</span></label>
                <input type="date" value={form.firstDueDate} onChange={(e) => setF('firstDueDate', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Calculation Type</label>
                <select value={form.calculationType} onChange={(e) => setF('calculationType', e.target.value)} className={inputCls}>
                  <option value="REDUCING">Reducing Balance</option>
                  <option value="FLAT">Flat Rate</option>
                  <option value="PER_1000_PER_DAY">₹ per ₹1,000 per day</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">EMI Rounding</label>
                <select value={form.emiRounding} onChange={(e) => setF('emiRounding', e.target.value)} className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-400`} disabled={isPerDay}>
                  <option value="0">No rounding</option>
                  <option value="10">Round to nearest ₹10</option>
                  <option value="50">Round to nearest ₹50</option>
                  <option value="100">Round to nearest ₹100</option>
                </select>
                {isPerDay && <p className="text-xs text-gray-400 mt-1">EMI is rounded to the nearest ₹1 for this type</p>}
              </div>
              {branches.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Branch</label>
                  <select value={form.branchId} onChange={(e) => setF('branchId', e.target.value)} className={inputCls}>
                    <option value="">No specific branch</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                  </select>
                  {branches.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      No branches yet — <Link href={`/${subdomain}/settings`} target="_blank" className="text-blue-600 hover:underline">add one in Settings →</Link>
                    </p>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Loan Purpose</label>
                <input value={form.purpose} onChange={(e) => setF('purpose', sanitizeLoanPurposeInput(e.target.value))} className={inputCls} placeholder="Agriculture, Business…" />
              </div>
            </div>

            <div className="pt-2">
              {previewError && <p className="text-xs text-red-600 mb-2">{previewError}</p>}
              <button onClick={handlePreview} disabled={previewing}
                className="px-4 py-2 border border-blue-500 text-blue-700 bg-blue-50 hover:bg-blue-100 text-sm font-medium rounded-lg disabled:opacity-60">
                {previewing ? 'Computing…' : '⚙ Preview Schedule'}
              </button>
            </div>

            {preview && (
              <div className="border-t pt-4 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Weekly EMI', value: fmt(preview.emi), color: 'text-blue-700' },
                    { label: 'Total Interest', value: fmt(preview.totalInterest), color: 'text-orange-600' },
                    { label: 'Total Payable', value: fmt(preview.totalPayable), color: 'text-gray-900' },
                    { label: 'Effective Rate', value: `${(preview.weeklyRate * 52 * 100).toFixed(2)}% p.a.`, color: 'text-gray-600' },
                  ].map((s) => (
                    <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                <details className="text-xs">
                  <summary className="cursor-pointer text-blue-600 hover:underline font-medium">Show schedule ({preview.schedule.length} installments)</summary>
                  <div className="mt-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {['#', 'Due Date', 'Principal', 'Interest', 'EMI', 'Outstanding'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.schedule.map((s) => (
                          <tr key={s.number} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 text-gray-500">{s.number}</td>
                            <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{fmtDate(s.dueDate)}</td>
                            <td className="px-3 py-1.5 text-gray-700">{fmt(s.principalAmount)}</td>
                            <td className="px-3 py-1.5 text-gray-500">{fmt(s.interestAmount)}</td>
                            <td className="px-3 py-1.5 font-medium text-gray-900">{fmt(s.totalAmount)}</td>
                            <td className="px-3 py-1.5 text-gray-500">{fmt(s.principalOutstanding)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            )}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">← Back</button>
            <button
              onClick={() => { if (!preview) { handlePreview(); } else { setStep(3); } }}
              disabled={previewing}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              {preview ? 'Next: Documents →' : previewing ? 'Computing…' : 'Preview Schedule first'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Documents ── */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Loan Summary</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {[
                { label: 'Customer', value: `${selectedCustomer?.firstName} ${selectedCustomer?.lastName}` },
                { label: 'Principal', value: fmt(parseFloat(form.principal || '0')) },
                { label: 'Weekly EMI', value: preview ? fmt(preview.emi) : '—' },
                { label: 'Tenure', value: `${form.termWeeks} weeks` },
                {
                  label: 'Interest Rate',
                  value: isPerDay
                    ? `₹${form.interestPerDay} per ₹1,000/day (${(parseFloat(form.interestPerDay || '0') * 36.4).toFixed(2)}% p.a. flat)`
                    : `${form.interestRate}% p.a. (${form.calculationType})`,
                },
                { label: 'Total Payable', value: preview ? fmt(preview.totalPayable) : '—' },
                { label: 'First Installment', value: fmtDate(form.firstDueDate) },
                { label: 'Branch', value: branches.find((b) => b.id === form.branchId)?.name || 'Not specified' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between border-b border-gray-50 pb-1">
                  <span className="text-gray-400">{label}</span>
                  <span className="font-medium text-gray-900 text-right">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Documents <span className="text-gray-400 font-normal text-xs">(optional)</span></h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Security Document (PDF/Image, max 10 MB)</label>
              <input type="file" accept="image/*,application/pdf"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, setSecurityB64, setSecurityFile); }}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
              {securityFile && <p className="text-xs text-green-600 mt-1">{securityFile.name} ({(securityFile.size / 1024).toFixed(0)} KB)</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Promissory Note (PDF/Image, max 10 MB)</label>
              <input type="file" accept="image/*,application/pdf"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, setPromissoryB64, setPromissoryFile); }}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
              {promissoryFile && <p className="text-xs text-green-600 mt-1">{promissoryFile.name} ({(promissoryFile.size / 1024).toFixed(0)} KB)</p>}
            </div>
          </div>

          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{submitError}</div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">← Back</button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg"
            >
              {submitting ? 'Creating Loan…' : '✓ Create Weekly Loan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
