import { NextResponse, type NextRequest } from 'next/server';

// Route protection by cookie presence only (the backend verifies tokens on every API call).
const PUBLIC_PATHS = ['/login', '/register', '/invitations/accept', '/password-reset', '/api'];
const GUEST_ONLY = ['/login', '/register'];

const matches = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogged = request.cookies.has('refresh_token');
  const isPublic = PUBLIC_PATHS.some((base) => matches(pathname, base));

  if (!isPublic && !isLogged) return NextResponse.redirect(new URL('/login', request.url));
  if (isLogged && GUEST_ONLY.some((base) => matches(pathname, base))) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
