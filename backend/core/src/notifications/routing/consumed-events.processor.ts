import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { AppException } from '../../common/exceptions/app.exceptions';
import { OrganizationService } from '../../organization/organization.service';
import {
  DeliveryService,
  type PendingPushDispatch,
} from '../delivery/delivery.service';
import {
  CONSUMED_SUBJECTS,
  type ConsumedMessage,
} from '../events/notifications.events';
import { NotificationsEventsService } from '../events/notifications-events.service';
import type { Prisma } from '../prisma/generated/client';
import { NotificationsPrismaService } from '../prisma/prisma.service';
import { NOTIFICATION_TEMPLATES } from '../templates/template-registry';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

@Injectable()
export class ConsumedEventsProcessor implements OnModuleInit {
  private readonly logger = new Logger(ConsumedEventsProcessor.name);

  constructor(
    private readonly prisma: NotificationsPrismaService,
    private readonly events: NotificationsEventsService,
    private readonly delivery: DeliveryService,
    private readonly authService: AuthService,
    private readonly organizationService: OrganizationService,
  ) {}

  onModuleInit(): void {
    this.events.registerHandler(CONSUMED_SUBJECTS.notificationsSend, (msg) =>
      this.handleNotificationSend(msg),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.attendanceAlertOpened, (msg) =>
      this.handleAlertOpened(msg),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.tasksTaskAssigned, (msg) =>
      this.handleTaskAssigned(msg),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.authTenantSuspended, (msg) =>
      this.handleTenantState(msg, true),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.authTenantCancelled, (msg) =>
      this.handleTenantState(msg, true),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.authTenantReactivated, (msg) =>
      this.handleTenantState(msg, false),
    );
    this.events.registerHandler(
      CONSUMED_SUBJECTS.billingSubscriptionCreated,
      (msg) => this.handlePlanFeatures(msg),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.billingPlanChanged, (msg) =>
      this.handlePlanFeatures(msg),
    );
    this.events.registerHandler(
      CONSUMED_SUBJECTS.billingDataRetentionExpired,
      (msg) => this.handleDataRetentionExpired(msg),
    );
  }

  private async claimEvent(
    tx: Prisma.TransactionClient,
    eventId: string,
    tenantId: string,
  ): Promise<boolean> {
    if (!eventId) {
      return true;
    }
    const inserted = await tx.processedEvent.createMany({
      data: [{ eventId, tenantId }],
      skipDuplicates: true,
    });
    return inserted.count > 0;
  }

  private async markSkippedEvent(
    eventId: string,
    tenantId: string,
  ): Promise<void> {
    if (!eventId) {
      return;
    }
    await this.prisma.processedEvent.createMany({
      data: [{ eventId, tenantId }],
      skipDuplicates: true,
    });
  }

  private async alreadyProcessed(eventId: string): Promise<boolean> {
    if (!eventId) {
      return false;
    }
    const existing = await this.prisma.processedEvent.findUnique({
      where: { eventId },
      select: { eventId: true },
    });
    return existing !== null;
  }

  private validateTenantPayload(
    message: ConsumedMessage,
  ): { tenantId: string; payload: Record<string, unknown>; eventId: string } | null {
    if (!isRecord(message.payload) || !message.tenantId) {
      return null;
    }
    const tenantId = message.tenantId;
    const payload = message.payload;
    if (typeof payload.tenantId === 'string' && payload.tenantId !== tenantId) {
      this.logger.warn(
        `Tenant mismatch on ${message.subject}; ignoring message`,
      );
      return null;
    }
    const eventId = typeof payload.eventId === 'string' ? payload.eventId : '';
    return { tenantId, payload, eventId };
  }

