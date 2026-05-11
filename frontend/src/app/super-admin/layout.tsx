'use client';

import { useEffect, useRef } from 'react';
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

  const isPublic = PUBLIC_PATHS.includes(pathname);

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
    <div className="flex min-h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 min-w-0 pl-[280px]">
        {children}
      </div>
    </div>
  );
}
