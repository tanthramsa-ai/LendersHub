'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  Landmark,
  Smartphone,
} from 'lucide-react';

const BRAND = '#0F4C81';
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAIN;
const LAST_WORKSPACE_KEY = 'lh_last_workspace';

// Build the tenant's own login URL. Host-based in prod (acme.lendershub.in/login),
// path-based in local dev (/acme/login). Credentials are entered THERE, not here,
// so the auth token is stored on the correct origin.
function workspaceLoginUrl(sub: string): string {
  if (ROOT_DOMAIN) return `https://${sub}.${ROOT_DOMAIN}/login`;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.host}/${sub}/login`;
  }
  return `/${sub}/login`;
}

const HIGHLIGHTS = [
  { icon: Landmark, label: 'Branded office portal', desc: 'Loans, KYC, approvals & ledger' },
  { icon: Smartphone, label: 'Field collections app', desc: 'Offline-first cash collection' },
  { icon: ShieldCheck, label: 'Isolated & secure', desc: 'A dedicated schema per lender' },
];

export default function WorkspacePickerPage() {
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill the last workspace this browser used
  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_WORKSPACE_KEY);
      if (last) setWorkspace(last);
    } catch {}
  }, []);

  function normalize(v: string): string {
    return v.toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const sub = normalize(workspace);
    if (!sub) return setError('Please enter your workspace name');
    setError('');
    setSubmitting(true);
    try { localStorage.setItem(LAST_WORKSPACE_KEY, sub); } catch {}
    window.location.href = workspaceLoginUrl(sub);
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left brand panel */}
      <div className="relative hidden lg:flex lg:w-1/2 flex-col justify-between overflow-hidden p-14 text-white">
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(135deg, ${BRAND} 0%, #0d3f6b 45%, #082741 100%)` }}
        />
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
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm ring-1 ring-white/25">
              <Landmark className="h-5 w-5" strokeWidth={2} />
            </div>
            <span className="text-xl font-bold tracking-tight">LendersHub</span>
          </Link>

          <h1 className="mt-14 max-w-md text-[2.6rem] font-bold leading-[1.1] tracking-tight">
            One platform for your entire lending operation.
          </h1>
          <p className="mt-5 max-w-sm text-lg leading-relaxed text-blue-100/80">
            Sign in to your company workspace to manage loans, customers, and collections.
          </p>
        </div>

        <div className="relative space-y-5">
          {HIGHLIGHTS.map((f) => (
            <div key={f.label} className="flex items-start gap-3.5">
              <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" strokeWidth={2} />
              <div>
                <p className="font-semibold">{f.label}</p>
                <p className="text-sm text-blue-100/70">{f.desc}</p>
              </div>
            </div>
          ))}
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
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">Sign in</h2>
            <p className="mt-1.5 text-sm text-gray-500">
              Enter your company workspace to continue
            </p>

            <form onSubmit={submit} className="mt-7">
              <label htmlFor="workspace" className="mb-1.5 block text-sm font-medium text-gray-700">
                Workspace
              </label>
              <div className="flex items-center rounded-xl border border-gray-200 bg-white transition-shadow focus-within:border-[#0F4C81] focus-within:ring-4 focus-within:ring-[#0F4C81]/10">
                <span className="pl-3.5 text-gray-400">
                  <Building2 className="h-[18px] w-[18px]" />
                </span>
                <input
                  id="workspace"
                  autoFocus
                  value={workspace}
                  onChange={(e) => setWorkspace(e.target.value)}
                  placeholder="your-company"
                  className="min-w-0 flex-1 bg-transparent px-3 py-3 text-gray-900 placeholder-gray-400 focus:outline-none"
                />
                {/* Host suffix only applies in host-based mode; hidden for path-based deployments */}
                {ROOT_DOMAIN && (
                  <span className="pr-3.5 text-sm text-gray-400 select-none">.{ROOT_DOMAIN}</span>
                )}
              </div>

              {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="group mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
                style={{ backgroundColor: BRAND }}
              >
                {submitting ? 'Redirecting…' : 'Continue'}
                {!submitting && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
              </button>
            </form>

            <div className="mt-6 flex items-center gap-2 text-xs text-gray-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              You&apos;ll enter your credentials on your workspace&apos;s secure page.
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-gray-500">
            Platform administrator?{' '}
            <Link href="/super-admin/login" className="font-medium hover:underline" style={{ color: BRAND }}>
              Admin login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
