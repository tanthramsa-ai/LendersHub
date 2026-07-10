'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: { value: number; danger?: boolean };
  exact?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    label: 'Overview',
    items: [
      {
        href: '/super-admin/dashboard',
        label: 'Dashboard',
        exact: true,
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
            <rect x="11.5" y="2.5" width="6" height="6" rx="1" />
            <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
            <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
          </svg>
        ),
      },
      {
        href: '/super-admin/tenants',
        label: 'Tenants',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <path d="M16.667 15.833V7.5L10 2.5 3.333 7.5v8.333c0 .46.184.902.513 1.228A1.75 1.75 0 005 17.5h10c.46 0 .902-.184 1.228-.513A1.75 1.75 0 0016.667 15.833z" />
          </svg>
        ),
      },
      {
        href: '/super-admin/users',
        label: 'Users',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <path d="M16.25 17.5v-1.667a3.333 3.333 0 00-3.333-3.333H7.083A3.333 3.333 0 003.75 15.833V17.5" />
            <circle cx="10" cy="5.833" r="3.333" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        href: '/super-admin/billing',
        label: 'Billing',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <rect x="2.5" y="5.833" width="15" height="11.667" rx="2" />
            <path d="M13.333 5.833V4.167a1.667 1.667 0 00-1.666-1.667H8.333a1.667 1.667 0 00-1.666 1.667v1.666" />
          </svg>
        ),
      },
      {
        href: '/super-admin/dashboard/mrr',
        label: 'Revenue',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <path d="M16.667 15.833V7.5M10 15.833V4.167M3.333 15.833v-5" />
          </svg>
        ),
      },
      {
        href: '/super-admin/subscriptions',
        label: 'Subscriptions',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="10" cy="10" r="7.5" />
            <path d="M10 6.667v3.333l2.5 1.667" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        href: '/super-admin/dashboard/alerts',
        label: 'Security Alerts',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <path d="M8.575 3.217 1.516 15a1.667 1.667 0 0 0 1.425 2.5h14.118a1.667 1.667 0 0 0 1.425-2.5L11.425 3.217a1.667 1.667 0 0 0-2.85 0Z" />
            <path d="M10 7.5v3.333M10 14.167h.008" />
          </svg>
        ),
      },
      {
        href: '/super-admin/system-health',
        label: 'System Health',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <path d="M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
            <path d="M10 6.667V10M10 13.333h.008" />
          </svg>
        ),
      },
      {
        href: '/super-admin/settings',
        label: 'Settings',
        icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="10" cy="10" r="3.333" />
            <path d="M16.167 12.5a1.5 1.5 0 00.3 1.65l.05.05a1.818 1.818 0 010 2.574 1.818 1.818 0 01-2.575 0l-.05-.05a1.5 1.5 0 00-1.65-.3 1.5 1.5 0 00-.909 1.375v.143a1.818 1.818 0 01-3.636 0v-.076a1.5 1.5 0 00-.983-1.375 1.5 1.5 0 00-1.65.3l-.05.05a1.818 1.818 0 01-2.574-2.574l.05-.05a1.5 1.5 0 00.3-1.65 1.5 1.5 0 00-1.375-.909H1.818a1.818 1.818 0 010-3.636h.076a1.5 1.5 0 001.375-.983 1.5 1.5 0 00-.3-1.65l-.05-.05a1.818 1.818 0 012.574-2.574l.05.05a1.5 1.5 0 001.65.3h.073a1.5 1.5 0 00.909-1.375V1.818a1.818 1.818 0 013.636 0v.076a1.5 1.5 0 00.909 1.375 1.5 1.5 0 001.65-.3l.05-.05a1.818 1.818 0 012.574 2.574l-.05.05a1.5 1.5 0 00-.3 1.65v.073a1.5 1.5 0 001.375.909h.143a1.818 1.818 0 010 3.636h-.076a1.5 1.5 0 00-1.375.909z" />
          </svg>
        ),
      },
    ],
  },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname.startsWith(href);
}

export default function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();

  // Deferred client-only state to avoid SSR/client hydration mismatch
  const [email, setEmail] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [initials, setInitials] = useState('SA');

  useEffect(() => {
    const token = sessionStore.getToken();
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split('.')[1])) as { email?: string; totpEnabled?: boolean };
      const e = payload.email ?? '';
      setEmail(e);
      setTotpEnabled(payload.totpEnabled ?? false);
      setInitials(e ? e.slice(0, 2).toUpperCase() : 'SA');
    } catch { /* leave defaults */ }
  }, []);

  function handleLogout() {
    sessionStore.clear();
    router.replace('/super-admin/login');
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 w-[280px] flex flex-col bg-gradient-to-b from-gray-900 to-gray-950 border-r border-gray-800 z-40 transition-transform duration-200 ${
        open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}
    >
      {/* Logo */}
      <div className="px-6 py-7 border-b border-gray-800">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 flex items-center justify-center font-bold text-white text-lg shadow-lg shadow-indigo-900/40">
            L
          </div>
          <span className="font-bold text-lg text-white tracking-tight">LendersHub</span>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider bg-indigo-600 text-white shadow-sm">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
          </svg>
          Super Admin
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-5 overflow-y-auto space-y-6">
        {NAV.map((section) => (
          <div key={section.label}>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-600 px-3 mb-2">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href, item.exact);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                        active
                          ? 'bg-indigo-600/20 text-white ring-1 ring-inset ring-indigo-500/30'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <span className={active ? 'text-indigo-400' : 'text-gray-500'}>{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${item.badge.danger ? 'bg-red-900/60 text-red-400' : 'bg-amber-900/60 text-amber-400'}`}>
                          {item.badge.value}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* 2FA prompt */}
      {!totpEnabled && (
        <div className="px-4 pb-3">
          <Link
            href="/super-admin/setup-2fa"
            className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg bg-amber-950/40 border border-amber-900/50 hover:bg-amber-950/60 transition-colors text-sm text-amber-300"
          >
            <svg className="w-4 h-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="flex-1 font-medium">Enable 2FA</span>
            <svg className="w-3.5 h-3.5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}

      {/* User footer */}
      <div className="px-4 py-4 border-t border-gray-800">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors group"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {initials}
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-semibold text-white truncate">Super Admin</p>
            <p className="text-xs text-gray-500 truncate">{email || 'admin@lendershub.in'}</p>
          </div>
          <svg className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
