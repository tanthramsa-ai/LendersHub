'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getLoan } from '@/services/tenant-api';

interface Installment {
  id: string;
  number: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  paid: number;
  status: string;
  paidAt: string | null;
}

interface Payment {
  id: string;
  amount: number;
  method: string;
  referenceNumber: string | null;
  paymentDate: string;
  createdAt: string;
}

interface LoanDetail {
  id: string;
  loanNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  principal: number;
  interestRate: number;
  termMonths: number;
  status: string;
  purpose: string | null;
  disbursedAt: string | null;
  firstDueDate: string | null;
  createdAt: string;
  installments: Installment[];
  payments: Payment[];
}

const STATUS_COLORS: Record<string, string> = {
  DISBURSED: 'bg-green-100 text-green-700',
  PENDING:   'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  CLOSED:    'bg-gray-100 text-gray-500',
  DEFAULTED: 'bg-red-100 text-red-700',
  REJECTED:  'bg-red-100 text-red-600',
};

const INST_STATUS_COLORS: Record<string, string> = {
  PAID:           'bg-green-100 text-green-700',
  PARTIALLY_PAID: 'bg-yellow-100 text-yellow-700',
  PENDING:        'bg-gray-100 text-gray-500',
  OVERDUE:        'bg-red-100 text-red-700',
  WAIVED:         'bg-purple-100 text-purple-700',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function LoanDetailPage() {
  const params = useParams<{ subdomain: string; id: string }>();
  const router = useRouter();
  const { subdomain, id } = params;

  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getLoan(id)
      .then((data) => setLoan(data as unknown as LoanDetail))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const totalPaid = loan?.payments.reduce((s, p) => s + p.amount, 0) ?? 0;
  const outstanding = loan
    ? loan.installments.reduce((s, i) => {
        if (['PENDING', 'PARTIALLY_PAID', 'OVERDUE'].includes(i.status)) {
          return s + (i.total - i.paid);
        }
        return s;
      }, 0)
    : 0;

  if (loading) {
    return (
      <div className="p-6 flex justify-center items-center h-64">
        <div className="text-gray-400 text-sm">Loading loan details…</div>
      </div>
    );
  }

  if (error || !loan) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error || 'Loan not found'}
        </div>
        <button onClick={() => router.back()} className="mt-4 text-sm text-blue-600 hover:underline">
          ← Go back
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href={`/tenant/${subdomain}/loans`} className="text-sm text-blue-600 hover:underline">
            ← Back to Loans
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-xl font-bold text-gray-900">{loan.loanNumber}</h1>
            <span className={`px-2.5 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[loan.status] ?? 'bg-gray-100 text-gray-500'}`}>
              {loan.status}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Created {fmtDate(loan.createdAt)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: details + installments + payments */}
        <div className="lg:col-span-2 space-y-5">

          {/* Loan overview */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Loan Details</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Customer</p>
                <p className="font-medium text-gray-900">{loan.customerName}</p>
                <p className="text-xs text-gray-500">{loan.customerPhone}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Purpose</p>
                <p className="font-medium text-gray-900">{loan.purpose || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Principal</p>
                <p className="font-medium text-gray-900">{fmt(loan.principal)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Interest Rate</p>
                <p className="font-medium text-gray-900">{loan.interestRate}% per annum</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Term</p>
                <p className="font-medium text-gray-900">{loan.termMonths} months</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">First Due Date</p>
                <p className="font-medium text-gray-900">{fmtDate(loan.firstDueDate)}</p>
              </div>
              {loan.disbursedAt && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Disbursed At</p>
                  <p className="font-medium text-gray-900">{fmtDate(loan.disbursedAt)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Repayment schedule */}
          {loan.installments.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700">Repayment Schedule</h2>
                <p className="text-xs text-gray-400 mt-0.5">{loan.installments.length} installments</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      {['#', 'Due Date', 'Principal', 'Interest', 'Total', 'Paid', 'Status'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {loan.installments.map((inst) => (
                      <tr key={inst.id} className={inst.status === 'OVERDUE' ? 'bg-red-50' : 'hover:bg-gray-50'}>
                        <td className="px-4 py-2.5 text-gray-500">{inst.number}</td>
                        <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{fmtDate(inst.dueDate)}</td>
                        <td className="px-4 py-2.5 text-gray-700">{fmt(inst.principal)}</td>
                        <td className="px-4 py-2.5 text-gray-500">{fmt(inst.interest)}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{fmt(inst.total)}</td>
                        <td className="px-4 py-2.5 text-green-700">{inst.paid > 0 ? fmt(inst.paid) : '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${INST_STATUS_COLORS[inst.status] ?? 'bg-gray-100 text-gray-500'}`}>
                            {inst.status.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Payment history */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Payment History</h2>
            </div>
            {loan.payments.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No payments recorded yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Date', 'Amount', 'Method', 'Reference'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loan.payments.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{fmtDate(p.paymentDate)}</td>
                        <td className="px-4 py-3 font-medium text-green-700">{fmt(p.amount)}</td>
                        <td className="px-4 py-3 text-gray-500">{p.method.replace('_', ' ')}</td>
                        <td className="px-4 py-3 text-gray-400">{p.referenceNumber || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right: summary */}
        <div className="space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 sticky top-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Summary</h2>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Principal</span>
                <span className="font-medium text-gray-900">{fmt(loan.principal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Paid</span>
                <span className="font-medium text-green-700">{fmt(totalPaid)}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-3">
                <span className="text-gray-700 font-medium">Outstanding</span>
                <span className={`font-bold ${outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmt(outstanding)}
                </span>
              </div>
            </div>

            {loan.installments.length > 0 && (
              <div className="border-t pt-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Schedule</p>
                {(['PAID', 'PARTIALLY_PAID', 'PENDING', 'OVERDUE'] as const).map((s) => {
                  const count = loan.installments.filter((i) => i.status === s).length;
                  if (count === 0) return null;
                  return (
                    <div key={s} className="flex justify-between text-xs">
                      <span className={`px-2 py-0.5 rounded font-medium ${INST_STATUS_COLORS[s]}`}>
                        {s.replace('_', ' ')}
                      </span>
                      <span className="text-gray-500">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="border-t pt-4">
              <Link
                href={`/tenant/${subdomain}/loans`}
                className="w-full block text-center px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Back to Loans
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
