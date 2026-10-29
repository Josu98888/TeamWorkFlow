import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService } from '../nats/jetstream.service';
import { ShiftSnapshotService } from '../shifts/shift-snapshot.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import { EmployeeCacheService } from '../geofence/employee-cache.service';
import {
  WorkdayNotFoundException,
} from '../common/exceptions';
import {
  ListWorkdaysDto,
  WorkdayStatusDto,
} from './dto';
import { WORKDAYS_CONSTANTS, WORKDAYS_EVENTS } from './workdays.patterns';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import type {
  Workday,
  WorkdayStatus,
} from '../prisma/generated/client';

const STATUS_MAP: Record<WorkdayStatusDto, WorkdayStatus> = {
  [WorkdayStatusDto.OPEN]: 'OPEN',
  [WorkdayStatusDto.CLOSED]: 'CLOSED',
  [WorkdayStatusDto.MISSING_CLOCK_OUT]: 'MISSING_CLOCK_OUT',
};

@Injectable()
export class WorkdaysService {
  private readonly logger = new Logger(WorkdaysService.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly jetstream: JetStreamService,
    private readonly shifts: ShiftSnapshotService,
    private readonly tenantState: TenantStateService,
    private readonly employeeCache: EmployeeCacheService,
  ) {}

  /**
   * Recalculates exactly one Workday for the shift using all clock events chronologically.
   * Handles worked minutes, overtime, late arrival, missing clock-out status,
   * alert creation/resolution, and JetStream event emission.
   */
  async recomputeWorkday(
    tenantId: string,
    shiftId: string,
  ): Promise<Workday | null> {
    const shift = await this.shifts.getShift(tenantId, shiftId);
    if (!shift) {
      this.logger.warn(
        `Cannot recompute workday: shift ${shiftId} not found in tenant ${tenantId}`,
      );
      return null;
    }

    const events = await this.prisma.clockEvent.findMany({
      where: { tenantId, shiftId },
      orderBy: { deviceTime: 'asc' },
    });

    const employeeId = events[0]?.employeeId ?? shift.employeeId;
    if (!employeeId) {
      this.logger.debug(
        `Shift ${shiftId} has no assigned employee and no clock events; skipping workday calculation`,
      );
      return null;
    }

    let totalWorkedMs = 0;
    let totalBreakMs = 0;
    let currentIn: Date | null = null;
    let currentBreakStart: Date | null = null;
    let firstIn: Date | null = null;

    for (const evt of events) {
      if (evt.type === 'IN') {
        if (!firstIn) {
          firstIn = evt.deviceTime;
        }
        if (!currentIn) {
          currentIn = evt.deviceTime;
        }
      } else if (evt.type === 'BREAK_START') {
        if (currentIn && !currentBreakStart) {
          currentBreakStart = evt.deviceTime;
        }
      } else if (evt.type === 'BREAK_END') {
        if (currentBreakStart) {
          totalBreakMs += evt.deviceTime.getTime() - currentBreakStart.getTime();
          currentBreakStart = null;
        }
      } else if (evt.type === 'OUT') {
        if (currentIn) {
          if (currentBreakStart) {
            totalBreakMs += evt.deviceTime.getTime() - currentBreakStart.getTime();
            currentBreakStart = null;
          }
          const intervalMs = evt.deviceTime.getTime() - currentIn.getTime();
          totalWorkedMs += Math.max(0, intervalMs - totalBreakMs);
          totalBreakMs = 0;
          currentIn = null;
        }
      }
    }

    const now = Date.now();
    const shiftEndMs = shift.endsAt.getTime();
    const missingClockOutThreshold =
      shiftEndMs +
      WORKDAYS_CONSTANTS.MISSING_CLOCK_OUT_HOURS * 60 * 60 * 1000;

    let status: WorkdayStatus;
    let workedMinutes = 0;
    let overtimeMinutes = 0;

    const shiftDurationMinutes = Math.max(
      0,
      Math.floor((shiftEndMs - shift.startsAt.getTime()) / 60000),
    );

    if (firstIn && currentIn && now >= missingClockOutThreshold) {
      status = 'MISSING_CLOCK_OUT';
      workedMinutes = 0;
      overtimeMinutes = 0;
    } else if (firstIn && !currentIn) {
      status = 'CLOSED';
      workedMinutes = Math.floor(totalWorkedMs / 60000);
      overtimeMinutes = Math.max(0, workedMinutes - shiftDurationMinutes);
    } else {
      status = 'OPEN';
      workedMinutes = Math.floor(totalWorkedMs / 60000);
      overtimeMinutes = Math.max(0, workedMinutes - shiftDurationMinutes);
    }

    let lateMinutes = 0;
    if (firstIn && firstIn.getTime() > shift.startsAt.getTime()) {
      lateMinutes = Math.floor(
        (firstIn.getTime() - shift.startsAt.getTime()) / 60000,
      );
    }

    const existingWorkday = await this.prisma.workday.findUnique({
      where: {
        tenantId_shiftId: {
          tenantId,
          shiftId,
        },
      },
    });

    const workday = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.workday.upsert({
        where: {
          tenantId_shiftId: {
            tenantId,
            shiftId,
          },
        },
        create: {
          tenantId,
          shiftId,
          employeeId,
          siteId: shift.siteId,
          workedMinutes,
          overtimeMinutes,
          lateMinutes,
          status,
        },
        update: {
          employeeId,
          siteId: shift.siteId,
          workedMinutes,
          overtimeMinutes,
          lateMinutes,
          status,
        },
      });

      if (status === 'MISSING_CLOCK_OUT') {
        const hasAlerts = await this.tenantState.hasFeature(tenantId, 'alerts');
        const isSuspended = await this.tenantState.isSuspended(tenantId);
        if (hasAlerts && !isSuspended) {
          const existingAlert = await tx.alert.findFirst({
            where: {
              tenantId,
              shiftId,
              type: 'MISSING_CLOCK_OUT',
            },
          });
          if (!existingAlert) {
            await tx.alert.create({
              data: {
                tenantId,
                shiftId,
                siteId: shift.siteId,
                employeeId,
                type: 'MISSING_CLOCK_OUT',
                status: 'OPEN',
              },
            });
          }
        }
      } else if (status === 'CLOSED') {
        // Auto-resolve any open or acknowledged MISSING_CLOCK_OUT alert for this shift
        await tx.alert.updateMany({
          where: {
            tenantId,
            shiftId,
            type: 'MISSING_CLOCK_OUT',
            status: { in: ['OPEN', 'ACKNOWLEDGED'] },
          },
          data: {
            status: 'RESOLVED',
            resolvedBy: 'system',
            resolvedAt: new Date(),
          },
        });
      }

      return saved;
    });

    if (existingWorkday?.status !== 'CLOSED' && workday.status === 'CLOSED') {
      await this.jetstream.publish(tenantId, WORKDAYS_EVENTS.CLOSED, {
        eventId: randomUUID(),
        tenantId,
        workdayId: workday.id,
        shiftId: workday.shiftId,
        employeeId: workday.employeeId,
        siteId: workday.siteId,
        workedMinutes: workday.workedMinutes,
        overtimeMinutes: workday.overtimeMinutes,
        lateMinutes: workday.lateMinutes,
        closedAt: workday.updatedAt.toISOString(),
      });
    }

    return workday;
  }

  /**
   * Retrieves a single Workday by shiftId enforcing role scoping.
   */
  async getWorkdayByShiftId(
    actor: VerifiedActor,
    shiftId: string,
  ): Promise<Workday> {
    const workday = await this.prisma.workday.findUnique({
      where: {
        tenantId_shiftId: {
          tenantId: actor.tenantId,
          shiftId,
        },
      },
    });

    if (!workday) {
      throw new WorkdayNotFoundException();
    }

    if (actor.role === 'employee') {
      const emp = await this.employeeCache.getEmployee(
        actor.tenantId,
        actor.userId,
      );
      if (!emp || workday.employeeId !== emp.id) {
        throw new WorkdayNotFoundException();
      }
    } else if (
      actor.role === 'supervisor' &&
      !actor.siteIds.includes(workday.siteId)
    ) {
      throw new WorkdayNotFoundException();
    }

    return workday;
  }

  /**
   * Lists workdays with filters and pagination, applying strict multi-tenant and role scoping.
   */
  async listWorkdays(
    actor: VerifiedActor,
    query: ListWorkdaysDto,
  ): Promise<{ items: Workday[]; total: number }> {
    const where: any = { tenantId: actor.tenantId };

    if (actor.role === 'employee') {
      const emp = await this.employeeCache.getEmployee(
        actor.tenantId,
        actor.userId,
      );
      where.employeeId = emp?.id ?? '00000000-0000-0000-0000-000000000000';
    } else if (actor.role === 'supervisor') {
      if (query.siteId) {
        if (!actor.siteIds.includes(query.siteId)) {
          throw new WorkdayNotFoundException();
        }
        where.siteId = query.siteId;
      } else {
        where.siteId = { in: actor.siteIds };
      }
    } else if (query.siteId) {
      where.siteId = query.siteId;
    }

    if (query.employeeId && actor.role !== 'employee') {
      where.employeeId = query.employeeId;
    }

    if (query.status) {
      where.status = STATUS_MAP[query.status];
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.workday.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.workday.count({ where }),
    ]);

    return { items, total };
  }
}
