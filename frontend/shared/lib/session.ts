'use client';

import { useSyncExternalStore } from 'react';

/** Claims of the access token (`sub, tenantId, role`); core exposes no "me" endpoint and the token holds no personal data. */
export type Session = { userId: string; tenantId: string | null; role: string };

// The access token cookie is httpOnly, so the browser JS cannot read it. Core returns the token pair in
// the body of login/register/refresh: only its (non secret) claims are kept here, for display and UI gating.
// The backend verifies the real cookie on every call and `proxy.ts` redirects from it on navigations.
const STORAGE_KEY = 'tw.session';
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedValue: Session | null = null;

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): Session | null {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedValue = raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      cachedValue = null;
    }
  }
  return cachedValue;
}

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** Decodes (without verifying) the payload of a JWT. */
export function decodeClaims(token: string | undefined | null): Session | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!payload) return null;
    const claims = JSON.parse(atob(payload)) as { sub?: string; tenantId?: string | null; role?: string };
    if (!claims.sub || !claims.role) return null;
    return { userId: claims.sub, tenantId: claims.tenantId ?? null, role: claims.role };
  } catch {
    return null;
  }
}

/** Stores the claims of a freshly issued access token (login, register, refresh). */
export function setSessionFromToken(accessToken: string | undefined): void {
  const session = decodeClaims(accessToken);
  if (!session) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable: the session just is not shown.
  }
  emit();
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  emit();
}

export function useStoredSession(): Session | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
