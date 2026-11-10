import { NextResponse, type NextRequest } from 'next/server';
import { canAccessRoute, homeFor } from '@/shared/auth/permissions';

// Route protection by cookie presence plus role-based redirects from the access token claims
// (decoded, not verified: the backend verifies tokens and enforces roles on every API call).
const PUBLIC_PATHS = ['/login', '/register', '/invitations/accept', '/password-reset', '/api'];
const GUEST_ONLY = ['/login', '/register'];

const matches = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** Role claim of the access token cookie, or null when missing/malformed. */
function roleFromAccessToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!payload) return null;
    const claims = JSON.parse(atob(payload)) as { role?: unknown };
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogged = request.cookies.has('refresh_token');
  const isPublic = PUBLIC_PATHS.some((base) => matches(pathname, base));
  // No access token (expired, refresh token still valid): let the request through; the API forwarder
  // refreshes it and the dashboard layout re-checks the route with the refreshed session.
  const role = roleFromAccessToken(request.cookies.get('access_token')?.value);

  if (!isPublic && !isLogged) return NextResponse.redirect(new URL('/login', request.url));
  if (isLogged && GUEST_ONLY.some((base) => matches(pathname, base))) {
    return NextResponse.redirect(new URL(role ? homeFor(role) : '/', request.url));
  }
  if (!isPublic && role && !canAccessRoute(role, pathname)) {
    return NextResponse.redirect(new URL(homeFor(role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\..*).*)'],
};
