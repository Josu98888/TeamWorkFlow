// Mirrors the wire format of `telemetry` (origin/develop: tower and alerts controllers, `Alert` row).
// Served under `/api/v1/telemetry`. Dates are ISO-8601 strings.

export const ALERT_TYPES = ['LATE', 'UNCOVERED_POST', 'OUT_OF_GEOFENCE', 'MISSING_CLOCK_OUT'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** `GET /alerts` item and `POST /alerts/:alertId/(acknowledge|resolve)` response (raw `Alert` row). */
export type Alert = {
  id: string;
  tenantId: string;
  type: AlertType;
  status: AlertStatus;
  siteId: string;
  shiftId: string;
  employeeId: string | null;
  clockEventId: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

/** Payload of the WebSocket event `site_summary_updated`. */
export type SiteSummary = {
  siteId: string;
  expected: number;
  present: number;
  openAlerts: number;
};

/** `items[]` of `GET /tower/snapshot`: the summary plus its OPEN/ACKNOWLEDGED alerts. */
export type SiteSummarySnapshot = SiteSummary & {
  alerts: Alert[];
};

export type TowerSnapshotResponse = {
  items: SiteSummarySnapshot[];
};

/** `GET /alerts` returns `{ items, total }`. */
export type AlertsPage = {
  items: Alert[];
  total: number;
};

export type ListAlertsQuery = {
  siteId?: string;
  /** Lowercase on the query string (`open`, `acknowledged`, `resolved`). */
  status?: Lowercase<AlertStatus>;
  type?: Lowercase<AlertType>;
  page?: number;
  pageSize?: number;
};
