'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getPendingApplications, loanDetailPath, getTenantSession, MANAGER_ROLES,
  PendingApplication,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';

const CYCLE_TYPE_LABEL: Record<string, string> = {
  WEEKLY: 'Weekly',
  DAILY_NO_SUNDAY: 'Daily',
  DAILY_WITH_SUNDAY: 'Daily',
  MONTHLY: 'Monthly',
  AGENT_RISK: 'Agent Risk',
  TERM_LOAN: 'Term Loan',
};

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function DocBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {ok ? '✓' : '✕'} {label}
    </span>
  );
}

export default function ApplicationsPage() {
  const router = useRouter();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const session = getTenantSession();
  const canReview = MANAGER_ROLES.includes(session?.user.role ?? 'CUSTOMER');

  const [apps, setApps] = useState<PendingApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPrincipal, setTotalPrincipal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const limit = 20;

  useEffect(() => {
    if (!canReview) return;
    setLoading(true);
    getPendingApplications(page, limit)
      .then((r) => {
        setApps(r.data);
        setTotal(r.total);
        setTotalPrincipal(r.totalPrincipal);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canReview) {
    router.replace(`/tenant/${subdomain}/dashboard`);
    return null;
  }

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Applications Awaiting Approval</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {loading ? 'Loading…' : (
            total > 0
              ? `${total.toLocaleString()} loan${total !== 1 ? 's' : ''} · ${fmtCurrency(totalPrincipal)} total principal`
              : 'Nothing waiting on you right now'
          )}
        </p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : apps.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No applications are waiting for review.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Loan', 'Customer', 'Principal', 'Submitted', 'By', 'Documents', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {apps.map((a) => (
                  <tr key={a.loanId} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-medium text-gray-900">{a.loanNumber}</p>
                      <p className="text-xs text-gray-400">{CYCLE_TYPE_LABEL[a.cycleType] ?? a.cycleType}</p>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{a.customerName}</p>
                        {a.newCustomer && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold">NEW</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{a.customerCode} · {a.customerPhone}</p>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{fmtCurrency(a.principal)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDate(a.submittedAt)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{a.submittedByName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {a.newCustomer && (
                          <>
                            <DocBadge ok={a.hasPhoto} label="Photo" />
                            <DocBadge ok={a.hasAadhaarDoc} label="Aadhaar" />
                          </>
                        )}
                        <DocBadge ok={a.hasPromissoryNote} label="Promissory" />
                        {a.hasSecurityDoc && <DocBadge ok label="Security" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/${subdomain}/${loanDetailPath(a.cycleType, a.loanId)}`}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg text-white whitespace-nowrap transition-colors"
                        style={{ backgroundColor: BRAND }}
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > limit && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 text-xs border rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">Previous</button>
              <button disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 text-xs border rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