  async handleNotificationSend(message: ConsumedMessage): Promise<void> {
    const validated = this.validateTenantPayload(message);
    if (!validated) return;
    const { tenantId, payload, eventId } = validated;

    if (await this.alreadyProcessed(eventId)) {
      return;
    }

    const templateCode =
      typeof payload.templateCode === 'string' ? payload.templateCode : '';
    if (!templateCode) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    const isBillingTemplate = templateCode.startsWith('billing_');
    const state = await this.prisma.tenantState.findUnique({
      where: { tenantId },
    });
    if (state?.isSuspended && !isBillingTemplate) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    let recipientUserIds = asStringArray(payload.recipientUserIds);
    if (recipientUserIds.length === 0 && isBillingTemplate) {
      const resolved = await this.authService.listRecipients({
        tenantId,
        roles: ['owner', 'admin'],
      });
      recipientUserIds = resolved.userIds;
    }

    if (recipientUserIds.length === 0) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    const sourceEventId = eventId || randomUUID();
    const data = isRecord(payload.data) ? payload.data : {};
    const locale = typeof payload.locale === 'string' ? payload.locale : undefined;

    const dispatches = await this.prisma.$transaction(async (tx) => {
      const shouldProcess = await this.claimEvent(tx, eventId, tenantId);
      if (!shouldProcess) {
        return [] as PendingPushDispatch[];
      }
      return this.delivery.stageDeliveries(tx, {
        tenantId,
        recipientUserIds,
        templateCode,
        data,
        locale,
        sourceEventId,
      });
    });

    await this.delivery.dispatchPushes(dispatches);
  }

  async handleAlertOpened(message: ConsumedMessage): Promise<void> {
    const validated = this.validateTenantPayload(message);
    if (!validated) return;
    const { tenantId, payload, eventId } = validated;

    if (await this.alreadyProcessed(eventId)) {
      return;
    }

    const siteId = typeof payload.siteId === 'string' ? payload.siteId : '';
    if (!siteId) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    const [state, featuresRow] = await Promise.all([
      this.prisma.tenantState.findUnique({ where: { tenantId } }),
      this.prisma.tenantFeatures.findUnique({ where: { tenantId } }),
    ]);

    if (state?.isSuspended) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    const hasAlerts =
      featuresRow !== null &&
      isRecord(featuresRow.features) &&
      featuresRow.features.alerts === true;

    if (!hasAlerts) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    const { userIds } = await this.authService.listRecipients({
      tenantId,
      roles: ['owner', 'admin', 'supervisor'],
      siteId,
    });

    if (userIds.length === 0) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    const sourceEventId = eventId || randomUUID();
    const data: Record<string, unknown> = {
      ...(typeof payload.alertId === 'string' ? { alertId: payload.alertId } : {}),
      siteId,
      ...(typeof payload.siteName === 'string'
        ? { siteName: payload.siteName }
        : {}),
      ...(typeof payload.type === 'string'
        ? { alertType: payload.type, type: payload.type }
        : {}),
      ...(typeof payload.employeeId === 'string'
        ? { employeeId: payload.employeeId }
        : {}),
      ...(typeof payload.employeeName === 'string'
        ? { employeeName: payload.employeeName }
        : {}),
      ...(typeof payload.severity === 'string'
        ? { severity: payload.severity }
        : {}),
    };

    const dispatches = await this.prisma.$transaction(async (tx) => {
      const shouldProcess = await this.claimEvent(tx, eventId, tenantId);
      if (!shouldProcess) {
        return [] as PendingPushDispatch[];
      }
      return this.delivery.stageDeliveries(tx, {
        tenantId,
        recipientUserIds: userIds,
        templateCode: NOTIFICATION_TEMPLATES.alertOpened,
        data,
        sourceEventId,
      });
    });

    await this.delivery.dispatchPushes(dispatches);
  }

