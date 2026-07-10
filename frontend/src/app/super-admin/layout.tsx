'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import Sidebar from '@/components/super-admin/Sidebar';

const PUBLIC_PATHS = [
  '/super-admin/login',
  '/super-admin/verify-2fa',
  '/super-admin/setup-2fa',
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isPublic = PUBLIC_PATHS.includes(pathname);

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  useEffect(() => {
    document.title = 'Super Admin · LendersHub';
  }, []);

  useEffect(() => {
    if (!isPublic && !sessionStore.getToken()) {
      router.replace('/super-admin/login');
    }
  }, [isPublic, router]);

  useEffect(() => {
    if (isPublic) return;

    const INACTIVITY_MS = 30 * 60 * 1000;

    const resetTimer = () => {
      sessionStore.touch();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        sessionStore.clear();
        router.replace('/super-admin/login');
      }, INACTIVITY_MS);
    };

    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll'];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPublic, router]);

  if (isPublic) return <>{children}</>;

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="min-w-0 lg:pl-[280px]">
        {/* Mobile top bar */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-800 bg-gray-900/95 px-4 py-3 backdrop-blur lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-gray-300 hover:bg-white/10"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">L</div>
            <span className="text-sm font-bold text-white">LendersHub</span>
            <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Admin</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
