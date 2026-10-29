import { minutesFromNow, mockResponse } from '@/shared/lib/mock';
import {
  CURRENT_ASSIGNMENTS,
  MOCK_USER_ID,
  SITE_COUNT,
  TENANT_ID,
  alertId,
  employeeId,
  shiftId,
  siteId,
} from '@/shared/mocks/world';
import type { TelemetryApi } from './api';
import type { Alert, SiteSummary, SiteSummarySnapshot } from './types';

const BASE_ALERT = {
  tenantId: TENANT_ID,
  clockEventId: null,
  acknowledgedBy: null,
  acknowledgedAt: null,
  resolvedBy: null,
  resolvedAt: null,
} as const;

const ALERTS: Alert[] = [
  {
    ...BASE_ALERT,
    id: alertId(1),
    type: 'LATE',
    status: 'OPEN',
    siteId: siteId(0),
    shiftId: shiftId(0, 2, 'current'),
    employeeId: employeeId(2),
    createdAt: minutesFromNow(-22),
  },
  {
    ...BASE_ALERT,
    id: alertId(2),
    type: 'OUT_OF_GEOFENCE',
    status: 'ACKNOWLEDGED',
    siteId: siteId(1),
    shiftId: shiftId(1, 1, 'current'),
    employeeId: employeeId(5),
    acknowledgedBy: MOCK_USER_ID,
    acknowledgedAt: minutesFromNow(-35),
    createdAt: minutesFromNow(-41),
  },
  {
    ...BASE_ALERT,
    id: alertId(3),
    type: 'MISSING_CLOCK_OUT',
    status: 'OPEN',
    siteId: siteId(1),
    shiftId: shiftId(1, 0, 'previous'),
    employeeId: employeeId(7),
    createdAt: minutesFromNow(-125),
  },
  {
    ...BASE_ALERT,
    id: alertId(4),
    type: 'LATE',
    status: 'ACKNOWLEDGED',
    siteId: siteId(2),
    shiftId: shiftId(2, 1, 'current'),
    employeeId: employeeId(9),
    acknowledgedBy: MOCK_USER_ID,
    acknowledgedAt: minutesFromNow(-10),
    createdAt: minutesFromNow(-14),
  },
  {
    ...BASE_ALERT,
    id: alertId(5),
    type: 'UNCOVERED_POST',
    status: 'OPEN',
    siteId: siteId(2),
    shiftId: shiftId(2, 2, 'current'),
    employeeId: null,
    createdAt: minutesFromNow(-9),
  },
  {
    ...BASE_ALERT,
    id: alertId(6),
    type: 'LATE',
    status: 'RESOLVED',
    siteId: siteId(3),
    shiftId: shiftId(3, 1, 'previous'),
    employeeId: employeeId(10),
    acknowledgedBy: MOCK_USER_ID,
    acknowledgedAt: minutesFromNow(-200),
    resolvedBy: MOCK_USER_ID,
    resolvedAt: minutesFromNow(-190),
    createdAt: minutesFromNow(-210),
  },
];

const isActive = (alert: Alert) => alert.status !== 'RESOLVED';

/** Same rules as the backend: expected = covered current shifts, present = clocked in. */
function summarize(site: number): SiteSummary {
  const assignments = CURRENT_ASSIGNMENTS.filter((item) => item.site === site && item.employee !== null);
  return {
    siteId: siteId(site),
    expected: assignments.length,
    present: assignments.filter((item) => item.clockedIn).length,
    openAlerts: ALERTS.filter((alert) => alert.siteId === siteId(site) && isActive(alert)).length,
  };
}

function snapshot(): SiteSummarySnapshot[] {
  return Array.from({ length: SITE_COUNT - 1 }, (_, site) => ({
    ...summarize(site),
    alerts: ALERTS.filter((alert) => alert.siteId === siteId(site) && isActive(alert)),
  }));
}

function findAlert(id: string): Alert {
  const alert = ALERTS.find((item) => item.id === id);
  if (!alert) throw new Error('La alerta no existe.');
  return alert;
}

export const telemetryMockApi: TelemetryApi = {
  getTowerSnapshot: () => mockResponse({ items: snapshot() }),

  listAlerts: (query = {}) => {
    const items = ALERTS.filter(
      (alert) =>
        (!query.siteId || alert.siteId === query.siteId) &&
        (!query.status || alert.status.toLowerCase() === query.status) &&
        (!query.type || alert.type.toLowerCase() === query.type),
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return mockResponse({ items, total: items.length });
  },

  // The mock is stateless: the screen keeps the updated alert in local state.
  acknowledgeAlert: (id) =>
    mockResponse({
      ...findAlert(id),
      status: 'ACKNOWLEDGED' as const,
      acknowledgedBy: MOCK_USER_ID,
      acknowledgedAt: new Date().toISOString(),
    }),

  resolveAlert: (id) =>
    mockResponse({
      ...findAlert(id),
      status: 'RESOLVED' as const,
      acknowledgedBy: findAlert(id).acknowledgedBy ?? MOCK_USER_ID,
      acknowledgedAt: findAlert(id).acknowledgedAt ?? new Date().toISOString(),
      resolvedBy: MOCK_USER_ID,
      resolvedAt: new Date().toISOString(),
    }),
};
