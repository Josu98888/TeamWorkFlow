import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../prisma/generated/client';
import {
  DeliveryStatus,
  NotificationChannel,
} from '../prisma/generated/client';
import { NotificationsPrismaService } from '../prisma/prisma.service';
import { FCM_PROVIDER } from '../providers/fcm-provider.interface';
import type { FcmProvider } from '../providers/fcm-provider.interface';
import { renderNotificationTemplate } from '../templates/template-registry';

export interface DeliverNotificationsInput {
  tenantId: string;
  recipientUserIds: string[];
  templateCode: string;
  data?: Record<string, unknown>;
  locale?: string;
  sourceEventId: string;
}

export interface PendingPushDispatch {
  deliveryId: string;
  tenantId: string;
  deviceTokenId: string;
  token: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export function buildFcmDataPayload(
  templateCode: string,
  notificationId: string,
  data?: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {
    templateCode,
    notificationId,
  };
  if (!data) {
    return result;
  }
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string') {
      result[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value);
    } else {
      result[key] = JSON.stringify(value);
    }
  }
  return result;
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: NotificationsPrismaService,
    @Inject(FCM_PROVIDER) private readonly fcm: FcmProvider,
  ) {}

  /**
   * Persist Notifications and initial IN_APP + PUSH deliveries inside `tx`.
   * Returns queued FCM dispatches to execute strictly AFTER `tx` commits.
   */
  async stageDeliveries(
    tx: Prisma.TransactionClient,
    input: DeliverNotificationsInput,
  ): Promise<PendingPushDispatch[]> {
    const uniqueUserIds = [...new Set(input.recipientUserIds)].filter(Boolean);
    if (uniqueUserIds.length === 0) {
      return [];
    }

    const rendered = renderNotificationTemplate(
      input.templateCode,
      input.data ?? {},
      input.locale,
    );
    if (!rendered) {
      return [];
    }

    const existing = await tx.notification.findMany({
      where: {
        tenantId: input.tenantId,
        sourceEventId: input.sourceEventId,
        userId: { in: uniqueUserIds },
      },
      select: { userId: true },
    });
    const alreadyNotified = new Set(existing.map((row) => row.userId));
    const targetUserIds = uniqueUserIds.filter(
      (userId) => !alreadyNotified.has(userId),
    );
    if (targetUserIds.length === 0) {
      return [];
    }

    const activeTokens = await tx.deviceToken.findMany({
      where: {
        tenantId: input.tenantId,
        userId: { in: targetUserIds },
        isActive: true,
      },
      select: {
        id: true,
        userId: true,
        token: true,
      },
    });

    const tokensByUser = new Map<string, { id: string; token: string }[]>();
    for (const row of activeTokens) {
      const list = tokensByUser.get(row.userId) ?? [];
      list.push({ id: row.id, token: row.token });
      tokensByUser.set(row.userId, list);
    }

    const now = new Date();
    const dispatches: PendingPushDispatch[] = [];

    for (const userId of targetUserIds) {
      const notification = await tx.notification.create({
        data: {
          tenantId: input.tenantId,
          userId,
          templateCode: rendered.templateCode,
          locale: rendered.locale,
          title: rendered.title,
          body: rendered.body,
          ...(input.data !== undefined
            ? { data: input.data as Prisma.InputJsonValue }
            : {}),
          sourceEventId: input.sourceEventId,
        },
      });

      await tx.notificationDelivery.create({
        data: {
          tenantId: input.tenantId,
          notificationId: notification.id,
          channel: NotificationChannel.IN_APP,
          status: DeliveryStatus.SENT,
          attempts: 1,
          sentAt: now,
        },
      });

      const userTokens = tokensByUser.get(userId) ?? [];
      const fcmData = buildFcmDataPayload(
        rendered.templateCode,
        notification.id,
        input.data,
      );

      for (const device of userTokens) {
        const delivery = await tx.notificationDelivery.create({
          data: {
            tenantId: input.tenantId,
            notificationId: notification.id,
            channel: NotificationChannel.PUSH,
            deviceTokenId: device.id,
            status: DeliveryStatus.PENDING,
            attempts: 0,
          },
        });

        dispatches.push({
          deliveryId: delivery.id,
          tenantId: input.tenantId,
          deviceTokenId: device.id,
          token: device.token,
          title: rendered.title,
          body: rendered.body,
          data: fcmData,
        });
      }
    }

    return dispatches;
  }

  /**
   * Standalone delivery entrypoint when not embedded in an outer event transaction.
   */
  async deliver(input: DeliverNotificationsInput): Promise<number> {
    const dispatches = await this.prisma.$transaction((tx) =>
      this.stageDeliveries(tx, input),
    );
    await this.dispatchPushes(dispatches);
    return dispatches.length;
  }

  /**
   * Execute queued FCM push dispatches after DB commit and record delivery status.
   * Never logs raw push tokens.
   */
  async dispatchPushes(dispatches: PendingPushDispatch[]): Promise<void> {
    for (const item of dispatches) {
      try {
        const result = await this.fcm.send({
          token: item.token,
          title: item.title,
          body: item.body,
          data: item.data,
        });

        if (result.success) {
          await this.prisma.notificationDelivery.update({
            where: { id: item.deliveryId },
            data: {
              status: DeliveryStatus.SENT,
              attempts: 1,
              sentAt: new Date(),
              lastError: null,
            },
          });
          continue;
        }

        if (result.isUnregistered) {
          await this.prisma.deviceToken.updateMany({
            where: { id: item.deviceTokenId },
            data: { isActive: false },
          });
        }

        await this.prisma.notificationDelivery.update({
          where: { id: item.deliveryId },
          data: {
            status: DeliveryStatus.FAILED,
            attempts: 1,
            lastError: result.error ?? 'fcm_send_failed',
          },
        });
      } catch (error) {
        const safeMessage =
          error instanceof Error ? error.name : 'fcm_dispatch_error';
        this.logger.warn(
          `Push dispatch failed for delivery ${item.deliveryId}: ${safeMessage}`,
        );
        await this.prisma.notificationDelivery
          .update({
            where: { id: item.deliveryId },
            data: {
              status: DeliveryStatus.FAILED,
              attempts: 1,
              lastError: safeMessage,
            },
          })
          .catch(() => undefined);
      }
    }
  }
}
