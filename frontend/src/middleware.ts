import { NextRequest, NextResponse } from 'next/server';

// Top-level route segments that are NOT tenant subdomains
const STATIC_SEGMENTS = new Set([
  'super-admin', 'api', 'tenant', '_next', 'favicon.ico',
  'login', 'register', 'dashboard', 'loans', 'profile',
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split('/')[1]; // segment after leading /

  // If the first segment is a known static route or empty, pass through
  if (!first || STATIC_SEGMENTS.has(first)) {
    return NextResponse.next();
  }

  // Treat everything else as /{subdomain}/... and rewrite to /tenant/{subdomain}/...
  const url = request.nextUrl.clone();
  url.pathname = '/tenant' + pathname;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    // Match everything except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
