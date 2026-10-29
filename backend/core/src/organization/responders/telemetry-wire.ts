import type { EmployeeView } from '../employees/employees.service';
import type { ShiftView } from '../shifts/shifts.service';
import type { SiteView } from '../sites/sites.service';

// Wire shapes `telemetry` parses (backend/telemetry/src/nats/dto/nats-contracts.ts).
// They differ from the organization model on purpose: the organization keeps
// its documented names and only these mappers know the telemetry ones.
export interface TelemetrySiteDto {
  id: string;
  tenantId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  qrCode?: string;
}

export interface TelemetryEmployeeDto {
  id: string;
  userId: string;
  tenantId: string;
  firstName?: string;
  lastName?: string;
}

export interface TelemetryShiftDto {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId?: string;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  version: number;
}

// `geofenceRadiusMeters` -> `radiusMeters`. The QR code is sent: the caller is
// the trusted attendance service that validates scans.
export function toTelemetrySite(site: SiteView): TelemetrySiteDto {
  return {
    id: site.id,
    tenantId: site.tenantId,
    name: site.name,
    latitude: site.latitude,
    longitude: site.longitude,
    radiusMeters: site.geofenceRadiusMeters,
    ...(site.qrCode ? { qrCode: site.qrCode } : {}),
  };
}

// Only identity and name travel: no email, phone or national id. `userId` is
// required on the wire; the lookup is by `userId`, so the row always has it.
export function toTelemetryEmployee(
  employee: EmployeeView,
  userId: string,
): TelemetryEmployeeDto {
  return {
    id: employee.id,
    userId: employee.userId ?? userId,
    tenantId: employee.tenantId,
    firstName: employee.firstName,
    lastName: employee.lastName,
  };
}

// `FINISHED` -> `COMPLETED`; `null` employee is omitted; dates are ISO strings.
export function toTelemetryShift(shift: ShiftView): TelemetryShiftDto {
  return {
    id: shift.id,
    tenantId: shift.tenantId,
    siteId: shift.siteId,
    postId: shift.postId,
    ...(shift.employeeId ? { employeeId: shift.employeeId } : {}),
    startsAt: shift.startsAt.toISOString(),
    endsAt: shift.endsAt.toISOString(),
    status: shift.status === 'FINISHED' ? 'COMPLETED' : shift.status,
    version: shift.version,
  };
}
