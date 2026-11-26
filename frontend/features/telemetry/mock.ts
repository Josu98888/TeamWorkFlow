import { minutesFromNow, mockResponse, mockUnavailable } from '@/shared/lib/mock';
import {
  CURRENT_ASSIGNMENTS,
  MOCK_USER_ID,
  SITE_COUNT,
  TENANT_ID,
  alertId,
  employeeId,
  postId,
  shiftId,
  siteId,
} from '@/shared/mocks/world';
import type { TelemetryApi } from './api';
import type {
  Alert,
  DailyAttendanceReport,
  EmployeeCompensationView,
  MonthlyAttendanceReport,
  MonthlyPayrollCalculation,
  PostOvertimeRateView,
  ReportRecipientView,
  RequestSiteReportEmailResponse,
  SiteReportEmailKind,
  SiteReportEmailStatusResponse,
  SiteSummary,
  SiteSummarySnapshot,
} from './types';

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

const MOCK_COMPENSATIONS: EmployeeCompensationView[] = [
  {
    employeeId: employeeId(0),
    firstName: 'Lucía',
    lastName: 'Fernández',
    employeeNumber: 'L-1001',
    isActive: true,
    payType: 'HOURLY',
    baseRate: '4500.00',
    currency: 'ARS',
    updatedAt: minutesFromNow(-60),
  },
  {
    employeeId: employeeId(1),
    firstName: 'Martín',
    lastName: 'Gómez',
    employeeNumber: 'L-1002',
    isActive: true,
    payType: 'PER_SHIFT',
    baseRate: '32000.00',
    currency: 'ARS',
    updatedAt: minutesFromNow(-60),
  },
];

const MOCK_POST_RATES: PostOvertimeRateView[] = [
  {
    postId: postId(0, 0),
    siteId: siteId(0),
    siteName: 'Planta Norte Pilar',
    postName: 'Acceso Principal',
    isActive: true,
    overtimeHourlyRate: '6750.00',
    currency: 'ARS',
    updatedAt: minutesFromNow(-60),
  },
  {
    postId: postId(0, 1),
    siteId: siteId(0),
    siteName: 'Planta Norte Pilar',
    postName: 'Ronda Perimetral',
    isActive: true,
    overtimeHourlyRate: '6500.00',
    currency: 'ARS',
    updatedAt: minutesFromNow(-60),
  },
];

const MOCK_RECIPIENTS: ReportRecipientView[] = [
  {
    id: 'rec-mock-1',
    tenantId: TENANT_ID,
    userId: 'user-mock-1',
    employeeId: employeeId(0),
    employeeName: 'Fernández, Lucía',
    employeeNumber: 'L-1001',
    siteIds: [siteId(0)],
    isActiveEmployee: true,
    receiveDaily: true,
    receiveMonthly: true,
    receivePayrollExcel: false,
    assignedByUserId: MOCK_USER_ID,
    updatedAt: minutesFromNow(-120),
  },
];

const MOCK_SITE_EMAIL_REQUESTS = new Map<
  string,
  { sentAt: string; targetPeriod: string }
>();

function mockTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function mockTomorrowStr(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function mockSiteRequestKey(targetSiteId: string, kind: SiteReportEmailKind, dateStr: string): string {
  return `${targetSiteId}:${kind}:${dateStr}`;
}

function buildMockDailyReport(query?: { date?: string; siteId?: string }): DailyAttendanceReport {
  const reportDate = query?.date ?? new Date().toISOString().slice(0, 10);
  return {
    reportDate,
    siteId: query?.siteId ?? null,
    generatedAt: new Date().toISOString(),
    summary: {
      totalAssignedShifts: 10,
      unassignedShiftsCount: 1,
      attendedShifts: 8,
      absentCount: 2,
      outOfGeofenceCount: 1,
      missingClockOutCount: 1,
    },
    absences: [
      {
        shiftId: shiftId(0, 2, 'current'),
        employeeId: employeeId(2),
        employeeName: 'Rodríguez, Sofía',
        employeeNumber: 'L-1003',
        siteId: siteId(0),
        siteName: 'Planta Norte Pilar',
        postId: postId(0, 2),
        postName: 'Monitoreo CCTV',
        startsAt: minutesFromNow(-180),
        endsAt: minutesFromNow(300),
        scheduledWindow: '08:00 - 16:00',
        absenceStatus: 'IN_PROGRESS_NO_SHOW',
      },
    ],
    outOfGeofenceEvents: [
      {
        clockEventId: 'evt-oof-1',
        shiftId: shiftId(1, 1, 'current'),
        employeeId: employeeId(5),
        employeeName: 'Martínez, Nicolás',
        employeeNumber: 'L-1006',
        siteId: siteId(1),
        siteName: 'Centro Logístico Zárate',
        postId: postId(1, 1),
        postName: 'Acceso de Camiones',
        type: 'IN',
        method: 'GPS',
        deviceTime: minutesFromNow(-41),
        localTime: '08:19',
        distanceMeters: 420,
        alertId: alertId(2),
        alertStatus: 'ACKNOWLEDGED',
      },
    ],
  };
}

function buildMockMonthlyReport(query?: { period?: string; siteId?: string }): MonthlyAttendanceReport {
  const period = query?.period ?? new Date().toISOString().slice(0, 7);
  return {
    period,
    siteId: query?.siteId ?? null,
    generatedAt: new Date().toISOString(),
    summary: {
      employeesCount: 2,
      totalAssignedShifts: 42,
      totalAttendedShifts: 40,
      totalAbsentShifts: 2,
      totalMissingClockOuts: 0,
      totalOutOfGeofence: 1,
      totalWorkedMinutes: 19620,
      totalRegularMinutes: 19200,
      totalOvertimeMinutes: 420,
    },
    employees: [
      {
        employeeId: employeeId(0),
        employeeNumber: 'L-1001',
        firstName: 'Lucía',
        lastName: 'Fernández',
        fullName: 'Fernández, Lucía',
        isActive: true,
        totalAssignedShifts: 22,
        upcomingShiftsCount: 0,
        attendedShifts: 21,
        closedWorkdays: 21,
        openWorkdays: 0,
        missingClockOutCount: 0,
        absentCount: 1,
        lateArrivalsCount: 1,
        totalLateMinutes: 12,
        totalScheduledMinutes: 10560,
        totalWorkedMinutes: 10320,
        totalRegularMinutes: 10080,
        totalAuthorizedOvertimeMinutes: 300,
        totalRawOvertimeMinutes: 240,
        totalOvertimeMinutes: 240,
        outOfGeofenceCount: 0,
        outOfGeofenceShiftsCount: 0,
        maxDistanceMeters: null,
      },
      {
        employeeId: employeeId(1),
        employeeNumber: 'L-1002',
        firstName: 'Martín',
        lastName: 'Gómez',
        fullName: 'Gómez, Martín',
        isActive: true,
        totalAssignedShifts: 20,
        upcomingShiftsCount: 0,
        attendedShifts: 19,
        closedWorkdays: 19,
        openWorkdays: 0,
        missingClockOutCount: 0,
        absentCount: 1,
        lateArrivalsCount: 0,
        totalLateMinutes: 0,
        totalScheduledMinutes: 9600,
        totalWorkedMinutes: 9300,
        totalRegularMinutes: 9120,
        totalAuthorizedOvertimeMinutes: 180,
        totalRawOvertimeMinutes: 180,
        totalOvertimeMinutes: 180,
        outOfGeofenceCount: 1,
        outOfGeofenceShiftsCount: 1,
        maxDistanceMeters: 380,
      },
    ],
    shiftsByEmployee: {},
    absences: [],
    outOfGeofenceEvents: [],
  };
}

function buildMockPayroll(query?: { period?: string; siteId?: string }): MonthlyPayrollCalculation {
  const attendanceReport = buildMockMonthlyReport(query);
  return {
    period: attendanceReport.period,
    siteId: attendanceReport.siteId,
    currency: 'ARS',
    generatedAt: attendanceReport.generatedAt,
    totals: {
      employeesCount: 2,
      totalRegularPay: '1364000.00',
      totalOvertimePay: '47250.00',
      totalPay: '1411250.00',
      warningsCount: 0,
    },
    employees: [
      {
        ...attendanceReport.employees[0],
        payType: 'HOURLY',
        baseRateApplied: '4500.00',
        regularPay: '756000.00',
        overtimePay: '27000.00',
        totalPay: '783000.00',
        missingEmployeeRate: false,
        missingPostOvertimeRate: false,
        hasMissingClockOut: false,
        observations: '',
      },
      {
        ...attendanceReport.employees[1],
        payType: 'PER_SHIFT',
        baseRateApplied: '32000.00',
        regularPay: '608000.00',
        overtimePay: '20250.00',
        totalPay: '628250.00',
        missingEmployeeRate: false,
        missingPostOvertimeRate: false,
        hasMissingClockOut: false,
        observations: '1 fichaje(s) fuera de geocerca',
      },
    ],
    attendanceReport,
  };
}

export const telemetryMockApi: TelemetryApi = {
  listClockEvents: () => mockResponse({ items: [], total: 0 }),
  getActiveClockStatus: () => mockResponse({ activeShift: null }),
  createClockEvent: mockUnavailable,
  createManualClockEvent: mockUnavailable,
  correctClockEvent: mockUnavailable,
  listWorkdays: () => mockResponse({ items: [], total: 0 }),
  getWorkday: mockUnavailable,
  getDailyReport: (query) => mockResponse(buildMockDailyReport(query)),
  downloadDailyReportPdf: mockUnavailable,
  getMonthlyReport: (query) => mockResponse(buildMockMonthlyReport(query)),
  downloadMonthlyReportPdf: mockUnavailable,
  getMonthlyPayroll: (query) => mockResponse(buildMockPayroll(query)),
  downloadMonthlyPayrollExcel: mockUnavailable,
  listEmployeeCompensations: () =>
    mockResponse({ items: MOCK_COMPENSATIONS, total: MOCK_COMPENSATIONS.length }),
  upsertEmployeeCompensation: async (targetEmployeeId, input) => {
    const found = MOCK_COMPENSATIONS.find((item) => item.employeeId === targetEmployeeId);
    const updated: EmployeeCompensationView = {
      employeeId: targetEmployeeId,
      firstName: found?.firstName ?? 'Empleado',
      lastName: found?.lastName ?? '',
      employeeNumber: found?.employeeNumber ?? null,
      isActive: true,
      payType: input.payType === 'per_shift' ? 'PER_SHIFT' : 'HOURLY',
      baseRate: Number(input.baseRate).toFixed(2),
      currency: 'ARS',
      updatedAt: new Date().toISOString(),
    };
    if (found) Object.assign(found, updated);
    else MOCK_COMPENSATIONS.push(updated);
    return mockResponse(updated);
  },
  listPostOvertimeRates: () =>
    mockResponse({ items: MOCK_POST_RATES, total: MOCK_POST_RATES.length }),
  upsertPostOvertimeRate: async (targetPostId, input) => {
    const found = MOCK_POST_RATES.find((item) => item.postId === targetPostId);
    const updated: PostOvertimeRateView = {
      postId: targetPostId,
      siteId: found?.siteId ?? siteId(0),
      siteName: found?.siteName ?? 'Planta Norte Pilar',
      postName: found?.postName ?? 'Puesto',
      isActive: true,
      overtimeHourlyRate: Number(input.overtimeHourlyRate).toFixed(2),
      currency: 'ARS',
      updatedAt: new Date().toISOString(),
    };
    if (found) Object.assign(found, updated);
    else MOCK_POST_RATES.push(updated);
    return mockResponse(updated);
  },
  listReportRecipients: () =>
    mockResponse({
      items: MOCK_RECIPIENTS,
      assignableEmployees: [
        {
          employeeId: employeeId(0),
          userId: 'user-mock-1',
          fullName: 'Fernández, Lucía',
          employeeNumber: 'L-1001',
          siteIds: [siteId(0)],
        },
        {
          employeeId: employeeId(1),
          userId: 'user-mock-2',
          fullName: 'Gómez, Martín',
          employeeNumber: 'L-1002',
          siteIds: [siteId(1)],
        },
      ],
    }),
  upsertReportRecipient: async (userId, input) => {
    const found = MOCK_RECIPIENTS.find((item) => item.userId === userId);
    const updated: ReportRecipientView = {
      id: found?.id ?? `rec-mock-${Date.now()}`,
      tenantId: TENANT_ID,
      userId,
      employeeId: input.employeeId ?? found?.employeeId ?? null,
      employeeName: found?.employeeName ?? 'Trabajador asignado',
      employeeNumber: found?.employeeNumber ?? null,
      siteIds: input.siteIds ?? found?.siteIds ?? [siteId(0)],
      isActiveEmployee: true,
      receiveDaily: input.receiveDaily,
      receiveMonthly: input.receiveMonthly,
      receivePayrollExcel: input.receivePayrollExcel,
      assignedByUserId: MOCK_USER_ID,
      updatedAt: new Date().toISOString(),
    };
    if (found) Object.assign(found, updated);
    else MOCK_RECIPIENTS.push(updated);
    return mockResponse(updated);
  },
  removeReportRecipient: async (userId) => {
    const idx = MOCK_RECIPIENTS.findIndex((item) => item.userId === userId);
    if (idx !== -1) MOCK_RECIPIENTS.splice(idx, 1);
    return mockResponse(undefined);
  },
  getSiteReportEmailStatus: (targetSiteId) => {
    const today = mockTodayStr();
    const tomorrow = mockTomorrowStr();
    const daily = MOCK_SITE_EMAIL_REQUESTS.get(
      mockSiteRequestKey(targetSiteId, 'daily_absences_pdf', today),
    );
    const monthly = MOCK_SITE_EMAIL_REQUESTS.get(
      mockSiteRequestKey(targetSiteId, 'monthly_attendance_pdf', today),
    );
    const excel = MOCK_SITE_EMAIL_REQUESTS.get(
      mockSiteRequestKey(targetSiteId, 'monthly_payroll_excel', today),
    );
    const status: SiteReportEmailStatusResponse = {
      siteId: targetSiteId,
      siteName: 'Sede operativa',
      timezone: 'America/Argentina/Buenos_Aires',
      currentDateInSiteTz: today,
      nextAvailableDate: tomorrow,
      nextAvailableAt: `${tomorrow}T03:00:00.000Z`,
      recipientEmailMasked: 'o***@teamworkflow.demo',
      hasProPlan: true,
      permissions: {
        canAccessPanel: true,
        canRequestDaily: true,
        canRequestMonthly: true,
        canRequestPayrollExcel: true,
      },
      requestedToday: {
        dailyAbsencesPdf: {
          requested: Boolean(daily),
          sentAt: daily?.sentAt ?? null,
          targetPeriod: daily?.targetPeriod ?? null,
        },
        monthlyAttendancePdf: {
          requested: Boolean(monthly),
          sentAt: monthly?.sentAt ?? null,
          targetPeriod: monthly?.targetPeriod ?? null,
        },
        monthlyPayrollExcel: {
          requested: Boolean(excel),
          sentAt: excel?.sentAt ?? null,
          targetPeriod: excel?.targetPeriod ?? null,
        },
      },
    };
    return mockResponse(status);
  },
  requestSiteReportEmail: async (targetSiteId, input) => {
    const today = mockTodayStr();
    const tomorrow = mockTomorrowStr();
    const key = mockSiteRequestKey(targetSiteId, input.kind, today);
    if (MOCK_SITE_EMAIL_REQUESTS.has(key)) {
      throw new Error(
        `Solo se puede solicitar este informe una vez al día por sede. Próximo pedido disponible el ${tomorrow}.`,
      );
    }
    const targetPeriod =
      input.kind === 'daily_absences_pdf'
        ? (input.date ?? today)
        : (input.period ?? today.slice(0, 7));
    const sentAt = new Date().toISOString();
    MOCK_SITE_EMAIL_REQUESTS.set(key, { sentAt, targetPeriod });
    const result: RequestSiteReportEmailResponse = {
      requestId: `req-mock-${Date.now()}`,
      siteId: targetSiteId,
      siteName: 'Sede operativa',
      kind: input.kind,
      targetPeriod,
      requestDate: today,
      sentAt,
      sentToEmailMasked: 'o***@teamworkflow.demo',
      nextAvailableDate: tomorrow,
      nextAvailableAt: `${tomorrow}T03:00:00.000Z`,
    };
    return mockResponse(result);
  },

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
