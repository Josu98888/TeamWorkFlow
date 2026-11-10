import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  BACKEND_URL,
  REFRESH_COOKIE,
  clearAuthCookies,
  isSameOrigin,
  refreshTokens,
  setAuthCookies,
  type TokenPair,
} from '@/shared/server/session';

// API proxy (BFF): forwards `/api/v1/**` to the backend reverse proxy adding the bearer token from the
// httpOnly cookie, so the browser never handles tokens. On 401 it refreshes once and retries.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function forward(request: NextRequest, accessToken: string | undefined, body: ArrayBuffer | undefined) {
  const target = `${BACKEND_URL}${request.nextUrl.pathname}${request.nextUrl.search}`;
  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('accept', request.headers.get('accept') ?? 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  return fetch(target, { method: request.method, headers, body, redirect: 'manual' });
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (MUTATING.has(request.method) && !isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Origen no permitido.', code: 'csrf_invalid' }, { status: 403 });
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;

  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  let refreshed: TokenPair | null = null;

  let upstream: Response;
  try {
    upstream = await forward(request, accessToken, body);
    if (upstream.status === 401) {
      refreshed = await refreshTokens(request.cookies.get(REFRESH_COOKIE)?.value);
      if (!refreshed) {
        const unauthorized = NextResponse.json({ detail: 'Sesión expirada.', code: 'unauthenticated' }, { status: 401 });
        clearAuthCookies(unauthorized);
        return unauthorized;
      }
      accessToken = refreshed.accessToken;
      upstream = await forward(request, accessToken, body);
    }
  } catch {
    return NextResponse.json({ detail: 'No se pudo contactar al servidor.', code: 'upstream_unreachable' }, { status: 502 });
  }

  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) responseHeaders.set('content-type', upstreamType);
  const response = new NextResponse(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
  if (refreshed) setAuthCookies(response, refreshed);
  return response;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
