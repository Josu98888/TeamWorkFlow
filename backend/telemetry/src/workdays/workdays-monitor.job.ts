import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import { WORKDAYS_CONSTANTS } from './workdays.patterns';
import { WorkdaysService } from './workdays.service';

@Injectable()
export class WorkdaysMonitorJob {
  private readonly logger = new Logger(WorkdaysMonitorJob.name);
  private running = false;

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly tenantState: TenantStateService,
    private readonly workdays: WorkdaysService,
  ) {}

  @Cron('* * * * *')
  async handleTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick(new Date());
    } catch (error) {
      this.logger.error(
        `Workdays monitor tick failed (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
    } finally {
      this.running = false;
    }
  }

  async tick(now: Date = new Date()): Promise<{ recomputed: number }> {
    const overdueShifts = await this.prisma.shiftSnapshot.findMany({
      where: {
        status: { not: 'CANCELLED' },
        employeeId: { not: null },
        endsAt: { lte: now },
      },
      take: 200,
    });

    let recomputed = 0;
    for (const shift of overdueShifts) {
      if (await this.tenantState.isSuspended(shift.tenantId)) {
        continue;
      }

      const existing = await this.prisma.workday.findUnique({
        where: {
          tenantId_shiftId: {
            tenantId: shift.tenantId,
            shiftId: shift.shiftId,
          },
        },
      });

      const effectiveEndMs =
        shift.endsAt.getTime() +
        (shift.authorizedOvertimeMinutes ?? 0) * 60_000;
      const missingOutThresholdMs =
        effectiveEndMs +
        WORKDAYS_CONSTANTS.MISSING_CLOCK_OUT_HOURS * 3600_000;

      // Recompute if no workday exists yet (so ABSENT can be materialized)
      // or if an OPEN workday has reached the MISSING_CLOCK_OUT threshold.
      if (
        !existing ||
        (existing.status === 'OPEN' && now.getTime() >= missingOutThresholdMs)
      ) {
        await this.workdays.recomputeWorkday(shift.tenantId, shift.shiftId);
        recomputed++;
      }
    }

    return { recomputed };
  }
}
