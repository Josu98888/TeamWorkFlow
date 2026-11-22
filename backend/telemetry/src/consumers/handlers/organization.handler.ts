import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  ConsumedEventProcessor,
  PoisonEventError,
  type ConsumedEventContext,
  type PostCommitEffect,
} from '../consumed-event.processor';
import { CONSUMED_SUBJECTS } from '../consumers.constants';
import { ShiftSnapshotService } from '../../shifts/shift-snapshot.service';
import { OrgSnapshotsService } from '../../snapshots/org-snapshots.service';
import { WorkdaysService } from '../../workdays/workdays.service';
import { SiteCacheService } from '../../geofence/site-cache.service';
import { TowerService } from '../../tower/tower.service';
import type { ShiftDto } from '../../nats/dto/nats-contracts';
import type { ShiftStatus } from '../../prisma/generated/client';

@Injectable()
export class OrganizationConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrganizationConsumer.name);

  constructor(
    private readonly processor: ConsumedEventProcessor,
    private readonly shifts: ShiftSnapshotService,
    private readonly workdays: WorkdaysService,
    private readonly siteCache: SiteCacheService,
    private readonly tower: TowerService,
    @Optional() private readonly snapshots?: OrgSnapshotsService,
  ) {}

  onModuleInit(): void {
    this.processor.register({
      filter: CONSUMED_SUBJECTS.SHIFT_CREATED,
      handle: (ctx) => this.handleShiftUpsert(ctx),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.SHIFT_UPDATED,
      handle: (ctx) => this.handleShiftUpsert(ctx),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.SHIFT_CANCELLED,
      handle: (ctx) => this.handleShiftUpsert(ctx),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.SHIFT_STARTED,
      handle: (ctx) => this.handleShiftStatus(ctx, 'IN_PROGRESS'),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.SHIFT_ENDED,
      handle: (ctx) => this.handleShiftEnded(ctx),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.SHIFT_STARTING,
      handle: (ctx) => this.handleShiftStarting(ctx),
    });

    this.processor.register({
      filter: CONSUMED_SUBJECTS.SITE_UPDATED,
      handle: (ctx) => this.handleSiteUpdated(ctx),
    });

    if (this.snapshots) {
      this.processor.register({
        filter: CONSUMED_SUBJECTS.POST_CREATED,
        handle: (ctx) => this.handlePostUpsert(ctx),
      });
      this.processor.register({
        filter: CONSUMED_SUBJECTS.POST_UPDATED,
        handle: (ctx) => this.handlePostUpsert(ctx),
      });
      this.processor.register({
        filter: CONSUMED_SUBJECTS.EMPLOYEE_CREATED,
        handle: (ctx) => this.handleEmployeeUpsert(ctx),
      });
      this.processor.register({
        filter: CONSUMED_SUBJECTS.EMPLOYEE_UPDATED,
        handle: (ctx) => this.handleEmployeeUpsert(ctx),
      });
    }
  }

  private async handleShiftUpsert(
    ctx: ConsumedEventContext,
  ): Promise<PostCommitEffect[] | void> {
    const p = ctx.payload;
    const shiftId = (p.shiftId ?? p.id) as string | undefined;
    const siteId = p.siteId as string | undefined;
    const startsAt = p.startsAt as string | undefined;
    const endsAt = p.endsAt as string | undefined;
    const status = p.status as ShiftStatus | undefined;
    const version = typeof p.version === 'number' ? p.version : undefined;

    if (!shiftId || !siteId || !startsAt || !endsAt || !status || version === undefined) {
      throw new PoisonEventError('Shift payload missing required fields');
    }

    const shiftDto: ShiftDto = {
      id: shiftId,
      tenantId: ctx.tenantId,
      siteId,
      postId: (p.postId as string) ?? shiftId,
      employeeId: (p.employeeId as string) ?? null,
      startsAt,
      endsAt,
      ...(typeof p.authorizedOvertimeMinutes === 'number'
        ? { authorizedOvertimeMinutes: p.authorizedOvertimeMinutes }
        : {}),
      status,
      version,
    };

    await this.shifts.upsertShift(shiftDto, ctx.tx);
    return [
      async () => {
        if (typeof p.authorizedOvertimeMinutes === 'number') {
          await this.workdays.recomputeWorkday(ctx.tenantId, shiftId);
        }
        await this.tower.emitSiteSummaryUpdated(ctx.tenantId, siteId);
      },
    ];
  }

  private async handleShiftStatus(
    ctx: ConsumedEventContext,
    status: ShiftStatus,
  ): Promise<void> {
    const shiftId = (ctx.payload.shiftId ?? ctx.payload.id) as string | undefined;
    if (!shiftId) {
      throw new PoisonEventError('Shift status payload missing shiftId');
    }

    await this.shifts.updateShiftStatus(ctx.tenantId, shiftId, status, ctx.tx);
  }

  private async handleShiftEnded(
    ctx: ConsumedEventContext,
  ): Promise<PostCommitEffect[]> {
    const shiftId = (ctx.payload.shiftId ?? ctx.payload.id) as string | undefined;
    const siteId = ctx.payload.siteId as string | undefined;

    if (!shiftId) {
      throw new PoisonEventError('Shift ended payload missing shiftId');
    }

    await this.shifts.updateShiftStatus(ctx.tenantId, shiftId, 'COMPLETED', ctx.tx);

    return [
      async () => {
        await this.workdays.recomputeWorkday(ctx.tenantId, shiftId);
        if (siteId) {
          await this.tower.emitSiteSummaryUpdated(ctx.tenantId, siteId);
        }
      },
    ];
  }

  private async handleShiftStarting(ctx: ConsumedEventContext): Promise<void> {
    const shiftId = (ctx.payload.shiftId ?? ctx.payload.id) as string | undefined;
    if (!shiftId) {
      throw new PoisonEventError('Shift starting payload missing shiftId');
    }

    await this.shifts.getShift(ctx.tenantId, shiftId);
  }

  private async handleSiteUpdated(ctx: ConsumedEventContext): Promise<void> {
    const siteId = (ctx.payload.siteId ?? ctx.payload.id) as string | undefined;
    if (!siteId) {
      throw new PoisonEventError('Site updated payload missing siteId');
    }

    this.siteCache.invalidateSite(siteId);
    if (this.snapshots) {
      await this.snapshots.upsertSite(
        {
          siteId,
          tenantId: ctx.tenantId,
          name:
            typeof ctx.payload.name === 'string' ? ctx.payload.name : undefined,
          timezone:
            typeof ctx.payload.timezone === 'string'
              ? ctx.payload.timezone
              : undefined,
          isActive:
            typeof ctx.payload.isActive === 'boolean'
              ? ctx.payload.isActive
              : undefined,
        },
        ctx.tx,
      );
    }
  }

  private async handlePostUpsert(ctx: ConsumedEventContext): Promise<void> {
    const postId = (ctx.payload.postId ?? ctx.payload.id) as string | undefined;
    const siteId = ctx.payload.siteId as string | undefined;
    const name = ctx.payload.name as string | undefined;
    if (!postId || !siteId || !name) {
      throw new PoisonEventError('Post payload missing required fields');
    }

    await this.snapshots?.upsertPost(
      {
        postId,
        tenantId: ctx.tenantId,
        siteId,
        name,
        isActive:
          typeof ctx.payload.isActive === 'boolean'
            ? ctx.payload.isActive
            : true,
      },
      ctx.tx,
    );
  }

  private async handleEmployeeUpsert(ctx: ConsumedEventContext): Promise<void> {
    const employeeId = (ctx.payload.employeeId ?? ctx.payload.id) as
      | string
      | undefined;
    const firstName = ctx.payload.firstName as string | undefined;
    const lastName = ctx.payload.lastName as string | undefined;
    if (!employeeId || !firstName || !lastName) {
      throw new PoisonEventError('Employee payload missing required fields');
    }

    await this.snapshots?.upsertEmployee(
      {
        employeeId,
        tenantId: ctx.tenantId,
        userId:
          typeof ctx.payload.userId === 'string'
            ? ctx.payload.userId
            : ctx.payload.userId === null
              ? null
              : undefined,
        firstName,
        lastName,
        employeeNumber:
          typeof ctx.payload.employeeNumber === 'string'
            ? ctx.payload.employeeNumber
            : ctx.payload.employeeNumber === null
              ? null
              : undefined,
        isActive:
          typeof ctx.payload.isActive === 'boolean'
            ? ctx.payload.isActive
            : true,
      },
      ctx.tx,
    );
  }
}
