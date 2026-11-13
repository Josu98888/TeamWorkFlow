import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { calculateTaskDeadline } from '../domain/deadline-calculator';
import { StorageService } from '../media/storage.service';
import { TasksPrismaService } from '../prisma/prisma.service';
import { TasksEventsService } from './tasks-events.service';
import { TASKS_EVENTS } from './tasks.events';
import {
  CONSUMED_SUBJECTS,
  type ConsumedMessage,
} from './consumed-events';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrismaUniqueError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

type PrismaTx = Pick<
  TasksPrismaService,
  | 'processedEvent'
  | 'tenantFeatures'
  | 'tenantState'
  | 'taskTemplate'
  | 'task'
  | 'media'
  | 'taskAnswer'
  | 'formVersion'
  | 'form'
>;

@Injectable()
export class ConsumedEventsProcessor implements OnModuleInit {
  private readonly logger = new Logger(ConsumedEventsProcessor.name);

  constructor(
    private readonly prisma: TasksPrismaService,
    private readonly events: TasksEventsService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.events.registerHandler(CONSUMED_SUBJECTS.orgShiftStarted, (msg) =>
      this.handleShiftStarted(msg),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.orgShiftCancelled, (msg) =>
      this.handleShiftCancelled(msg),
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
    this.events.registerHandler(CONSUMED_SUBJECTS.billingSubscriptionCreated, (msg) =>
      this.handlePlanFeatures(msg),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.billingPlanChanged, (msg) =>
      this.handlePlanFeatures(msg),
    );
    this.events.registerHandler(CONSUMED_SUBJECTS.billingDataRetentionExpired, (msg) =>
      this.handleDataRetentionExpired(msg),
    );
  }

  private async claimEvent(
    tx: PrismaTx,
    payload: Record<string, unknown>,
    tenantId: string,
  ): Promise<boolean> {
    const eventId = typeof payload.eventId === 'string' ? payload.eventId : '';
    if (!eventId) {
      return true;
    }
    const inserted = await tx.processedEvent.createMany({
      data: [{ eventId, tenantId }],
      skipDuplicates: true,
    });
    return inserted.count > 0;
  }

  async handleShiftStarted(message: ConsumedMessage): Promise<void> {
    if (!isRecord(message.payload) || !message.tenantId) return;

    const tenantId = message.tenantId;
    const payload = message.payload;
    if (typeof payload.tenantId === 'string' && payload.tenantId !== tenantId) {
      return;
    }

    const shiftId = typeof payload.shiftId === 'string' ? payload.shiftId : '';
    const siteId = typeof payload.siteId === 'string' ? payload.siteId : '';
    const postId = typeof payload.postId === 'string' ? payload.postId : '';
    const employeeId = typeof payload.employeeId === 'string' ? payload.employeeId : null;
    const startStr =
      typeof payload.startsAt === 'string'
        ? payload.startsAt
        : typeof payload.start === 'string'
          ? payload.start
          : typeof payload.startTime === 'string'
            ? payload.startTime
            : '';
    const endStr =
      typeof payload.endsAt === 'string'
        ? payload.endsAt
        : typeof payload.end === 'string'
          ? payload.end
          : typeof payload.endTime === 'string'
            ? payload.endTime
            : '';

    if (!shiftId || !siteId || !postId || !startStr || !endStr) {
      return;
    }

    const shiftStart = new Date(startStr);
    const shiftEnd = new Date(endStr);
    if (Number.isNaN(shiftStart.getTime()) || Number.isNaN(shiftEnd.getTime())) {
      return;
    }

    // Check plan gating & suspension
    const [features, state] = await Promise.all([
      this.prisma.tenantFeatures.findFirst({ where: { tenantId } }),
      this.prisma.tenantState.findFirst({ where: { tenantId } }),
    ]);

    if (state?.isSuspended) {
      return;
    }

    const hasTasks =
      features &&
      isRecord(features.features) &&
      features.features.tasks === true;

    if (!hasTasks) {
      return;
    }

    const templates = await this.prisma.taskTemplate.findMany({
      where: {
        tenantId,
        siteId,
        postId,
        isActive: true,
      },
      include: { formVersion: true },
    });

    if (templates.length === 0) {
      return;
    }

    let createdTasks: Array<{
      id: string;
      employeeId: string | null;
      siteId: string;
      postId: string;
      shiftId: string | null;
      title: string;
      deadline: Date;
    }> = [];

    try {
      createdTasks = await this.prisma.$transaction(async (tx) => {
        const shouldProcess = await this.claimEvent(tx, payload, tenantId);
        if (!shouldProcess) {
          return [];
        }

        const inserted: typeof createdTasks = [];
        for (const template of templates) {
          const deadline = calculateTaskDeadline({
            shiftStart,
            shiftEnd,
            deadlineMode: template.deadlineMode,
            deadlineMinutes: template.deadlineMinutes,
          });

          const existing = await tx.task.findFirst({
            where: {
              tenantId,
              shiftId,
              templateId: template.id,
            },
          });

          if (!existing) {
            const created = await tx.task.create({
              data: {
                tenantId,
                kind: 'PER_SHIFT',
                status: 'PENDING',
                formVersionId: template.formVersionId,
                title: template.formVersion.name,
                deadline,
                employeeId,
                siteId,
                postId,
                shiftId,
                templateId: template.id,
              },
            });
            inserted.push(created);
          }
        }
        return inserted;
      });
    } catch (err) {
      if (isPrismaUniqueError(err)) {
        this.logger.warn(
          `Concurrent shift_started duplicate for tenant=${tenantId} shift=${shiftId}; skipping`,
        );
        return;
      }
      throw err;
    }

    for (const created of createdTasks) {
      await this.events.publish(tenantId, TASKS_EVENTS.taskAssigned, {
        tenantId,
        taskId: created.id,
        employeeId: created.employeeId,
        siteId: created.siteId,
        postId: created.postId,
        shiftId: created.shiftId,
        title: created.title,
        deadline: created.deadline.toISOString(),
      });
    }
  }

  async handleShiftCancelled(message: ConsumedMessage): Promise<void> {
    if (!isRecord(message.payload) || !message.tenantId) return;

    const tenantId = message.tenantId;
    const payload = message.payload;
    if (typeof payload.tenantId === 'string' && payload.tenantId !== tenantId) {
      return;
    }

    const shiftId = typeof payload.shiftId === 'string' ? payload.shiftId : '';
    if (!shiftId) return;

    await this.prisma.$transaction(async (tx) => {
      const shouldProcess = await this.claimEvent(tx, payload, tenantId);
      if (!shouldProcess) return;

      await tx.task.updateMany({
        where: {
          tenantId,
          shiftId,
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
        },
      });
    });
  }

  async handleTenantState(message: ConsumedMessage, isSuspended: boolean): Promise<void> {
    if (!message.tenantId) return;

    const tenantId = message.tenantId;
    const payload = isRecord(message.payload) ? message.payload : {};
    if (typeof payload.tenantId === 'string' && payload.tenantId !== tenantId) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const shouldProcess = await this.claimEvent(tx, payload, tenantId);
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
    if (!isRecord(message.payload) || !message.tenantId) return;

    const tenantId = message.tenantId;
    const payload = message.payload;
    if (typeof payload.tenantId === 'string' && payload.tenantId !== tenantId) {
      return;
    }

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

    const features = (isRecord(payload.features) ? payload.features : {}) as object;

    await this.prisma.$transaction(async (tx) => {
      const shouldProcess = await this.claimEvent(tx, payload, tenantId);
      if (!shouldProcess) return;

      const existing = await tx.tenantFeatures.findFirst({
        where: { tenantId },
      });

      if (existing && existing.effectiveAt >= effectiveAt) {
        return; // Ignore stale event
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
      return;
    }

    // 1. Delete all S3 photos under <tenantId>/ prefix
    await this.storage.deleteObjectsByPrefix(`${tenantId}/`);

    // 2. Cascade delete database records for tenant
    await this.prisma.$transaction(async (tx) => {
      await tx.media.deleteMany({ where: { tenantId } });
      await tx.taskAnswer.deleteMany({ where: { tenantId } });
      await tx.task.deleteMany({ where: { tenantId } });
      await tx.taskTemplate.deleteMany({ where: { tenantId } });
      await tx.formVersion.deleteMany({ where: { tenantId } });
      await tx.form.deleteMany({ where: { tenantId } });
      await tx.tenantState.deleteMany({ where: { tenantId } });
      await tx.tenantFeatures.deleteMany({ where: { tenantId } });
      await tx.processedEvent.deleteMany({ where: { tenantId } });
    });
  }
}
