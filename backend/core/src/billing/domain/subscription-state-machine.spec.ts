import { InvalidSubscriptionTransitionException } from '../../common/exceptions/app.exceptions';
import {
  DomainSubscriptionStatus,
  assertValidSubscriptionTransition,
  canTransitionSubscription,
} from './subscription-state-machine';

describe('subscription-state-machine', () => {
  const allStatuses: DomainSubscriptionStatus[] = [
    'TRIAL',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
    'CANCELLED',
  ];

  const allowedPairs: [DomainSubscriptionStatus, DomainSubscriptionStatus][] = [
    ['TRIAL', 'ACTIVE'],
    ['TRIAL', 'CANCELLED'],
    ['ACTIVE', 'PAST_DUE'],
    ['ACTIVE', 'CANCELLED'],
    ['PAST_DUE', 'ACTIVE'],
    ['PAST_DUE', 'SUSPENDED'],
    ['PAST_DUE', 'CANCELLED'],
    ['SUSPENDED', 'ACTIVE'],
    ['SUSPENDED', 'CANCELLED'],
  ];

  it.each(allowedPairs)(
    'allows valid transition: %s -> %s',
    (from, to) => {
      expect(canTransitionSubscription(from, to)).toBe(true);
      expect(assertValidSubscriptionTransition(from, to)).toBe(to);
      // Case-insensitivity check
      expect(
        assertValidSubscriptionTransition(from.toLowerCase(), to.toLowerCase()),
      ).toBe(to);
    },
  );

  const allowedSet = new Set(allowedPairs.map(([f, t]) => `${f}->${t}`));

  const forbiddenPairs: [DomainSubscriptionStatus, DomainSubscriptionStatus][] =
    [];
  for (const from of allStatuses) {
    for (const to of allStatuses) {
      if (!allowedSet.has(`${from}->${to}`)) {
        forbiddenPairs.push([from, to]);
      }
    }
  }

  it.each(forbiddenPairs)(
    'forbids invalid transition: %s -> %s',
    (from, to) => {
      expect(canTransitionSubscription(from, to)).toBe(false);
      expect(() => assertValidSubscriptionTransition(from, to)).toThrow(
        InvalidSubscriptionTransitionException,
      );
    },
  );

  it('strictly forbids any transition from CANCELLED (terminal state)', () => {
    for (const to of allStatuses) {
      expect(canTransitionSubscription('CANCELLED', to)).toBe(false);
      expect(() =>
        assertValidSubscriptionTransition('CANCELLED', to),
      ).toThrow(InvalidSubscriptionTransitionException);
    }
  });

  it('rejects unknown subscription status strings', () => {
    expect(canTransitionSubscription('UNKNOWN', 'ACTIVE')).toBe(false);
    expect(() =>
      assertValidSubscriptionTransition('UNKNOWN', 'ACTIVE'),
    ).toThrow(InvalidSubscriptionTransitionException);
  });
});
