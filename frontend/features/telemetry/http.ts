import { TELEMETRY_API_PREFIX } from '@/shared/lib/config';
import { apiFetch } from '@/shared/lib/http';
import type { TelemetryApi } from './api';
import type { ListAlertsQuery } from './types';

const options = { prefix: TELEMETRY_API_PREFIX };

function toQueryString(query: ListAlertsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Real implementation against `telemetry` (`/api/v1/telemetry/...`). Same contract as the mock.
 * TODO(P5): live updates through the Socket.IO `/ws` event `site_summary_updated`.
 */
export const telemetryHttpApi: TelemetryApi = {
  getTowerSnapshot: () => apiFetch('/tower/snapshot', options),
  listAlerts: (query = {}) => apiFetch(`/alerts${toQueryString(query)}`, options),
  acknowledgeAlert: (alertId) => apiFetch(`/alerts/${alertId}/acknowledge`, { ...options, method: 'POST' }),
  resolveAlert: (alertId, reason) =>
    apiFetch(`/alerts/${alertId}/resolve`, { ...options, method: 'POST', body: JSON.stringify({ reason }) }),
};
