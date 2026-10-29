import { API_PREFIX } from './config';

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

/**
 * Minimal client for the public HTTP API (browser only).
 * TODO(auth): the access token still lives in localStorage (set by the login page);
 * move it to an httpOnly cookie + server-side `backendFetch` when the auth flow is reworked.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { prefix?: string } = {},
): Promise<T> {
  const { prefix = API_PREFIX, headers, ...rest } = init;
  const token = typeof window === 'undefined' ? null : localStorage.getItem('accessToken');

  const response = await fetch(`${prefix}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body ?? {}) as { detail?: string; code?: string };
    throw new ApiError(response.status, error.code, error.detail ?? 'No se pudo completar la solicitud.');
  }
  return body as T;
}
