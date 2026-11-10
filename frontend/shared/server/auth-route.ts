import { NextResponse, type NextRequest } from 'next/server';
import { BACKEND_URL, isSameOrigin, isTokenPair, setAuthCookies } from './session';

/**
 * Shared body of the `POST /api/auth/*` routes that return a token pair (login, register, accept
 * invitation): forwards the JSON body to core and, on success, stores the tokens in httpOnly cookies
 * (they never reach the browser JS). Backend errors pass through with their status.
 */
export async function authenticate(request: NextRequest, backendPath: string): Promise<NextResponse> {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Origen no permitido.', code: 'csrf_invalid' }, { status: 403 });
  }

  const upstream = await fetch(`${BACKEND_URL}/api/v1${backendPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text(),
  }).catch(() => null);

  if (!upstream) {
    return NextResponse.json({ detail: 'No se pudo contactar al servidor.', code: 'upstream_unreachable' }, { status: 502 });
  }

  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok || !isTokenPair(body)) {
    return NextResponse.json(body ?? { detail: 'Respuesta inválida del servidor.' }, {
      status: upstream.ok ? 502 : upstream.status,
    });
  }

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, body);
  return response;
}
