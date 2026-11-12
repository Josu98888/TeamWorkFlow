import { BILLING_MODULE, BILLING_STREAM } from '../billing.patterns';

export const AUTH_STREAM = 'AUTH_EVENTS';

export const CONSUMED_SUBJECTS = {
  authTenantCreated: 't.*.auth.tenant_created',
  billingDataRetentionExpired: `t.*.${BILLING_MODULE}.data_retention_expired`,
} as const;

export type ConsumedSubject =
  (typeof CONSUMED_SUBJECTS)[keyof typeof CONSUMED_SUBJECTS];

export interface DurableConsumerSpec {
  durable: string;
  stream: string;
  filterSubjects: ConsumedSubject[];
}

export const BILLING_DURABLE_CONSUMERS: readonly DurableConsumerSpec[] = [
  {
    durable: 'billing-auth',
    stream: AUTH_STREAM,
    filterSubjects: [CONSUMED_SUBJECTS.authTenantCreated],
  },
  {
    durable: 'billing-billing',
    stream: BILLING_STREAM,
    filterSubjects: [CONSUMED_SUBJECTS.billingDataRetentionExpired],
  },
];

export interface ConsumedMessage {
  subject: string;
  tenantId: string | null;
  payload: unknown;
}

export interface TenantCreatedPayload {
  tenantId: string;
  name: string;
  ownerId: string;
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
