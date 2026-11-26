import { API_PREFIX, TELEMETRY_API_PREFIX } from '@/shared/lib/config';
import { ApiError, apiFetch, refreshAccessToken } from '@/shared/lib/http';
import type { TelemetryApi } from './api';
import type { SocketTokenResponse } from './types';

const options = { prefix: TELEMETRY_API_PREFIX };

function toQueryString(query: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function downloadBinary(path: string, fallbackFilename: string, retried = false): Promise<void> {
  const response = await fetch(`${TELEMETRY_API_PREFIX}${path}`, {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401 && !retried && typeof window !== 'undefined') {
    const refreshed = await refreshAccessToken(API_PREFIX);
    if (refreshed) {
      return downloadBinary(path, fallbackFilename, true);
    }
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string; code?: string } | null;
    throw new ApiError(response.status, body?.code, body?.detail ?? 'No se pudo descargar el archivo.');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? fallbackFilename;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
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
  getActiveClockStatus: () => apiFetch('/clock-events/active', options),
  createClockEvent: (input) =>
    apiFetch('/clock-events', { ...options, method: 'POST', body: JSON.stringify(input) }),
  createManualClockEvent: (input) =>
    apiFetch('/clock-events/manual', { ...options, method: 'POST', body: JSON.stringify(input) }),
  correctClockEvent: (clockEventId, input) =>
    apiFetch(`/clock-events/${clockEventId}`, { ...options, method: 'PATCH', body: JSON.stringify(input) }),
  listWorkdays: (query = {}) => apiFetch(`/workdays${toQueryString(query)}`, options),
  getWorkday: (shiftId) => apiFetch(`/workdays/${shiftId}`, options),
  getDailyReport: (query = {}) => apiFetch(`/reports/daily${toQueryString(query)}`, options),
  downloadDailyReportPdf: (query = {}) =>
    downloadBinary(`/reports/daily/pdf${toQueryString(query)}`, `informe-diario-${query.date ?? 'hoy'}.pdf`),
  getMonthlyReport: (query = {}) => apiFetch(`/reports/monthly${toQueryString(query)}`, options),
  downloadMonthlyReportPdf: (query = {}) =>
    downloadBinary(`/reports/monthly/pdf${toQueryString(query)}`, `informe-mensual-${query.period ?? 'mes'}.pdf`),
  getMonthlyPayroll: (query = {}) => apiFetch(`/reports/monthly/payroll${toQueryString(query)}`, options),
  downloadMonthlyPayrollExcel: (query = {}) =>
    downloadBinary(
      `/reports/monthly/export${toQueryString(query)}`,
      `liquidacion-asistencia-${query.period ?? 'mes'}.xlsx`,
    ),
  listEmployeeCompensations: () => apiFetch('/compensation/employees', options),
  upsertEmployeeCompensation: (employeeId, input) =>
    apiFetch(`/compensation/employees/${employeeId}`, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listPostOvertimeRates: () => apiFetch('/compensation/posts', options),
  upsertPostOvertimeRate: (postId, input) =>
    apiFetch(`/compensation/posts/${postId}`, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listReportRecipients: () => apiFetch('/reports/recipients', options),
  upsertReportRecipient: (userId, input) =>
    apiFetch(`/reports/recipients/${userId}`, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  removeReportRecipient: (userId) =>
    apiFetch(`/reports/recipients/${userId}`, {
      ...options,
      method: 'DELETE',
    }),
  getSiteReportEmailStatus: (siteId) =>
    apiFetch(`/reports/sites/${siteId}/email-status`, options),
  requestSiteReportEmail: (siteId, input) =>
    apiFetch(`/reports/sites/${siteId}/request-email`, {
      ...options,
      method: 'POST',
      body: JSON.stringify(input),
    }),
};

/**
 * Asks `core` (not telemetry) for a short-lived token (60 s) to authenticate the Tower socket handshake.
 */
export function fetchSocketToken(): Promise<SocketTokenResponse> {
  return apiFetch<SocketTokenResponse>('/auth/socket-token', { prefix: API_PREFIX, method: 'POST' });
}
