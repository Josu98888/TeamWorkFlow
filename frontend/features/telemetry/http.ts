import { API_PREFIX, TELEMETRY_API_PREFIX } from '@/shared/lib/config';
import { apiFetch } from '@/shared/lib/http';
import type { TelemetryApi } from './api';
import type { ListAlertsQuery, ListClockEventsQuery, ListWorkdaysQuery, SocketTokenResponse } from './types';

const options = { prefix: TELEMETRY_API_PREFIX };

function toQueryString(query: ListAlertsQuery | ListClockEventsQuery | ListWorkdaysQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Real implementation against `telemetry` (`/api/v1/telemetry/...`). Same contract as the mock.
 */
export const telemetryHttpApi: TelemetryApi = {
  getTowerSnapshot: () => apiFetch('/tower/snapshot', options),
  listAlerts: (query = {}) => apiFetch(`/alerts${toQueryString(query)}`, options),
  acknowledgeAlert: (alertId) => apiFetch(`/alerts/${alertId}/acknowledge`, { ...options, method: 'POST' }),
  resolveAlert: (alertId, reason) =>
    apiFetch(`/alerts/${alertId}/resolve`, { ...options, method: 'POST', body: JSON.stringify({ reason }) }),
  listClockEvents: (query = {}) => apiFetch(`/clock-events${toQueryString(query)}`, options),
  createClockEvent: (input) =>
    apiFetch('/clock-events', { ...options, method: 'POST', body: JSON.stringify(input) }),
  createManualClockEvent: (input) =>
    apiFetch('/clock-events/manual', { ...options, method: 'POST', body: JSON.stringify(input) }),
  correctClockEvent: (clockEventId, input) =>
    apiFetch(`/clock-events/${clockEventId}`, { ...options, method: 'PATCH', body: JSON.stringify(input) }),
  listWorkdays: (query = {}) => apiFetch(`/workdays${toQueryString(query)}`, options),
  getWorkday: (shiftId) => apiFetch(`/workdays/${shiftId}`, options),
};

/**
 * Asks `core` (not telemetry) for a short-lived token (60 s) to authenticate the Tower socket handshake.
 * Goes through `apiFetch`, so the session cookies, the CSRF header and the 401 rotation apply. Rejects with
 * `ApiError` (401 no session, 403 role or plan without the tower).
 */
export function fetchSocketToken(): Promise<SocketTokenResponse> {
  return apiFetch<SocketTokenResponse>('/auth/socket-token', { prefix: API_PREFIX, method: 'POST' });
}
