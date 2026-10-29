// Events `organization` consumes. The producer's names are duplicated here on
// purpose: a module never imports another module's internals (`auth`).

export const AUTH_STREAM = 'AUTH_EVENTS';

export const CONSUMED_SUBJECTS = {
  userCreated: 't.*.auth.user_created',
} as const;

export type ConsumedSubject =
  (typeof CONSUMED_SUBJECTS)[keyof typeof CONSUMED_SUBJECTS];

// Durable consumers are named `<consumer>-<producer>` over the producer's
// stream, with explicit ack (`backend/core/AGENTS.md` § Event bus).
export interface DurableConsumerSpec {
  durable: string;
  stream: string;
  filterSubjects: ConsumedSubject[];
}

export const ORGANIZATION_DURABLE_CONSUMERS: readonly DurableConsumerSpec[] = [
  {
    durable: 'organization-auth',
    stream: AUTH_STREAM,
    filterSubjects: [CONSUMED_SUBJECTS.userCreated],
  },
];

export interface ConsumedMessage {
  subject: string;
  // Tenant taken from the subject; checked against the payload by the processor.
  tenantId: string | null;
  payload: unknown;
}

// Minimal shape of `auth.user_created` (`eventId` and `occurredAt` are added
// by the producer). Only the fields `organization` reads.
export interface UserCreatedPayload {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
}

// The tenant of a consumed event comes from the subject (`t.<tenant>.…`).
export function tenantIdFromSubject(subject: string): string | null {
  const [prefix, tenantId] = subject.split('.');
  return prefix === 't' && tenantId ? tenantId : null;
}

// Whether a concrete subject matches a filter such as `t.*.auth.user_created`.
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
