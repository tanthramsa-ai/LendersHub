'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { createLoan, getCustomers, Customer } from '@/services/tenant-api';

const BRAND = '#0F4C81';
const ACCENT = '#FF6B35';

const STEPS = ['Application', 'Review', 'Approval', 'Disbursement'];

function calcEmi(principal: number, annualRate: number, months: number): number {
  if (!principal || !months) return 0;
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildSchedulePreview(principal: number, annualRate: number, termMonths: number, firstDueDateStr: string) {
  if (!principal || !termMonths) return [];
  const monthlyRate = annualRate / 100 / 12;
  const emi = calcEmi(principal, annualRate, termMonths);
  let balance = principal;
  const rows = [];
  const start = firstDueDateStr ? new Date(firstDueDateStr) : new Date(Date.now() + 30 * 86400000);

  for (let i = 1; i <= Math.min(termMonths, 5); i++) {
    const interest = balance * monthlyRate;
    const principalAmt = i < termMonths ? emi - interest : balance;
    const total = principalAmt + interest;
    balance -= principalAmt;
    const due = new Date(start);
    due.setMonth(due.getMonth() + (i - 1));
    rows.push({
      num: i,
      due: fmtDate(due),
      principal: Math.round(principalAmt * 100) / 100,
      interest: Math.round(interest * 100) / 100,
      total: Math.round(total * 100) / 100,
      balance: Math.max(0, Math.round(balance * 100) / 100),
    });
  }
  return rows;
}

export default function NewLoanPage() {
  const router = useRouter();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const [loanType, setLoanType] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
  const [form, setForm] = useState({
    principal: '',
    interestRate: '',
    termMonths: '',
    purpose: '',
    firstDueDate: '',
  });
  const [uploadedDocs, setUploadedDocs] = useState<string[]>([]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const emi = calcEmi(Number(form.principal), Number(form.interestRate), Number(form.termMonths));
  const totalRepayment = emi * Number(form.termMonths);
  const totalInterest = totalRepayment - Number(form.principal);
  const schedulePreview = buildSchedulePreview(
    Number(form.principal),
    Number(form.interestRate),
    Number(form.termMonths),
    form.firstDueDate,
  );

  const searchCustomers = useCallback(async (q: string) => {
    try {
      const res = await getCustomers(1, 10, q);
      setCustomers(res.data);
    } catch {
      setCustomers([]);
    }
  }, []);

  useEffect(() => {
    if (customerSearch.length >= 2) {
      searchCustomers(customerSearch);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  }, [customerSearch, searchCustomers]);

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setCustomerSearch(`${c.firstName} ${c.lastName} — ${c.phone}`);
    setShowDropdown(false);
  }

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setUploadedDocs((prev) => [...prev, ...files.map((f) => f.name)]);
    e.target.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer) { setError('Please select a customer'); return; }
    setError('');
    setLoading(true);
    try {
      const loan = await createLoan({
        customerId: selectedCustomer.id,
        principal: Number(form.principal),
        interestRate: Number(form.interestRate),
        termMonths: Number(form.termMonths),
        purpose: form.purpose || undefined,
        firstDueDate: form.firstDueDate || undefined,
      }) as { id: string };
      router.push(`/tenant/${subdomain}/loans/${loan.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 bg-white text-gray-900 placeholder-gray-400';

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
        <Link href={`/tenant/${subdomain}/dashboard`} className="hover:text-gray-600">Dashboard</Link>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <Link href={`/tenant/${subdomain}/loans`} className="hover:text-gray-600">Loans</Link>
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="text-gray-700 font-medium">New Application</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">New Loan Application</h1>
        <p className="text-sm text-gray-500 mt-0.5">Fill in the details to create a new loan application</p>
      </div>

      {/* Step indicator */}
      <div className="mb-6 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-0">
          {STEPS.map((step, idx) => (
            <div key={step} className="flex items-center flex-1">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{
                    backgroundColor: idx === 0 ? BRAND : '#E5E7EB',
                    color: idx === 0 ? 'white' : '#9CA3AF',
                  }}
                >
                  {idx === 0 ? '✓' : idx + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${idx === 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                  {step}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mx-2" style={{ backgroundColor: '#E5E7EB' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: form */}
        <div className="lg:col-span-2 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Customer Selection */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full text-xs font-bold text-white flex items-center justify-center" style={{ backgroundColor: BRAND }}>1</span>
                Customer Information
              </h2>
              <div className="relative">
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Search Customer *</label>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      if (selectedCustomer) setSelectedCustomer(null);
                    }}
                    placeholder="Type name or phone number…"
                    className={`${inputCls} pl-9`}
                    required={!selectedCustomer}
                  />
                </div>
                {showDropdown && customers.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                    {customers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomer(c)}
                        className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: BRAND }}>
                            {c.firstName[0]}{c.lastName[0]}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</p>
                            <p className="text-xs text-gray-400">{c.customerCode} · {c.phone}</p>
                          </div>
                          {c.creditScore && (
                            <div className="ml-auto">
                              <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                                Score: {c.creditScore}
                              </span>
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedCustomer && (
                <div className="mt-3 p-4 rounded-xl border" style={{ backgroundColor: `${BRAND}08`, borderColor: `${BRAND}30` }}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0" style={{ backgroundColor: BRAND }}>
                      {selectedCustomer.firstName[0]}{selectedCustomer.lastName[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">{selectedCustomer.firstName} {selectedCustomer.lastName}</p>
                      <p className="text-xs text-gray-500">{selectedCustomer.customerCode} · {selectedCustomer.phone}</p>
                      {selectedCustomer.city && <p className="text-xs text-gray-400">{selectedCustomer.city}, {selectedCustomer.state}</p>}
                    </div>
                    {selectedCustomer.creditScore && (
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-gray-500">Credit Score</p>
                        <p className="text-2xl font-bold" style={{ color: BRAND }}>{selectedCustomer.creditScore}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-3">
                <Link href={`/tenant/${subdomain}/customers/new`} className="text-xs font-medium hover:underline flex items-center gap-1" style={{ color: BRAND }}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Add new customer
                </Link>
              </div>
            </div>

            {/* Loan Type */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full text-xs font-bold text-white flex items-center justify-center" style={{ backgroundColor: BRAND }}>2</span>
                Loan Type & Repayment
              </h2>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {(['daily', 'weekly', 'monthly'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setLoanType(t)}
                    className="relative py-3 px-4 rounded-xl border-2 text-sm font-semibold transition-all capitalize"
                    style={loanType === t
                      ? { borderColor: BRAND, backgroundColor: `${BRAND}10`, color: BRAND }
                      : { borderColor: '#E5E7EB', color: '#6B7280' }
                    }
                  >
                    {loanType === t && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: BRAND }} />
                    )}
                    {t === 'daily' && (
                      <svg className="w-5 h-5 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                    )}
                    {t === 'weekly' && (
                      <svg className="w-5 h-5 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    )}
                    {t === 'monthly' && (
                      <svg className="w-5 h-5 mx-auto mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    )}
                    {t}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Principal Amount (₹) *</label>
                  <input
                    type="number"
                    value={form.principal}
                    onChange={(e) => set('principal', e.target.value)}
                    required
                    min={1}
                    placeholder="50,000"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Annual Interest Rate (%) *</label>
                  <input
                    type="number"
                    value={form.interestRate}
                    onChange={(e) => set('interestRate', e.target.value)}
                    required
                    min={0}
                    max={100}
                    step={0.01}
                    placeholder="18"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Term ({loanType === 'daily' ? 'days' : loanType === 'weekly' ? 'weeks' : 'months'}) *
                  </label>
                  <input
                    type="number"
                    value={form.termMonths}
                    onChange={(e) => set('termMonths', e.target.value)}
                    required
                    min={1}
                    max={360}
                    placeholder={loanType === 'monthly' ? '12' : loanType === 'weekly' ? '52' : '365'}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">First Due Date</label>
                  <input
                    type="date"
                    value={form.firstDueDate}
                    onChange={(e) => set('firstDueDate', e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Loan Purpose</label>
                  <select value={form.purpose} onChange={(e) => set('purpose', e.target.value)} className={inputCls}>
                    <option value="">Select purpose</option>
                    {['Personal', 'Business', 'Agriculture', 'Education', 'Medical', 'Home Improvement', 'Vehicle', 'Wedding', 'Other'].map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Documents */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full text-xs font-bold text-white flex items-center justify-center" style={{ backgroundColor: BRAND }}>3</span>
                Document Upload
                <span className="text-xs font-normal text-gray-400">(optional)</span>
              </h2>

              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
                <input type="file" className="sr-only" multiple onChange={handleDocUpload} accept=".pdf,.jpg,.jpeg,.png" />
                <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm text-gray-500">Drop files or <span className="font-medium" style={{ color: BRAND }}>browse</span></p>
                <p className="text-xs text-gray-400 mt-0.5">PDF, JPG, PNG up to 10MB</p>
              </label>

              {uploadedDocs.length > 0 && (
                <div className="mt-3 space-y-2">
                  {uploadedDocs.map((doc, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 bg-green-50 rounded-lg">
                      <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-xs text-green-700 truncate">{doc}</span>
                      <button
                        type="button"
                        onClick={() => setUploadedDocs((d) => d.filter((_, j) => j !== i))}
                        className="ml-auto text-green-500 hover:text-red-500 flex-shrink-0"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2">
                {['Aadhaar Card', 'PAN Card', 'Bank Statement', 'Income Proof', 'Address Proof', 'Photo'].map((doc) => (
                  <div key={doc} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <svg className="w-3 h-3 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" /></svg>
                    {doc}
                  </div>
                ))}
              </div>
            </div>

            {/* Agent Assignment */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full text-xs font-bold text-white flex items-center justify-center" style={{ backgroundColor: BRAND }}>4</span>
                Agent Assignment
                <span className="text-xs font-normal text-gray-400">(optional)</span>
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { name: 'Ravi Kumar', area: 'North Zone', loans: 28 },
                  { name: 'Priya Sharma', area: 'South Zone', loans: 35 },
                  { name: 'Amit Singh', area: 'East Zone', loans: 22 },
                  { name: 'Sunita Patel', area: 'West Zone', loans: 41 },
                ].map((agent) => (
                  <button
                    key={agent.name}
                    type="button"
                    className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-100 hover:border-blue-200 text-left transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: ACCENT }}>
                      {agent.name.split(' ').map((n) => n[0]).join('')}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{agent.name}</p>
                      <p className="text-xs text-gray-400">{agent.area} · {agent.loans} loans</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {error}
              </div>
            )}

            <div className="flex justify-between gap-3 pt-2">
              <Link
                href={`/tenant/${subdomain}/loans`}
                className="px-5 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || !selectedCustomer}
                className="px-6 py-2.5 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60 flex items-center gap-2"
                style={{ backgroundColor: BRAND }}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Creating…
                  </>
                ) : 'Submit Application'}
              </button>
            </div>
          </form>
        </div>

        {/* Right: EMI Calculator */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 sticky top-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-800">EMI Calculator</h2>

            {emi > 0 ? (
              <>
                {/* EMI highlight */}
                <div className="rounded-xl p-4 text-center" style={{ backgroundColor: `${BRAND}08` }}>
                  <p className="text-xs font-medium mb-1" style={{ color: BRAND }}>Monthly EMI</p>
                  <p className="text-3xl font-bold" style={{ color: BRAND }}>{fmtCurrency(emi)}</p>
                </div>

                {/* Breakdown */}
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Principal</span>
                    <span className="font-semibold text-gray-900">{fmtCurrency(Number(form.principal))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Interest</span>
                    <span className="font-semibold" style={{ color: ACCENT }}>{fmtCurrency(totalInterest)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-gray-800 font-medium">Total Repayment</span>
                    <span className="font-bold text-gray-900">{fmtCurrency(totalRepayment)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">No. of EMIs</span>
                    <span className="font-semibold text-gray-900">{form.termMonths}</span>
                  </div>
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex text-xs text-gray-400 justify-between mb-1">
                    <span>Principal {Math.round((Number(form.principal) / totalRepayment) * 100)}%</span>
                    <span>Interest {Math.round((totalInterest / totalRepayment) * 100)}%</span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden flex">
                    <div className="h-full rounded-l-full" style={{ width: `${(Number(form.principal) / totalRepayment) * 100}%`, backgroundColor: BRAND }} />
                    <div className="h-full flex-1 rounded-r-full" style={{ backgroundColor: ACCENT }} />
                  </div>
                </div>

                {/* Installment preview */}
                {schedulePreview.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      First {schedulePreview.length} Installments
                    </p>
                    <div className="rounded-xl overflow-hidden border border-gray-100">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50">
                            <th className="px-2.5 py-2 text-left text-gray-500 font-semibold">#</th>
                            <th className="px-2.5 py-2 text-left text-gray-500 font-semibold">Due</th>
                            <th className="px-2.5 py-2 text-right text-gray-500 font-semibold">EMI</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {schedulePreview.map((row) => (
                            <tr key={row.num} className="hover:bg-gray-50">
                              <td className="px-2.5 py-2 text-gray-400">{row.num}</td>
                              <td className="px-2.5 py-2 text-gray-600">{row.due}</td>
                              <td className="px-2.5 py-2 text-right font-semibold text-gray-900">{fmtCurrency(row.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {Number(form.termMonths) > 5 && (
                      <p className="text-xs text-gray-400 text-center mt-1">
                        + {Number(form.termMonths) - 5} more installments
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-gray-400">Enter loan details to see EMI calculation</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
