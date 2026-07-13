'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore, saAuthFetch } from '@/services/super-admin-auth';

interface SuperAdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  totpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuditLog {
  id: string;
  email: string;
  ipAddress: string;
  success: boolean;
  reason: string | null;
  createdAt: string;
}

async function authFetch<T>(path: string): Promise<T> {
  return saAuthFetch<T>(path);
}

type Tab = 'admins' | 'audit';

export default function UsersPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('admins');

  const [admins, setAdmins] = useState<SuperAdminUser[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(true);

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [emailFilter, setEmailFilter] = useState('');
  const [debouncedEmail, setDebouncedEmail] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LIMIT = 20;

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    authFetch<{ total: number; users: SuperAdminUser[] }>('/api/v1/super-admin/users')
      .then((d) => setAdmins(d.users))
      .catch(() => {})
      .finally(() => setAdminsLoading(false));
  }, [router]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedEmail(emailFilter), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [emailFilter]);

  useEffect(() => { setLogsPage(1); }, [debouncedEmail]);

  useEffect(() => {
    if (tab !== 'audit') return;
    setLogsLoading(true);
    const qs = new URLSearchParams({ page: String(logsPage), limit: String(LIMIT) });
    if (debouncedEmail) qs.set('email', debouncedEmail);
    authFetch<{ total: number; logs: AuditLog[] }>(`/api/v1/super-admin/users/audit-log?${qs}`)
      .then((d) => { setLogs(d.logs); setLogsTotal(d.total); })
      .catch(() => {})
      .finally(() => setLogsLoading(false));
  }, [tab, logsPage, debouncedEmail]);

  const totalPages = Math.ceil(logsTotal / LIMIT);

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Platform Users</h1>
          <p className="text-xs text-gray-500 mt-0.5">Super admin accounts and login activity</p>
        </div>
      </div>

      <main className="px-8 py-8 max-w-5xl mx-auto">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
          {([
            { id: 'admins', label: 'Super Admins' },
            { id: 'audit', label: 'Login Audit Log' },
          ] as { id: Tab; label: string }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.id
                  ? 'bg-violet-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Super Admins tab */}
        {tab === 'admins' && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="font-semibold text-white">Super Admin Accounts</h2>
              {!adminsLoading && (
                <span className="text-xs text-gray-500">{admins.length} account{admins.length !== 1 ? 's' : ''}</span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">User</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Email</th>
                  <th className="text-center px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">2FA</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {adminsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full bg-gray-800 animate-pulse" /><div className="h-4 w-28 bg-gray-800 rounded animate-pulse" /></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-40 bg-gray-800 rounded animate-pulse" /></td>
                      <td className="px-6 py-4 text-center"><div className="h-5 w-14 bg-gray-800 rounded-full animate-pulse mx-auto" /></td>
                      <td className="px-6 py-4"><div className="h-4 w-24 bg-gray-800 rounded animate-pulse" /></td>
                    </tr>
                  ))
                ) : admins.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500">No super admin accounts found</td>
                  </tr>
                ) : (
                  admins.map((u) => {
                    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Super Admin';
                    const initials = name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
                    return (
                      <tr key={u.id} className="hover:bg-gray-800/40 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {initials}
                            </div>
                            <span className="font-medium text-white">{name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-gray-300">{u.email}</td>
                        <td className="px-6 py-4 text-center">
                          {u.totpEnabled ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-900/50 text-emerald-300">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                              Enabled
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-900/40 text-amber-300">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                              </svg>
                              Not set
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-gray-500 text-xs">{fmtDate(u.createdAt)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Audit Log tab */}
        {tab === 'audit' && (
          <div className="space-y-4">
            {/* Filter */}
            <div className="relative max-w-xs">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.65 16.65A7 7 0 1116.65 3a7 7 0 010 13.65z" />
              </svg>
              <input
                type="search"
                placeholder="Filter by email…"
                value={emailFilter}
                onChange={(e) => setEmailFilter(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                <h2 className="font-semibold text-white">Login Audit Log</h2>
                {!logsLoading && <span className="text-xs text-gray-500">{logsTotal} entries</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Time</th>
                      <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Email</th>
                      <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">IP Address</th>
                      <th className="text-center px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Result</th>
                      <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {logsLoading ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 5 }).map((_, j) => (
                            <td key={j} className="px-6 py-4"><div className="h-4 bg-gray-800 rounded animate-pulse" style={{ width: `${50 + (j * 13) % 40}%` }} /></td>
                          ))}
                        </tr>
                      ))
                    ) : logs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">No login activity found</td>
                      </tr>
                    ) : (
                      logs.map((log) => (
                        <tr key={log.id} className="hover:bg-gray-800/40 transition-colors">
                          <td className="px-6 py-4 text-gray-400 text-xs whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                          <td className="px-6 py-4 text-gray-300">{log.email}</td>
                          <td className="px-6 py-4 font-mono text-xs text-gray-400">{log.ipAddress}</td>
                          <td className="px-6 py-4 text-center">
                            {log.success ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-900/50 text-emerald-300">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                Success
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/50 text-red-300">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                                Failed
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-gray-500 text-xs">{log.reason ?? '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-between">
                  <p className="text-sm text-gray-400">Page {logsPage} of {totalPages} · {logsTotal} total</p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                      disabled={logsPage === 1}
                      className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setLogsPage((p) => Math.min(totalPages, p + 1))}
                      disabled={logsPage === totalPages}
                      className="px-3 py-1.5 text-sm rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
