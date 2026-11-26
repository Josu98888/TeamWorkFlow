import type { EmployeeView } from '../employees/employees.service';
import type { ShiftView } from '../shifts/shifts.service';
import type { PostView } from '../sites/posts.service';
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
  timezone?: string;
  isActive?: boolean;
}

export interface TelemetryPostDto {
  id: string;
  tenantId: string;
  siteId: string;
  name: string;
  isActive: boolean;
}

export interface TelemetryEmployeeDto {
  id: string;
  userId: string;
  tenantId: string;
  firstName?: string;
  lastName?: string;
  employeeNumber?: string | null;
  isActive?: boolean;
}

export interface TelemetryEmployeeCatalogDto {
  id: string;
  userId: string | null;
  tenantId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  isActive: boolean;
}

export interface TelemetryShiftDto {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId?: string;
  startsAt: string;
  endsAt: string;
  authorizedOvertimeMinutes?: number;
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

export function toTelemetrySiteCatalog(site: SiteView): TelemetrySiteDto {
  return {
    id: site.id,
    tenantId: site.tenantId,
    name: site.name,
    timezone: site.timezone,
    isActive: site.isActive,
    latitude: site.latitude,
    longitude: site.longitude,
    radiusMeters: site.geofenceRadiusMeters,
  };
}

export function toTelemetryPost(post: PostView): TelemetryPostDto {
  return {
    id: post.id,
    tenantId: post.tenantId,
    siteId: post.siteId,
    name: post.name,
    isActive: post.isActive,
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

export function toTelemetryEmployeeCatalog(
  employee: EmployeeView,
): TelemetryEmployeeCatalogDto {
  return {
    id: employee.id,
    userId: employee.userId,
    tenantId: employee.tenantId,
    firstName: employee.firstName,
    lastName: employee.lastName,
    employeeNumber: employee.employeeNumber,
    isActive: employee.isActive,
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
    ...(shift.authorizedOvertimeMinutes !== undefined
      ? { authorizedOvertimeMinutes: shift.authorizedOvertimeMinutes }
      : {}),
    status: shift.status === 'FINISHED' ? 'COMPLETED' : shift.status,
    version: shift.version,
  };
}