  async handleTaskAssigned(message: ConsumedMessage): Promise<void> {
    const validated = this.validateTenantPayload(message);
    if (!validated) return;
    const { tenantId, payload, eventId } = validated;

    if (await this.alreadyProcessed(eventId)) {
      return;
    }

    const employeeId =
      typeof payload.employeeId === 'string' ? payload.employeeId : '';
    if (!employeeId) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    const state = await this.prisma.tenantState.findUnique({
      where: { tenantId },
    });
    if (state?.isSuspended) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    let employee: { userId: string | null; isActive: boolean };
    try {
      employee = await this.organizationService.getEmployeeForTenant(tenantId, {
        employeeId,
      });
    } catch (error) {
      // Missing employee is permanent; transient errors must bubble so JetStream retries.
      if (error instanceof AppException && error.code === 'employee_not_found') {
        this.logger.warn(
          `Skipping task_assigned notification: employee ${employeeId} not found`,
        );
        await this.markSkippedEvent(eventId, tenantId);
        return;
      }
      throw error;
    }

    if (!employee.userId || !employee.isActive) {
      await this.markSkippedEvent(eventId, tenantId);
      return;
    }

    const sourceEventId = eventId || randomUUID();
    const data: Record<string, unknown> = {
      ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
      ...(typeof payload.siteId === 'string' ? { siteId: payload.siteId } : {}),
      employeeId,
      ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
      ...(typeof payload.deadline === 'string'
        ? { deadline: payload.deadline }
        : {}),
    };

    const dispatches = await this.prisma.$transaction(async (tx) => {
      const shouldProcess = await this.claimEvent(tx, eventId, tenantId);
      if (!shouldProcess) {
        return [] as PendingPushDispatch[];
      }
      return this.delivery.stageDeliveries(tx, {
        tenantId,
        recipientUserIds: [employee.userId!],
        templateCode: NOTIFICATION_TEMPLATES.taskAssigned,
        data,
        sourceEventId,
      });
    });

    await this.delivery.dispatchPushes(dispatches);
  }

  async handleTenantState(
    message: ConsumedMessage,
    isSuspended: boolean,
  ): Promise<void> {
    if (!message.tenantId) return;
    const tenantId = message.tenantId;
    const payload = isRecord(message.payload) ? message.payload : {};
    if (typeof payload.tenantId === 'string' && payload.tenantId !== tenantId) {
      this.logger.warn(
        `Tenant mismatch on ${message.subject}; ignoring message`,
      );
      return;
    }
    const eventId = typeof payload.eventId === 'string' ? payload.eventId : '';

    await this.prisma.$transaction(async (tx) => {
      const shouldProcess = await this.claimEvent(tx, eventId, tenantId);
      if (!shouldProcess) return;

      await tx.tenantState.upsert({
        where: { tenantId },
        create: {
          tenantId,
          isSuspended,
          updatedAt: new Date(),
        },
        update: {
          isSuspended,
          updatedAt: new Date(),
        },
      });
    });
  }

  async handlePlanFeatures(message: ConsumedMessage): Promise<void> {
    const validated = this.validateTenantPayload(message);
    if (!validated) return;
    const { tenantId, payload, eventId } = validated;

    const effectiveAtStr =
      typeof payload.effectiveAt === 'string'
        ? payload.effectiveAt
        : typeof payload.occurredAt === 'string'
          ? payload.occurredAt
          : '';
    if (!effectiveAtStr) return;

    const effectiveAt = new Date(effectiveAtStr);
    if (Number.isNaN(effectiveAt.getTime())) {
      return;
    }

    const features = (
      isRecord(payload.features) ? payload.features : {}
    ) as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      const shouldProcess = await this.claimEvent(tx, eventId, tenantId);
      if (!shouldProcess) return;

      const existing = await tx.tenantFeatures.findFirst({
        where: { tenantId },
      });

      if (existing && existing.effectiveAt >= effectiveAt) {
        return;
      }

      await tx.tenantFeatures.upsert({
        where: { tenantId },
        create: {
          tenantId,
          features,
          effectiveAt,
        },
        update: {
          features,
          effectiveAt,
        },
      });
    });
  }

  async handleDataRetentionExpired(message: ConsumedMessage): Promise<void> {
    if (!message.tenantId) return;
    const tenantId = message.tenantId;
    const payload = isRecord(message.payload) ? message.payload : {};
    if (typeof payload.tenantId === 'string' && payload.tenantId !== tenantId) {
      this.logger.warn(
        `Tenant mismatch on ${message.subject}; ignoring message`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.notificationDelivery.deleteMany({ where: { tenantId } });
      await tx.notification.deleteMany({ where: { tenantId } });
      await tx.deviceToken.deleteMany({ where: { tenantId } });
      await tx.tenantState.deleteMany({ where: { tenantId } });
      await tx.tenantFeatures.deleteMany({ where: { tenantId } });
      await tx.processedEvent.deleteMany({ where: { tenantId } });
    });
  }
}
