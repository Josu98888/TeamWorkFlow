import {
  formatDateInTz,
  formatTimeInTz,
  monthRangeInTz,
} from './timezone-range';
import type {
  DailyAbsenceItem,
  DailyOutOfGeofenceItem,
  DailyReportAlertInput,
  DailyReportClockEventInput,
  DailyReportShiftInput,
  DailyReportWorkdayInput,
} from './daily-report-builder';

export interface MonthlyShiftDetailItem {
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
  workdayStatus: 'OPEN' | 'CLOSED' | 'MISSING_CLOCK_OUT' | 'ABSENT';
  workedMinutes: number;
  regularMinutes: number;
  rawOvertimeMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  outOfGeofenceCount: number;
}

export interface MonthlyEmployeeSummaryItem {
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
}

export interface MonthlyAttendanceReportPayload {
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
}

export function buildMonthlyAttendanceReport(input: {
  period: string;
  siteId?: string | null;
  employeeId?: string | null;
  defaultTz: string;
  now: Date;
  sitesById: Map<string, { name: string; timezone: string }>;
  postsById: Map<string, { name: string }>;
  employeesById: Map<
    string,
    {
      firstName: string;
      lastName: string;
      employeeNumber: string | null;
      isActive: boolean;
    }
  >;
  shifts: DailyReportShiftInput[];
  clockEvents: DailyReportClockEventInput[];
  workdays: (DailyReportWorkdayInput & {
    rawOvertimeMinutes?: number;
    authorizedOvertimeMinutes?: number;
    firstInAt?: Date | null;
    lastOutAt?: Date | null;
  })[];
  alerts: DailyReportAlertInput[];
}): MonthlyAttendanceReportPayload {
  const siteRanges = new Map<string, { start: Date; end: Date; tz: string }>();
  const getSiteRange = (siteId: string) => {
    let cached = siteRanges.get(siteId);
    if (!cached) {
      const tz = input.sitesById.get(siteId)?.timezone ?? input.defaultTz;
      const range = monthRangeInTz(input.period, tz);
      cached = { ...range, tz };
      siteRanges.set(siteId, cached);
    }
    return cached;
  };

  const workdayByShift = new Map(input.workdays.map((w) => [w.shiftId, w]));
  const shiftById = new Map(input.shifts.map((s) => [s.shiftId, s]));
  const alertByClockEvent = new Map(
    input.alerts
      .filter((a) => a.clockEventId !== null)
      .map((a) => [a.clockEventId!, a]),
  );

  const eventsByShift = new Map<string, DailyReportClockEventInput[]>();
  for (const evt of input.clockEvents) {
    const list = eventsByShift.get(evt.shiftId) ?? [];
    list.push(evt);
    eventsByShift.set(evt.shiftId, list);
  }

  const empSummaries = new Map<string, MonthlyEmployeeSummaryItem>();
  const shiftsByEmployee: Record<string, MonthlyShiftDetailItem[]> = {};
  const absences: DailyAbsenceItem[] = [];

  const ensureEmployee = (empId: string): MonthlyEmployeeSummaryItem => {
    let item = empSummaries.get(empId);
    if (!item) {
      const meta = input.employeesById.get(empId);
      const firstName = meta?.firstName ?? '';
      const lastName = meta?.lastName ?? empId;
      item = {
        employeeId: empId,
        employeeNumber: meta?.employeeNumber ?? null,
        firstName,
        lastName,
        fullName: firstName ? `${lastName}, ${firstName}` : lastName,
        isActive: meta?.isActive ?? true,
        totalAssignedShifts: 0,
        upcomingShiftsCount: 0,
        attendedShifts: 0,
        closedWorkdays: 0,
        openWorkdays: 0,
        missingClockOutCount: 0,
        absentCount: 0,
        lateArrivalsCount: 0,
        totalLateMinutes: 0,
        totalScheduledMinutes: 0,
        totalWorkedMinutes: 0,
        totalRegularMinutes: 0,
        totalAuthorizedOvertimeMinutes: 0,
        totalRawOvertimeMinutes: 0,
        totalOvertimeMinutes: 0,
        outOfGeofenceCount: 0,
        outOfGeofenceShiftsCount: 0,
        maxDistanceMeters: null,
      };
      empSummaries.set(empId, item);
      shiftsByEmployee[empId] = [];
    }
    return item;
  };

  for (const shift of input.shifts) {
    if (shift.status === 'CANCELLED' || !shift.employeeId) continue;
    if (input.siteId && shift.siteId !== input.siteId) continue;
    if (input.employeeId && shift.employeeId !== input.employeeId) continue;

    const range = getSiteRange(shift.siteId);
    const startMs = shift.startsAt.getTime();
    if (startMs < range.start.getTime() || startMs >= range.end.getTime()) {
      continue;
    }

    const summary = ensureEmployee(shift.employeeId);
    if (startMs > input.now.getTime()) {
      summary.upcomingShiftsCount++;
      continue;
    }

    summary.totalAssignedShifts++;
    const scheduledMinutes = Math.max(
      0,
      Math.floor((shift.endsAt.getTime() - startMs) / 60000),
    );
    summary.totalScheduledMinutes += scheduledMinutes;
    summary.totalAuthorizedOvertimeMinutes += Math.max(
      0,
      shift.authorizedOvertimeMinutes ?? 0,
    );

    const shiftEvents = (eventsByShift.get(shift.shiftId) ?? []).sort(
      (a, b) => a.deviceTime.getTime() - b.deviceTime.getTime(),
    );
    const inEvents = shiftEvents.filter((e) => e.type === 'IN');
    const outEvents = shiftEvents.filter((e) => e.type === 'OUT');
    const oofEvents = shiftEvents.filter((e) => e.outOfGeofence);
    const workday = workdayByShift.get(shift.shiftId);

    const hasIn = inEvents.length > 0;
    let workdayStatus: 'OPEN' | 'CLOSED' | 'MISSING_CLOCK_OUT' | 'ABSENT';
    if (workday) {
      workdayStatus = workday.status;
    } else if (hasIn) {
      workdayStatus = outEvents.length > 0 ? 'CLOSED' : 'OPEN';
    } else if (
      shift.status === 'COMPLETED' ||
      shift.endsAt.getTime() <= input.now.getTime()
    ) {
      workdayStatus = 'ABSENT';
    } else {
      workdayStatus = 'OPEN';
    }

    const site = input.sitesById.get(shift.siteId);
    const post = input.postsById.get(shift.postId);

    if (workdayStatus === 'ABSENT') {
      summary.absentCount++;
      absences.push({
        shiftId: shift.shiftId,
        employeeId: shift.employeeId,
        employeeName: summary.fullName,
        employeeNumber: summary.employeeNumber,
        siteId: shift.siteId,
        siteName: site?.name ?? 'Sede',
        postId: shift.postId,
        postName: post?.name ?? 'Puesto',
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        scheduledWindow: `${formatTimeInTz(shift.startsAt, range.tz)} - ${formatTimeInTz(shift.endsAt, range.tz)}`,
        absenceStatus: 'CONFIRMED_ABSENCE',
      });
    } else if (hasIn) {
      summary.attendedShifts++;
      if (workdayStatus === 'CLOSED') summary.closedWorkdays++;
      else if (workdayStatus === 'MISSING_CLOCK_OUT') {
        summary.missingClockOutCount++;
      } else {
        summary.openWorkdays++;
      }
    }

    const workedMinutes =
      workdayStatus === 'CLOSED' ? (workday?.workedMinutes ?? 0) : 0;
    const overtimeMinutes =
      workdayStatus === 'CLOSED' ? (workday?.overtimeMinutes ?? 0) : 0;
    const rawOvertimeMinutes =
      workdayStatus === 'CLOSED'
        ? (workday?.rawOvertimeMinutes ?? overtimeMinutes)
        : 0;
    const regularMinutes = Math.max(0, workedMinutes - overtimeMinutes);
    const lateMinutes = workday?.lateMinutes ?? 0;

    if (lateMinutes > 0) {
      summary.lateArrivalsCount++;
      summary.totalLateMinutes += lateMinutes;
    }

    summary.totalWorkedMinutes += workedMinutes;
    summary.totalRegularMinutes += regularMinutes;
    summary.totalRawOvertimeMinutes += rawOvertimeMinutes;
    summary.totalOvertimeMinutes += overtimeMinutes;

    if (oofEvents.length > 0) {
      summary.outOfGeofenceShiftsCount++;
    }

    shiftsByEmployee[shift.employeeId].push({
      shiftId: shift.shiftId,
      date: formatDateInTz(shift.startsAt, range.tz),
      siteId: shift.siteId,
      siteName: site?.name ?? 'Sede',
      postId: shift.postId,
      postName: post?.name ?? 'Puesto',
      scheduledWindow: `${formatTimeInTz(shift.startsAt, range.tz)} - ${formatTimeInTz(shift.endsAt, range.tz)}`,
      startsAt: shift.startsAt.toISOString(),
      endsAt: shift.endsAt.toISOString(),
      scheduledMinutes,
      authorizedOvertimeMinutes: shift.authorizedOvertimeMinutes ?? 0,
      firstInAt:
        workday?.firstInAt?.toISOString() ??
        inEvents[0]?.deviceTime.toISOString() ??
        null,
      lastOutAt:
        workday?.lastOutAt?.toISOString() ??
        outEvents[outEvents.length - 1]?.deviceTime.toISOString() ??
        null,
      workdayStatus,
      workedMinutes,
      regularMinutes,
      rawOvertimeMinutes,
      overtimeMinutes,
      lateMinutes,
      outOfGeofenceCount: oofEvents.length,
    });
  }

  const outOfGeofenceEvents: DailyOutOfGeofenceItem[] = [];
  for (const evt of input.clockEvents) {
    if (!evt.outOfGeofence) continue;
    if (input.siteId && evt.siteId !== input.siteId) continue;
    if (input.employeeId && evt.employeeId !== input.employeeId) continue;

    const range = getSiteRange(evt.siteId);
    const evtMs = evt.deviceTime.getTime();
    if (evtMs < range.start.getTime() || evtMs >= range.end.getTime()) {
      continue;
    }

    const summary = ensureEmployee(evt.employeeId);
    summary.outOfGeofenceCount++;
    const dist =
      evt.distanceMeters !== null ? Math.round(evt.distanceMeters) : null;
    if (
      dist !== null &&
      (summary.maxDistanceMeters === null || dist > summary.maxDistanceMeters)
    ) {
      summary.maxDistanceMeters = dist;
    }

    const site = input.sitesById.get(evt.siteId);
    const shift = shiftById.get(evt.shiftId);
    const post = shift ? input.postsById.get(shift.postId) : undefined;
    const alert = alertByClockEvent.get(evt.id);

    outOfGeofenceEvents.push({
      clockEventId: evt.id,
      shiftId: evt.shiftId,
      employeeId: evt.employeeId,
      employeeName: summary.fullName,
      employeeNumber: summary.employeeNumber,
      siteId: evt.siteId,
      siteName: site?.name ?? 'Sede',
      postId: shift?.postId ?? '',
      postName: post?.name ?? 'Puesto',
      type: evt.type,
      method: evt.method,
      deviceTime: evt.deviceTime.toISOString(),
      localTime: `${formatDateInTz(evt.deviceTime, range.tz)} ${formatTimeInTz(evt.deviceTime, range.tz)}`,
      distanceMeters: dist,
      alertId: alert?.id ?? null,
      alertStatus: alert?.status ?? null,
    });
  }

  const employees = [...empSummaries.values()].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'es'),
  );
  for (const list of Object.values(shiftsByEmployee)) {
    list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  outOfGeofenceEvents.sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));

  return {
    period: input.period,
    siteId: input.siteId ?? null,
    generatedAt: input.now.toISOString(),
    summary: {
      employeesCount: employees.length,
      totalAssignedShifts: employees.reduce(
        (acc, e) => acc + e.totalAssignedShifts,
        0,
      ),
      totalAttendedShifts: employees.reduce(
        (acc, e) => acc + e.attendedShifts,
        0,
      ),
      totalAbsentShifts: employees.reduce((acc, e) => acc + e.absentCount, 0),
      totalMissingClockOuts: employees.reduce(
        (acc, e) => acc + e.missingClockOutCount,
        0,
      ),
      totalOutOfGeofence: outOfGeofenceEvents.length,
      totalWorkedMinutes: employees.reduce(
        (acc, e) => acc + e.totalWorkedMinutes,
        0,
      ),
      totalRegularMinutes: employees.reduce(
        (acc, e) => acc + e.totalRegularMinutes,
        0,
      ),
      totalOvertimeMinutes: employees.reduce(
        (acc, e) => acc + e.totalOvertimeMinutes,
        0,
      ),
    },
    employees,
    shiftsByEmployee,
    absences,
    outOfGeofenceEvents,
  };
}
