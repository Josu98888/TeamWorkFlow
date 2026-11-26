import { dayRangeInTz, formatTimeInTz } from './timezone-range';

const NO_SHOW_THRESHOLD_MS = 15 * 60 * 1000;

export interface DailyReportShiftInput {
  shiftId: string;
  siteId: string;
  postId: string;
  employeeId: string | null;
  startsAt: Date;
  endsAt: Date;
  authorizedOvertimeMinutes: number;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

export interface DailyReportClockEventInput {
  id: string;
  shiftId: string;
  employeeId: string;
  siteId: string;
  type: 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END';
  method: 'GPS' | 'QR' | 'MANUAL';
  distanceMeters: number | null;
  outOfGeofence: boolean;
  deviceTime: Date;
}

export interface DailyReportWorkdayInput {
  shiftId: string;
  status: 'OPEN' | 'CLOSED' | 'MISSING_CLOCK_OUT' | 'ABSENT';
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
}

export interface DailyReportAlertInput {
  id: string;
  clockEventId: string | null;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
}

export interface DailyAbsenceItem {
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
}

export interface DailyOutOfGeofenceItem {
  clockEventId: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  siteId: string;
  siteName: string;
  postId: string;
  postName: string;
  type: 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END';
  method: 'GPS' | 'QR' | 'MANUAL';
  deviceTime: string;
  localTime: string;
  distanceMeters: number | null;
  alertId: string | null;
  alertStatus: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | null;
}

export interface DailyAttendanceReportPayload {
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
}

export function buildDailyReportPayload(input: {
  reportDate: string;
  siteId?: string | null;
  defaultTz: string;
  now: Date;
  sitesById: Map<string, { name: string; timezone: string }>;
  postsById: Map<string, { name: string }>;
  employeesById: Map<
    string,
    { firstName: string; lastName: string; employeeNumber: string | null }
  >;
  shifts: DailyReportShiftInput[];
  clockEvents: DailyReportClockEventInput[];
  workdays: DailyReportWorkdayInput[];
  alerts: DailyReportAlertInput[];
}): DailyAttendanceReportPayload {
  const siteRanges = new Map<string, { start: Date; end: Date; tz: string }>();
  const getSiteRange = (siteId: string) => {
    let cached = siteRanges.get(siteId);
    if (!cached) {
      const tz = input.sitesById.get(siteId)?.timezone ?? input.defaultTz;
      const range = dayRangeInTz(input.reportDate, tz);
      cached = { ...range, tz };
      siteRanges.set(siteId, cached);
    }
    return cached;
  };

  const shiftById = new Map(input.shifts.map((s) => [s.shiftId, s]));
  const workdayByShift = new Map(input.workdays.map((w) => [w.shiftId, w]));
  const alertByClockEvent = new Map(
    input.alerts
      .filter((a) => a.clockEventId !== null)
      .map((a) => [a.clockEventId!, a]),
  );

  const inEventsByShift = new Set<string>();
  for (const evt of input.clockEvents) {
    if (evt.type === 'IN') {
      inEventsByShift.add(evt.shiftId);
    }
  }

  let totalAssignedShifts = 0;
  let unassignedShiftsCount = 0;
  let attendedShifts = 0;
  let missingClockOutCount = 0;
  const absences: DailyAbsenceItem[] = [];

  for (const shift of input.shifts) {
    if (shift.status === 'CANCELLED') continue;
    if (input.siteId && shift.siteId !== input.siteId) continue;

    const range = getSiteRange(shift.siteId);
    const startMs = shift.startsAt.getTime();
    if (startMs < range.start.getTime() || startMs >= range.end.getTime()) {
      continue;
    }

    if (!shift.employeeId) {
      unassignedShiftsCount++;
      continue;
    }

    totalAssignedShifts++;
    const hasIn = inEventsByShift.has(shift.shiftId);
    const workday = workdayByShift.get(shift.shiftId);

    if (workday?.status === 'MISSING_CLOCK_OUT') {
      missingClockOutCount++;
    }

    if (hasIn) {
      attendedShifts++;
      continue;
    }

    const isEnded =
      shift.status === 'COMPLETED' ||
      workday?.status === 'ABSENT' ||
      shift.endsAt.getTime() <= input.now.getTime();
    const isPastNoShowThreshold =
      input.now.getTime() >= shift.startsAt.getTime() + NO_SHOW_THRESHOLD_MS;

    if (isEnded || isPastNoShowThreshold) {
      const emp = input.employeesById.get(shift.employeeId);
      const site = input.sitesById.get(shift.siteId);
      const post = input.postsById.get(shift.postId);

      absences.push({
        shiftId: shift.shiftId,
        employeeId: shift.employeeId,
        employeeName: emp
          ? `${emp.lastName}, ${emp.firstName}`
          : shift.employeeId,
        employeeNumber: emp?.employeeNumber ?? null,
        siteId: shift.siteId,
        siteName: site?.name ?? 'Sede',
        postId: shift.postId,
        postName: post?.name ?? 'Puesto',
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        scheduledWindow: `${formatTimeInTz(shift.startsAt, range.tz)} - ${formatTimeInTz(shift.endsAt, range.tz)}`,
        absenceStatus: isEnded ? 'CONFIRMED_ABSENCE' : 'IN_PROGRESS_NO_SHOW',
      });
    }
  }

  absences.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'es'));

  const outOfGeofenceEvents: DailyOutOfGeofenceItem[] = [];
  for (const evt of input.clockEvents) {
    if (!evt.outOfGeofence) continue;
    if (input.siteId && evt.siteId !== input.siteId) continue;

    const range = getSiteRange(evt.siteId);
    const evtMs = evt.deviceTime.getTime();
    if (evtMs < range.start.getTime() || evtMs >= range.end.getTime()) {
      continue;
    }

    const emp = input.employeesById.get(evt.employeeId);
    const site = input.sitesById.get(evt.siteId);
    const shift = shiftById.get(evt.shiftId);
    const post = shift ? input.postsById.get(shift.postId) : undefined;
    const alert = alertByClockEvent.get(evt.id);

    outOfGeofenceEvents.push({
      clockEventId: evt.id,
      shiftId: evt.shiftId,
      employeeId: evt.employeeId,
      employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : evt.employeeId,
      employeeNumber: emp?.employeeNumber ?? null,
      siteId: evt.siteId,
      siteName: site?.name ?? 'Sede',
      postId: shift?.postId ?? '',
      postName: post?.name ?? 'Puesto',
      type: evt.type,
      method: evt.method,
      deviceTime: evt.deviceTime.toISOString(),
      localTime: formatTimeInTz(evt.deviceTime, range.tz),
      distanceMeters:
        evt.distanceMeters !== null ? Math.round(evt.distanceMeters) : null,
      alertId: alert?.id ?? null,
      alertStatus: alert?.status ?? null,
    });
  }

  outOfGeofenceEvents.sort((a, b) => a.deviceTime.localeCompare(b.deviceTime));

  return {
    reportDate: input.reportDate,
    siteId: input.siteId ?? null,
    generatedAt: input.now.toISOString(),
    summary: {
      totalAssignedShifts,
      unassignedShiftsCount,
      attendedShifts,
      absentCount: absences.length,
      outOfGeofenceCount: outOfGeofenceEvents.length,
      missingClockOutCount,
    },
    absences,
    outOfGeofenceEvents,
  };
}
