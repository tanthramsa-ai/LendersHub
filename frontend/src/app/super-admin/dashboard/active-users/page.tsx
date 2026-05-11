'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { dashboardApi, type ActiveUsersDetail } from '@/services/dashboard';

export default function ActiveUsersDetailPage() {
  const router = useRouter();
  const [data, setData] = useState<ActiveUsersDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    dashboardApi.getActiveUsers()
      .then(setData)
      .catch(() => setError('Failed to load user activity data'))
      .finally(() => setLoading(false));
  }, [router]);

  const maxLogins = data ? Math.max(...data.dailyLogins.map((d) => d.count), 1) : 1;

  const roleBadge: Record<string, string> = {
    BORROWER: 'bg-blue-900 text-blue-300',
    LENDER: 'bg-emerald-900 text-emerald-300',
    ADMIN: 'bg-purple-900 text-purple-300',
    SUPER_ADMIN: 'bg-indigo-900 text-indigo-300',
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="font-bold text-white">Active Users</h1>
          <p className="text-xs text-gray-500">Users with successful logins in the last 30 days</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {error && <p className="text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm">{error}</p>}

        {/* Daily login chart */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="font-semibold mb-5">Daily Login Activity — Last 7 Days</h2>
          {loading ? (
            <div className="h-32 bg-gray-800 rounded animate-pulse" />
          ) : (
            <div className="flex items-end gap-3 h-32">
              {data?.dailyLogins.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-gray-400">{d.count}</span>
                  <div
                    className="w-full bg-sky-600 rounded-t"
                    style={{ height: `${(d.count / maxLogins) * 100}%`, minHeight: d.count > 0 ? 4 : 0 }}
                  />
                  <span className="text-xs text-gray-500 truncate w-full text-center">{d.day}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent users table */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="font-semibold">Recently Active Users</h2>
            {data && <p className="text-sm text-gray-400 mt-0.5">{data.recentUsers.length} unique users in last 30 days</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-6 py-3 font-medium">User</th>
                  <th className="px-6 py-3 font-medium">Role</th>
                  <th className="px-6 py-3 font-medium">Last Login</th>
                  <th className="px-6 py-3 font-medium">IP Address</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-800">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <td key={j} className="px-6 py-4"><div className="h-4 bg-gray-800 rounded animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : data?.recentUsers.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">No active users in last 30 days</td></tr>
                ) : (
                  data?.recentUsers.map((u, i) => (
                    <tr key={u.id ?? i} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-white">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</p>
                        <p className="text-gray-400 text-xs">{u.email}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadge[u.role] ?? 'bg-gray-800 text-gray-300'}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-400 text-xs">
                        {new Date(u.lastLoginAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-gray-400">{u.ipAddress}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
