'use client';

import { useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Phone, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, ShieldCheck, Building2 } from 'lucide-react';
import { AuthShell } from '@/components/AuthShell';
import { platformHref } from '@/lib/public-routes';
import { tenantLoginWithPhone, tenantLoginWithEmail, verifyLoginOtp, saveTenantSession, postLoginPath, LoginResponse } from '@/services/tenant-api';

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
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Sent here by tenantFetch when the session token expired.
  const sessionExpired = useSearchParams().get('expired') === '1';

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
        router.push(postLoginPath(subdomain, (res as LoginResponse).user.role));
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
      router.push(postLoginPath(subdomain, res.user.role));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow={step === 'credentials' ? 'Secure workspace access' : 'Verify your identity'}
      title={step === 'credentials' ? 'Welcome back' : 'Enter verification code'}
      description={step === 'credentials'
        ? 'Use the mobile number or email connected to your team account.'
        : `A six-digit code was sent to ${maskedPhone}.`}
    >
      <div className="lh-workspace-badge">
        <Building2 size={16} aria-hidden="true" /><span>{subdomain} workspace</span>
        <Link href={platformHref('/login')}>Change</Link>
      </div>
      {step === 'credentials' ? (
        <form key="credentials" className="lh-form" onSubmit={handleCredentials}>
          <div className="lh-field">
            <label htmlFor="identifier">Mobile Number or Email</label>
            <div className="lh-input-wrap">
              {identifierIsEmail ? <Mail size={18} aria-hidden="true" /> : <Phone size={18} aria-hidden="true" />}
              <input id="identifier" name="identifier" type={identifierIsEmail ? 'email' : 'tel'}
                value={identifier} onChange={e => handleIdentifierChange(e.target.value)}
                placeholder="user@example.com or 9876543210" required autoComplete="username"
                aria-describedby="identifier-help" autoFocus />
            </div>
            <p id="identifier-help" className="lh-field-help">
              {hasPhoneDigits ? 'Indian mobile number (+91), 10 digits' : 'Use your registered email or 10-digit mobile number.'}
            </p>
          </div>
          <div className="lh-field">
            <div className="lh-label-row">
              <label htmlFor="password">Password</label>
              <Link href={`/${subdomain}/forgot-password`}>Forgot password?</Link>
            </div>
            <div className="lh-input-wrap">
              <Lock size={18} aria-hidden="true" />
              <input id="password" name="password" type={showPassword ? 'text' : 'password'}
                value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password"
                required autoComplete="current-password" />
              <button type="button" className="lh-reveal" onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {sessionExpired && !error && <p className="lh-field-error" role="status">Your session has expired. Please sign in again.</p>}
          {error && <p className="lh-field-error" role="alert">{error}</p>}
          <button type="submit" className="lh-button lh-button--form" disabled={loading || !canSubmit || !password}>
            {loading ? 'Verifying…' : 'Continue'}<ArrowRight size={18} aria-hidden="true" />
          </button>
          <p className="lh-secure-note"><ShieldCheck size={15} aria-hidden="true" /> Your company workspace. Your team&apos;s access.</p>
        </form>
      ) : (
        <form key="otp" className="lh-form" onSubmit={handleOtp}>
          <div className="lh-field">
            <label htmlFor="otp">One-Time Password</label>
            <div className="lh-input-wrap lh-input-wrap--otp">
              <input id="otp" type="text" inputMode="numeric" value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" required maxLength={6} pattern="[0-9]{6}" autoComplete="one-time-code" autoFocus />
            </div>
            <p className="lh-field-help">Enter the six digits from your text message.</p>
          </div>
          {error && <p className="lh-field-error" role="alert">{error}</p>}
          <button type="submit" className="lh-button lh-button--form" disabled={loading || otp.length !== 6}>
            {loading ? 'Verifying OTP…' : 'Sign in'}<ArrowRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className="lh-back-button" disabled={loading}
            onClick={() => { setStep('credentials'); setOtp(''); setError(''); }}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
          </button>
        </form>
      )}
      <div className="lh-auth__divider"><span>Platform access</span></div>
      <a href={platformHref('/super-admin/login')} className="lh-admin-link">
        <ShieldCheck size={17} /><span><strong>Platform administrator</strong><small>Sign in to manage LendersHub</small></span><ArrowRight size={17} />
      </a>
    </AuthShell>
  );
}
