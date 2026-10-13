import { Injectable, OnModuleInit } from '@nestjs/common';
import { CONSUMED_SUBJECTS } from '../events/auth.events';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import type {
  ConsumedEventContext,
  PostCommitEffect,
} from '../events/consumed-event.processor';
import { Prisma } from '../generated/prisma/client';
import { TenantStatusConflictError } from './tenant-status.billing.handlers';

// Consumer of `data_retention_expired` (AGENTS § Tenant data purge): the only
// hard deletion of users. Dedupe, tenant check and the transaction come from
// `ConsumedEventProcessor`; everything below runs in that one transaction.
@Injectable()
export class TenantPurgeHandlers implements OnModuleInit {
  constructor(private readonly processor: ConsumedEventProcessor) {}

  onModuleInit() {
    this.processor.register({
      filter: CONSUMED_SUBJECTS.dataRetentionExpired,
      handle: (context) => this.apply(context),
    });
  }

  async apply({
    tx,
    tenantId,
  }: ConsumedEventContext): Promise<PostCommitEffect[]> {
    // Only a tenant that is still `cancelled` is purged: a resubscribed tenant
    // (`active`) is ignored, and a `deleted` one was purged already (a second
    // delivery of this event, or of another one, is a no-op).
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (tenant?.status !== 'CANCELLED') return [];

    // Claims the tenant first: if it was reactivated meanwhile the update
    // matches nothing, the transaction rolls back and the redelivery is ignored.
    const claimed = await tx.tenant.updateMany({
      where: { id: tenantId, status: 'CANCELLED' },
      data: {
        status: 'DELETED',
        plan: null,
        features: Prisma.DbNull,
        planUpdatedAt: null,
        pastDueSince: null,
        suspendedAt: null,
        cancelledAt: null,
      },
    });
    if (claimed.count !== 1) throw new TenantStatusConflictError();

    // Every delete is filtered by the tenant (a `platform_admin` has no tenant
    // and is never matched). Tokens go before their users and invitations
    // before the users that sent them, so no row depends on a deleted one.
    await tx.refreshToken.deleteMany({ where: { user: { tenantId } } });
    await tx.passwordResetToken.deleteMany({ where: { user: { tenantId } } });
    await tx.invitation.deleteMany({ where: { tenantId } });
    await tx.user.deleteMany({ where: { tenantId } });
    // Includes the row of this very event: the status `deleted` is what makes
    // a redelivery a no-op, so the row is not needed to deduplicate it.
    await tx.processedEvent.deleteMany({ where: { tenantId } });

    // AGENTS lists no event for the purge.
    return [];
  }
}
