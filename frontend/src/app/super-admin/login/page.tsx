'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Building2,
  CreditCard,
  Activity,
  AlertCircle,
} from 'lucide-react';
import { superAdminAuth, sessionStore } from '@/services/super-admin-auth';

const HIGHLIGHTS = [
  { icon: Building2, label: 'Tenant provisioning', desc: 'Onboard lenders into isolated schemas' },
  { icon: CreditCard, label: 'Subscriptions & billing', desc: 'Plans, MRR, and trials' },
  { icon: Activity, label: 'Platform health', desc: 'System status & usage monitoring' },
];

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await superAdminAuth.login(email, password);
      if (!res.requiresTwoFactor && res.accessToken) {
        sessionStore.setToken(res.accessToken);
        router.push('/super-admin/dashboard');
      } else if (res.tempToken) {
        sessionStorage.setItem('sa_temp_token', res.tempToken);
        router.push(res.totpEnabled ? '/super-admin/verify-2fa' : '/super-admin/setup-2fa');
      }
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  const fieldWrap =
    'flex items-center rounded-xl border border-gray-700 bg-gray-800/60 transition-shadow focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/15';

  return (
    <div className="min-h-screen flex bg-gray-950">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-between overflow-hidden p-14 text-white">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-[#171633] to-[#0f0f2e]" />
        <div className="absolute inset-0 opacity-70 bg-[radial-gradient(ellipse_at_75%_15%,rgba(99,102,241,0.35)_0%,transparent_55%)]" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 shadow-lg shadow-indigo-900/40">
              <ShieldCheck className="h-5 w-5" strokeWidth={2} />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight">LendersHub</span>
              <span className="ml-2 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-200 ring-1 ring-white/15">
                Platform
              </span>
            </div>
          </div>

          <h1 className="mt-14 max-w-md text-[2.6rem] font-bold leading-[1.1] tracking-tight">
            Operate the platform behind every lender.
          </h1>
          <p className="mt-5 max-w-sm text-lg leading-relaxed text-indigo-100/70">
            Provision tenants, manage subscriptions, and monitor the health of the
            whole LendersHub platform.
          </p>
        </div>

        <div className="relative space-y-5">
          {HIGHLIGHTS.map((f) => (
            <div key={f.label} className="flex items-start gap-3.5">
              <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-300" strokeWidth={2} />
              <div>
                <p className="font-semibold">{f.label}</p>
                <p className="text-sm text-indigo-100/60">{f.desc}</p>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-4 text-sm text-indigo-100/50">
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
            Restricted access · Two-factor authentication supported
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile brand */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600">
              <ShieldCheck className="h-4.5 w-4.5 text-white" strokeWidth={2} />
            </div>
            <span className="text-lg font-bold text-white">LendersHub Platform</span>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-7 shadow-2xl sm:p-9">
            <h2 className="text-2xl font-bold tracking-tight text-white">Super Admin Portal</h2>
            <p className="mt-1.5 text-sm text-gray-400">Sign in to LendersHub platform administration</p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Email address</label>
                <div className={fieldWrap}>
                  <span className="pl-3.5 text-gray-500">
                    <Mail className="h-[18px] w-[18px]" />
                  </span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@lendershub.in"
                    autoComplete="username"
                    className="w-full flex-1 bg-transparent px-3 py-3 text-white placeholder-gray-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-300">Password</label>
                <div className={fieldWrap}>
                  <span className="pl-3.5 text-gray-500">
                    <Lock className="h-[18px] w-[18px]" />
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="w-full flex-1 bg-transparent px-3 py-3 text-white placeholder-gray-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="pr-3.5 text-gray-500 transition-colors hover:text-gray-300"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Signing in…' : 'Sign in'}
                {!loading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
              </button>
            </form>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-gray-500">
              <ShieldCheck className="h-3.5 w-3.5" />
              Two-factor authentication available for enhanced security
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
