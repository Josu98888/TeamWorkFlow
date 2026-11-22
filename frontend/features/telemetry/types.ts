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

export const WORKDAY_STATUSES = ['OPEN', 'CLOSED', 'MISSING_CLOCK_OUT', 'ABSENT'] as const;
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

/** `GET /clock-events/active` (employee): open shift where the worker clocked IN and has not clocked OUT yet. */
export type ActiveClockStatus = {
  activeShift: {
    shiftId: string;
    siteId: string;
    postId: string;
    startsAt: string;
    endsAt: string;
    authorizedOvertimeMinutes: number;
    lastInAt: string;
    suggestedNextType: 'OUT';
  } | null;
};

export type DailyAbsenceItem = {
  shiftId: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  siteId: string;
  siteName: string;
  postId: string;
  postName: string;
  startsAt: string;
  endsAt: string;
  scheduledWindow: string;
  absenceStatus: 'CONFIRMED_ABSENCE' | 'IN_PROGRESS_NO_SHOW';
};

export type DailyOutOfGeofenceItem = {
  clockEventId: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  siteId: string;
  siteName: string;
  postId: string;
  postName: string;
  type: ClockEventType;
  method: ClockEventMethod;
  deviceTime: string;
  localTime: string;
  distanceMeters: number | null;
  alertId: string | null;
  alertStatus: AlertStatus | null;
};

export type DailyAttendanceReport = {
  reportDate: string;
  siteId: string | null;
  generatedAt: string;
  summary: {
    totalAssignedShifts: number;
    unassignedShiftsCount: number;
    attendedShifts: number;
    absentCount: number;
    outOfGeofenceCount: number;
    missingClockOutCount: number;
  };
  absences: DailyAbsenceItem[];
  outOfGeofenceEvents: DailyOutOfGeofenceItem[];
};

export type MonthlyShiftDetailItem = {
  shiftId: string;
  date: string;
  siteId: string;
  siteName: string;
  postId: string;
  postName: string;
  scheduledWindow: string;
  startsAt: string;
  endsAt: string;
  scheduledMinutes: number;
  authorizedOvertimeMinutes: number;
  firstInAt: string | null;
  lastOutAt: string | null;
  workdayStatus: WorkdayStatus;
  workedMinutes: number;
  regularMinutes: number;
  rawOvertimeMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  outOfGeofenceCount: number;
};

export type MonthlyEmployeeSummaryItem = {
  employeeId: string;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  isActive: boolean;
  totalAssignedShifts: number;
  upcomingShiftsCount: number;
  attendedShifts: number;
  closedWorkdays: number;
  openWorkdays: number;
  missingClockOutCount: number;
  absentCount: number;
  lateArrivalsCount: number;
  totalLateMinutes: number;
  totalScheduledMinutes: number;
  totalWorkedMinutes: number;
  totalRegularMinutes: number;
  totalAuthorizedOvertimeMinutes: number;
  totalRawOvertimeMinutes: number;
  totalOvertimeMinutes: number;
  outOfGeofenceCount: number;
  outOfGeofenceShiftsCount: number;
  maxDistanceMeters: number | null;
};

export type MonthlyAttendanceReport = {
  period: string;
  siteId: string | null;
  generatedAt: string;
  summary: {
    employeesCount: number;
    totalAssignedShifts: number;
    totalAttendedShifts: number;
    totalAbsentShifts: number;
    totalMissingClockOuts: number;
    totalOutOfGeofence: number;
    totalWorkedMinutes: number;
    totalRegularMinutes: number;
    totalOvertimeMinutes: number;
  };
  employees: MonthlyEmployeeSummaryItem[];
  shiftsByEmployee: Record<string, MonthlyShiftDetailItem[]>;
  absences: DailyAbsenceItem[];
  outOfGeofenceEvents: DailyOutOfGeofenceItem[];
};

export type PayRateType = 'HOURLY' | 'PER_SHIFT';

export type PayrollEmployeeLineItem = MonthlyEmployeeSummaryItem & {
  payType: PayRateType | null;
  baseRateApplied: string | null;
  regularPay: string;
  overtimePay: string;
  totalPay: string;
  missingEmployeeRate: boolean;
  missingPostOvertimeRate: boolean;
  hasMissingClockOut: boolean;
  observations: string;
};

export type MonthlyPayrollCalculation = {
  period: string;
  siteId: string | null;
  currency: string;
  generatedAt: string;
  totals: {
    employeesCount: number;
    totalRegularPay: string;
    totalOvertimePay: string;
    totalPay: string;
    warningsCount: number;
  };
  employees: PayrollEmployeeLineItem[];
  attendanceReport: MonthlyAttendanceReport;
};

export type EmployeeCompensationView = {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  isActive: boolean;
  payType: PayRateType | null;
  baseRate: string | null;
  currency: string;
  updatedAt: string | null;
};

export type PostOvertimeRateView = {
  postId: string;
  siteId: string;
  siteName: string;
  postName: string;
  isActive: boolean;
  overtimeHourlyRate: string | null;
  currency: string;
  updatedAt: string | null;
};

export type ReportRecipientView = {
  id: string;
  tenantId: string;
  userId: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeNumber: string | null;
  isActiveEmployee: boolean;
  receiveDaily: boolean;
  receiveMonthly: boolean;
  receivePayrollExcel: boolean;
  assignedByUserId: string;
  updatedAt: string;
};

export type ReportRecipientsResponse = {
  items: ReportRecipientView[];
  assignableEmployees: {
    employeeId: string;
    userId: string;
    fullName: string;
    employeeNumber: string | null;
  }[];
};

export type UpsertEmployeeCompensationInput = {
  payType: 'hourly' | 'per_shift';
  baseRate: string;
  reason?: string;
};

export type UpsertPostOvertimeRateInput = {
  overtimeHourlyRate: string;
  reason?: string;
};

export type UpsertReportRecipientInput = {
  employeeId?: string | null;
  receiveDaily: boolean;
  receiveMonthly: boolean;
  receivePayrollExcel: boolean;
};

/** Body of `POST /api/v1/auth/socket-token` (core): short-lived token for the Tower socket handshake. */
export type SocketTokenResponse = { token: string; expiresIn: number };
