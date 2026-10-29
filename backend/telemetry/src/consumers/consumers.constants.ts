export const CONSUMED_STREAMS = {
  ORGANIZATION: 'ORGANIZATION_EVENTS',
  AUTH: 'AUTH_EVENTS',
  BILLING: 'BILLING_EVENTS',
} as const;

export const CONSUMED_SUBJECTS = {
  // Organization events
  SHIFT_CREATED: 't.*.organization.shift_created',
  SHIFT_UPDATED: 't.*.organization.shift_updated',
  SHIFT_CANCELLED: 't.*.organization.shift_cancelled',
  SHIFT_STARTED: 't.*.organization.shift_started',
  SHIFT_ENDED: 't.*.organization.shift_ended',
  SHIFT_STARTING: 't.*.organization.shift_starting',
  SITE_UPDATED: 't.*.organization.site_updated',

  // Auth events
  TENANT_SUSPENDED: 't.*.auth.tenant_suspended',
  TENANT_CANCELLED: 't.*.auth.tenant_cancelled',
  TENANT_REACTIVATED: 't.*.auth.tenant_reactivated',

  // Billing events
  SUBSCRIPTION_CREATED: 't.*.billing.subscription_created',
  PLAN_CHANGED: 't.*.billing.plan_changed',
  DATA_RETENTION_EXPIRED: 't.*.billing.data_retention_expired',
} as const;

export type ConsumedSubject =
  (typeof CONSUMED_SUBJECTS)[keyof typeof CONSUMED_SUBJECTS];

export interface DurableConsumerSpec {
  durable: string;
  stream: string;
  filterSubjects: string[];
}

export const TELEMETRY_DURABLE_CONSUMERS: readonly DurableConsumerSpec[] = [
  {
    durable: 'telemetry-organization',
    stream: CONSUMED_STREAMS.ORGANIZATION,
    filterSubjects: [
      CONSUMED_SUBJECTS.SHIFT_CREATED,
      CONSUMED_SUBJECTS.SHIFT_UPDATED,
      CONSUMED_SUBJECTS.SHIFT_CANCELLED,
      CONSUMED_SUBJECTS.SHIFT_STARTED,
      CONSUMED_SUBJECTS.SHIFT_ENDED,
      CONSUMED_SUBJECTS.SHIFT_STARTING,
      CONSUMED_SUBJECTS.SITE_UPDATED,
    ],
  },
  {
    durable: 'telemetry-auth',
    stream: CONSUMED_STREAMS.AUTH,
    filterSubjects: [
      CONSUMED_SUBJECTS.TENANT_SUSPENDED,
      CONSUMED_SUBJECTS.TENANT_CANCELLED,
      CONSUMED_SUBJECTS.TENANT_REACTIVATED,
    ],
  },
  {
    durable: 'telemetry-billing',
    stream: CONSUMED_STREAMS.BILLING,
    filterSubjects: [
      CONSUMED_SUBJECTS.SUBSCRIPTION_CREATED,
      CONSUMED_SUBJECTS.PLAN_CHANGED,
      CONSUMED_SUBJECTS.DATA_RETENTION_EXPIRED,
    ],
  },
];

/**
 * Extracts the tenantId from a subject formatted as `t.<tenantId>.<module>.<event>`.
 */
export function tenantIdFromSubject(subject: string): string | null {
  const [prefix, tenantId] = subject.split('.');
  return prefix === 't' && tenantId ? tenantId : null;
}

/**
 * Checks whether a concrete subject matches a wildcard filter such as `t.*.organization.shift_created`.
 */
export function subjectMatches(filter: string, subject: string): boolean {
  const filterTokens = filter.split('.');
  const subjectTokens = subject.split('.');
  for (let i = 0; i < filterTokens.length; i++) {
    if (filterTokens[i] === '>') return subjectTokens.length > i;
    if (i >= subjectTokens.length) return false;
    if (filterTokens[i] !== '*' && filterTokens[i] !== subjectTokens[i]) {
      return false;
    }
  }
  return filterTokens.length === subjectTokens.length;
}
