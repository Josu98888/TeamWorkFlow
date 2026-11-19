export const ORGANIZATION_STREAM = 'ORGANIZATION_EVENTS';
export const AUTH_STREAM = 'AUTH_EVENTS';
export const BILLING_STREAM = 'BILLING_EVENTS';

export const CONSUMED_SUBJECTS = {
  orgShiftStarted: 't.*.organization.shift_started',
  orgShiftCancelled: 't.*.organization.shift_cancelled',
  authTenantSuspended: 't.*.auth.tenant_suspended',
  authTenantCancelled: 't.*.auth.tenant_cancelled',
  authTenantReactivated: 't.*.auth.tenant_reactivated',
  billingSubscriptionCreated: 't.*.billing.subscription_created',
  billingPlanChanged: 't.*.billing.plan_changed',
  billingDataRetentionExpired: 't.*.billing.data_retention_expired',
} as const;

export type ConsumedSubject =
  (typeof CONSUMED_SUBJECTS)[keyof typeof CONSUMED_SUBJECTS];

export interface DurableConsumerSpec {
  durable: string;
  stream: string;
  filterSubjects: ConsumedSubject[];
}

export const TASKS_DURABLE_CONSUMERS: readonly DurableConsumerSpec[] = [
  {
    durable: 'tasks-organization',
    stream: ORGANIZATION_STREAM,
    filterSubjects: [
      CONSUMED_SUBJECTS.orgShiftStarted,
      CONSUMED_SUBJECTS.orgShiftCancelled,
    ],
  },
  {
    durable: 'tasks-auth',
    stream: AUTH_STREAM,
    filterSubjects: [
      CONSUMED_SUBJECTS.authTenantSuspended,
      CONSUMED_SUBJECTS.authTenantCancelled,
      CONSUMED_SUBJECTS.authTenantReactivated,
    ],
  },
  {
    durable: 'tasks-billing',
    stream: BILLING_STREAM,
    filterSubjects: [
      CONSUMED_SUBJECTS.billingSubscriptionCreated,
      CONSUMED_SUBJECTS.billingPlanChanged,
      CONSUMED_SUBJECTS.billingDataRetentionExpired,
    ],
  },
];

export interface ConsumedMessage {
  subject: string;
  tenantId: string | null;
  payload: unknown;
}

export function tenantIdFromSubject(subject: string): string | null {
  const [prefix, tenantId] = subject.split('.');
  return prefix === 't' && tenantId ? tenantId : null;
}

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
