'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { tenantLogin, saveTenantSession } from '@/services/tenant-api';

export default function TenantLoginPage() {
  const router = useRouter();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await tenantLogin(email, password, subdomain);
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
            { icon: '👥', label: 'Customer Management', desc: 'Complete KYC & credit profiles' },
            { icon: '💰', label: 'Loan Lifecycle', desc: 'Origination to closure tracking' },
            { icon: '📊', label: 'Collections Dashboard', desc: 'Daily targets & agent routing' },
          ].map((f) => (
            <div key={f.label} className="flex items-start gap-3">
              <span className="text-2xl">{f.icon}</span>
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

          <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-gray-400 text-sm mb-8">
            Signing into <span className="font-semibold text-blue-600">{subdomain}</span>
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <a href="#" className="text-sm text-blue-600 hover:underline">Forgot password?</a>
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
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

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
