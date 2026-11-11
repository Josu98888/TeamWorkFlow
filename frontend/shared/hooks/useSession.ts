'use client';

import { useCallback, useEffect } from 'react';
import { hasActiveSession, logoutSession, refreshAccessToken } from '../lib/http';
import { useStoredSession, type Session } from '../lib/session';

export type { Session };

/**
 * Current session (claims of the access token issued by core). When the browser has a session cookie but
 * no stored claims (new browser profile, cleared storage) one token rotation recovers them.
 */
export function useSession() {
  const session = useStoredSession();

  useEffect(() => {
    if (!session && hasActiveSession()) void refreshAccessToken();
  }, [session]);

  return session;
}

/** Revokes the refresh token, clears the cookies (core does) and goes to the login page. */
export function useLogout() {
  return useCallback(async () => {
    await logoutSession();
    window.location.href = '/login';
  }, []);
}
