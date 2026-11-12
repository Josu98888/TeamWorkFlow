import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrganizationEventsService } from '../events/organization-events.service';
import { ORGANIZATION_EVENTS } from '../organization.patterns';
import { OrganizationPrismaService } from '../prisma/prisma.service';

type ShiftStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';

interface LifecycleRow {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: ShiftStatus;
  version: number;
}

type LifecycleEvent =
  | typeof ORGANIZATION_EVENTS.shiftStarting
  | typeof ORGANIZATION_EVENTS.shiftStarted
  | typeof ORGANIZATION_EVENTS.shiftEnded;

export interface LifecycleResult {
  starting: number;
  started: number;
  ended: number;
}

// `shift_starting` is emitted this long before the start (AGENTS § Shift lifecycle job).
export const STARTING_LEAD_MS = 15 * 60 * 1000;
const BATCH_SIZE = 200;
// Bounds one tick when a long outage left a large backlog; the next tick continues.
const MAX_BATCHES_PER_PHASE = 5;

// Moves shifts through SCHEDULED -> IN_PROGRESS -> FINISHED and emits
// `shift_starting|started|ended` once per shift. Every transition is a
// compare-and-set (`updateMany` on id, tenant, status and version), so a second
// tick, a second instance or a concurrent edit that lost the race changes
// nothing and emits nothing. A late job catches up on its next run.
@Injectable()
export class ShiftLifecycleService {
  private readonly logger = new Logger(ShiftLifecycleService.name);
  private running = false;

  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly events: OrganizationEventsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTick() {
    // A slow tick must not overlap the next one in this process.
    if (this.running) return;
    this.running = true;
    try {
      await this.tick(new Date());
    } catch (error) {
      // Never log the error message: it may carry data.
      this.logger.error(
        `Shift lifecycle tick failed (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
    } finally {
      this.running = false;
    }
  }

  // Plain method so tests can drive it with a fixed `now`. Phases run in
  // order, so a shift that was missed entirely emits started and then ended.
  async tick(now: Date): Promise<LifecycleResult> {
    const suspended = await this.prisma.tenantState.findMany({
      where: { isSuspended: true },
      select: { tenantId: true },
    });
    const skip = suspended.map((state) => state.tenantId);
    const tenantFilter = skip.length > 0 ? { tenantId: { notIn: skip } } : {};

    const starting = await this.runPhase(
      {
        ...tenantFilter,
        status: 'SCHEDULED',
        startingEmittedAt: null,
        startsAt: {
          gt: now,
          lte: new Date(now.getTime() + STARTING_LEAD_MS),
        },
      },
      (row) => ({ status: row.status, data: { startingEmittedAt: now } }),
      ORGANIZATION_EVENTS.shiftStarting,
      false,
    );
    const started = await this.runPhase(
      { ...tenantFilter, status: 'SCHEDULED', startsAt: { lte: now } },
      () => ({ status: 'IN_PROGRESS' as const, data: {} }),
      ORGANIZATION_EVENTS.shiftStarted,
      true,
    );
    const ended = await this.runPhase(
      { ...tenantFilter, status: 'IN_PROGRESS', endsAt: { lte: now } },
      () => ({ status: 'FINISHED' as const, data: {} }),
      ORGANIZATION_EVENTS.shiftEnded,
      true,
    );

    return { starting, started, ended };
  }

  private async runPhase(
    where: Record<string, unknown>,
    transition: (row: LifecycleRow) => {
      status: ShiftStatus;
      data: Record<string, unknown>;
    },
    event: LifecycleEvent,
    bumpVersion: boolean,
  ) {
    let applied = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_PHASE; batch++) {
      const rows = (await this.prisma.shift.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        take: BATCH_SIZE,
      })) as LifecycleRow[];

      let batchApplied = 0;
      for (const row of rows) {
        const next = transition(row);
        const { count } = await this.prisma.shift.updateMany({
          where: {
            id: row.id,
            tenantId: row.tenantId,
            status: row.status,
            version: row.version,
          },
          data: {
            ...next.data,
            ...(bumpVersion
              ? { status: next.status, version: { increment: 1 } }
              : {}),
          },
        });
        // Zero rows: another tick or a user edit got there first.
        if (count !== 1) continue;
        batchApplied++;
        await this.events.publish(row.tenantId, event, {
          shiftId: row.id,
          tenantId: row.tenantId,
          siteId: row.siteId,
          postId: row.postId,
          employeeId: row.employeeId,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          status: next.status,
          version: bumpVersion ? row.version + 1 : row.version,
        });
      }
      applied += batchApplied;
      // Stop when the backlog is drained, or nothing moved (rows lost races).
      if (rows.length < BATCH_SIZE || batchApplied === 0) break;
    }
    return applied;
  }
}
