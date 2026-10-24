import { Injectable, OnModuleInit } from '@nestjs/common';
import { AUTH_EVENTS, CONSUMED_SUBJECTS } from '../events/auth.events';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import type {
  ConsumedEventContext,
  ConsumedEventHandler,
  PostCommitEffect,
} from '../events/consumed-event.processor';
import { JetStreamService } from '../events/jetstream.service';
import { billingTransition } from './tenant-status.transitions';
import type {
  BillingStatusEvent,
  TenantStatusChange,
} from './tenant-status.transitions';

// Raised when the tenant changed between the read and the write. The
// transaction (including the `ProcessedEvent` row) rolls back and JetStream
// redelivers the event, which is then evaluated against the new state.
export class TenantStatusConflictError extends Error {
  constructor() {
    super('Tenant status changed concurrently');
    this.name = 'TenantStatusConflictError';
  }
}

// Consumers of the billing events that change the tenant status (AGENTS §
// Tenant status): `payment_overdue`, `subscription_expired`, `payment_received`,
// `subscription_cancelled` and `subscription_reactivated`. Dedupe, tenant check and the transaction come from
// `ConsumedEventProcessor`; this class only decides and applies the transition.
@Injectable()
export class TenantStatusBillingHandlers implements OnModuleInit {
  constructor(
    private readonly processor: ConsumedEventProcessor,
    private readonly events: JetStreamService,
  ) {}

  onModuleInit() {
    const handlers: [ConsumedEventHandler['filter'], BillingStatusEvent][] = [
      [CONSUMED_SUBJECTS.paymentOverdue, 'payment_overdue'],
      [CONSUMED_SUBJECTS.subscriptionExpired, 'subscription_expired'],
      [CONSUMED_SUBJECTS.paymentReceived, 'payment_received'],
      [CONSUMED_SUBJECTS.subscriptionCancelled, 'subscription_cancelled'],
      [CONSUMED_SUBJECTS.subscriptionReactivated, 'subscription_reactivated'],
    ];
    for (const [filter, event] of handlers) {
      this.processor.register({
        filter,
        handle: (context) => this.apply(event, context),
      });
    }
  }

  async apply(
    event: BillingStatusEvent,
    { tx, tenantId, occurredAt }: ConsumedEventContext,
  ): Promise<PostCommitEffect[]> {
    // Unknown tenant: nothing to change (the id is not trusted beyond this read).
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant) return [];

    const change = billingTransition(tenant.status, event, occurredAt);
    if (!change) return [];

    // Only applies if the status is still the one the decision was based on.
    const updated = await tx.tenant.updateMany({
      where: { id: tenantId, status: tenant.status },
      data: change.data,
    });
    if (updated.count !== 1) {
      throw new TenantStatusConflictError();
    }

    if (change.revokeSessions) {
      await tx.refreshToken.updateMany({
        where: {
          revokedAt: null,
          user: { tenantId, role: { in: ['SUPERVISOR', 'EMPLOYEE'] } },
        },
        data: { revokedAt: new Date() },
      });
    }

    return [() => this.notify(tenantId, change)];
  }

  private notify(tenantId: string, change: TenantStatusChange) {
    switch (change.data.status) {
      case 'PAST_DUE':
        return this.events.publish(tenantId, AUTH_EVENTS.tenantPastDue, {
          tenantId,
          pastDueSince: change.data.pastDueSince.toISOString(),
        });
      case 'SUSPENDED':
        return this.events.publish(tenantId, AUTH_EVENTS.tenantSuspended, {
          tenantId,
          suspendedAt: change.data.suspendedAt.toISOString(),
        });
      case 'CANCELLED':
        return this.events.publish(tenantId, AUTH_EVENTS.tenantCancelled, {
          tenantId,
          cancelledAt: change.data.cancelledAt.toISOString(),
        });
      case 'ACTIVE':
        return this.events.publish(tenantId, AUTH_EVENTS.tenantReactivated, {
          tenantId,
        });
    }
  }
}
