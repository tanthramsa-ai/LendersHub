'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  Landmark,
  KeyRound,
} from 'lucide-react';
import {
  tenantLoginWithPhone,
  tenantLoginWithEmail,
  verifyLoginOtp,
  saveTenantSession,
  LoginResponse,
} from '@/services/tenant-api';

const BRAND = '#0F4C81';

type Step = 'credentials' | 'otp';

function isEmail(val: string) {
  // Treat as email if it contains @ OR any letter
  // so typing "rajesh" is not stripped as non-digits
  return val.includes('@') || /[a-zA-Z]/.test(val);
}

const HIGHLIGHTS = [
  { label: 'Customer Management', desc: 'Complete KYC & credit profiles' },
  { label: 'Loan Lifecycle', desc: 'Origination to closure tracking' },
  { label: 'Collections Dashboard', desc: 'Daily targets & agent routing' },
];

export default function TenantLoginPage() {
  const router = useRouter();
  const { subdomain } = useParams<{ subdomain: string }>();

  const [step, setStep] = useState<Step>('credentials');
  const [identifier, setIdentifier] = useState(''); // email or phone digits
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
  const hasPhoneDigits = !identifierIsEmail && identifier.length > 0;
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

  const fieldWrap =
    'flex items-center rounded-xl border border-gray-200 bg-white transition-shadow focus-within:border-[#0F4C81] focus-within:ring-4 focus-within:ring-[#0F4C81]/10';

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-between overflow-hidden p-14 text-white">
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${BRAND} 0%, #0d3f6b 45%, #082741 100%)` }}
        />
        {/* decorative glow + grid */}
        <div className="absolute inset-0 opacity-60 bg-[radial-gradient(ellipse_at_80%_10%,rgba(96,165,250,0.35)_0%,transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/25">
              <Landmark className="h-5 w-5" strokeWidth={2} />
            </div>
            <span className="text-xl font-bold tracking-tight">LendersHub</span>
          </div>

          <h1 className="mt-14 max-w-md text-[2.6rem] font-bold leading-[1.1] tracking-tight">
            Your lending business, fully in control.
          </h1>
          <p className="mt-5 max-w-sm text-lg leading-relaxed text-blue-100/80">
            Manage customers, loans, collections, and your team — all from one secure workspace.
          </p>
        </div>

        <div className="relative space-y-5">
          {HIGHLIGHTS.map((f) => (
            <div key={f.label} className="flex items-start gap-3.5">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" strokeWidth={2} />
              <div>
                <p className="font-semibold">{f.label}</p>
                <p className="text-sm text-blue-100/70">{f.desc}</p>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-4 text-sm text-blue-100/60">
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
            Bank-grade encryption · Isolated tenant data
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center bg-gray-50 p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile brand */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: BRAND }}>
              <Landmark className="h-4.5 w-4.5 text-white" strokeWidth={2} />
            </div>
            <span className="text-lg font-bold text-gray-900">LendersHub</span>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-7 shadow-sm sm:p-9">
            {step === 'credentials' ? (
              <>
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">Welcome back</h2>
                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-500">
                  Signing in to
                  <span
                    className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: `${BRAND}12`, color: BRAND }}
                  >
                    {subdomain}
                  </span>
                </p>

                <form onSubmit={handleCredentials} className="mt-7 space-y-5">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      Mobile Number or Email
                    </label>
                    <div className={fieldWrap}>
                      <span className="pl-3.5 text-gray-400">
                        {identifierIsEmail ? <Mail className="h-[18px] w-[18px]" /> : <Phone className="h-[18px] w-[18px]" />}
                      </span>
                      {hasPhoneDigits && (
                        <span className="pl-2 text-sm text-gray-500 select-none">+91</span>
                      )}
                      <input
                        type={identifierIsEmail ? 'email' : 'tel'}
                        value={identifier}
                        onChange={(e) => handleIdentifierChange(e.target.value)}
                        placeholder="9876543210 or user@example.com"
                        required
                        autoComplete="username"
                        className="w-full flex-1 rounded-xl bg-transparent px-3 py-3 text-gray-900 placeholder-gray-400 focus:outline-none"
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-gray-400">
                      {identifierIsEmail
                        ? 'Logging in with email'
                        : hasPhoneDigits
                          ? 'Logging in with mobile number'
                          : 'Enter mobile number (10 digits) or email address'}
                    </p>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="block text-sm font-medium text-gray-700">Password</label>
                      <Link
                        href={`/${subdomain}/forgot-password`}
                        className="text-xs font-medium hover:underline"
                        style={{ color: BRAND }}
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <div className={fieldWrap}>
                      <span className="pl-3.5 text-gray-400">
                        <Lock className="h-[18px] w-[18px]" />
                      </span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                        autoComplete="current-password"
                        className="w-full flex-1 bg-transparent px-3 py-3 text-gray-900 placeholder-gray-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="pr-3.5 text-gray-400 transition-colors hover:text-gray-600"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || !canSubmit || !password}
                    className="group flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: BRAND }}
                  >
                    {loading ? 'Verifying…' : 'Continue'}
                    {!loading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
                  </button>
                </form>
              </>
            ) : (
              <>
                <button
                  onClick={() => { setStep('credentials'); setOtp(''); setError(''); }}
                  className="mb-6 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-800"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>

                <div
                  className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${BRAND}12`, color: BRAND }}
                >
                  <KeyRound className="h-6 w-6" strokeWidth={2} />
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">Enter OTP</h2>
                <p className="mt-1.5 text-sm text-gray-500">
                  A 6-digit code was sent to{' '}
                  <span className="font-semibold text-gray-700">{maskedPhone}</span>
                </p>

                <form onSubmit={handleOtp} className="mt-7 space-y-5">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
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
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em] text-gray-900 focus:border-[#0F4C81] focus:outline-none focus:ring-4 focus:ring-[#0F4C81]/10"
                    />
                    <p className="mt-1.5 text-xs text-gray-400">OTP is valid for 10 minutes</p>
                  </div>

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading || otp.length !== 6}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: BRAND }}
                  >
                    {loading ? 'Verifying OTP…' : 'Sign in'}
                  </button>
                </form>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-gray-500">
            Platform administrator?{' '}
            <a href="/super-admin/login" className="font-medium hover:underline" style={{ color: BRAND }}>
              Admin panel
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
