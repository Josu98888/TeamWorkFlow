export const NATS_PATTERNS = {
  AUTH_TOKEN_VERIFY: 'auth.token.verify',
  ORGANIZATION_EMPLOYEE_GET: 'organization.employee.get',
  ORGANIZATION_SITE_GET: 'organization.site.get',
  ORGANIZATION_SHIFT_GET: 'organization.shift.get',
} as const;

export const JETSTREAM_STREAMS = {
  ATTENDANCE: 'ATTENDANCE_EVENTS',
} as const;

export function buildAttendanceSubject(tenantId: string, eventName: string): string {
  return `t.${tenantId}.attendance.${eventName}`;
}
