'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  tenantLoginWithPhone,
  tenantLoginWithEmail,
  verifyLoginOtp,
  saveTenantSession,
  LoginResponse,
} from '@/services/tenant-api';

type Step = 'credentials' | 'otp';

function isEmail(val: string) {
  // Treat as email if it contains @ OR any letter
  // so typing "rajesh" is not stripped as non-digits
  return val.includes('@') || /[a-zA-Z]/.test(val);
}

export default function TenantLoginPage() {
  const router = useRouter();
  const { subdomain } = useParams<{ subdomain: string }>();

  const [step, setStep] = useState<Step>('credentials');
  const [identifier, setIdentifier] = useState(''); // email or phone digits
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleIdentifierChange(val: string) {
    if (isEmail(val)) {
      setIdentifier(val);
    } else {
      // Phone — strip non-digits, cap at 10
      setIdentifier(val.replace(/\D/g, '').slice(0, 10));
    }
  }

  const identifierIsEmail = isEmail(identifier);
  const canSubmit = identifierIsEmail ? identifier.length > 4 : identifier.length === 10;

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = identifierIsEmail
        ? await tenantLoginWithEmail(identifier.trim(), password, subdomain)
        : await tenantLoginWithPhone(identifier.trim(), password, subdomain);

      if ('requiresOtp' in res && res.requiresOtp) {
        setTempToken(res.tempToken);
        setMaskedPhone(res.maskedPhone ?? '');
        setStep('otp');
      } else {
        saveTenantSession(res as LoginResponse);
        router.push(`/${subdomain}/dashboard`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await verifyLoginOtp(tempToken, otp);
      saveTenantSession(res);
      router.push(`/${subdomain}/dashboard`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 to-blue-800 flex-col justify-between p-12 text-white">
        <div>
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
              <span className="text-blue-700 font-bold text-lg">L</span>
            </div>
            <span className="text-xl font-bold">LendersHub</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Your lending business,<br />fully in control.
          </h1>
          <p className="text-blue-200 text-lg">
            Manage customers, loans, collections, and team — all from one place.
          </p>
        </div>
        <div className="space-y-4">
          {[
            { label: 'Customer Management', desc: 'Complete KYC & credit profiles' },
            { label: 'Loan Lifecycle', desc: 'Origination to closure tracking' },
            { label: 'Collections Dashboard', desc: 'Daily targets & agent routing' },
          ].map((f) => (
            <div key={f.label} className="flex items-start gap-3">
              <div className="w-2 h-2 mt-2 rounded-full bg-blue-300 flex-shrink-0" />
              <div>
                <p className="font-semibold">{f.label}</p>
                <p className="text-blue-200 text-sm">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">L</span>
            </div>
            <span className="text-lg font-bold text-gray-800">LendersHub</span>
          </div>

          {step === 'credentials' ? (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
              <p className="text-gray-400 text-sm mb-8">
                Signing into <span className="font-semibold text-blue-600">{subdomain}</span>
              </p>

              <form onSubmit={handleCredentials} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mobile Number or Email
                  </label>
                  <div className="relative">
                    {!identifierIsEmail && identifier.length > 0 && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm select-none pointer-events-none">
                        +91&nbsp;
                      </span>
                    )}
                    <input
                      type={identifierIsEmail ? 'email' : 'tel'}
                      value={identifier}
                      onChange={(e) => handleIdentifierChange(e.target.value)}
                      placeholder="9876543210 or user@example.com"
                      required
                      autoComplete="username"
                      className={`w-full py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 ${
                        !identifierIsEmail && identifier.length > 0 ? 'pl-12 pr-4' : 'px-4'
                      }`}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {identifierIsEmail ? 'Logging in with email' : identifier.length > 0 ? 'Logging in with mobile number' : 'Enter mobile number (10 digits) or email address'}
                  </p>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <label className="block text-sm font-medium text-gray-700">Password</label>
                    <Link href={`/${subdomain}/forgot-password`} className="text-xs text-blue-600 hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !canSubmit || !password}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors"
                >
                  {loading ? 'Verifying…' : 'Continue'}
                </button>
              </form>
            </>
          ) : (
            <>
              <button
                onClick={() => { setStep('credentials'); setOtp(''); setError(''); }}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
              >
                ← Back
              </button>

              <h2 className="text-2xl font-bold text-gray-900 mb-1">Enter OTP</h2>
              <p className="text-gray-400 text-sm mb-8">
                A 6-digit OTP has been sent to{' '}
                <span className="font-semibold text-gray-700">{maskedPhone}</span>
              </p>

              <form onSubmit={handleOtp} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    One-Time Password
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    required
                    maxLength={6}
                    autoComplete="one-time-code"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 text-center text-xl tracking-widest"
                  />
                  <p className="text-xs text-gray-400 mt-1">OTP is valid for 10 minutes</p>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors"
                >
                  {loading ? 'Verifying OTP…' : 'Sign in'}
                </button>
              </form>
            </>
          )}

          <p className="mt-8 text-center text-sm text-gray-500">
            Super admin?{' '}
            <a href="/super-admin/login" className="text-blue-600 hover:underline font-medium">
              Admin panel
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
