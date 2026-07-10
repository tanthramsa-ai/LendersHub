'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
    <div className="flex flex-1 items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="text-xl font-bold" style={{ color: BRAND }}>LendersHub</Link>
          <p className="mt-2 text-sm text-gray-500">Sign in to your company workspace</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <label htmlFor="workspace" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Workspace
          </label>
          <div className="flex items-stretch overflow-hidden rounded-xl border border-gray-200 focus-within:ring-2 focus-within:ring-blue-500">
            <input
              id="workspace"
              autoFocus
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              placeholder="your-company"
              className="min-w-0 flex-1 px-3 py-2.5 text-sm focus:outline-none"
            />
            {/* Host suffix only applies in host-based mode; hidden for path-based deployments */}
            {ROOT_DOMAIN && (
              <span className="flex items-center bg-gray-50 px-3 text-sm text-gray-400">
                .{ROOT_DOMAIN}
              </span>
            )}
          </div>

          {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full rounded-xl py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-70"
            style={{ backgroundColor: BRAND }}
          >
            {submitting ? 'Redirecting…' : 'Continue'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Platform administrator?{' '}
          <Link href="/super-admin/login" className="font-semibold text-blue-600 hover:underline">
            Admin login
          </Link>
        </p>
      </div>
    </div>
  );
}
