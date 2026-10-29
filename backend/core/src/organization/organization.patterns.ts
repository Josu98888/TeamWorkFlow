// Operation names of the organization module (AGENTS § NATS Contract).
// In `core` they are in-process facade calls; only `siteGet`, `employeeGet` and
// `shiftGet` are also NATS request-reply responders (for `telemetry`).
export const ORGANIZATION_PATTERNS = {
  siteCreate: 'organization.site.create',
  siteUpdate: 'organization.site.update',
  siteGet: 'organization.site.get',
  siteList: 'organization.site.list',
  siteRotateQr: 'organization.site.rotate-qr',
  postCreate: 'organization.post.create',
  postUpdate: 'organization.post.update',
  postList: 'organization.post.list',
  employeeCreate: 'organization.employee.create',
  employeeUpdate: 'organization.employee.update',
  employeeGet: 'organization.employee.get',
  employeeList: 'organization.employee.list',
  employeeListAvailable: 'organization.employee.list-available',
  shiftTemplateCreate: 'organization.shift-template.create',
  shiftTemplateUpdate: 'organization.shift-template.update',
  shiftTemplateDeactivate: 'organization.shift-template.deactivate',
  shiftTemplateList: 'organization.shift-template.list',
  shiftCreate: 'organization.shift.create',
  shiftUpdate: 'organization.shift.update',
  shiftReassign: 'organization.shift.reassign',
  shiftCancel: 'organization.shift.cancel',
  shiftGet: 'organization.shift.get',
  shiftList: 'organization.shift.list',
} as const;

export type OrganizationPattern =
  (typeof ORGANIZATION_PATTERNS)[keyof typeof ORGANIZATION_PATTERNS];

// Patterns answered over NATS request-reply for `telemetry`.
export const ORGANIZATION_RESPONDER_PATTERNS = [
  ORGANIZATION_PATTERNS.siteGet,
  ORGANIZATION_PATTERNS.employeeGet,
  ORGANIZATION_PATTERNS.shiftGet,
] as const;

export const ORGANIZATION_MODULE = 'organization';

// Stream owned by organization (backend STEPS S1.2): captures every emitted subject.
export const ORGANIZATION_STREAM = 'ORGANIZATION_EVENTS';
export const ORGANIZATION_STREAM_SUBJECTS = `t.*.${ORGANIZATION_MODULE}.>`;

export const ORGANIZATION_EVENTS = {
  employeeCreated: 'employee_created',
  siteUpdated: 'site_updated',
  shiftCreated: 'shift_created',
  shiftUpdated: 'shift_updated',
  shiftCancelled: 'shift_cancelled',
  shiftStarting: 'shift_starting',
  shiftStarted: 'shift_started',
  shiftEnded: 'shift_ended',
} as const;

export type OrganizationEventName =
  (typeof ORGANIZATION_EVENTS)[keyof typeof ORGANIZATION_EVENTS];

// A tenant id becomes a subject token: it must not contain `.`, `*`, `>` or spaces.
const SUBJECT_TOKEN = /^[A-Za-z0-9_-]+$/;

// `t.<tenant>.organization.<event>`
export function organizationEventSubject(
  tenantId: string,
  event: OrganizationEventName,
) {
  if (!SUBJECT_TOKEN.test(tenantId)) {
    throw new Error('Invalid tenant id for an event subject');
  }
  return `t.${tenantId}.${ORGANIZATION_MODULE}.${event}`;
}
