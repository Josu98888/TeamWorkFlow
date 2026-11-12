import { InvalidSubscriptionTransitionException } from '../../common/exceptions/app.exceptions';

export type DomainSubscriptionStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED';

const ALLOWED_TRANSITIONS: Record<
  DomainSubscriptionStatus,
  ReadonlySet<DomainSubscriptionStatus>
> = {
  TRIAL: new Set(['ACTIVE', 'CANCELLED']),
  ACTIVE: new Set(['PAST_DUE', 'CANCELLED']),
  PAST_DUE: new Set(['ACTIVE', 'SUSPENDED', 'CANCELLED']),
  SUSPENDED: new Set(['ACTIVE', 'CANCELLED']),
  CANCELLED: new Set(), // strictly terminal
};

function normalizeStatus(status: string): DomainSubscriptionStatus {
  const upper = status.toUpperCase() as DomainSubscriptionStatus;
  if (!ALLOWED_TRANSITIONS[upper]) {
    throw new InvalidSubscriptionTransitionException();
  }
  return upper;
}

export function canTransitionSubscription(
  from: string,
  to: string,
): boolean {
  try {
    const fromNorm = normalizeStatus(from);
    const toNorm = normalizeStatus(to);
    return ALLOWED_TRANSITIONS[fromNorm].has(toNorm);
  } catch {
    return false;
  }
}

export function assertValidSubscriptionTransition(
  from: string,
  to: string,
): DomainSubscriptionStatus {
  const fromNorm = normalizeStatus(from);
  const toNorm = normalizeStatus(to);

  if (!ALLOWED_TRANSITIONS[fromNorm].has(toNorm)) {
    throw new InvalidSubscriptionTransitionException();
  }

  return toNorm;
}
