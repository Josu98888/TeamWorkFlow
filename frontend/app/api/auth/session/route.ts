import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  decodeAccessToken,
  refreshTokens,
  setAuthCookies,
  type TokenPair,
} from '@/shared/server/session';

/**
 * Current session read from the access token claims (display only; the backend verifies on every call).
 * The JWT carries `sub`, `tenantId` and `role` only (no name/email) and core exposes no "me" endpoint,
 * so the UI can show the role and the user id.
 */
export async function GET(request: NextRequest) {
  let claims = decodeAccessToken(request.cookies.get(ACCESS_COOKIE)?.value);
  let refreshed: TokenPair | null = null;

  if (!claims || claims.exp * 1000 <= Date.now()) {
    refreshed = await refreshTokens(request.cookies.get(REFRESH_COOKIE)?.value);
    claims = refreshed ? decodeAccessToken(refreshed.accessToken) : null;
  }
  if (!claims) return NextResponse.json({ detail: 'Sin sesión.', code: 'unauthenticated' }, { status: 401 });

  const response = NextResponse.json({ userId: claims.userId, tenantId: claims.tenantId, role: claims.role });
  if (refreshed) setAuthCookies(response, refreshed);
  return response;
}
