import { NextResponse, type NextRequest } from 'next/server';
import { BACKEND_URL, isSameOrigin } from '@/shared/server/session';

/** Public: confirms a password reset with the single-use token. Backend errors pass through. */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ detail: 'Origen no permitido.', code: 'csrf_invalid' }, { status: 403 });
  }
  const upstream = await fetch(`${BACKEND_URL}/api/v1/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text(),
  }).catch(() => null);
  if (!upstream) {
    return NextResponse.json({ detail: 'No se pudo contactar al servidor.', code: 'upstream_unreachable' }, { status: 502 });
  }
  const body: unknown = await upstream.json().catch(() => null);
  return NextResponse.json(body ?? {}, { status: upstream.status });
}
