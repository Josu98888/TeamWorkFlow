import type { NextRequest } from 'next/server';
import { authenticate } from '@/shared/server/auth-route';

/** Public: accepts an invitation and logs the new user in (core returns a token pair). */
export function POST(request: NextRequest) {
  return authenticate(request, '/auth/invitations/accept');
}
