'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useParams } from 'next/navigation';
import Link from 'next/link';
import { getTenantSession, clearTenantSession, TenantUser, TenantInfo } from '@/services/tenant-api';

const NAV = [
  { href: 'dashboard', label: 'Dashboard', icon: '⊞' },
  { href: 'customers', label: 'Customers', icon: '👥' },
  { href: 'loans', label: 'Loans', icon: '💰' },
  { href: 'payments', label: 'Payments', icon: '🧾' },
  { href: 'collections', label: 'Collections', icon: '📋' },
  { href: 'settings', label: 'Settings', icon: '⚙' },
];

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ subdomain: string }>();
  const subdomain = params.subdomain;

  const [user, setUser] = useState<TenantUser | null>(null);
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isLoginPage = pathname.endsWith('/login');

  useEffect(() => {
    if (isLoginPage) return;
    const session = getTenantSession();
    if (!session) {
      router.replace(`/${subdomain}/login`);
      return;
    }
    if (session.tenant.subdomain !== subdomain) {
      router.replace(`/${subdomain}/login`);
      return;
    }
    setUser(session.user);
    setTenant(session.tenant);
  }, [subdomain, router, isLoginPage]);

  function handleLogout() {
    clearTenantSession();
    router.push(`/${subdomain}/login`);
  }

  if (isLoginPage) return <>{children}</>;
  if (!user || !tenant) return null;

  function isActive(href: string) {
    return pathname.includes(`/${subdomain}/${href}`);
  }

  const roleColors: Record<string, string> = {
    ADMIN: 'bg-blue-100 text-blue-700',
    LOAN_OFFICER: 'bg-green-100 text-green-700',
    COLLECTOR: 'bg-amber-100 text-amber-700',
    VIEWER: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">L</span>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{tenant.companyName}</p>
            <p className="text-xs text-gray-400">{tenant.subdomain}.lendershub.com</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={`/${subdomain}/${item.href}`}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User profile */}
        <div className="px-4 py-4 border-t border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">
                {user.firstName} {user.lastName}
              </p>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${roleColors[user.role] ?? 'bg-gray-100 text-gray-600'}`}>
                {user.role}
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 rounded text-gray-500 hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-semibold text-gray-800 text-sm">{tenant.companyName}</span>
          <div className="w-8" />
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
