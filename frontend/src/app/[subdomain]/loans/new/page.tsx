'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { createLoan, getCustomers, getBranches, Customer, TenantBranch } from '@/services/tenant-api';

function calcEmi(principal: number, annualRate: number, months: number): number {
  if (!principal || !months) return 0;
  if (annualRate === 0) return principal / months;
  const r = annualRate / 100 / 12;
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900';

export default function NewLoanPage() {
  const router = useRouter();
  const { subdomain } = useParams<{ subdomain: string }>();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [form, setForm] = useState({ principal: '', interestRate: '', termMonths: '', purpose: '', firstDueDate: '', branchId: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const emi = calcEmi(Number(form.principal), Number(form.interestRate), Number(form.termMonths));
  const totalRepayment = emi * Number(form.termMonths);
  const totalInterest = totalRepayment - Number(form.principal);

  const searchCustomers = useCallback(async (q: string) => {
    try { const res = await getCustomers(1, 10, q); setCustomers(res.data); } catch { /**/ }
  }, []);

  useEffect(() => {
    if (customerSearch.length >= 2) { searchCustomers(customerSearch); setShowDropdown(true); }
    else setShowDropdown(false);
  }, [customerSearch, searchCustomers]);

  useEffect(() => { getBranches().then(setBranches).catch(() => {}); }, []);

  function set(field: keyof typeof form, value: string) { setForm((f) => ({ ...f, [field]: value })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer) { setError('Please select a customer'); return; }
    setError(''); setLoading(true);
    try {
      const loan = await createLoan({ customerId: selectedCustomer.id, principal: Number(form.principal), interestRate: Number(form.interestRate), termMonths: Number(form.termMonths), purpose: form.purpose || undefined, firstDueDate: form.firstDueDate || undefined, branchId: form.branchId || undefined }) as { id: string };
      router.push(`/${subdomain}/loans/${loan.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href={`/${subdomain}/loans`} className="text-sm text-blue-600 hover:underline">← Back to Loans</Link>
        <h1 className="text-xl font-bold text-gray-900 mt-2">New Loan Application</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Customer */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Customer</h2>
              <div className="relative">
                <label className="block text-xs font-medium text-gray-600 mb-1">Search Customer *</label>
                <input type="text" value={customerSearch} onChange={(e) => { setCustomerSearch(e.target.value); if (selectedCustomer) setSelectedCustomer(null); }} placeholder="Type name or phone…" className={inputCls} />
                {showDropdown && customers.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {customers.map((c) => (
                      <button key={c.id} type="button" onClick={() => { setSelectedCustomer(c); setCustomerSearch(`${c.firstName} ${c.lastName} — ${c.phone}`); setShowDropdown(false); }} className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors">
                        <p className="text-sm font-medium text-gray-900">{c.firstName} {c.lastName}</p>
                        <p className="text-xs text-gray-500">{c.customerCode} · {c.phone}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedCustomer && (
                <div className="mt-3 p-3 bg-blue-50 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-blue-900">{selectedCustomer.firstName} {selectedCustomer.lastName}</p>
                    <p className="text-xs text-blue-600">{selectedCustomer.customerCode} · {selectedCustomer.phone}</p>
                  </div>
                  {selectedCustomer.creditScore && (
                    <div className="text-right">
                      <p className="text-xs text-blue-500">Credit Score</p>
                      <p className="text-lg font-bold text-blue-800">{selectedCustomer.creditScore}</p>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3"><Link href={`/${subdomain}/customers/new`} className="text-xs text-blue-600 hover:underline">+ Add new customer</Link></div>
            </div>

            {/* Loan Details */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Loan Details</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Principal Amount (₹) *</label>
                  <input type="number" value={form.principal} onChange={(e) => set('principal', e.target.value)} required min={1} placeholder="50000" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Annual Interest Rate (%) *</label>
                  <input type="number" value={form.interestRate} onChange={(e) => set('interestRate', e.target.value)} required min={0} max={100} step={0.01} placeholder="18" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Term (months) *</label>
                  <input type="number" value={form.termMonths} onChange={(e) => set('termMonths', e.target.value)} required min={1} max={360} placeholder="12" className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">First Due Date</label>
                  <input type="date" value={form.firstDueDate} onChange={(e) => set('firstDueDate', e.target.value)} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Branch</label>
                  <select value={form.branchId} onChange={(e) => set('branchId', e.target.value)} className={inputCls}>
                    <option value="">— No branch —</option>
                    {branches.filter((b) => b.isActive).map((b) => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Loan Purpose</label>
                  <select value={form.purpose} onChange={(e) => set('purpose', e.target.value)} className={inputCls}>
                    <option value="">Select purpose</option>
                    {['Personal','Business','Agriculture','Education','Medical','Home Improvement','Vehicle','Wedding','Other'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

            <div className="flex justify-end gap-3">
              <Link href={`/${subdomain}/loans`} className="px-5 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Cancel</Link>
              <button type="submit" disabled={loading || !selectedCustomer} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                {loading ? 'Creating…' : 'Create Loan Application'}
              </button>
            </div>
          </form>
        </div>

        {/* EMI Calculator */}
        <div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 sticky top-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">EMI Calculator</h2>
            {emi > 0 ? (
              <div className="space-y-4">
                <div className="text-center py-4 bg-blue-50 rounded-xl">
                  <p className="text-xs text-blue-500 mb-1">Monthly EMI</p>
                  <p className="text-3xl font-bold text-blue-700">{fmtCurrency(emi)}</p>
                </div>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Principal</span><span className="font-medium">{fmtCurrency(Number(form.principal))}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Total Interest</span><span className="font-medium text-orange-600">{fmtCurrency(totalInterest)}</span></div>
                  <div className="flex justify-between border-t pt-2"><span className="font-medium text-gray-700">Total Repayment</span><span className="font-bold">{fmtCurrency(totalRepayment)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">No. of EMIs</span><span className="font-medium">{form.termMonths}</span></div>
                </div>
                <div>
                  <div className="h-3 rounded-full overflow-hidden flex">
                    <div className="bg-blue-500 h-full" style={{ width: `${(Number(form.principal) / totalRepayment) * 100}%` }} />
                    <div className="bg-orange-400 h-full flex-1" />
                  </div>
                  <div className="flex text-xs mt-1 gap-4">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Principal {Math.round((Number(form.principal) / totalRepayment) * 100)}%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />Interest {Math.round((totalInterest / totalRepayment) * 100)}%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">Enter loan details to see EMI calculation</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
