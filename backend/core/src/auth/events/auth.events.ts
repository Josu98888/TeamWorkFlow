// Event contract of the auth service (AGENTS § Events emitted / consumed).
// Single owner of the event names inside `auth`: subjects and filters are built
// only here; every other file imports from this one.

import type { WireRole } from '../wire';

export const AUTH_SERVICE = 'auth';

// Stream owned by auth (backend STEPS S1.2): captures every emitted subject.
export const AUTH_STREAM = 'AUTH_EVENTS';
export const AUTH_STREAM_SUBJECTS = `t.*.${AUTH_SERVICE}.>`;

export const AUTH_EVENTS = {
  userCreated: 'user_created',
  userRoleChanged: 'user_role_changed',
  userDeactivated: 'user_deactivated',
  tenantCreated: 'tenant_created',
  tenantPastDue: 'tenant_past_due',
  tenantSuspended: 'tenant_suspended',
  tenantCancelled: 'tenant_cancelled',
  tenantReactivated: 'tenant_reactivated',
} as const;

export type AuthEventName = (typeof AUTH_EVENTS)[keyof typeof AUTH_EVENTS];

// Business payloads. `eventId` and `occurredAt` are added when publishing.
export interface AuthEventPayloads {
  user_created: {
    userId: string;
    tenantId: string;
    email: string;
    name: string;
    role: WireRole;
  };
  user_role_changed: {
    userId: string;
    tenantId: string;
    role: WireRole;
    actorId: string;
  };
  user_deactivated: { userId: string; tenantId: string; actorId: string };
  tenant_created: { tenantId: string; name: string; ownerId: string };
  tenant_past_due: { tenantId: string; pastDueSince: string };
  tenant_suspended: { tenantId: string; suspendedAt: string };
  tenant_cancelled: { tenantId: string; cancelledAt: string };
  tenant_reactivated: { tenantId: string };
}

export interface EventMeta {
  eventId: string;
  occurredAt: string;
}

export type PublishedAuthEvent<E extends AuthEventName> = AuthEventPayloads[E] &
  EventMeta;

// A tenant id becomes a subject token: it must not contain `.`, `*`, `>` or spaces.
const SUBJECT_TOKEN = /^[A-Za-z0-9_-]+$/;

export function authEventSubject(tenantId: string, event: AuthEventName) {
  if (!SUBJECT_TOKEN.test(tenantId)) {
    throw new Error('Invalid tenant id for an event subject');
  }
  return `t.${tenantId}.${AUTH_SERVICE}.${event}`;
}

// Filter that matches an event of a producer for every tenant.
function consumedSubject(producer: string, event: string) {
  return `t.*.${producer}.${event}`;
}

export const ORGANIZATION_CONSUMED_EVENTS = {
  employeeCreated: 'employee_created',
} as const;

export const BILLING_CONSUMED_EVENTS = {
  subscriptionCreated: 'subscription_created',
  planChanged: 'plan_changed',
  paymentOverdue: 'payment_overdue',
  subscriptionExpired: 'subscription_expired',
  paymentReceived: 'payment_received',
  subscriptionCancelled: 'subscription_cancelled',
  subscriptionReactivated: 'subscription_reactivated',
  dataRetentionExpired: 'data_retention_expired',
} as const;

export const CONSUMED_SUBJECTS = {
  employeeCreated: consumedSubject(
    'organization',
    ORGANIZATION_CONSUMED_EVENTS.employeeCreated,
  ),
  subscriptionCreated: consumedSubject(
    'billing',
    BILLING_CONSUMED_EVENTS.subscriptionCreated,
  ),
  planChanged: consumedSubject('billing', BILLING_CONSUMED_EVENTS.planChanged),
  paymentOverdue: consumedSubject(
    'billing',
    BILLING_CONSUMED_EVENTS.paymentOverdue,
  ),
  subscriptionExpired: consumedSubject(
    'billing',
    BILLING_CONSUMED_EVENTS.subscriptionExpired,
  ),
  paymentReceived: consumedSubject(
    'billing',
    BILLING_CONSUMED_EVENTS.paymentReceived,
  ),
  subscriptionCancelled: consumedSubject(
    'billing',
    BILLING_CONSUMED_EVENTS.subscriptionCancelled,
  ),
  subscriptionReactivated: consumedSubject(
    'billing',
    BILLING_CONSUMED_EVENTS.subscriptionReactivated,
  ),
  dataRetentionExpired: consumedSubject(
    'billing',
    BILLING_CONSUMED_EVENTS.dataRetentionExpired,
  ),
} as const;

export type ConsumedSubject =
  (typeof CONSUMED_SUBJECTS)[keyof typeof CONSUMED_SUBJECTS];

// Durable consumers of auth: `<consumer>-<producer>` over the producer's stream
// (backend STEPS S1.2), filtered to the subjects auth handles.
export interface DurableConsumerSpec {
  durable: string;
  stream: string;
  filterSubjects: ConsumedSubject[];
}

export const AUTH_DURABLE_CONSUMERS: readonly DurableConsumerSpec[] = [
  {
    durable: 'auth-organization',
    stream: 'ORGANIZATION_EVENTS',
    filterSubjects: [CONSUMED_SUBJECTS.employeeCreated],
  },
  {
    durable: 'auth-billing',
    stream: 'BILLING_EVENTS',
    filterSubjects: [
      CONSUMED_SUBJECTS.subscriptionCreated,
      CONSUMED_SUBJECTS.planChanged,
      CONSUMED_SUBJECTS.paymentOverdue,
      CONSUMED_SUBJECTS.subscriptionExpired,
      CONSUMED_SUBJECTS.paymentReceived,
      CONSUMED_SUBJECTS.subscriptionCancelled,
      CONSUMED_SUBJECTS.subscriptionReactivated,
      CONSUMED_SUBJECTS.dataRetentionExpired,
    ],
  },
];

// Fields every consumed event carries. Event-specific fields are typed only for
// the ones auth reads; the rest are added with their handler (Phase 7).
export interface ConsumedEventBase extends EventMeta {
  tenantId: string;
}

export interface ConsumedEventPayloads {
  employee_created: ConsumedEventBase & { email: string };
  subscription_created: ConsumedEventBase & {
    plan: string;
    features: Record<string, boolean>;
  };
  plan_changed: ConsumedEventBase & {
    plan: string;
    features: Record<string, boolean>;
    effectiveAt: string;
  };
  payment_overdue: ConsumedEventBase;
  subscription_expired: ConsumedEventBase;
  payment_received: ConsumedEventBase;
  subscription_cancelled: ConsumedEventBase;
  subscription_reactivated: ConsumedEventBase;
  data_retention_expired: ConsumedEventBase;
}

// The tenant of a consumed event comes from the subject (`t.<tenant>.…`) and
// must be checked against the payload by the handler.
export function tenantIdFromSubject(subject: string): string | null {
  const [prefix, tenantId] = subject.split('.');
  return prefix === 't' && tenantId ? tenantId : null;
}

// Whether a concrete subject matches a filter such as `t.*.billing.plan_changed`.
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
