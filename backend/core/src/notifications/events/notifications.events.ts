import {
  NOTIFICATIONS_MODULE,
  NOTIFICATIONS_STREAM,
} from '../notifications.patterns';

export const NOTIFICATIONS_EVENTS = {
  send: 'send',
} as const;

export type NotificationsEventName =
  (typeof NOTIFICATIONS_EVENTS)[keyof typeof NOTIFICATIONS_EVENTS];

export const AUTH_STREAM = 'AUTH_EVENTS';
export const TASKS_STREAM = 'TASKS_EVENTS';
export const BILLING_STREAM = 'BILLING_EVENTS';
export const ATTENDANCE_STREAM = 'ATTENDANCE_EVENTS';

export const CONSUMED_SUBJECTS = {
  notificationsSend: 't.*.notifications.send',
  attendanceAlertOpened: 't.*.attendance.alert_opened',
  tasksTaskAssigned: 't.*.tasks.task_assigned',
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

export const NOTIFICATIONS_DURABLE_CONSUMERS: readonly DurableConsumerSpec[] =
  [
    {
      durable: 'notifications-generic',
      stream: NOTIFICATIONS_STREAM,
      filterSubjects: [CONSUMED_SUBJECTS.notificationsSend],
    },
    {
      durable: 'notifications-telemetry',
      stream: ATTENDANCE_STREAM,
      filterSubjects: [CONSUMED_SUBJECTS.attendanceAlertOpened],
    },
    {
      durable: 'notifications-tasks',
      stream: TASKS_STREAM,
      filterSubjects: [CONSUMED_SUBJECTS.tasksTaskAssigned],
    },
    {
      durable: 'notifications-auth',
      stream: AUTH_STREAM,
      filterSubjects: [
        CONSUMED_SUBJECTS.authTenantSuspended,
        CONSUMED_SUBJECTS.authTenantCancelled,
        CONSUMED_SUBJECTS.authTenantReactivated,
      ],
    },
    {
      durable: 'notifications-billing',
      stream: BILLING_STREAM,
      filterSubjects: [
        CONSUMED_SUBJECTS.billingSubscriptionCreated,
        CONSUMED_SUBJECTS.billingPlanChanged,
        CONSUMED_SUBJECTS.billingDataRetentionExpired,
      ],
    },
  ];

export interface EventMeta {
  eventId: string;
  occurredAt: string;
}

export interface NotificationsSendPayload extends EventMeta {
  tenantId: string;
  recipientUserIds: string[];
  templateCode: string;
  data?: Record<string, unknown>;
  locale?: string;
}

export interface AttendanceAlertOpenedPayload extends EventMeta {
  tenantId: string;
  alertId?: string;
  siteId: string;
  siteName?: string;
  employeeId?: string | null;
  employeeName?: string;
  type: string;
  severity?: string;
}

export interface TasksTaskAssignedPayload extends EventMeta {
  tenantId: string;
  taskId: string;
  employeeId: string | null;
  siteId: string;
  postId?: string;
  shiftId?: string | null;
  title: string;
  deadline: string;
}

export interface AuthTenantSuspendedPayload extends EventMeta {
  tenantId: string;
  reason?: string;
}

export interface AuthTenantCancelledPayload extends EventMeta {
  tenantId: string;
  cancelledAt?: string;
  retentionUntil?: string;
}

export interface AuthTenantReactivatedPayload extends EventMeta {
  tenantId: string;
}

export interface BillingSubscriptionCreatedPayload extends EventMeta {
  tenantId: string;
  plan: string;
  features: Record<string, boolean>;
  status?: string;
  trialEndsAt?: string;
}

export interface BillingPlanChangedPayload extends EventMeta {
  tenantId: string;
  plan: string;
  features: Record<string, boolean>;
  previousPlan?: string;
  effectiveAt?: string;
}

export interface BillingDataRetentionExpiredPayload extends EventMeta {
  tenantId: string;
}

export interface ConsumedMessage {
  subject: string;
  tenantId: string | null;
  payload: unknown;
}

// A tenant id becomes a subject token: it must not contain `.`, `*`, `>` or spaces.
const SUBJECT_TOKEN = /^[A-Za-z0-9_-]+$/;

export function notificationsEventSubject(
  tenantId: string,
  event: NotificationsEventName,
): string {
  if (!SUBJECT_TOKEN.test(tenantId)) {
    throw new Error('Invalid tenant id for an event subject');
  }
  return `t.${tenantId}.${NOTIFICATIONS_MODULE}.${event}`;
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
