import { API_PREFIX } from './config';
import { clearSession, setSessionFromToken } from './session';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_SAFETY_MARGIN_SECONDS = 60;

/** Error shape returned by the HTTP layer of the backend: `{ detail, code }`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Spanish copy for the 403 codes every screen can hit (`forbidden`, plan gating, tenant billing state). */
const FORBIDDEN_MESSAGES: Record<string, string> = {
  forbidden: 'No tenés permiso para realizar esta acción.',
  feature_not_in_plan: 'Tu plan no incluye esta función. Podés cambiarlo desde Facturación.',
  tenant_suspended: 'La cuenta de tu empresa está suspendida por falta de pago. Regularizala desde Facturación.',
  tenant_cancelled: 'La suscripción de tu empresa está cancelada. Podés volver a suscribirte desde Facturación.',
};

let refreshInFlight: Promise<boolean> | null = null;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityListenerAttached = false;

/** Reads a cookie by name in browser environments. */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

/** Reads the non-httpOnly double-submit CSRF token set by core. */
export function getCsrfToken(): string | null {
  return getCookie('csrf_token');
}

/** Checks whether the browser currently holds an active session CSRF cookie. */
export function hasActiveSession(): boolean {
  return Boolean(getCsrfToken());
}

/** Removes any legacy JWT tokens that might have been stored in localStorage. */
export function clearLegacyTokenStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  } catch {
    // Ignore storage access errors in restricted contexts
  }
}

/** Cancels any scheduled proactive token refresh timer. */
export function stopProactiveRefresh(): void {
  if (proactiveRefreshTimer !== null) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

/**
 * Schedules a background token rotation before the 15-minute access token expires
 * so active sessions never expire abruptly mid-operation.
 */
export function scheduleProactiveRefresh(
  expiresInSeconds = DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
): void {
  if (typeof window === 'undefined') return;
  stopProactiveRefresh();

  const delayMs = Math.max(
    30_000,
    (expiresInSeconds - REFRESH_SAFETY_MARGIN_SECONDS) * 1000,
  );

  proactiveRefreshTimer = setTimeout(() => {
    proactiveRefreshTimer = null;
    void refreshAccessToken();
  }, delayMs);

  if (!visibilityListenerAttached && typeof document !== 'undefined') {
    visibilityListenerAttached = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && hasActiveSession()) {
        void refreshAccessToken();
      }
    });
  }
}

/**
 * Performs a single-flight token rotation against `POST /api/v1/auth/refresh`
 * using the `refresh_token` httpOnly cookie.
 */
export async function refreshAccessToken(prefix = API_PREFIX): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const csrfToken = getCsrfToken();
      const response = await fetch(`${prefix}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        stopProactiveRefresh();
        return false;
      }

      const data = (await response.json().catch(() => null)) as {
        accessToken?: string;
        expiresIn?: number;
      } | null;
      setSessionFromToken(data?.accessToken);
      clearLegacyTokenStorage();
      scheduleProactiveRefresh(
        typeof data?.expiresIn === 'number'
          ? data.expiresIn
          : DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
      );
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/** Revokes the current session on the backend and clears auth cookies. */
export async function logoutSession(prefix = API_PREFIX): Promise<void> {
  stopProactiveRefresh();
  clearLegacyTokenStorage();
  clearSession();
  if (typeof window === 'undefined') return;

  try {
    const csrfToken = getCsrfToken();
    await fetch(`${prefix}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Ignore network errors during logout redirect
  }
}

/** Body of login/register/accept-invitation in `core`; the tokens also arrive as cookies set by core. */
export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };

/**
 * POSTs to a public `/auth/*` route that opens a session (`login`, `register`): core sets the httpOnly
 * session cookies plus the CSRF cookie, and this keeps the token claims and schedules the rotation.
 */
export async function startSession(path: string, body: unknown, prefix = API_PREFIX): Promise<TokenPair> {
  const pair = await apiFetch<TokenPair>(path, { method: 'POST', body: JSON.stringify(body), prefix });
  setSessionFromToken(pair.accessToken);
  clearLegacyTokenStorage();
  scheduleProactiveRefresh(typeof pair.expiresIn === 'number' ? pair.expiresIn : undefined);
  return pair;
}

function isAuthLifecyclePath(path: string): boolean {
  return (
    path.startsWith('/auth/login') ||
    path.startsWith('/auth/register') ||
    path.startsWith('/auth/refresh') ||
    path.startsWith('/auth/logout') ||
    path.startsWith('/auth/invitations/accept') ||
    path.startsWith('/auth/password-reset/confirm')
  );
}

/**
 * Client for the public HTTP API using `httpOnly` cookies (`credentials: 'include'`),
 * double-submit `X-CSRF-Token` on mutating requests, and automatic 401 token rotation.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { prefix?: string; _retried?: boolean } = {},
): Promise<T> {
  const { prefix = API_PREFIX, headers, _retried = false, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const csrfToken = MUTATING_METHODS.has(method) ? getCsrfToken() : null;

  const response = await fetch(`${prefix}${path}`, {
    ...rest,
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...headers,
    },
  });

  if (
    response.status === 401 &&
    !_retried &&
    !isAuthLifecyclePath(path) &&
    typeof window !== 'undefined'
  ) {
    const refreshed = await refreshAccessToken(API_PREFIX);
    if (refreshed) {
      return apiFetch<T>(path, { ...init, _retried: true });
    }
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body ?? {}) as { detail?: string; code?: string };
    const message =
      (response.status === 403 && FORBIDDEN_MESSAGES[error.code ?? '']) || (error.detail ?? 'No se pudo completar la solicitud.');
    throw new ApiError(response.status, error.code, message);
  }
  return body as T;
}
