import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { envs } from '../config';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import {
  previousDayInTz,
  previousYearMonthInTz,
} from './domain/timezone-range';
import { ReportsService } from './reports.service';

@Injectable()
export class DailyReportJob {
  private readonly logger = new Logger(DailyReportJob.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly tenantState: TenantStateService,
    private readonly reportsService: ReportsService,
  ) {}

  @Cron('15 3 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce(new Date());
  }

  async runOnce(now: Date = new Date()): Promise<number> {
    const yesterdayDate = previousDayInTz(now, envs.defaultReportTz);

    const tenants = await this.prisma.shiftSnapshot.findMany({
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    let generated = 0;
    for (const { tenantId } of tenants) {
      if (await this.tenantState.isSuspended(tenantId)) continue;
      try {
        await this.reportsService.generateAndSaveDailySnapshot(
          tenantId,
          yesterdayDate,
          now,
        );
        generated++;
      } catch (err) {
        this.logger.warn(
          `Failed to generate daily report for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return generated;
  }
}

@Injectable()
export class MonthlyReportJob {
  private readonly logger = new Logger(MonthlyReportJob.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly tenantState: TenantStateService,
    private readonly reportsService: ReportsService,
  ) {}

  @Cron('0 7 1 * *')
  async handleCron(): Promise<void> {
    await this.runOnce(new Date());
  }

  async runOnce(now: Date = new Date()): Promise<number> {
    const previousPeriod = previousYearMonthInTz(now, envs.defaultReportTz);

    const tenants = await this.prisma.shiftSnapshot.findMany({
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    let generated = 0;
    for (const { tenantId } of tenants) {
      if (await this.tenantState.isSuspended(tenantId)) continue;
      try {
        await this.reportsService.generateAndSaveMonthlySnapshot(
          tenantId,
          previousPeriod,
          now,
        );
        generated++;
      } catch (err) {
        this.logger.warn(
          `Failed to generate monthly report for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return generated;
  }
}
