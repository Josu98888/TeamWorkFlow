import type { TenantStatus } from '../generated/prisma/enums';

// Billing events that move the tenant between `active`, `past_due` and
// `suspended` (AGENTS § Tenant status). S7.2 adds the cancel/reactivate ones.
export type BillingStatusEvent =
  'payment_overdue' | 'subscription_expired' | 'payment_received';

export interface TenantStatusChange {
  // Columns written together with the new status.
  data:
    | { status: 'PAST_DUE'; pastDueSince: Date }
    | { status: 'SUSPENDED'; suspendedAt: Date }
    | { status: 'ACTIVE'; pastDueSince: null; suspendedAt: null };
  // Supervisors and employees lose their refresh tokens when access is cut.
  revokeSessions: boolean;
}

// Pure decision table. `null` means "nothing to do": same state, an event that
// does not apply to the current state, or a tenant that no longer takes part
// (`cancelled`, `deleted`). A no-op writes nothing and emits nothing.
// `at` is the event's `occurredAt`, so a redelivery stores the same instant.
export function billingTransition(
  status: TenantStatus,
  event: BillingStatusEvent,
  at: Date,
): TenantStatusChange | null {
  switch (event) {
    case 'payment_overdue':
      // Only an `active` tenant becomes past due. DEFAULT(auth): it never
      // downgrades a `suspended` tenant (that would give access back).
      return status === 'ACTIVE'
        ? {
            data: { status: 'PAST_DUE', pastDueSince: at },
            revokeSessions: false,
          }
        : null;
    case 'subscription_expired':
      // From `active` too (AGENTS); `past_due` keeps its `pastDueSince`.
      return status === 'ACTIVE' || status === 'PAST_DUE'
        ? {
            data: { status: 'SUSPENDED', suspendedAt: at },
            revokeSessions: true,
          }
        : null;
    case 'payment_received':
      // Never reactivates `cancelled` (only `subscription_reactivated` does).
      return status === 'PAST_DUE' || status === 'SUSPENDED'
        ? {
            data: { status: 'ACTIVE', pastDueSince: null, suspendedAt: null },
            revokeSessions: false,
          }
        : null;
  }
}
