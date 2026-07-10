import { NextRequest, NextResponse } from 'next/server';

// Top-level route segments that are NOT tenant subdomains
const STATIC_SEGMENTS = new Set([
  'super-admin', 'api', 'tenant', '_next', 'favicon.ico',
  'login', 'register', 'dashboard', 'loans', 'profile',
]);

// Hostnames that are the platform itself, not a tenant (app/www/api/root landing).
// `sandbox` is a deployment host that serves path-based tenant routing underneath,
// so it must never be treated as a host-based tenant even when ROOT_DOMAIN is set.
const RESERVED_SUBDOMAINS = new Set(['app', 'www', 'api', 'sandbox']);

// Root domain for host-based tenant subdomains (e.g. acme.lendershub.in).
// Configure via NEXT_PUBLIC_TENANT_ROOT_DOMAIN; unset in local dev to use path-based routing.
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAIN ?? '';

// Extract a tenant subdomain from the Host header, or '' if there isn't one.
function subdomainFromHost(host: string): string {
  const hostname = host.split(':')[0]; // strip any port
  if (!ROOT_DOMAIN || !hostname.endsWith(`.${ROOT_DOMAIN}`)) return '';
  const label = hostname.slice(0, -(`.${ROOT_DOMAIN}`).length);
  // Only a single-level label is a tenant (reject "foo.acme" and reserved names)
  if (!label || label.includes('.') || RESERVED_SUBDOMAINS.has(label)) return '';
  return label;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Host-based subdomain (production): acme.lendershub.in/loans → /tenant/acme/loans
  const sub = subdomainFromHost(request.headers.get('host') ?? '');
  if (sub) {
    // Skip Next internals / api so they resolve normally
    if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname === '/favicon.ico') {
      return NextResponse.next();
    }
    // Avoid double-rewriting if the path already targets the tenant tree
    if (pathname.startsWith(`/tenant/`)) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = `/tenant/${sub}${pathname}`;
    return NextResponse.rewrite(url);
  }

  // 2. Path-based fallback (local dev / app.lendershub.in/{subdomain}/...)
  const first = pathname.split('/')[1]; // segment after leading /
  if (!first || STATIC_SEGMENTS.has(first)) {
    return NextResponse.next();
  }
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
