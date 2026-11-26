export const NATS_PATTERNS = {
  AUTH_TOKEN_VERIFY: 'auth.token.verify',
  ORGANIZATION_EMPLOYEE_GET: 'organization.employee.get',
  ORGANIZATION_EMPLOYEE_LIST: 'organization.employee.list',
  ORGANIZATION_SITE_GET: 'organization.site.get',
  ORGANIZATION_SITE_LIST: 'organization.site.list',
  ORGANIZATION_POST_LIST: 'organization.post.list',
  ORGANIZATION_SHIFT_GET: 'organization.shift.get',
} as const;

export const JETSTREAM_STREAMS = {
  ATTENDANCE: 'ATTENDANCE_EVENTS',
} as const;

export function buildAttendanceSubject(tenantId: string, eventName: string): string {
  return `t.${tenantId}.attendance.${eventName}`;
}

// DI token of the Nest NATS ClientProxy used for request/reply to core.
// Kept here because telemetry has no config/services.ts.
export const NATS_SERVICE = 'NATS_SERVICE';
