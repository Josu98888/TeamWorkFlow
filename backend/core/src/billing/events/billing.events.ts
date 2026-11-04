import { BILLING_MODULE } from '../billing.patterns';

export const BILLING_EVENTS = {
  subscriptionCreated: 'subscription_created',
  planChanged: 'plan_changed',
  invoiceIssued: 'invoice_issued',
  paymentOverdue: 'payment_overdue',
  subscriptionExpired: 'subscription_expired',
  paymentReceived: 'payment_received',
  subscriptionCancelled: 'subscription_cancelled',
  subscriptionReactivated: 'subscription_reactivated',
  dataRetentionExpired: 'data_retention_expired',
} as const;

export type BillingEventName =
  (typeof BILLING_EVENTS)[keyof typeof BILLING_EVENTS];

export type WirePlan = 'basic' | 'pro';
export type WireSubscriptionStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled';

export interface BillingEventPayloads {
  subscription_created: {
    tenantId: string;
    plan: WirePlan;
    features: Record<string, boolean>;
    status: WireSubscriptionStatus;
    trialEndsAt: string;
  };
  plan_changed: {
    tenantId: string;
    plan: WirePlan;
    features: Record<string, boolean>;
    previousPlan: WirePlan;
    effectiveAt: string;
  };
  invoice_issued: {
    tenantId: string;
    invoiceId: string;
    period: string;
    total: string;
    dueDate: string;
  };
  payment_overdue: {
    tenantId: string;
    invoiceId: string;
    dueDate: string;
  };
  subscription_expired: {
    tenantId: string;
  };
  payment_received: {
    tenantId: string;
    invoiceId: string;
  };
  subscription_cancelled: {
    tenantId: string;
  };
  subscription_reactivated: {
    tenantId: string;
    plan: WirePlan;
  };
  data_retention_expired: {
    tenantId: string;
  };
}

export interface EventMeta {
  eventId: string;
  occurredAt: string;
}

export type PublishedBillingEvent<E extends BillingEventName> =
  BillingEventPayloads[E] & EventMeta;

export type BillingNotificationTemplate =
  | 'billing_invoice_issued'
  | 'billing_due_soon'
  | 'billing_overdue_notice'
  | 'billing_suspended'
  | 'billing_data_deletion_warning';

export interface NotificationSendPayload extends EventMeta {
  tenantId: string;
  recipientUserIds: string[];
  templateCode: BillingNotificationTemplate;
  data?: Record<string, unknown>;
}

// A tenant id becomes a subject token: it must not contain `.`, `*`, `>` or spaces.
const SUBJECT_TOKEN = /^[A-Za-z0-9_-]+$/;

export function billingEventSubject(tenantId: string, event: BillingEventName) {
  if (!SUBJECT_TOKEN.test(tenantId)) {
    throw new Error('Invalid tenant id for an event subject');
  }
  return `t.${tenantId}.${BILLING_MODULE}.${event}`;
}

export function notificationSendSubject(tenantId: string) {
  if (!SUBJECT_TOKEN.test(tenantId)) {
    throw new Error('Invalid tenant id for an event subject');
  }
  return `t.${tenantId}.notifications.send`;
}

export const CONSUMED_BILLING_SUBJECTS = {
  authTenantCreated: 't.*.auth.tenant_created',
  billingDataRetentionExpired: `t.*.${BILLING_MODULE}.data_retention_expired`,
} as const;
