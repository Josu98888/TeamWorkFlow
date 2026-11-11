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

// Attendance: clock events and workdays (raw Prisma rows of `telemetry`; enums come uppercase,
// but the DTO inputs and query filters use lowercase values).

export const CLOCK_EVENT_TYPES = ['IN', 'OUT', 'BREAK_START', 'BREAK_END'] as const;
export type ClockEventType = (typeof CLOCK_EVENT_TYPES)[number];
export type ClockEventTypeInput = Lowercase<ClockEventType>;

export type ClockEventMethod = 'GPS' | 'QR' | 'MANUAL';

/** `GET /clock-events` item; also the response of `POST /clock-events/manual` and `PATCH /clock-events/:id`. */
export type ClockEvent = {
  id: string;
  tenantId: string;
  shiftId: string;
  employeeId: string;
  siteId: string;
  type: ClockEventType;
  method: ClockEventMethod;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  outOfGeofence: boolean;
  clientEventId: string;
  deviceTime: string;
  receivedAt: string;
  createdByUserId: string | null;
  reason: string | null;
};

/** `POST /clock-events` (employee). `clientEventId` makes the call idempotent; `siteId` comes from the shift. */
export type CreateClockEventInput = {
  clientEventId: string;
  type: ClockEventTypeInput;
  method: 'gps' | 'qr';
  siteId: string;
  deviceTime: string;
  latitude?: number;
  longitude?: number;
  qrCode?: string;
};

export type ClockEventsPage = { items: ClockEvent[]; total: number };
export type ListClockEventsQuery = { shiftId?: string; employeeId?: string; siteId?: string; page?: number; pageSize?: number };

/** `POST /clock-events/manual` (supervisor, admin, owner). */
export type CreateManualClockEventInput = {
  employeeId: string;
  shiftId: string;
  type: ClockEventTypeInput;
  time: string;
  reason: string;
};

/** `PATCH /clock-events/:clockEventId`: `reason` is required, `type`/`time` are optional. */
export type CorrectClockEventInput = { type?: ClockEventTypeInput; time?: string; reason: string };

export const WORKDAY_STATUSES = ['OPEN', 'CLOSED', 'MISSING_CLOCK_OUT'] as const;
export type WorkdayStatus = (typeof WORKDAY_STATUSES)[number];

/** `GET /workdays` item and `GET /workdays/:shiftId`. */
export type Workday = {
  id: string;
  tenantId: string;
  shiftId: string;
  employeeId: string;
  siteId: string;
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  status: WorkdayStatus;
  updatedAt: string;
};

export type WorkdaysPage = { items: Workday[]; total: number };
export type ListWorkdaysQuery = { employeeId?: string; siteId?: string; status?: Lowercase<WorkdayStatus>; page?: number; pageSize?: number };
