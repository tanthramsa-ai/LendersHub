'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  createTermLoan, previewTermLoanSchedule, getCustomers, getBranches, getLoanTypes,
  Customer, TenantBranch, LoanType, TermSchedulePreview,
  getTenantSession, LOAN_CREATE_ROLES,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

const ROUNDING_OPTIONS = [
  { value: 0,   label: 'No rounding (exact)' },
  { value: 10,  label: 'Round up to ₹10' },
  { value: 50,  label: 'Round up to ₹50' },
  { value: 100, label: 'Round up to ₹100' },
];

export default function NewTermLoanPage() {
  const router = useRouter();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const session = getTenantSession();
  if (!LOAN_CREATE_ROLES.includes(session?.user.role ?? 'VIEWER')) {
    router.replace(`/${subdomain}/dashboard`);
    return null;
  }

  // Step 1: Customer
  const [step, setStep] = useState(1);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [custLoading, setCustLoading] = useState(false);

  // Step 2: Loan details
  const [branchId, setBranchId] = useState('');
  const [loanTypeId, setLoanTypeId] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [firstDueDate, setFirstDueDate] = useState('');
  const [calculationType, setCalculationType] = useState<'REDUCING' | 'FLAT'>('REDUCING');
  const [emiRounding, setEmiRounding] = useState<0 | 10 | 50 | 100>(0);
  const [purpose, setPurpose] = useState('');
  const [securityDocUrl, setSecurityDocUrl] = useState('');
  const [promissoryNoteUrl, setPromissoryNoteUrl] = useState('');

  // Step 3: Preview
  const [preview, setPreview] = useState<TermSchedulePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loanTypes, setLoanTypes] = useState<LoanType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getBranches().then((b) => setBranches(b.filter((x) => x.isActive)));
    getLoanTypes().then((t) => setLoanTypes(t.filter((x) => x.isActive)));
    // default first due date = 1 month from today
    const d = new Date(); d.setMonth(d.getMonth() + 1);
    setFirstDueDate(d.toISOString().slice(0, 10));
  }, []);

  const searchCustomers = useCallback(async (q: string) => {
    if (q.length < 2) { setCustomers([]); return; }
    setCustLoading(true);
    try {
      const res = await getCustomers(1, 10, q);
      setCustomers(res.data);
    } finally { setCustLoading(false); }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchCustomers(customerSearch), 300);
    return () => clearTimeout(t);
  }, [customerSearch, searchCustomers]);

  const canPreview = !!(principal && interestRate && termMonths && firstDueDate && branchId);

  async function loadPreview() {
    if (!canPreview) return;
    setPreviewLoading(true);
    setError('');
    try {
      const p = await previewTermLoanSchedule({
        principal: parseFloat(principal), interestRate: parseFloat(interestRate),
        termMonths: parseInt(termMonths), firstDueDate,
        calculationType, emiRounding,
      });
      setPreview(p);
      setStep(3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally { setPreviewLoading(false); }
  }

  async function handleSubmit() {
    if (!selectedCustomer || !preview) return;
    setSubmitting(true); setError('');
    try {
      const res = await createTermLoan({
        customerId: selectedCustomer.id, branchId, loanTypeId: loanTypeId || undefined,
        principal: parseFloat(principal), interestRate: parseFloat(interestRate),
        termMonths: parseInt(termMonths), firstDueDate,
        calculationType, emiRounding,
        purpose: purpose || undefined,
        securityDocUrl: securityDocUrl || undefined,
        promissoryNoteUrl: promissoryNoteUrl || undefined,
      });
      router.push(`/${subdomain}/loans/${res.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create loan');
      setSubmitting(false);
    }
  }

  function handleFileUpload(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { setError('File must be under 10 MB'); return; }
      const reader = new FileReader();
      reader.onload = () => setter(reader.result as string);
      reader.readAsDataURL(file);
    };
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/${subdomain}/loans`} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">New Loan</h1>
          <p className="text-sm text-gray-500">EMI-based term loan · Principal + Interest</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {['Customer', 'Loan Details', 'Preview & Confirm'].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              step > i + 1 ? 'bg-green-500 text-white' : step === i + 1 ? 'text-white' : 'bg-gray-100 text-gray-400'
            }`} style={step === i + 1 ? { backgroundColor: BRAND } : {}}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-xs font-medium hidden sm:block ${step === i + 1 ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
            {i < 2 && <div className="w-8 h-px bg-gray-200 mx-1" />}
          </div>
        ))}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* Step 1: Customer */}
      {step === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Select Customer</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search by name or phone</label>
            <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder="Type customer name or phone number…"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {custLoading && <p className="text-sm text-gray-400">Searching…</p>}
          {customers.length > 0 && (
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
              {customers.map((c) => (
                <button key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerSearch(c.firstName + ' ' + c.lastName); setCustomers([]); }}
                  className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors">
                  <p className="font-medium text-gray-900 text-sm">{c.firstName} {c.lastName}</p>
                  <p className="text-xs text-gray-400">{c.phone}</p>
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="w-9 h-9 rounded-full bg-green-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {selectedCustomer.firstName[0]}
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm">{selectedCustomer.firstName} {selectedCustomer.lastName}</p>
                <p className="text-xs text-gray-500">{selectedCustomer.phone}</p>
              </div>
              <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(''); }}
                className="ml-auto text-gray-400 hover:text-red-500 text-xs">Change</button>
            </div>
          )}
          <div className="flex justify-end">
            <button disabled={!selectedCustomer} onClick={() => setStep(2)}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40 transition-colors hover:opacity-90"
              style={{ backgroundColor: BRAND }}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Loan details */}
      {step === 2 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
          <h2 className="font-semibold text-gray-900">Loan Details</h2>

          {/* Branch (mandatory) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch <span className="text-red-500">*</span></label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select branch…</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Principal Amount (₹) <span className="text-red-500">*</span></label>
              <input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)}
                placeholder="e.g. 100000" min="1"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Interest Rate (% p.a.) <span className="text-red-500">*</span></label>
              <input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)}
                placeholder="e.g. 18" step="0.1" min="0" max="100"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tenure (months) <span className="text-red-500">*</span></label>
              <input type="number" value={termMonths} onChange={(e) => setTermMonths(e.target.value)}
                placeholder="e.g. 12" min="1" max="360"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Due Date <span className="text-red-500">*</span></label>
              <input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Interest Calculation</label>
              <select value={calculationType} onChange={(e) => setCalculationType(e.target.value as 'REDUCING' | 'FLAT')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="REDUCING">Reducing Balance</option>
                <option value="FLAT">Flat Rate</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">EMI Rounding</label>
              <select value={emiRounding} onChange={(e) => setEmiRounding(Number(e.target.value) as 0 | 10 | 50 | 100)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {ROUNDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {loanTypes.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Loan Type</label>
                <select value={loanTypeId} onChange={(e) => setLoanTypeId(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select (optional)</option>
                  {loanTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Purpose</label>
              <input value={purpose} onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. Business expansion, Home renovation…"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Document uploads */}
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Documents</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Security Document</label>
                <input type="file" accept="image/*,application/pdf" onChange={handleFileUpload(setSecurityDocUrl)}
                  className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                {securityDocUrl && <p className="text-xs text-green-600 mt-1">✓ Uploaded</p>}
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Promissory Note</label>
                <input type="file" accept="image/*,application/pdf" onChange={handleFileUpload(setPromissoryNoteUrl)}
                  className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                {promissoryNoteUrl && <p className="text-xs text-green-600 mt-1">✓ Uploaded</p>}
              </div>
            </div>
          </div>

          {/* EMI preview inline */}
          {principal && interestRate && termMonths && (
            <div className="p-3 bg-blue-50 rounded-lg text-sm">
              {(() => {
                const p = parseFloat(principal), r = parseFloat(interestRate), t = parseInt(termMonths);
                if (!p || !r || !t) return null;
                const mr = r / 100 / 12;
                let emi = calculationType === 'FLAT'
                  ? (p + p * mr * t) / t
                  : mr === 0 ? p / t : (p * mr * Math.pow(1+mr, t)) / (Math.pow(1+mr, t) - 1);
                if (emiRounding > 0) emi = Math.ceil(emi / emiRounding) * emiRounding;
                return <span className="text-blue-800 font-medium">Estimated EMI: <strong>{fmt(emi)}</strong> / month</span>;
              })()}
            </div>
          )}

          <div className="flex justify-between pt-2">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">← Back</button>
            <button disabled={!canPreview || previewLoading} onClick={loadPreview}
              className="px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40 hover:opacity-90 transition-colors"
              style={{ backgroundColor: BRAND }}>
              {previewLoading ? 'Generating…' : 'Preview Schedule →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 3 && preview && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Schedule Preview</h2>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Monthly EMI', value: fmt(preview.emi), color: 'text-blue-700' },
                { label: 'Total Interest', value: fmt(preview.totalInterest), color: 'text-orange-600' },
                { label: 'Total Repayment', value: fmt(preview.totalAmount), color: 'text-gray-900' },
                { label: 'Installments', value: `${preview.schedule.length} months`, color: 'text-gray-700' },
              ].map((c) => (
                <div key={c.label} className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">{c.label}</p>
                  <p className={`text-base font-bold mt-0.5 ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>

            {/* Schedule table */}
            <div className="overflow-auto max-h-80 border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['#', 'Due Date', 'Principal', 'Interest', 'EMI', 'Balance'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(() => {
                    let balance = parseFloat(principal);
                    return preview.schedule.map((inst) => {
                      balance = Math.round((balance - inst.principalAmount) * 100) / 100;
                      return (
                        <tr key={inst.number} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-gray-400">{inst.number}</td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{inst.dueDate}</td>
                          <td className="px-3 py-2 font-medium text-gray-900">{fmt(inst.principalAmount)}</td>
                          <td className="px-3 py-2 text-orange-600">{fmt(inst.interestAmount)}</td>
                          <td className="px-3 py-2 font-bold text-blue-700">{fmt(inst.totalAmount)}</td>
                          <td className="px-3 py-2 text-gray-500">{fmt(Math.max(0, balance))}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          {/* Customer + loan summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <p className="text-sm font-semibold text-gray-900 mb-3">Loan Summary</p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-gray-500 text-xs">Customer</dt><dd className="font-medium">{selectedCustomer?.firstName} {selectedCustomer?.lastName}</dd></div>
              <div><dt className="text-gray-500 text-xs">Principal</dt><dd className="font-medium">{fmt(parseFloat(principal))}</dd></div>
              <div><dt className="text-gray-500 text-xs">EMI</dt><dd className="font-medium text-blue-700">{fmt(preview.emi)}</dd></div>
              <div><dt className="text-gray-500 text-xs">Rate</dt><dd className="font-medium">{interestRate}% p.a. {calculationType}</dd></div>
              <div><dt className="text-gray-500 text-xs">Term</dt><dd className="font-medium">{termMonths} months</dd></div>
              <div><dt className="text-gray-500 text-xs">First Due</dt><dd className="font-medium">{firstDueDate}</dd></div>
            </dl>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">← Edit Details</button>
            <button disabled={submitting} onClick={handleSubmit}
              className="px-6 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-40 hover:opacity-90 transition-colors"
              style={{ backgroundColor: BRAND }}>
              {submitting ? 'Creating Loan…' : 'Confirm & Disburse'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
