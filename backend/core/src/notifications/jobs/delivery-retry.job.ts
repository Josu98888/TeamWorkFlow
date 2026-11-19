import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { buildFcmDataPayload } from '../delivery/delivery.service';
import {
  DeliveryStatus,
  NotificationChannel,
} from '../prisma/generated/client';
import { NotificationsPrismaService } from '../prisma/prisma.service';
import { FCM_PROVIDER } from '../providers/fcm-provider.interface';
import type { FcmProvider } from '../providers/fcm-provider.interface';

export const MAX_PUSH_ATTEMPTS = 3;
const RETRY_BATCH_LIMIT = 100;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

@Injectable()
export class DeliveryRetryJob {
  private readonly logger = new Logger(DeliveryRetryJob.name);
  private running = false;

  constructor(
    private readonly prisma: NotificationsPrismaService,
    @Inject(FCM_PROVIDER) private readonly fcm: FcmProvider,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.retryFailedDeliveries();
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Push retry cron failed: ${msg}`);
    } finally {
      this.running = false;
    }
  }

  async retryFailedDeliveries(): Promise<number> {
    const candidates = await this.prisma.notificationDelivery.findMany({
      where: {
        channel: NotificationChannel.PUSH,
        status: DeliveryStatus.FAILED,
        attempts: { lt: MAX_PUSH_ATTEMPTS },
      },
      orderBy: [{ createdAt: 'asc' }],
      take: RETRY_BATCH_LIMIT,
      include: {
        notification: {
          select: {
            id: true,
            title: true,
            body: true,
            templateCode: true,
            data: true,
          },
        },
      },
    });

    if (candidates.length === 0) {
      return 0;
    }

    const tenantIds = [...new Set(candidates.map((row) => row.tenantId))];
    const suspendedTenants = await this.prisma.tenantState.findMany({
      where: {
        tenantId: { in: tenantIds },
        isSuspended: true,
      },
      select: { tenantId: true },
    });
    const suspendedSet = new Set(suspendedTenants.map((t) => t.tenantId));

    const eligible = candidates.filter((row) => !suspendedSet.has(row.tenantId));
    if (eligible.length === 0) {
      return 0;
    }

    const tokenIds = [
      ...new Set(
        eligible
          .map((row) => row.deviceTokenId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const tokens =
      tokenIds.length > 0
        ? await this.prisma.deviceToken.findMany({
            where: { id: { in: tokenIds } },
            select: { id: true, token: true, isActive: true },
          })
        : [];
    const tokenMap = new Map(tokens.map((t) => [t.id, t]));

    let succeeded = 0;

    for (const delivery of eligible) {
      const device = delivery.deviceTokenId
        ? tokenMap.get(delivery.deviceTokenId)
        : undefined;

      if (!device || !device.isActive) {
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts: MAX_PUSH_ATTEMPTS,
            lastError: 'device_token_inactive',
          },
        });
        continue;
      }

      const nextAttempts = delivery.attempts + 1;
      const fcmData = buildFcmDataPayload(
        delivery.notification.templateCode,
        delivery.notification.id,
        asRecord(delivery.notification.data),
      );

      try {
        const result = await this.fcm.send({
          token: device.token,
          title: delivery.notification.title,
          body: delivery.notification.body,
          data: fcmData,
        });

        if (result.success) {
          await this.prisma.notificationDelivery.update({
            where: { id: delivery.id },
            data: {
              status: DeliveryStatus.SENT,
              attempts: nextAttempts,
              sentAt: new Date(),
              lastError: null,
            },
          });
          succeeded += 1;
          continue;
        }

        if (result.isUnregistered) {
          await this.prisma.deviceToken.updateMany({
            where: { id: device.id },
            data: { isActive: false },
          });
          // Mark inactive in map so subsequent rows in same batch skip it.
          device.isActive = false;
        }

        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: DeliveryStatus.FAILED,
            attempts: nextAttempts,
            lastError: result.error ?? 'fcm_send_failed',
          },
        });
      } catch (error) {
        const safeError =
          error instanceof Error ? error.name : 'fcm_retry_error';
        this.logger.warn(
          `Retry failed for delivery ${delivery.id}: ${safeError}`,
        );
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: DeliveryStatus.FAILED,
            attempts: nextAttempts,
            lastError: safeError,
          },
        });
      }
    }

    return succeeded;
  }
}
