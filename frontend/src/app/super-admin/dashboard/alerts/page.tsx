'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { dashboardApi, type AlertsDetail } from '@/services/dashboard';

export default function AlertsDetailPage() {
  const router = useRouter();
  const [data, setData] = useState<AlertsDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    dashboardApi.getAlerts()
      .then(setData)
      .catch(() => setError('Failed to load alert data'))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="font-bold text-white">System Alerts</h1>
          <p className="text-xs text-gray-500">Failed login attempts in the last 24 hours</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        {error && <p className="text-red-400 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-sm">{error}</p>}

        {/* Suspicious IPs */}
        {!loading && data && data.suspiciousIps.length > 0 && (
          <section className="bg-red-950 border border-red-800 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <h2 className="font-semibold text-red-300">Suspicious IPs (≥ 3 failed attempts)</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              {data.suspiciousIps.map((s) => (
                <div key={s.ip} className="bg-red-900 border border-red-700 rounded-lg px-4 py-2">
                  <p className="font-mono text-sm text-red-200">{s.ip}</p>
                  <p className="text-xs text-red-400">{s.failedAttempts} failed attempts</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Alerts table */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="font-semibold">Failed Login Attempts</h2>
            {data && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                data.alerts.length === 0 ? 'bg-emerald-900 text-emerald-300' :
                data.alerts.length < 5 ? 'bg-yellow-900 text-yellow-300' :
                'bg-red-900 text-red-300'
              }`}>
                {data.alerts.length} alert{data.alerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-left">
                  <th className="px-6 py-3 font-medium">Email Attempted</th>
                  <th className="px-6 py-3 font-medium">IP Address</th>
                  <th className="px-6 py-3 font-medium">Reason</th>
                  <th className="px-6 py-3 font-medium">Time</th>
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
                ) : data?.alerts.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                      <div className="flex flex-col items-center gap-2">
                        <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        No failed attempts in the last 24 hours
                      </div>
                    </td>
                  </tr>
                ) : (
                  data?.alerts.map((a) => (
                    <tr key={a.id} className="border-b border-gray-800 hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4 text-gray-300">{a.email}</td>
                      <td className="px-6 py-4 font-mono text-xs text-gray-400">{a.ipAddress}</td>
                      <td className="px-6 py-4 text-gray-400 text-xs">{a.reason ?? '—'}</td>
                      <td className="px-6 py-4 text-gray-400 text-xs">{new Date(a.createdAt).toLocaleString()}</td>
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
