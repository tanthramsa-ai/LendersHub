'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getCustomers, createCustomer, getBranches, getLoanTypes,
  previewDailySchedule, createDailyLoan,
  Customer, TenantBranch, LoanType, DailySchedulePreview,
  getTenantSession, LOAN_CREATE_ROLES,
} from '@/services/tenant-api';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Step = 1 | 2 | 3;
type CycleType = 'DAILY_NO_SUNDAY' | 'DAILY_WITH_SUNDAY';

function nextCollectionDay(skipSunday: boolean): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (skipSunday && d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function NewDailyLoanPage() {
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
  const [newCust, setNewCust] = useState({ firstName: '', lastName: '', phone: '', address: '', locality: '', altContact: '', panNumber: '', aadhaarLast4: '' });
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [addCustError, setAddCustError] = useState('');

  // Step 2: Loan Terms
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loanTypes, setLoanTypes] = useState<LoanType[]>([]);
  const [dailyTypeId, setDailyTypeId] = useState('');
  const [form, setForm] = useState({
    branchId: '', purpose: '',
    principal: '', interestRate: '', termDays: '',
    firstDueDate: '',
    cycleType: 'DAILY_NO_SUNDAY' as CycleType,
    calculationType: 'FLAT' as 'REDUCING' | 'FLAT',
    emiRounding: '0',
  });
  const [preview, setPreview] = useState<DailySchedulePreview | null>(null);
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
    getBranches().then((b) => setBranches(b.filter((br) => br.isActive)));
    getLoanTypes().then((lt) => {
      setLoanTypes(lt.filter((t) => t.isActive));
      const daily = lt.find((t) => t.name.toLowerCase().includes('daily'));
      if (daily) setDailyTypeId(daily.id);
    });
    setForm((f) => ({ ...f, firstDueDate: nextCollectionDay(true) }));
  }, []);

  // Update first due date when cycle type changes
  function handleCycleChange(ct: CycleType) {
    setF('cycleType', ct);
    setF('firstDueDate', nextCollectionDay(ct === 'DAILY_NO_SUNDAY'));
    setPreview(null);
  }

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

  async function handleAddCustomer() {
    if (!newCust.firstName || !newCust.phone || !newCust.address || !newCust.locality || !newCust.altContact) {
      setAddCustError('First name, phone, address, locality and alternate contact are required');
      return;
    }
    if (!newCust.panNumber && !newCust.aadhaarLast4) {
      setAddCustError('At least PAN or Aadhaar number is required');
      return;
    }
    setAddCustError('');
    setAddingCustomer(true);
    try {
      const result = await createCustomer({
        firstName: newCust.firstName, lastName: newCust.lastName || '-',
        phone: newCust.phone, address: newCust.address, locality: newCust.locality,
        altContact: newCust.altContact,
        ...(newCust.panNumber && { panNumber: newCust.panNumber }),
        ...(newCust.aadhaarLast4 && { aadhaarLast4: newCust.aadhaarLast4 }),
      }) as Customer;
      setSelectedCustomer(result);
      setShowAddCustomer(false);
    } catch (e) {
      setAddCustError((e as Error).message);
    } finally { setAddingCustomer(false); }
  }

  function setF(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    if (field !== 'cycleType' && field !== 'firstDueDate') setPreview(null);
  }

  async function handlePreview() {
    if (!form.principal || !form.interestRate || !form.termDays || !form.firstDueDate) {
      setPreviewError('Fill principal, interest rate, tenure and first due date');
      return;
    }
    setPreviewError('');
    setPreviewing(true);
    try {
      const p = await previewDailySchedule({
        principal: parseFloat(form.principal),
        interestRate: parseFloat(form.interestRate),
        termDays: parseInt(form.termDays),
        firstDueDate: form.firstDueDate,
        cycleType: form.cycleType,
        calculationType: form.calculationType,
        emiRounding: parseInt(form.emiRounding),
      });
      setPreview(p);
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally { setPreviewing(false); }
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
      const result = await createDailyLoan({
        customerId: selectedCustomer.id,
        principal: parseFloat(form.principal),
        interestRate: parseFloat(form.interestRate),
        termDays: parseInt(form.termDays),
        firstDueDate: form.firstDueDate,
        cycleType: form.cycleType,
        calculationType: form.calculationType,
        emiRounding: parseInt(form.emiRounding),
        ...(form.purpose && { purpose: form.purpose }),
        ...(form.branchId && { branchId: form.branchId }),
        ...(dailyTypeId && { loanTypeId: dailyTypeId }),
        ...(securityB64 && { securityDocUrl: securityB64 }),
        ...(promissoryB64 && { promissoryNoteUrl: promissoryB64 }),
      });
      router.push(`/${subdomain}/daily-loans/${result.id}`);
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <Link href={`/${subdomain}/daily-loans`} className="text-sm text-blue-600 hover:underline">← Back to Daily Loans</Link>
        <h1 className="text-xl font-bold text-gray-900 mt-1">New Daily Loan</h1>
      </div>

      {/* Step indicator */}
      <div className="flex gap-0">
        {[{ n: 1, label: 'Customer' }, { n: 2, label: 'Loan Terms' }, { n: 3, label: 'Documents' }].map(({ n, label }) => (
          <div key={n} className="flex-1 text-center">
            <div className={`h-1 mb-2 rounded-full ${step >= n ? 'bg-blue-600' : 'bg-gray-200'}`} />
            <span className={`text-xs font-medium ${step === n ? 'text-blue-700' : 'text-gray-400'}`}>{n}. {label}</span>
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
                <button onClick={() => setSelectedCustomer(null)} className="text-xs text-red-500 hover:underline">Change</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
                    placeholder="Search by name, phone or customer code…" className={inputCls} autoFocus />
                  {searching && <span className="absolute right-3 top-2.5 text-xs text-gray-400">Searching…</span>}
                </div>
                {customerResults.length > 0 && (
                  <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100">
                    {customerResults.map((c) => (
                      <button key={c.id}
                        onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setCustomerResults([]); }}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors">
                        <p className="font-medium text-gray-900 text-sm">{c.firstName} {c.lastName}</p>
                        <p className="text-xs text-gray-400">{c.phone} · {c.customerCode}</p>
                      </button>
                    ))}
                  </div>
                )}
                {customerSearch.length > 2 && customerResults.length === 0 && !searching && (
                  <p className="text-sm text-gray-500 mt-2">No customers found. <button onClick={() => setShowAddCustomer(true)} className="text-blue-600 hover:underline">Add new</button></p>
                )}
              </>
            )}

            {!selectedCustomer && (
              <button onClick={() => setShowAddCustomer(!showAddCustomer)} className="mt-3 text-sm text-blue-600 hover:underline">
                {showAddCustomer ? '▲ Hide' : '+ Add new customer'}
              </button>
            )}

            {showAddCustomer && !selectedCustomer && (
              <div className="mt-4 border-t pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Quick Add Customer</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">First Name <span className="text-red-500">*</span></label>
                    <input value={newCust.firstName} onChange={(e) => setNewCust({ ...newCust, firstName: e.target.value })} className={inputCls} placeholder="Ravi" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
                    <input value={newCust.lastName} onChange={(e) => setNewCust({ ...newCust, lastName: e.target.value })} className={inputCls} placeholder="Kumar" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Phone <span className="text-red-500">*</span></label>
                    <input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value.replace(/\D/g,'').slice(0,10) })} className={inputCls} placeholder="9876543210" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Alt. Contact <span className="text-red-500">*</span></label>
                    <input value={newCust.altContact} onChange={(e) => setNewCust({ ...newCust, altContact: e.target.value.replace(/\D/g,'').slice(0,10) })} className={inputCls} placeholder="9876543210" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Address <span className="text-red-500">*</span></label>
                    <input value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} className={inputCls} placeholder="Plot 12, Main Road" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Locality <span className="text-red-500">*</span></label>
                    <input value={newCust.locality} onChange={(e) => setNewCust({ ...newCust, locality: e.target.value })} className={inputCls} placeholder="Anna Nagar" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">PAN <span className="text-xs text-gray-400">(or Aadhaar)</span></label>
                    <input value={newCust.panNumber} onChange={(e) => setNewCust({ ...newCust, panNumber: e.target.value.toUpperCase() })} className={inputCls} placeholder="ABCDE1234F" maxLength={10} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Aadhaar Last 4</label>
                    <input value={newCust.aadhaarLast4} onChange={(e) => setNewCust({ ...newCust, aadhaarLast4: e.target.value.replace(/\D/g,'').slice(0,4) })} className={inputCls} placeholder="1234" maxLength={4} />
                  </div>
                </div>
                {addCustError && <p className="text-xs text-red-600">{addCustError}</p>}
                <button onClick={handleAddCustomer} disabled={addingCustomer}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
                  {addingCustomer ? 'Adding…' : 'Add & Select Customer'}
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setStep(2)} disabled={!selectedCustomer}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
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

            {/* Cycle type — prominent selector */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Collection Cycle <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: 'DAILY_NO_SUNDAY', label: 'Daily (No Sunday)', desc: 'Mon–Sat collection' },
                  { value: 'DAILY_WITH_SUNDAY', label: 'Daily (All Days)', desc: 'Mon–Sun, 7 days/week' },
                ] as { value: CycleType; label: string; desc: string }[]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleCycleChange(opt.value)}
                    className={`text-left px-4 py-3 rounded-lg border-2 transition-colors ${form.cycleType === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <p className={`text-sm font-semibold ${form.cycleType === opt.value ? 'text-blue-700' : 'text-gray-700'}`}>{opt.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Principal Amount (₹) <span className="text-red-500">*</span></label>
                <input type="number" value={form.principal} onChange={(e) => setF('principal', e.target.value)} className={inputCls} placeholder="10000" min={1} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Interest Rate (% per annum) <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" value={form.interestRate} onChange={(e) => setF('interestRate', e.target.value)} className={inputCls} placeholder="36" min={0} max={200} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tenure (days) <span className="text-red-500">*</span></label>
                <input type="number" value={form.termDays} onChange={(e) => setF('termDays', e.target.value)} className={inputCls} placeholder="100" min={1} max={3650} />
                <p className="text-xs text-gray-400 mt-1">
                  {form.termDays && form.cycleType === 'DAILY_NO_SUNDAY'
                    ? `≈ ${Math.ceil(parseInt(form.termDays) * 7 / 6)} calendar days (excl. Sundays)`
                    : form.termDays ? `= ${form.termDays} calendar days` : ''}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">First Installment Date <span className="text-red-500">*</span></label>
                <input type="date" value={form.firstDueDate} onChange={(e) => setF('firstDueDate', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Calculation Type</label>
                <select value={form.calculationType} onChange={(e) => setF('calculationType', e.target.value)} className={inputCls}>
                  <option value="FLAT">Flat Rate (common for daily)</option>
                  <option value="REDUCING">Reducing Balance</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">EMI Rounding</label>
                <select value={form.emiRounding} onChange={(e) => setF('emiRounding', e.target.value)} className={inputCls}>
                  <option value="0">No rounding</option>
                  <option value="10">Round to nearest ₹10</option>
                  <option value="50">Round to nearest ₹50</option>
                  <option value="100">Round to nearest ₹100</option>
                </select>
              </div>
              {branches.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Branch</label>
                  <select value={form.branchId} onChange={(e) => setF('branchId', e.target.value)} className={inputCls}>
                    <option value="">No specific branch</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Loan Purpose</label>
                <input value={form.purpose} onChange={(e) => setF('purpose', e.target.value)} className={inputCls} placeholder="Agriculture, Business…" />
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
                    { label: 'Daily EMI', value: fmt(preview.emi), color: 'text-blue-700' },
                    { label: 'Total Interest', value: fmt(preview.totalInterest), color: 'text-orange-600' },
                    { label: 'Total Payable', value: fmt(preview.totalPayable), color: 'text-gray-900' },
                    { label: 'Daily Rate', value: `${(preview.dailyRate * 100).toFixed(4)}%`, color: 'text-gray-600' },
                  ].map((s) => (
                    <div key={s.label} className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                <details className="text-xs">
                  <summary className="cursor-pointer text-blue-600 hover:underline font-medium">
                    Show schedule ({preview.schedule.length} installments
                    {form.cycleType === 'DAILY_NO_SUNDAY' ? ', Sundays skipped' : ''})
                  </summary>
                  <div className="mt-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          {['#', 'Due Date', 'Day', 'Principal', 'Interest', 'EMI'].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {preview.schedule.map((s) => {
                          const day = new Date(s.dueDate).toLocaleDateString('en-IN', { weekday: 'short' });
                          return (
                            <tr key={s.number} className="hover:bg-gray-50">
                              <td className="px-3 py-1.5 text-gray-500">{s.number}</td>
                              <td className="px-3 py-1.5 text-gray-700 whitespace-nowrap">{fmtDate(s.dueDate)}</td>
                              <td className="px-3 py-1.5 text-gray-400">{day}</td>
                              <td className="px-3 py-1.5 text-gray-700">{fmt(s.principalAmount)}</td>
                              <td className="px-3 py-1.5 text-gray-500">{fmt(s.interestAmount)}</td>
                              <td className="px-3 py-1.5 font-medium text-gray-900">{fmt(s.totalAmount)}</td>
                            </tr>
                          );
                        })}
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
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Loan Summary</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {[
                { label: 'Customer', value: `${selectedCustomer?.firstName} ${selectedCustomer?.lastName}` },
                { label: 'Principal', value: fmt(parseFloat(form.principal || '0')) },
                { label: 'Daily EMI', value: preview ? fmt(preview.emi) : '—' },
                { label: 'Tenure', value: `${form.termDays} days` },
                { label: 'Cycle', value: form.cycleType === 'DAILY_NO_SUNDAY' ? 'Daily (No Sunday)' : 'Daily (All Days)' },
                { label: 'Interest Rate', value: `${form.interestRate}% p.a. (${form.calculationType})` },
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
            <button onClick={handleSubmit} disabled={submitting}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg">
              {submitting ? 'Creating Loan…' : '✓ Create Daily Loan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
