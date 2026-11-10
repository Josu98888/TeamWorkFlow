'use client';

import { useCallback, useEffect, useState } from 'react';

export type Session = { userId: string; tenantId: string | null; role: string };

/** Current session from `GET /api/auth/session` (claims of the httpOnly access token cookie). */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((response) => (response.ok ? (response.json() as Promise<Session>) : null))
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return session;
}

/** Revokes the refresh token, clears the cookies and goes to the login page. */
export function useLogout() {
  return useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    window.location.href = '/login';
  }, []);
}
