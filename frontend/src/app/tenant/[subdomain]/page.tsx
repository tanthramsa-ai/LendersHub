'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getTenantSession, postLoginPath } from '@/services/tenant-api';

// Client-side: the landing role check needs the session, which only lives in
// localStorage (no server-side auth cookie to read here).
export default function TenantRootPage({ params }: { params: { subdomain: string } }) {
  const router = useRouter();

  useEffect(() => {
    const session = getTenantSession();
    if (!session || session.tenant.subdomain !== params.subdomain) {
      router.replace(`/${params.subdomain}/login`);
      return;
    }
    router.replace(postLoginPath(params.subdomain, session.user.role));
  }, [params.subdomain, router]);

  return null;
}
