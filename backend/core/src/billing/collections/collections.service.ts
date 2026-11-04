import { Inject, Injectable, Logger } from '@nestjs/common';
import { envs } from '../../config';
import { CLOCK_SERVICE } from '../common/clock.service';
import type { ClockService } from '../common/clock.service';
import { BILLING_EVENTS } from '../events/billing.events';
import { BillingEventsService } from '../events/billing-events.service';
import { BillingPrismaService } from '../prisma/prisma.service';

function toMidnightUtc(date: Date): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private readonly prisma: BillingPrismaService,
    private readonly events: BillingEventsService,
    @Inject(CLOCK_SERVICE) private readonly clock: ClockService,
  ) {}

  async processCollections(): Promise<void> {
    const now = this.clock.now();
    const unpaidInvoices = await this.prisma.invoice.findMany({
      where: { status: 'ISSUED' },
    });

    const nowMidnight = toMidnightUtc(now);
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (const inv of unpaidInvoices) {
      const sub = await this.prisma.subscription.findFirst({
        where: { tenantId: inv.tenantId, status: { not: 'CANCELLED' } },
      });

      // Cancelled subscriptions are skipped by collections
      if (!sub) {
        continue;
      }

      const dueDate = inv.dueDate;
      const dueMidnight = toMidnightUtc(dueDate);
      const diffDays = Math.round((nowMidnight - dueMidnight) / oneDayMs);

      // Notice 3 days before due date (due in 3 days)
      if (diffDays === -3) {
        await this.events.publishNotification(inv.tenantId, {
          eventId: `billing:billing_due_soon:${inv.id}`,
          recipientUserIds: [],
          templateCode: 'billing_due_soon',
          data: { invoiceId: inv.id, dueDate: dueDate.toISOString() },
        });
        continue;
      }

      if (diffDays <= 0) {
        continue;
      }

      // Overdue: delayDay is diffDays (day after due date is delayDay 1)
      const delayDay = diffDays;

      if (delayDay === 1) {
        if (sub.status !== 'PAST_DUE' && sub.status !== 'SUSPENDED') {
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'PAST_DUE' },
          });

          await this.events.publish(
            inv.tenantId,
            BILLING_EVENTS.paymentOverdue,
            {
              invoiceId: inv.id,
              dueDate: dueDate.toISOString(),
            },
          );
        }

        await this.events.publishNotification(inv.tenantId, {
          eventId: `billing:billing_overdue_notice:${inv.id}:1`,
          recipientUserIds: [],
          templateCode: 'billing_overdue_notice',
          data: { invoiceId: inv.id, delayDay: 1 },
        });
      } else if (delayDay === 4 || delayDay === 6) {
        await this.events.publishNotification(inv.tenantId, {
          eventId: `billing:billing_overdue_notice:${inv.id}:${delayDay}`,
          recipientUserIds: [],
          templateCode: 'billing_overdue_notice',
          data: { invoiceId: inv.id, delayDay },
        });
      }

      if (delayDay >= envs.graceDays) {
        if (sub.status !== 'SUSPENDED') {
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'SUSPENDED' },
          });

          await this.events.publish(
            inv.tenantId,
            BILLING_EVENTS.subscriptionExpired,
            {},
          );
        }

        await this.events.publishNotification(inv.tenantId, {
          eventId: `billing:billing_suspended:${inv.id}`,
          recipientUserIds: [],
          templateCode: 'billing_suspended',
          data: { invoiceId: inv.id },
        });
      }
    }
  }

  async processDataRetention(): Promise<void> {
    const now = this.clock.now();
    const cancelledSubs = await this.prisma.subscription.findMany({
      where: {
        status: 'CANCELLED',
        endedAt: { not: null },
      },
    });

    const nowMidnight = toMidnightUtc(now);
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (const sub of cancelledSubs) {
      // If tenant has another non-cancelled subscription (resubscribed), skip!
      const activeSub = await this.prisma.subscription.findFirst({
        where: {
          tenantId: sub.tenantId,
          status: { not: 'CANCELLED' },
        },
      });

      if (activeSub) {
        continue;
      }

      const endedAt = sub.endedAt!;
      const endedMidnight = toMidnightUtc(endedAt);
      const daysSinceEnded = Math.round((nowMidnight - endedMidnight) / oneDayMs);

      // Warning 7 days before retention expiration (day 83 of 90)
      const warningThreshold = envs.dataRetentionDays - 7;
      if (
        daysSinceEnded >= warningThreshold &&
        !sub.dataRetentionWarningSentAt
      ) {
        const deletionDate = new Date(
          endedAt.getTime() + envs.dataRetentionDays * 24 * 60 * 60 * 1000,
        );

        await this.events.publishNotification(sub.tenantId, {
          eventId: `billing:billing_data_deletion_warning:${sub.id}`,
          recipientUserIds: [],
          templateCode: 'billing_data_deletion_warning',
          data: { deletionDate: deletionDate.toISOString() },
        });

        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { dataRetentionWarningSentAt: now },
        });
      }

      // Expired at 90 days
      if (
        daysSinceEnded >= envs.dataRetentionDays &&
        !sub.dataRetentionExpiredAt
      ) {
        await this.events.publish(
          sub.tenantId,
          BILLING_EVENTS.dataRetentionExpired,
          {},
        );

        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { dataRetentionExpiredAt: now },
        });
      }
    }
  }

  async purgeTenantData(tenantId: string): Promise<void> {
    this.logger.log(`Executing billing purge for tenant ${tenantId}`);

    // Delete transient plan changes for tenant
    await this.prisma.subscriptionPlanChange.deleteMany({
      where: { tenantId },
    });

    // Clear payment links from invoices
    await this.prisma.invoice.updateMany({
      where: { tenantId },
      data: {
        paymentLinkUrl: null,
        paymentLinkExpiresAt: null,
      },
    });
  }
}
