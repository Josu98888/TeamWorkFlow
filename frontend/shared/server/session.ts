// Server-only helpers of the auth BFF: backend URL, cookie handling, JWT decoding and token refresh.
// Never import this file from a client component.
import type { NextResponse } from 'next/server';

export const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:8080').replace(/\/$/, '');

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/** Matches the backend default `REFRESH_TOKEN_TTL=7d` (the refresh response carries no refresh expiry). */
const REFRESH_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Body of login/register/refresh/accept-invitation in `core`. */
export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };

/** Claims of the access token (`sub, tenantId, role, jti, iat, exp`); no personal data. */
export type SessionClaims = {
  userId: string;
  tenantId: string | null;
  role: string;
  exp: number;
};

export function isTokenPair(value: unknown): value is TokenPair {
  const pair = value as Partial<TokenPair> | null;
  return !!pair && typeof pair.accessToken === 'string' && typeof pair.refreshToken === 'string';
}

/** Decodes (without verifying) the payload of a JWT. Verification is done by the backend on every call. */
export function decodeAccessToken(token: string | undefined): SessionClaims | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      sub?: string;
      tenantId?: string | null;
      role?: string;
      exp?: number;
    };
    if (!payload.sub || !payload.role || typeof payload.exp !== 'number') return null;
    return { userId: payload.sub, tenantId: payload.tenantId ?? null, role: payload.role, exp: payload.exp };
  } catch {
    return null;
  }
}

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
};

export function setAuthCookies(response: NextResponse, pair: TokenPair): void {
  const claims = decodeAccessToken(pair.accessToken);
  const accessMaxAge = claims ? Math.max(claims.exp - Math.floor(Date.now() / 1000), 1) : pair.expiresIn;
  response.cookies.set(ACCESS_COOKIE, pair.accessToken, { ...baseCookie, maxAge: accessMaxAge });
  response.cookies.set(REFRESH_COOKIE, pair.refreshToken, { ...baseCookie, maxAge: REFRESH_MAX_AGE_SECONDS });
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_COOKIE, '', { ...baseCookie, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, '', { ...baseCookie, maxAge: 0 });
}

/** Calls `POST /auth/refresh`; returns the new pair or `null` when the refresh token is not valid. */
export async function refreshTokens(refreshToken: string | undefined): Promise<TokenPair | null> {
  if (!refreshToken) return null;
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isTokenPair(body) ? body : null;
  } catch {
    return null;
  }
}

/** CSRF guard for mutating requests: an `Origin` header, when present, must match the request host. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
