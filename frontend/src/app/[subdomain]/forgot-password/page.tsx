'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { forgotPassword, resetPassword } from '@/services/tenant-api';

type Step = 'phone' | 'reset' | 'done';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { subdomain } = useParams<{ subdomain: string }>();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPassword(phone.trim(), subdomain);
      setStep('reset');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword(phone.trim(), otp, newPassword, subdomain);
      setStep('done');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold">L</span>
          </div>
          <span className="text-lg font-bold text-gray-800">LendersHub</span>
        </div>

        {step === 'phone' && (
          <>
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Forgot Password</h2>
            <p className="text-gray-400 text-sm mb-8">
              Enter your registered mobile number to receive an OTP
            </p>

            <form onSubmit={handleSendOtp} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Mobile Number
                </label>
                <div className="flex">
                  <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 rounded-l-lg bg-gray-50 text-gray-500 text-sm">
                    +91
                  </span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="9876543210"
                    required
                    maxLength={10}
                    autoComplete="tel"
                    className="flex-1 px-4 py-2.5 border border-gray-300 rounded-r-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || phone.length < 10}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors"
              >
                {loading ? 'Sending OTP…' : 'Send OTP'}
              </button>
            </form>
          </>
        )}

        {step === 'reset' && (
          <>
            <button
              onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6"
            >
              ← Back
            </button>

            <h2 className="text-2xl font-bold text-gray-900 mb-1">Reset Password</h2>
            <p className="text-gray-400 text-sm mb-8">
              Enter the OTP sent to{' '}
              <span className="font-semibold text-gray-700">+91 XXXXXX{phone.slice(-4)}</span>{' '}
              and choose a new password
            </p>

            <form onSubmit={handleReset} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  OTP
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  autoComplete="new-password"
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
                disabled={loading || otp.length !== 6 || !newPassword}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors"
              >
                {loading ? 'Resetting…' : 'Reset Password'}
              </button>
            </form>
          </>
        )}

        {step === 'done' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Password Reset</h2>
            <p className="text-gray-500 text-sm mb-8">
              Your password has been updated successfully.
            </p>
            <Link
              href={`/${subdomain}/login`}
              className="inline-block w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-center transition-colors"
            >
              Back to Login
            </Link>
          </div>
        )}

        {step !== 'done' && (
          <p className="mt-8 text-center text-sm text-gray-500">
            Remember your password?{' '}
            <Link href={`/${subdomain}/login`} className="text-blue-600 hover:underline font-medium">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
