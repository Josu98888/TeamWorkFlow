import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, BACKEND_URL, REFRESH_COOKIE, clearAuthCookies, isSameOrigin } from '@/shared/server/session';

/** Revokes the refresh token in core (best effort) and clears both cookies. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Origen no permitido.', code: 'csrf_invalid' }, { status: 403 });
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${BACKEND_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => null);
  }

  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}
