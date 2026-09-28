'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, ArrowLeft } from 'lucide-react';
import { AuthShell } from '@/components/AuthShell';
import { superAdminAuth, sessionStore } from '@/services/super-admin-auth';

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell eyebrow="Platform administration" title="Administrator sign in"
      description="Manage organisations, subscriptions and platform operations.">
      <form className="lh-form" onSubmit={handleSubmit}>
        <div className="lh-field">
          <label htmlFor="admin-email">Email address</label>
          <div className="lh-input-wrap"><Mail size={18} aria-hidden="true" />
            <input id="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="username" placeholder="admin@example.com" required autoFocus />
          </div>
        </div>
        <div className="lh-field">
          <label htmlFor="admin-password">Password</label>
          <div className="lh-input-wrap"><Lock size={18} aria-hidden="true" />
            <input id="admin-password" type={showPassword ? 'text' : 'password'} value={password}
              onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="Enter your password" required />
            <button type="button" className="lh-reveal" onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        {error && <p className="lh-field-error" role="alert">{error}</p>}
        <button type="submit" className="lh-button lh-button--form" disabled={loading || !email || !password}>
          {loading ? 'Verifying…' : 'Continue'}<ArrowRight size={18} aria-hidden="true" />
        </button>
        <p className="lh-secure-note"><ShieldCheck size={15} aria-hidden="true" /> Authorised platform administrators only.</p>
      </form>
      <div className="lh-auth__divider"><span>Looking for your company?</span></div>
      <Link href="/login" className="lh-back-button"><ArrowLeft size={16} /> Back to workspace sign in</Link>
    </AuthShell>
  );
}
