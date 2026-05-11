'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { sessionStore } from '@/services/super-admin-auth';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

interface MeResponse {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  totpEnabled: boolean;
  createdAt: string;
}

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStore.getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Request failed');
  return data as T;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800">
        <h2 className="font-semibold text-white">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function Toast({ msg, ok }: { msg: string; ok: boolean }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium border ${ok ? 'bg-emerald-950 border-emerald-800 text-emerald-300' : 'bg-red-950 border-red-800 text-red-300'}`}>
      {ok
        ? <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
        : <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
      }
      {msg}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(true);

  // Toast state
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  }

  // Change password
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');

  // Disable 2FA confirm dialog
  const [disabling2fa, setDisabling2fa] = useState(false);
  const [disable2faLoading, setDisable2faLoading] = useState(false);

  // Read totpEnabled from JWT on client only to avoid hydration mismatch
  const [totpEnabledFromJwt, setTotpEnabledFromJwt] = useState(false);
  useEffect(() => {
    const token = sessionStore.getToken();
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { totpEnabled?: boolean };
      setTotpEnabledFromJwt(payload.totpEnabled ?? false);
    } catch { /* leave false */ }
  }, []);

  useEffect(() => {
    if (!sessionStore.getToken()) { router.replace('/super-admin/login'); return; }
    authFetch<MeResponse>('/api/v1/super-admin/auth/me')
      .then(setMe)
      .catch(() => {})
      .finally(() => setMeLoading(false));
  }, [router]);

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwError('');
    if (newPw !== confirmPw) { setPwError('New passwords do not match'); return; }
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    setPwLoading(true);
    try {
      await authFetch('/api/v1/super-admin/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      showToast('Password changed successfully', true);
    } catch (err: any) {
      setPwError(err.message ?? 'Failed to change password');
    } finally {
      setPwLoading(false);
    }
  }

  async function handleDisable2fa() {
    setDisable2faLoading(true);
    try {
      await authFetch('/api/v1/super-admin/auth/disable-2fa', { method: 'POST' });
      setDisabling2fa(false);
      setMe((prev) => prev ? { ...prev, totpEnabled: false } : prev);
      // Clear session — token has stale totpEnabled: true, force re-login
      showToast('2FA disabled. Please log in again.', true);
      setTimeout(() => { sessionStore.clear(); router.replace('/super-admin/login'); }, 2000);
    } catch (err: any) {
      showToast(err.message ?? 'Failed to disable 2FA', false);
    } finally {
      setDisable2faLoading(false);
    }
  }

  const name = me ? [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Super Admin' : '—';
  const initials = name.split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const memberSince = me ? new Date(me.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {toast && <Toast msg={toast.msg} ok={toast.ok} />}

      {/* Disable 2FA confirm dialog */}
      {disabling2fa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-red-900/40 border border-red-800 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-white text-center">Disable Two-Factor Auth?</h3>
            <p className="text-sm text-gray-400 text-center mt-2 mb-6">
              This will remove 2FA from your account. You will be logged out and need to sign in again.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDisabling2fa(false)}
                disabled={disable2faLoading}
                className="flex-1 py-2.5 rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDisable2fa}
                disabled={disable2faLoading}
                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {disable2faLoading ? 'Disabling…' : 'Disable 2FA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="sticky top-0 z-30 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-8 py-4">
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-xs text-gray-500 mt-0.5">Account and security configuration</p>
      </div>

      <main className="px-8 py-8 max-w-2xl mx-auto space-y-6">

        {/* Profile */}
        <Section title="Profile">
          {meLoading ? (
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gray-800 animate-pulse" />
              <div className="space-y-2">
                <div className="h-5 w-36 bg-gray-800 rounded animate-pulse" />
                <div className="h-4 w-52 bg-gray-800 rounded animate-pulse" />
                <div className="h-3 w-28 bg-gray-800 rounded animate-pulse" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center text-white text-xl font-bold shrink-0 shadow-lg shadow-violet-900/30">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold text-white">{name}</p>
                <p className="text-sm text-gray-400">{me?.email}</p>
                <p className="text-xs text-gray-600 mt-0.5">Member since {memberSince}</p>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-orange-500 text-white shrink-0">
                Super Admin
              </span>
            </div>
          )}
        </Section>

        {/* Security */}
        <Section title="Security">
          <div className="space-y-6">

            {/* 2FA status */}
            <div className="flex items-start justify-between gap-4 pb-6 border-b border-gray-800">
              <div>
                <p className="font-medium text-white text-sm">Two-Factor Authentication</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {totpEnabledFromJwt
                    ? 'Your account is protected with TOTP 2FA.'
                    : 'Add an extra layer of security to your account.'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {totpEnabledFromJwt ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Enabled
                    </span>
                    <button
                      onClick={() => setDisabling2fa(true)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-400 hover:text-red-400 hover:border-red-800 transition-colors"
                    >
                      Disable
                    </button>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                      Not enabled
                    </span>
                    <Link
                      href="/super-admin/setup-2fa"
                      className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
                    >
                      Enable 2FA
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* Change password */}
            <div>
              <p className="font-medium text-white text-sm mb-4">Change Password</p>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Current password</label>
                  <input
                    type="password"
                    required
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">New password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    placeholder="Min. 8 characters"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Confirm new password</label>
                  <input
                    type="password"
                    required
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-lg bg-gray-800 border text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm ${confirmPw && confirmPw !== newPw ? 'border-red-700' : 'border-gray-700'}`}
                    placeholder="••••••••"
                  />
                  {confirmPw && confirmPw !== newPw && (
                    <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                  )}
                </div>

                {pwError && (
                  <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-3 py-2.5">
                    <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {pwError}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={pwLoading || !currentPw || !newPw || newPw !== confirmPw}
                    className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                  >
                    {pwLoading ? 'Updating…' : 'Update Password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Section>

        {/* Session */}
        <Section title="Session">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Active Session</p>
              <p className="text-xs text-gray-500 mt-0.5">Session expires after 30 minutes of inactivity</p>
            </div>
            <button
              onClick={() => { sessionStore.clear(); router.replace('/super-admin/login'); }}
              className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
            >
              Sign out
            </button>
          </div>
        </Section>

        {/* Platform info */}
        <Section title="Platform">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
            {[
              { label: 'Environment', value: 'Development' },
              { label: 'API', value: API },
              { label: 'Frontend', value: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010' },
              { label: 'Auth', value: 'JWT + TOTP (RS256)' },
              { label: 'Database', value: 'PostgreSQL 15' },
              { label: 'Multi-tenancy', value: 'Schema-per-tenant' },
            ].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wider text-gray-600">{label}</dt>
                <dd className="text-gray-300 mt-0.5 font-mono text-xs break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>

      </main>
    </div>
  );
}
