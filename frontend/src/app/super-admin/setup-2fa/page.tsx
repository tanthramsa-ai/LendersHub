'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { superAdminAuth, sessionStore } from '@/services/super-admin-auth';

export default function Setup2faPage() {
  const router = useRouter();
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingQr, setLoadingQr] = useState(true);
  const [alreadyEnabled, setAlreadyEnabled] = useState(false);

  useEffect(() => {
    const token = sessionStore.getToken();
    if (!token) { router.replace('/super-admin/login'); return; }

    superAdminAuth
      .getSetup2fa(token)
      .then((data) => {
        setQrCodeDataUrl(data.qrCodeDataUrl);
        setOtpauthUrl(data.otpauthUrl);
      })
      .catch((err: any) => {
        if (err.message?.includes('already enabled')) {
          setAlreadyEnabled(true);
        } else {
          router.replace('/super-admin/login');
        }
      })
      .finally(() => setLoadingQr(false));
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const token = sessionStore.getToken()!;
      const res = await superAdminAuth.confirmSetup2fa(code, token);
      sessionStore.setToken(res.accessToken);
      router.push('/super-admin/dashboard');
    } catch (err: any) {
      setError(err.message ?? 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-md">
        <div className="bg-gray-900 rounded-2xl shadow-2xl p-8 border border-gray-800">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-white">Set up Two-Factor Authentication</h1>
            <p className="text-gray-400 mt-1 text-sm">
              Scan the QR code with your authenticator app
            </p>
          </div>

          {alreadyEnabled ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-900/40 border border-emerald-700 flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-emerald-400 font-semibold">2FA is already enabled on your account</p>
              <button
                onClick={() => router.push('/super-admin/dashboard')}
                className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors"
              >
                Back to Dashboard
              </button>
            </div>
          ) : loadingQr ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {qrCodeDataUrl && (
                <div className="flex flex-col items-center gap-4 mb-6">
                  <div className="p-3 bg-white rounded-xl">
                    <img src={qrCodeDataUrl} alt="2FA QR Code" className="w-48 h-48" />
                  </div>
                  <p className="text-gray-500 text-xs text-center">
                    Can&apos;t scan?{' '}
                    <a href={otpauthUrl} className="text-indigo-400 hover:underline break-all">
                      Open in authenticator
                    </a>
                  </p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Enter the 6-digit code from your app
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-center text-2xl tracking-widest placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="000000"
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-3">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                >
                  {loading ? 'Verifying…' : 'Enable 2FA & Continue'}
                </button>

                <button
                  type="button"
                  onClick={() => router.push('/super-admin/dashboard')}
                  className="w-full py-2 px-4 rounded-lg text-gray-400 hover:text-white text-sm transition-colors"
                >
                  Skip for now
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
